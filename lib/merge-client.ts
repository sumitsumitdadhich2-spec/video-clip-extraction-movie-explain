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
  // Live log-line tap for the step currently running on THIS engine (used to
  // detect segment-file rollovers for status updates during the single pass).
  activeLog: ((line: string) => void) | null
}

async function createEngine(): Promise<Engine> {
  const instance = new FFmpeg()
  const engine: Engine = { ff: instance, isMT: false, logBuffer: [], activeProgress: null, activeLog: null }

  instance.on("log", ({ message }) => {
    engine.logBuffer.push(message)
    // Keep the buffer bounded — a 3GB stream copy can emit a LOT of lines.
    if (engine.logBuffer.length > 400) engine.logBuffer.splice(0, engine.logBuffer.length - 200)
    engine.activeLog?.(message)
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
  engine.activeLog = null
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

/** A user-selected section of the movie (Part B): only this range is merged. */
export interface MovieTrim {
  startSec: number
  endSec: number
}

/** Formats seconds as HH:MM:SS (e.g. 7290 → "02:01:30"). */
export function formatTimecode(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
}

// ---------------------------------------------------------------------------
// Segmented, resumable merge
// ---------------------------------------------------------------------------

/** Output is produced in ~2-minute segments so each part can upload while
 * the next one is still being processed (zero extra save time). */
export const SEGMENT_DURATION_SEC = 120

export interface SegmentPlan {
  totalSegments: number
  segmentDurationSec: number
  totalDurationSec: number | null
}

export interface MergeResult {
  url: string
  /** The final merged file — download-ready the moment processing hits 100%. */
  blob: Blob
  sizeBytes: number
  usedFallback: boolean
}

export interface SegmentedMergeHandlers {
  /** When false, the output is produced in ONE direct pass (no parts).
   * Use this when cloud saving is disabled — segmentation only exists so
   * parts can upload while processing, so without uploads it's pure waste. */
  segmented?: boolean
  onStatus?: (message: string) => void
  /** Processing-only progress, 0..100 (the caller blends in upload progress). */
  onProcessProgress?: (percent: number) => void
  /** Estimated seconds remaining for the current heavy step; null = unknown. */
  onEta?: (secondsRemaining: number | null) => void
  /** Called once the segment plan is known (and again if it falls back to 1 segment). */
  onPlan?: (plan: SegmentPlan) => void
  /** Called the moment a segment's bytes are ready — start its upload here.
   * MUST NOT block: processing of the next segment continues immediately. */
  onSegmentReady?: (index: number, data: Blob) => void
}

export interface ResumeOptions {
  /** Segment indices already uploaded by a previous (interrupted) run. */
  completedSegments: number[]
  /** The interrupted job's segment count — resume only applies when the
   * fresh plan produces the SAME count (deterministic for identical files). */
  expectedTotalSegments: number
  /** Downloads an already-uploaded part so it can be reused locally. */
  fetchPart: (index: number) => Promise<Blob>
}

// Inputs are MOUNTED (read directly from disk by ffmpeg — never copied into
// memory), which is what makes 2-3GB movies workable in the browser.
const MOUNT_DIR = "/merge_in"
const PARTS_DIR = "/merge_parts"
const SHORT_FIXED = "merge_short_fixed.mp4"
const LIST_FILE = "merge_list.txt"
const PARTS_LIST_FILE = "merge_parts_list.txt"
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

async function safeUnmount(engine: Engine, dir: string) {
  try {
    await engine.ff.unmount(dir)
  } catch {
    // not mounted — ignore
  }
  try {
    await engine.ff.deleteDir(dir)
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

/** Internal marker so a per-segment failure can trigger the single-pass fallback. */
class SegmentExecError extends Error {}

/**
 * Joins already-processed part blobs into one MP4 with the concat demuxer
 * (pure stream copy). Parts are MOUNTED via WORKERFS — zero memory copy.
 */
async function concatPartsWithEngine(
  engine: Engine,
  parts: Blob[],
  opts: {
    baseline: number
    span: number
    totalSec: number | null
    onProgress?: (percent: number) => void
    onEta?: (secondsRemaining: number | null) => void
  },
): Promise<Blob> {
  const ff = engine.ff
  await safeUnmount(engine, PARTS_DIR)
  await ff.createDir(PARTS_DIR)
  await ff.mount(
    WORKERFS,
    { blobs: parts.map((data, i) => ({ name: `p${i}.mp4`, data: data as File })) },
    PARTS_DIR,
  )
  await ff.writeFile(
    PARTS_LIST_FILE,
    new TextEncoder().encode(parts.map((_, i) => `file '${PARTS_DIR}/p${i}.mp4'`).join("\n")),
  )

  try {
    const ret = await execWithProgress(
      engine,
      [
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        PARTS_LIST_FILE,
        "-c",
        "copy",
        "-fflags",
        "+genpts",
        "-avoid_negative_ts",
        "make_zero",
        "-y",
        OUTPUT,
      ],
      opts,
    )
    if (ret !== 0) {
      console.log("[v0] parts concat failed, logs tail:", engine.logBuffer.slice(-15).join(" | "))
      throw new Error("Failed to assemble the final video from its parts.")
    }

    const data = (await engine.ff.readFile(OUTPUT)) as Uint8Array
    await safeDelete(engine, OUTPUT)
    if (data.byteLength === 0) throw new Error("Final video assembly produced an empty file.")
    return new Blob([data as BlobPart], { type: "video/mp4" })
  } finally {
    await safeDelete(engine, PARTS_LIST_FILE)
    await safeUnmount(engine, PARTS_DIR)
  }
}

/**
 * Rebuilds one MP4 from saved history parts (used by the History panel's
 * Download button). Creates its own isolated engine.
 */
export async function concatPartBlobs(parts: Blob[], onProgress?: (percent: number) => void): Promise<Blob> {
  if (parts.length === 1) return parts[0]
  const engine = await createEngine()
  try {
    return await concatPartsWithEngine(engine, parts, {
      baseline: 0,
      span: 100,
      totalSec: null,
      onProgress,
    })
  } finally {
    destroyEngine(engine)
  }
}

/**
 * Merges shortFile (Part A, front) + movieFile (Part B, back) into one MP4,
 * producing the output in time segments so each part can be uploaded to
 * cloud storage WHILE the next part is still processing.
 *
 * Primary path: concat demuxer with `-c copy` — zero re-encoding, original
 * quality. When codecs/resolution differ, ONLY the short video is converted
 * to match the movie (the movie is never re-encoded).
 *
 * If per-segment extraction fails for an exotic container, it automatically
 * falls back to a single full-length pass (same behavior as before), so a
 * merge never breaks because of segmentation.
 *
 * PARALLEL-SAFE: every call creates its own isolated ffmpeg engine.
 */
export async function processMergeInSegments(
  shortFile: File,
  movieFile: File,
  handlers: SegmentedMergeHandlers = {},
  resume?: ResumeOptions,
  movieTrim?: MovieTrim | null,
): Promise<MergeResult> {
  const { segmented, onStatus, onProcessProgress: onProgress, onEta, onPlan, onSegmentReady } = handlers

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
    await safeUnmount(engine, MOUNT_DIR)
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

    // Validate + clamp the trim against the movie's REAL duration. A trim
    // that covers (almost) the whole movie is treated as "no trim" so the
    // concat list stays byte-identical to the untrimmed path.
    let trim: MovieTrim | null = null
    if (movieTrim && movieInfo.durationSec !== null) {
      const start = Math.max(0, Math.min(movieTrim.startSec, movieInfo.durationSec))
      const end = Math.max(0, Math.min(movieTrim.endSec, movieInfo.durationSec))
      if (end > start && (start > 0.5 || end < movieInfo.durationSec - 0.5)) {
        trim = { startSec: start, endSec: end }
      }
    } else if (movieTrim && movieTrim.endSec > movieTrim.startSec) {
      // Duration unknown (rare) — trust the user's values as-is.
      trim = { startSec: Math.max(0, movieTrim.startSec), endSec: movieTrim.endSec }
    }

    // The movie length that actually ends up in the output.
    const movieOutSec = trim ? trim.endSec - trim.startSec : movieInfo.durationSec

    // Total output duration — the base for the segment plan + accurate progress.
    const totalDurationSec =
      shortInfo.durationSec !== null && movieOutSec !== null ? shortInfo.durationSec + movieOutSec : null

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
        span: 6,
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

      // `-threads 0` BEFORE -i = multi-threaded DECODE of the short as well
      // (not just the encode) when the MT core is active.
      const args: string[] = engine.isMT ? ["-threads", "0", "-i", SHORT_IN] : ["-i", SHORT_IN]
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
        span: 6,
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

    // Concat list — when a trim is set, `inpoint`/`outpoint` limit the movie
    // to the selected range INSIDE the same single stream-copy pass (zero
    // extra steps, zero re-encoding; cuts land on the nearest keyframe).
    const movieEntry = trim
      ? `file '${MOVIE_IN}'\ninpoint ${trim.startSec.toFixed(3)}\noutpoint ${trim.endSec.toFixed(3)}`
      : `file '${MOVIE_IN}'`
    await ff.writeFile(LIST_FILE, new TextEncoder().encode(`file '${shortName}'\n${movieEntry}`))

    // --- Segment plan ------------------------------------------------------
    // Segmentation ONLY exists so parts can upload to the cloud while the
    // next part processes. When cloud saving is off (`segmented: false`),
    // always do ONE direct stream-copy pass — much faster, no parts.
    // Otherwise, only worth segmenting when the output is meaningfully
    // longer than one segment; unknown duration also means a single pass.
    let plan: SegmentPlan = {
      totalSegments:
        segmented !== false && totalDurationSec !== null && totalDurationSec > SEGMENT_DURATION_SEC * 1.5
          ? Math.ceil(totalDurationSec / SEGMENT_DURATION_SEC)
          : 1,
      segmentDurationSec: SEGMENT_DURATION_SEC,
      totalDurationSec,
    }
    onPlan?.(plan)

    // Segments get the big 15→88% range (they ARE the merge). Final local
    // assembly (fast stream copy of already-processed parts) gets 88→99%.
    const SEG_BASE = 15
    const SEG_SPAN = 73

    // ONE direct full-length stream-copy pass (no parts). Used when
    // segmentation is off (cloud saving disabled) and as the safety fallback.
    const runSinglePass = async (): Promise<Blob> => {
      const ret = await execWithProgress(
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
        { baseline: SEG_BASE, span: SEG_SPAN, totalSec: totalDurationSec, onProgress, onEta },
      )
      if (ret !== 0) {
        console.log("[v0] single-pass merge failed, logs tail:", engine.logBuffer.slice(-10).join(" | "))
        throw new SegmentExecError("Single-pass merge failed")
      }
      const data = (await ff.readFile(OUTPUT)) as Uint8Array
      await safeDelete(engine, OUTPUT)
      if (data.byteLength === 0) throw new SegmentExecError("Merge produced an empty file")
      return new Blob([data as BlobPart], { type: "video/mp4" })
    }

    // Segmented output: ONE stream-copy pass through ffmpeg's built-in
    // `-f segment` muxer. Unlike the old per-part seek+cut approach (which
    // re-opened the input for every part and duplicated 10-40s of content at
    // every keyframe boundary — inflating a 1h35m movie to ~2h and drifting
    // the audio out of sync), the segment muxer splits the CONTINUOUS packet
    // stream at keyframes with ZERO overlap and ZERO duplication. It's also
    // much faster: 1 read of the inputs instead of N.
    const runSegmentedPass = async (): Promise<Blob[]> => {
      const partPattern = /merge_part_(\d+)\.mp4/
      // Live "part X of Y" status as ffmpeg rolls over to each new part file.
      engine.activeLog = (line) => {
        if (!line.includes("Opening") || !line.includes("for writing")) return
        const m = line.match(partPattern)
        if (m) {
          const n = Number.parseInt(m[1], 10) + 1
          onStatus?.(`Merging + saving — part ${n} of ~${plan.totalSegments} (stream copy)...`)
        }
      }
      let ret: number
      try {
        ret = await execWithProgress(
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
            "-f",
            "segment",
            "-segment_time",
            String(plan.segmentDurationSec),
            "-reset_timestamps",
            "1",
            "-y",
            "merge_part_%d.mp4",
          ],
          { baseline: SEG_BASE, span: SEG_SPAN, totalSec: totalDurationSec, onProgress, onEta },
        )
      } finally {
        engine.activeLog = null
      }
      if (ret !== 0) {
        console.log("[v0] segment-muxer pass failed, logs tail:", engine.logBuffer.slice(-10).join(" | "))
        throw new SegmentExecError("Segment muxer pass failed")
      }

      // Collect the parts ffmpeg actually produced (keyframe cuts mean the
      // real count can be slightly below the duration-based estimate).
      const nodes = await ff.listDir("/")
      const indices = nodes
        .map((n) => {
          const m = n.name.match(/^merge_part_(\d+)\.mp4$/)
          return m ? Number.parseInt(m[1], 10) : null
        })
        .filter((n): n is number => n !== null)
        .sort((x, y) => x - y)
      if (indices.length === 0) throw new SegmentExecError("Segment muxer produced no parts")

      const blobs: Blob[] = []
      for (const idx of indices) {
        const name = `merge_part_${idx}.mp4`
        const data = (await ff.readFile(name)) as Uint8Array
        await safeDelete(engine, name)
        if (data.byteLength === 0) throw new SegmentExecError(`Segment ${idx} produced an empty file`)
        blobs.push(new Blob([data as BlobPart], { type: "video/mp4" }))
      }
      return blobs
    }

    // NOTE on resume: parts saved by older versions were cut with per-part
    // seeks and contain overlapping content, so they can't be reused safely.
    // Every merge now regenerates all parts in one clean pass and re-fires
    // onSegmentReady for each — the caller's upload simply overwrites any
    // previously saved (possibly corrupt) parts at the same paths.
    if (resume && resume.completedSegments.length > 0) {
      console.log("[v0] resume data found — regenerating and re-saving all parts (single-pass split, no reuse)")
    }

    // --- Process segments (uploads run in the caller, in parallel) ---------
    const parts: Blob[] = []
    try {
      if (plan.totalSegments > 1) {
        onStatus?.(`Merging + saving — splitting into ~${plan.totalSegments} parts (stream copy)...`)
        const blobs = await runSegmentedPass()
        if (blobs.length !== plan.totalSegments) {
          // Report the REAL count so the manifest/progress UI match reality.
          plan = { ...plan, totalSegments: blobs.length }
          onPlan?.(plan)
        }
        for (let idx = 0; idx < blobs.length; idx++) {
          parts.push(blobs[idx])
          onSegmentReady?.(idx, blobs[idx])
        }
      } else {
        onStatus?.("Merging Part A + Part B (stream copy — no re-encoding)...")
        const blob = await runSinglePass()
        parts.push(blob)
        onSegmentReady?.(0, blob)
      }
    } catch (err) {
      if (!(err instanceof SegmentExecError) || plan.totalSegments <= 1) {
        throw err instanceof SegmentExecError
          ? new Error("Merging failed while joining the two videos. The files may be in an unsupported format.")
          : err
      }
      // Segment muxer failed for this container — fall back to one
      // full-length pass so the merge itself never breaks.
      console.log("[v0] segment muxer failed — falling back to single-pass merge")
      plan = { totalSegments: 1, segmentDurationSec: SEGMENT_DURATION_SEC, totalDurationSec }
      onPlan?.(plan)
      parts.length = 0
      onStatus?.("Merging Part A + Part B (stream copy — no re-encoding)...")
      let blob: Blob
      try {
        blob = await runSinglePass()
      } catch {
        throw new Error("Merging failed while joining the two videos. The files may be in an unsupported format.")
      }
      parts.push(blob)
      onSegmentReady?.(0, blob)
    }

    // Release inputs BEFORE assembling the final file to minimize peak memory.
    await safeDelete(engine, SHORT_FIXED)
    await safeDelete(engine, LIST_FILE)
    await safeUnmount(engine, MOUNT_DIR)

    // --- Local final assembly (fast stream copy of local parts) ------------
    let finalBlob: Blob
    if (parts.length === 1) {
      finalBlob = parts[0]
      onProgress?.(99)
    } else {
      onStatus?.("Finalizing video (joining parts — stream copy)...")
      onProgress?.(88)
      finalBlob = await concatPartsWithEngine(engine, parts, {
        baseline: 88,
        span: 11,
        totalSec: totalDurationSec,
        onProgress,
        onEta,
      })
    }

    // --- Output verification (guards against duration/sync regressions) ----
    // Probe the final file's REAL duration and compare with short + movie.
    // Best-effort: verification problems never fail a completed merge.
    if (totalDurationSec !== null) {
      const VERIFY_DIR = "/merge_verify"
      try {
        await safeUnmount(engine, VERIFY_DIR)
        await ff.createDir(VERIFY_DIR)
        await ff.mount(WORKERFS, { blobs: [{ name: "out.mp4", data: finalBlob as File }] }, VERIFY_DIR)
        const outInfo = await probeFile(engine, `${VERIFY_DIR}/out.mp4`)
        if (outInfo.durationSec !== null) {
          const diff = Math.abs(outInfo.durationSec - totalDurationSec)
          if (diff > 5) {
            console.warn(
              `[v0] MERGE DURATION MISMATCH: expected ~${formatTimecode(totalDurationSec)} but output is ${formatTimecode(outInfo.durationSec)} (off by ${Math.round(diff)}s) — possible overlap/sync bug`,
            )
          } else {
            console.log(
              `[v0] merge verified: output ${formatTimecode(outInfo.durationSec)} ≈ expected ${formatTimecode(totalDurationSec)}`,
            )
          }
        }
      } catch {
        // verification is best-effort only
      } finally {
        await safeUnmount(engine, VERIFY_DIR)
      }
    }

    const url = URL.createObjectURL(finalBlob)
    onProgress?.(100)
    onEta?.(null)
    onStatus?.("Done!")

    return { url, blob: finalBlob, sizeBytes: finalBlob.size, usedFallback }
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
