"use client"

import { FFmpeg } from "@ffmpeg/ffmpeg"
import { toBlobURL } from "@ffmpeg/util"

// Read a File into a Uint8Array using the modern arrayBuffer() API —
// more reliable than FileReader-based helpers across browsers.
async function fileToUint8(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}

// Self-hosted single-threaded ffmpeg core (same files Page 2 uses, but a
// fully separate instance so the matcher tool is never affected).
const CORE_JS = "/ffmpeg/ffmpeg-core.js"
const CORE_WASM = "/ffmpeg/ffmpeg-core.wasm"

let mergeFF: FFmpeg | null = null
let logBuffer: string[] = []

async function getMergeFFmpeg(): Promise<FFmpeg> {
  if (mergeFF) return mergeFF

  const instance = new FFmpeg()
  instance.on("log", ({ message }) => {
    logBuffer.push(message)
  })

  await instance.load({
    coreURL: await toBlobURL(CORE_JS, "text/javascript"),
    wasmURL: await toBlobURL(CORE_WASM, "application/wasm"),
  })

  mergeFF = instance
  return instance
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
  }

  for (const line of logs) {
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

async function probeFile(ff: FFmpeg, name: string): Promise<StreamInfo> {
  logBuffer = []
  // `ffmpeg -i file` exits with an error (no output specified) but prints
  // full stream info to the log — that's all we need. Wrap in try/catch.
  try {
    await ff.exec(["-i", name])
  } catch {
    // expected — no output file was requested
  }
  return parseStreamInfo(logBuffer)
}

function fpsClose(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false
  return Math.abs(a - b) < 0.05
}

function streamsCompatible(a: StreamInfo, b: StreamInfo): boolean {
  return (
    a.videoCodec !== null &&
    a.videoCodec === b.videoCodec &&
    a.width === b.width &&
    a.height === b.height &&
    fpsClose(a.fps, b.fps) &&
    a.audioCodec === b.audioCodec &&
    a.sampleRate === b.sampleRate
  )
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export interface MergeHandlers {
  onStatus?: (message: string) => void
  onProgress?: (percent: number) => void
}

export interface MergeResult {
  url: string
  sizeBytes: number
  usedFallback: boolean
}

const SHORT_IN = "merge_short_in.mp4"
const SHORT_FIXED = "merge_short_fixed.mp4"
const MOVIE_IN = "merge_movie_in.mp4"
const LIST_FILE = "merge_list.txt"
const OUTPUT = "merge_output.mp4"

async function safeDelete(ff: FFmpeg, name: string) {
  try {
    await ff.deleteFile(name)
  } catch {
    // file may not exist — ignore
  }
}

/**
 * Merges shortFile (Part A, front) + movieFile (Part B, back) into one MP4.
 *
 * Primary path: concat demuxer with `-c copy` — zero re-encoding, so it is
 * as fast as a file copy and preserves 100% original quality.
 *
 * Fallback (only when codecs/resolution/fps mismatch): ONLY the short video
 * is re-encoded to match the movie's parameters (short = tiny, takes
 * seconds). The movie is NEVER re-encoded — always stream-copied.
 */
export async function mergeVideos(
  shortFile: File,
  movieFile: File,
  handlers: MergeHandlers = {},
): Promise<MergeResult> {
  const { onStatus, onProgress } = handlers

  onStatus?.("Loading merge engine...")
  onProgress?.(5)
  const ff = await getMergeFFmpeg()

  try {
    onStatus?.("Reading Part A (short video)...")
    onProgress?.(10)
    await ff.writeFile(SHORT_IN, await fileToUint8(shortFile))

    onStatus?.("Reading Part B (full movie)...")
    onProgress?.(25)
    await ff.writeFile(MOVIE_IN, await fileToUint8(movieFile))

    onStatus?.("Checking format compatibility...")
    onProgress?.(40)
    const shortInfo = await probeFile(ff, SHORT_IN)
    const movieInfo = await probeFile(ff, MOVIE_IN)

    let shortName = SHORT_IN
    let usedFallback = false

    if (!streamsCompatible(shortInfo, movieInfo)) {
      // Fallback: convert ONLY the short to match the movie. Movie untouched.
      usedFallback = true
      onStatus?.("Formats differ — converting only the short video to match the movie (movie stays original quality)...")
      onProgress?.(50)

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
        "veryfast",
        "-crf",
        "20",
        "-profile:v",
        targetProfile,
      )
      if (movieHasAudio) {
        if (!shortHasAudio) {
          args.push("-map", "0:v:0", "-map", "1:a:0", "-shortest")
        }
        args.push("-c:a", "aac", "-ar", targetSR, "-ac", "2")
      } else {
        args.push("-an")
      }
      args.push("-y", SHORT_FIXED)

      logBuffer = []
      const encodeRet = await ff.exec(args)
      if (encodeRet !== 0) {
        console.log("[v0] fallback encode failed, logs tail:", logBuffer.slice(-10).join(" | "))
        throw new Error("Could not convert the short video to match the movie format. Try a different short file.")
      }
      shortName = SHORT_FIXED
    }

    onStatus?.("Merging Part A + Part B (stream copy — no re-encoding)...")
    onProgress?.(usedFallback ? 70 : 55)

    await ff.writeFile(
      LIST_FILE,
      new TextEncoder().encode(`file '${shortName}'\nfile '${MOVIE_IN}'`),
    )

    logBuffer = []
    const concatRet = await ff.exec([
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
    ])
    if (concatRet !== 0) {
      console.log("[v0] concat failed, logs tail:", logBuffer.slice(-15).join(" | "))
      throw new Error("Merging failed while joining the two videos. The files may be in an unsupported format.")
    }

    // Free the inputs BEFORE reading the output — halves peak memory,
    // which matters for large movies.
    await safeDelete(ff, SHORT_IN)
    await safeDelete(ff, SHORT_FIXED)
    await safeDelete(ff, MOVIE_IN)
    await safeDelete(ff, LIST_FILE)

    onStatus?.("Preparing download...")
    onProgress?.(90)
    const data = (await ff.readFile(OUTPUT)) as Uint8Array
    if (data.byteLength === 0) {
      throw new Error("Merge produced an empty file. The inputs may be in an unsupported format.")
    }
    const blob = new Blob([data as BlobPart], { type: "video/mp4" })
    const url = URL.createObjectURL(blob)

    onProgress?.(100)
    onStatus?.("Done!")

    return { url, sizeBytes: data.byteLength, usedFallback }
  } finally {
    // Free WASM memory immediately — critical for large movies.
    await safeDelete(ff, SHORT_IN)
    await safeDelete(ff, SHORT_FIXED)
    await safeDelete(ff, MOVIE_IN)
    await safeDelete(ff, LIST_FILE)
    await safeDelete(ff, OUTPUT)
  }
}

// Browser WASM has a hard ~2GB address space. Warn well below it since we
// need room for both inputs + output simultaneously.
export const MAX_TOTAL_BYTES = 800 * 1024 * 1024 // 800MB combined

export function totalSizeOk(shortFile: File | null, movieFile: File | null): boolean {
  const total = (shortFile?.size ?? 0) + (movieFile?.size ?? 0)
  return total <= MAX_TOTAL_BYTES
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
