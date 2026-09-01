"use client"

import { FFmpeg } from "@ffmpeg/ffmpeg"
import { toBlobURL, fetchFile } from "@ffmpeg/util"
import type { MappingPair } from "./report-parser"

// Core + wasm are self-hosted from /public/ffmpeg (same-origin) and passed as
// blob URLs. The @ffmpeg/ffmpeg wrapper is bundled by Next, so its Web Worker
// is already same-origin — we must NOT override classWorkerURL, otherwise the
// worker's internal importScripts of the core fails.
// The single-threaded core does NOT need SharedArrayBuffer / cross-origin
// isolation, so it runs in the standard preview environment.
const CORE_JS = "/ffmpeg/ffmpeg-core.js"
const CORE_WASM = "/ffmpeg/ffmpeg-core.wasm"

let ffmpeg: FFmpeg | null = null

export type LogHandler = (message: string) => void

export async function getFFmpeg(onLog?: LogHandler): Promise<FFmpeg> {
  if (ffmpeg) return ffmpeg

  const instance = new FFmpeg()
  if (onLog) {
    instance.on("log", ({ message }) => onLog(message))
  }

  await instance.load({
    coreURL: await toBlobURL(CORE_JS, "text/javascript"),
    wasmURL: await toBlobURL(CORE_WASM, "application/wasm"),
  })

  ffmpeg = instance
  return instance
}

export interface ExtractedClip {
  index: number
  name: string
  url: string
  data: Uint8Array
  durationSeconds: number
}

const MOVIE_INPUT = "movie_source.mp4"
let movieWritten = false
let movieWrittenFor: File | null = null

async function ensureMovieLoaded(ff: FFmpeg, movieFile: File) {
  if (movieWritten && movieWrittenFor === movieFile) return
  await ff.writeFile(MOVIE_INPUT, await fetchFile(movieFile))
  movieWritten = true
  movieWrittenFor = movieFile
}

// Extracts a single movie-side clip, re-encoding to normalized H.264/AAC MP4
// so all clips can be safely concatenated afterwards. Frame-accurate via
// -ss before -i + re-encode.
async function extractOneClip(ff: FFmpeg, pair: MappingPair): Promise<ExtractedClip> {
  const outName = `clip_${String(pair.index).padStart(3, "0")}.mp4`
  const duration = pair.movieEnd - pair.movieStart

  await ff.exec([
    "-ss",
    pair.movieStart.toFixed(3),
    "-i",
    MOVIE_INPUT,
    "-t",
    duration.toFixed(3),
    "-vf",
    "scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=24,format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    // Resample audio against timestamps so voice stays in sync at every cut
    // boundary (prevents drift when clips are concatenated).
    "-af",
    "aresample=async=1:first_pts=0",
    "-c:a",
    "aac",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-y",
    outName,
  ])

  const data = (await ff.readFile(outName)) as Uint8Array
  const blob = new Blob([data as BlobPart], { type: "video/mp4" })
  return {
    index: pair.index,
    name: pair.label,
    url: URL.createObjectURL(blob),
    data,
    durationSeconds: duration,
  }
}

// ---------------------------------------------------------------------------
// Background extraction store
//
// Started when the user enters the compare step so movie clips are pre-cut
// while they review pairs. Results are cached by clip index; the merge step
// consumes the cache and only cuts what is still missing.
// ---------------------------------------------------------------------------

export interface BackgroundState {
  running: boolean
  doneCount: number
  total: number
  clips: Map<number, ExtractedClip>
  error: string | null
}

type BackgroundListener = (state: BackgroundState) => void

const bgState: BackgroundState = {
  running: false,
  doneCount: 0,
  total: 0,
  clips: new Map(),
  error: null,
}
const bgListeners = new Set<BackgroundListener>()
let bgSessionId = 0

function notifyBg() {
  const snapshot: BackgroundState = {
    running: bgState.running,
    doneCount: bgState.doneCount,
    total: bgState.total,
    clips: new Map(bgState.clips),
    error: bgState.error,
  }
  bgListeners.forEach((l) => l(snapshot))
}

export function subscribeBackground(listener: BackgroundListener): () => void {
  bgListeners.add(listener)
  listener({
    running: bgState.running,
    doneCount: bgState.doneCount,
    total: bgState.total,
    clips: new Map(bgState.clips),
    error: bgState.error,
  })
  return () => {
    bgListeners.delete(listener)
  }
}

export function getBackgroundState(): BackgroundState {
  return {
    running: bgState.running,
    doneCount: bgState.doneCount,
    total: bgState.total,
    clips: new Map(bgState.clips),
    error: bgState.error,
  }
}

export function resetBackground() {
  bgSessionId++
  bgState.running = false
  bgState.doneCount = 0
  bgState.total = 0
  bgState.clips.forEach((c) => URL.revokeObjectURL(c.url))
  bgState.clips.clear()
  bgState.error = null
  movieWritten = false
  movieWrittenFor = null
  notifyBg()
}

// Kicks off sequential background cutting of all movie-side clips.
// Safe to call multiple times — no-ops if already running for the same set.
export function startBackgroundExtraction(movieFile: File, pairs: MappingPair[]) {
  if (bgState.running) return
  if (bgState.total === pairs.length && bgState.doneCount === pairs.length) return

  const session = ++bgSessionId
  bgState.running = true
  bgState.total = pairs.length
  bgState.error = null
  notifyBg()

  ;(async () => {
    try {
      const ff = await getFFmpeg()
      await ensureMovieLoaded(ff, movieFile)
      if (session !== bgSessionId) return

      for (const pair of pairs) {
        if (session !== bgSessionId) return
        if (bgState.clips.has(pair.index)) continue
        const clip = await extractOneClip(ff, pair)
        if (session !== bgSessionId) {
          URL.revokeObjectURL(clip.url)
          return
        }
        bgState.clips.set(pair.index, clip)
        bgState.doneCount = bgState.clips.size
        notifyBg()
      }

      bgState.running = false
      notifyBg()
    } catch (err) {
      if (session !== bgSessionId) return
      console.error("[v0] background extraction error:", err)
      bgState.running = false
      bgState.error = err instanceof Error ? err.message : "Background extraction failed."
      notifyBg()
    }
  })()
}

// Completes any missing clips (foreground), consuming the background cache.
export async function completeExtraction(
  movieFile: File,
  pairs: MappingPair[],
  handlers: {
    onStatus?: (message: string) => void
    onClipDone?: (doneCount: number, total: number) => void
  } = {},
): Promise<ExtractedClip[]> {
  const { onStatus, onClipDone } = handlers

  // Wait for a running background session to finish instead of competing with it.
  if (bgState.running) {
    onStatus?.("Finishing background clip cutting...")
    await new Promise<void>((resolve) => {
      const unsub = subscribeBackground((s) => {
        onClipDone?.(s.doneCount, s.total)
        if (!s.running) {
          unsub()
          resolve()
        }
      })
    })
  }

  const ff = await getFFmpeg()
  await ensureMovieLoaded(ff, movieFile)

  const results: ExtractedClip[] = []
  for (const pair of pairs) {
    const cached = bgState.clips.get(pair.index)
    if (cached) {
      results.push(cached)
      onClipDone?.(results.length, pairs.length)
      continue
    }
    onStatus?.(`Cutting clip ${pair.index + 1} of ${pairs.length} (${pair.label})...`)
    const clip = await extractOneClip(ff, pair)
    bgState.clips.set(pair.index, clip)
    bgState.doneCount = bgState.clips.size
    notifyBg()
    results.push(clip)
    onClipDone?.(results.length, pairs.length)
  }

  return results.sort((a, b) => a.index - b.index)
}

// Concatenates already-extracted clips into a single MP4 using the concat
// demuxer with stream copy (fast, since all clips share the same encoding).
export async function mergeClips(
  clips: ExtractedClip[],
  handlers: { onLog?: LogHandler; onStatus?: (message: string) => void } = {},
): Promise<string> {
  const { onLog, onStatus } = handlers
  const ff = await getFFmpeg(onLog)

  onStatus?.("Merging all clips into one video...")

  const listLines: string[] = []
  for (const clip of clips) {
    const name = `clip_${String(clip.index).padStart(3, "0")}.mp4`
    await ff.writeFile(name, clip.data)
    listLines.push(`file '${name}'`)
  }

  await ff.writeFile("concat_list.txt", new TextEncoder().encode(listLines.join("\n")))

  await ff.exec([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    "concat_list.txt",
    "-c",
    "copy",
    "-y",
    "merged.mp4",
  ])

  const data = (await ff.readFile("merged.mp4")) as Uint8Array
  const blob = new Blob([data as BlobPart], { type: "video/mp4" })
  return URL.createObjectURL(blob)
}
