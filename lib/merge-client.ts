"use client"

import { FFmpeg } from "@ffmpeg/ffmpeg"
import type { FFFSType } from "@ffmpeg/ffmpeg"
import { toBlobURL } from "@ffmpeg/util"

// FFFSType.WORKERFS as a value — the enum itself isn't exported from the
// package's SSR stub, so we use the literal (it's just the string "WORKERFS").
const WORKERFS = "WORKERFS" as FFFSType

// Self-hosted single-threaded ffmpeg core (same files Page 2 uses, but a
// fully separate instance so the matcher tool is never affected).
const CORE_JS = "/ffmpeg/ffmpeg-core.js"
const CORE_WASM = "/ffmpeg/ffmpeg-core.wasm"

// Self-hosted MULTI-THREADED core — uses ALL CPU cores for the conversion
// step (4-6x faster). Requires SharedArrayBuffer (cross-origin isolation),
// so we feature-detect and fall back to the single-threaded core when the
// browser/embedding context doesn't allow it.
const CORE_MT_JS = "/ffmpeg-mt/ffmpeg-core.js"
const CORE_MT_WASM = "/ffmpeg-mt/ffmpeg-core.wasm"
const CORE_MT_WORKER = "/ffmpeg-mt/ffmpeg-core.worker.js"

/** True when the page is cross-origin isolated and SharedArrayBuffer exists. */
export function multiThreadAvailable(): boolean {
  try {
    return (
      typeof SharedArrayBuffer !== "undefined" &&
      typeof crossOriginIsolated !== "undefined" &&
      crossOriginIsolated === true
    )
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Per-job engine — each merge job gets its OWN ffmpeg instance so multiple
// merges can run in PARALLEL without sharing state or files.
// ---------------------------------------------------------------------------

interface Engine {
  ff: FFmpeg
  isMT: boolean
  logBuffer: string[]
  // Dispatches ffmpeg's real progress reports (out_time of the file being
  // written) to whichever step is currently running on THIS engine.
  activeProgress: ((timeUs: number, libProgress: number) => void) | null
}

async function createEngine(): Promise<Engine> {
  const instance = new FFmpeg()
  const engine: Engine = { ff: instance, isMT: false, logBuffer: [], activeProgress: null }

  instance.on("log", ({ message }) => {
    engine.logBuffer.push(message)
    // Keep the buffer bounded — a 3GB stream copy can emit a LOT of lines.
    if (engine.logBuffer.length > 400) engine.logBuffer.splice(0, engine.logBuffer.length - 200)
  })
  instance.on("progress", ({ progress, time }) => {
    engine.activeProgress?.(time, progress)
  })

  if (multiThreadAvailable()) {
    try {
      await instance.load({
        coreURL: await toBlobURL(CORE_MT_JS, "text/javascript"),
        wasmURL: await toBlobURL(CORE_MT_WASM, "application/wasm"),
        workerURL: await toBlobURL(CORE_MT_WORKER, "text/javascript"),
      })
      engine.isMT = true
      return engine
    } catch {
      // MT core failed to load — fall through to the single-threaded core.
    }
  }

  await instance.load({
    coreURL: await toBlobURL(CORE_JS, "text/javascript"),
    wasmURL: await toBlobURL(CORE_WASM, "application/wasm"),
  })

  return engine
}

// Fully discard an engine. Called after EVERY job (success or failure) —
// WASM heaps grow but never shrink, so retiring the instance hands the
// memory back to the browser and keeps parallel jobs from starving each
// other. A fresh engine loads in ~1s.
function destroyEngine(engine: Engine) {
  try {
    engine.ff.terminate()
  } catch {
    // already dead — ignore
  }
  engine.activeProgress = null
  engine.logBuffer = []
}

// ---------------------------------------------------------------------------
// Stream probing (via ffmpeg -i log output — no re-encode, instant)
// ---------------------------------------------------------------------------

export interface StreamInfo {
  videoCodec: string | null
  videoProfile: string | null
  width: number | null
  height: number | null
  fps: number | null
  audioCodec: string | null
  sampleRate: number | null
  channels: string | null
  durationSec: number | null
}

function parseStreamInfo(logs: string[]): StreamInfo {
  const info: StreamInfo = {
    videoCodec: null,
    videoProfile: null,
    width: null,
    height: null,
    fps: null,
    audioCodec: null,
    sampleRate: null,
    channels: null,
    durationSec: null,
  }

  for (const line of logs) {
    if (info.durationSec === null) {
      const durMatch = line.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/)
      if (durMatch) {
        info.durationSec =
          Number.parseInt(durMatch[1], 10) * 3600 +
          Number.parseInt(durMatch[2], 10) * 60 +
          Number.parseFloat(durMatch[3])
      }
    }
    if (line.includes("Video:") && info.videoCodec === null) {
      const codecMatch = line.match(/Video:\s*(\w+)/)
      if (codecMatch) info.videoCodec = codecMatch[1]
      const profileMatch = line.match(/Video:\s*\w+\s*\(([^)/]+)\)/)
      if (profileMatch) info.videoProfile = profileMatch[1].trim()
      const dimMatch = line.match(/(\d{2,5})x(\d{2,5})/)
      if (dimMatch) {
        info.width = Number.parseInt(dimMatch[1], 10)
        info.height = Number.parseInt(dimMatch[2], 10)
      }
      const fpsMatch = line.match(/([\d.]+)\s*fps/)
      if (fpsMatch) info.fps = Number.parseFloat(fpsMatch[1])
    }
    if (line.includes("Audio:") && info.audioCodec === null) {
      const codecMatch = line.match(/Audio:\s*(\w+)/)
      if (codecMatch) info.audioCodec = codecMatch[1]
      const srMatch = line.match(/(\d{4,6})\s*Hz/)
      if (srMatch) info.sampleRate = Number.parseInt(srMatch[1], 10)
      const chMatch = line.match(/Hz,\s*([\w.()]+)/)
      if (chMatch) info.channels = chMatch[1]
    }
  }

  return info
}

async function probeFile(engine: Engine, name: string): Promise<StreamInfo> {
  engine.logBuffer = []
  // `ffmpeg -i file` exits with an error (no output specified) but prints
  // full stream info to the log — that's all we need. Wrap in try/catch.
  try {
    await engine.ff.exec(["-i", name])
  } catch {
    // expected — no output file was requested
  }
  return parseStreamInfo(engine.logBuffer)
}

// ---------------------------------------------------------------------------
// Accurate progress tracking
// ---------------------------------------------------------------------------

export interface MergeHandlers {
  onStatus?: (message: string) => void
  onProgress?: (percent: number) => void
  /** Estimated seconds remaining for the current heavy step; null = unknown. */
  onEta?: (secondsRemaining: number | null) => void
}

/**
 * Runs one ffmpeg exec while converting its REAL output-time reports into
 * an overall percentage (baseline → baseline+span) plus a time-remaining
 * estimate based on measured throughput. `totalSec` is the expected output
 * duration; when unknown we fall back to ffmpeg's own progress ratio.
 */
async function execWithProgress(
  engine: Engine,
  args: string[],
  opts: {
    baseline: number
    span: number
    totalSec: number | null
    onProgress?: (percent: number) => void
    onEta?: (secondsRemaining: number | null) => void
  },
): Promise<number> {
  const { baseline, span, totalSec, onProgress, onEta } = opts
  const startedAt = Date.now()
  let lastPercent = -1

  engine.activeProgress = (timeUs, libProgress) => {
    let f: number
    if (totalSec && totalSec > 0 && Number.isFinite(timeUs) && timeUs > 0) {
      f = timeUs / 1_000_000 / totalSec
    } else {
      f = libProgress
    }
    if (!Number.isFinite(f)) f = 0
    f = Math.min(Math.max(f, 0), 1)

    const percent = Math.min(baseline + span, Math.round(baseline + f * span))
    if (percent !== lastPercent) {
      lastPercent = percent
      onProgress?.(percent)
    }

    // Time remaining from real throughput. Skip the first ~3% so a couple
    // of early samples can't produce a wild estimate.
    if (f >= 0.03 && f < 1) {
      const elapsedSec = (Date.now() - startedAt) / 1000
      if (elapsedSec >= 1) {
        onEta?.(Math.max(1, Math.round((elapsedSec * (1 - f)) / f)))
      }
    } else if (f >= 1) {
      onEta?.(0)
    }
  }

  try {
    engine.logBuffer = []
    return await engine.ff.exec(args)
  } finally {
    engine.activeProgress = null
    onEta?.(null)
  }
}

export function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m < 60) return `${m}m ${s.toString().padStart(2, "0")}s`
  const h = Math.floor(m / 60)
  return `${h}h ${(m % 60).toString().padStart(2, "0")}m`
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export interface MergeResult {
  url: string
  /** The merged file itself — used to save it to cloud storage (history). */
  blob: Blob
  sizeBytes: number
  usedFallback: boolean
}

// Inputs are MOUNTED (read directly from disk by ffmpeg — never copied into
// memory), which is what makes 2-3GB movies workable in the browser.
const MOUNT_DIR = "/merge_in"
const SHORT_FIXED = "merge_short_fixed.mp4"
const LIST_FILE = "merge_list.txt"
const OUTPUT = "merge_output.mp4"

function extOf(file: File): string {
  const m = file.name.match(/\.(\w{2,5})$/)
  return m ? m[1].toLowerCase() : "mp4"
}

async function safeDelete(engine: Engine, name: string) {
  try {
    await engine.ff.deleteFile(name)
  } catch {
    // file may not exist — ignore
  }
}

async function safeUnmount(engine: Engine) {
  try {
    await engine.ff.unmount(MOUNT_DIR)
  } catch {
    // not mounted — ignore
  }
  try {
    await engine.ff.deleteDir(MOUNT_DIR)
  } catch {
    // dir may not exist — ignore
  }
}

function isMemoryError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    msg.includes("oom") ||
    msg.includes("out of memory") ||
    msg.includes("cannot enlarge memory") ||
    msg.includes("allocation") ||
    msg.includes("abort") ||
    msg.includes("memory access out of bounds")
  )
}

/**
 * Merges shortFile (Part A, front) + movieFile (Part B, back) into one MP4.
 *
 * Primary path: concat demuxer with `-c copy` — zero re-encoding, so it is
 * as fast as a file copy and preserves 100% original quality.
 *
 * Fallback (only when codecs/resolution mismatch): ONLY the short video
 * is re-encoded to match the movie's parameters (short = tiny, takes
 * seconds). The movie is NEVER re-encoded — always stream-copied.
 *
 * PARALLEL-SAFE: every call creates its own isolated ffmpeg engine, so
 * multiple merges can run at the same time without interfering.
 */
export async function mergeVideos(
  shortFile: File,
  movieFile: File,
  handlers: MergeHandlers = {},
): Promise<MergeResult> {
  const { onStatus, onProgress, onEta } = handlers

  onStatus?.("Loading merge engine...")
  onProgress?.(1)
  const engine = await createEngine()
  const ff = engine.ff

  const SHORT_IN = `${MOUNT_DIR}/a.${extOf(shortFile)}`
  const MOVIE_IN = `${MOUNT_DIR}/b.${extOf(movieFile)}`

  try {
    // Mount inputs — instant, zero copy, works for multi-GB files.
    onStatus?.("Opening files (direct disk access — no memory copy)...")
    onProgress?.(3)
    await safeUnmount(engine)
    await ff.createDir(MOUNT_DIR)
    await ff.mount(
      WORKERFS,
      {
        blobs: [
          { name: `a.${extOf(shortFile)}`, data: shortFile },
          { name: `b.${extOf(movieFile)}`, data: movieFile },
        ],
      },
      MOUNT_DIR,
    )

    onStatus?.("Analyzing Part A (short video)...")
    onProgress?.(4)
    const shortInfo = await probeFile(engine, SHORT_IN)

    onStatus?.("Analyzing Part B (full movie)...")
    onProgress?.(6)
    const movieInfo = await probeFile(engine, MOVIE_IN)

    // Total output duration — the base for ACCURATE percentage reporting.
    const totalDurationSec =
      shortInfo.durationSec !== null && movieInfo.durationSec !== null
        ? shortInfo.durationSec + movieInfo.durationSec
        : null

    let shortName = SHORT_IN
    let usedFallback = false

    const vOk =
      shortInfo.videoCodec !== null &&
      shortInfo.videoCodec === movieInfo.videoCodec &&
      shortInfo.width === movieInfo.width &&
      shortInfo.height === movieInfo.height
    const aOk =
      (shortInfo.audioCodec === null && movieInfo.audioCodec === null) ||
      (shortInfo.audioCodec === movieInfo.audioCodec && shortInfo.sampleRate === movieInfo.sampleRate)

    // The short-fix step (when needed) is quick; give it 8→22%. The concat
    // (the real work, scales with movie size) gets the big 22→90% range.
    const CONCAT_BASE = 8
    const CONCAT_BASE_FALLBACK = 22

    if (vOk && !aOk) {
      // FAST PATH: video matches — copy it bit-for-bit, convert ONLY the
      // short's tiny audio track. Takes a second or two even for long shorts.
      usedFallback = true
      onStatus?.("Video formats match — fixing only the short's audio track (video untouched)...")
      onProgress?.(8)

      const targetSR = movieInfo.sampleRate ? String(movieInfo.sampleRate) : "44100"
      const movieHasAudio = movieInfo.audioCodec !== null
      const shortHasAudio = shortInfo.audioCodec !== null

      const args: string[] = ["-i", SHORT_IN]
      if (movieHasAudio && !shortHasAudio) {
        args.push("-f", "lavfi", "-i", `anullsrc=r=${targetSR}:cl=stereo`)
        args.push("-map", "0:v:0", "-map", "1:a:0", "-shortest")
      }
      args.push("-c:v", "copy")
      if (movieHasAudio) {
        args.push("-c:a", "aac", "-ar", targetSR, "-ac", "2")
      } else {
        args.push("-an")
      }
      args.push("-y", SHORT_FIXED)

      const audioRet = await execWithProgress(engine, args, {
        baseline: 8,
        span: 14,
        totalSec: shortInfo.durationSec,
        onProgress,
        onEta,
      })
      if (audioRet !== 0) {
        console.log("[v0] audio-only fix failed, logs tail:", engine.logBuffer.slice(-10).join(" | "))
        throw new Error("Could not adapt the short video's audio. Try a different short file.")
      }
      shortName = SHORT_FIXED
    } else if (!vOk) {
      // Fallback: convert ONLY the short to match the movie. Movie untouched.
      usedFallback = true
      onStatus?.(
        engine.isMT
          ? "Formats differ — fast multi-core conversion of the short video (movie stays original quality)..."
          : "Formats differ — converting only the short video to match the movie (movie stays original quality)...",
      )
      onProgress?.(8)

      const targetW = movieInfo.width ?? 1280
      const targetH = movieInfo.height ?? 720
      const targetFps = movieInfo.fps ? movieInfo.fps.toFixed(3) : "24"
      const targetSR = movieInfo.sampleRate ? String(movieInfo.sampleRate) : "44100"

      // Match the movie's h264 profile so the copied movie packets and the
      // re-encoded short packets share one decoder configuration — mixed
      // profiles in a single stream glitch in some players.
      const profileLower = (movieInfo.videoProfile ?? "").toLowerCase()
      const targetProfile = profileLower.includes("baseline")
        ? "baseline"
        : profileLower.includes("main")
          ? "main"
          : "high"

      // Concat with -c copy requires IDENTICAL stream layouts. If the movie
      // has audio but the short doesn't, give the short a silent track; if
      // the movie has no audio, strip the short's audio.
      const movieHasAudio = movieInfo.audioCodec !== null
      const shortHasAudio = shortInfo.audioCodec !== null

      const args: string[] = ["-i", SHORT_IN]
      if (movieHasAudio && !shortHasAudio) {
        args.push("-f", "lavfi", "-i", `anullsrc=r=${targetSR}:cl=stereo`)
      }
      args.push(
        "-vf",
        `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,fps=${targetFps},format=yuv420p`,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "18",
        "-profile:v",
        targetProfile,
      )
      if (engine.isMT) {
        // Use every available CPU core for the encode (4-6x faster).
        args.push("-threads", "0")
      }
      if (movieHasAudio) {
        if (!shortHasAudio) {
          args.push("-map", "0:v:0", "-map", "1:a:0", "-shortest")
        }
        args.push("-c:a", "aac", "-ar", targetSR, "-ac", "2")
      } else {
        args.push("-an")
      }
      args.push("-y", SHORT_FIXED)

      const encodeRet = await execWithProgress(engine, args, {
        baseline: 8,
        span: 14,
        totalSec: shortInfo.durationSec,
        onProgress,
        onEta,
      })
      if (encodeRet !== 0) {
        console.log("[v0] fallback encode failed, logs tail:", engine.logBuffer.slice(-10).join(" | "))
        throw new Error("Could not convert the short video to match the movie format. Try a different short file.")
      }
      shortName = SHORT_FIXED
    }

    const concatBase = usedFallback ? CONCAT_BASE_FALLBACK : CONCAT_BASE
    onStatus?.("Merging Part A + Part B (stream copy — no re-encoding)...")
    onProgress?.(concatBase)

    await ff.writeFile(
      LIST_FILE,
      new TextEncoder().encode(`file '${shortName}'\nfile '${MOVIE_IN}'`),
    )

    // Real progress: ffmpeg reports the output timestamp as it writes; we
    // compare against the known total duration for a true percentage + ETA.
    const concatRet = await execWithProgress(
      engine,
      [
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        LIST_FILE,
        "-c",
        "copy",
        "-fflags",
        "+genpts",
        "-avoid_negative_ts",
        "make_zero",
        "-y",
        OUTPUT,
      ],
      {
        baseline: concatBase,
        span: 90 - concatBase,
        totalSec: totalDurationSec,
        onProgress,
        onEta,
      },
    )
    if (concatRet !== 0) {
      console.log("[v0] concat failed, logs tail:", engine.logBuffer.slice(-15).join(" | "))
      throw new Error("Merging failed while joining the two videos. The files may be in an unsupported format.")
    }

    // Release inputs BEFORE reading the output to minimize peak memory.
    await safeDelete(engine, SHORT_FIXED)
    await safeDelete(engine, LIST_FILE)
    await safeUnmount(engine)

    onStatus?.("Preparing download...")
    onProgress?.(92)
    const data = (await ff.readFile(OUTPUT)) as Uint8Array
    // Free the in-engine copy immediately — the bytes now live in `data`.
    await safeDelete(engine, OUTPUT)

    if (data.byteLength === 0) {
      throw new Error("Merge produced an empty file. The inputs may be in an unsupported format.")
    }

    onProgress?.(96)
    const blob = new Blob([data as BlobPart], { type: "video/mp4" })
    const url = URL.createObjectURL(blob)

    onProgress?.(100)
    onEta?.(null)
    onStatus?.("Done!")

    return { url, blob, sizeBytes: data.byteLength, usedFallback }
  } catch (err) {
    if (isMemoryError(err)) {
      throw new Error(
        "The browser ran out of memory while merging these files. Close other tabs and try again, or use a slightly smaller movie file. (Browsers cap how much memory one page can use — this is a browser limit, not a bug.)",
      )
    }
    throw err
  } finally {
    // Retire the engine after EVERY job — hands WASM memory back to the
    // browser immediately, which is essential when jobs run in parallel.
    destroyEngine(engine)
    onEta?.(null)
  }
}

// Inputs are now streamed from disk (never loaded into memory), so the only
// real constraint is the merged OUTPUT held by the engine while writing.
// 3.5GB covers 2-3GB movies; if a machine truly runs out of RAM, the merge
// fails with a clear recoverable message instead of a stuck/broken page.
export const MAX_TOTAL_BYTES = 3.5 * 1024 * 1024 * 1024

export function totalSizeOk(shortFile: File | null, movieFile: File | null): boolean {
  const total = (shortFile?.size ?? 0) + (movieFile?.size ?? 0)
  return total <= MAX_TOTAL_BYTES
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
