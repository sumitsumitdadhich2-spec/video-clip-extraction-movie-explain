"use client"

import { FFmpeg } from "@ffmpeg/ffmpeg"
import type { FFFSType } from "@ffmpeg/ffmpeg"
import { toBlobURL } from "@ffmpeg/util"
import type { MappingPair } from "./report-parser"

// Core + wasm are self-hosted from /public/ffmpeg (same-origin) and passed as
// blob URLs. The @ffmpeg/ffmpeg wrapper is bundled by Next, so its Web Worker
// is already same-origin — we must NOT override classWorkerURL, otherwise the
// worker's internal importScripts of the core fails.
// The single-threaded core does NOT need SharedArrayBuffer / cross-origin
// isolation, so it runs in the standard preview environment.
const CORE_JS = "/ffmpeg/ffmpeg-core.js"
const CORE_WASM = "/ffmpeg/ffmpeg-core.wasm"

// Self-hosted MULTI-THREADED core — uses ALL CPU cores when re-encoding
// (precise preview mode), 4-6x faster on multi-core devices. Requires
// SharedArrayBuffer (cross-origin isolation), so we feature-detect and fall
// back to the single-threaded core when the browser/embedding context
// doesn't allow it. Same MT files the merge tool already ships.
const CORE_MT_JS = "/ffmpeg-mt/ffmpeg-core.js"
const CORE_MT_WASM = "/ffmpeg-mt/ffmpeg-core.wasm"
const CORE_MT_WORKER = "/ffmpeg-mt/ffmpeg-core.worker.js"

/** True when the page is cross-origin isolated and SharedArrayBuffer exists. */
function multiThreadAvailable(): boolean {
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

// True when the currently loaded engine is the multi-threaded core.
let engineIsMT = false

/** Whether the active clip-cutting engine runs on all CPU cores. */
export function isMultiThreaded(): boolean {
  return engineIsMT
}

// FFFSType.WORKERFS as a value — the enum isn't exported from the package's
// SSR stub, so we use the literal (it's just the string "WORKERFS").
const WORKERFS = "WORKERFS" as FFFSType

let ffmpeg: FFmpeg | null = null
let loadingPromise: Promise<FFmpeg> | null = null

// Bounded tail of ffmpeg's log output — used to build useful error messages.
let logBuffer: string[] = []
const extraLogHandlers = new Set<LogHandler>()

export type LogHandler = (message: string) => void

export async function getFFmpeg(onLog?: LogHandler): Promise<FFmpeg> {
  if (onLog) extraLogHandlers.add(onLog)
  if (ffmpeg) return ffmpeg
  if (loadingPromise) return loadingPromise

  loadingPromise = (async () => {
    const instance = new FFmpeg()
    instance.on("log", ({ message }) => {
      logBuffer.push(message)
      if (logBuffer.length > 300) logBuffer.splice(0, logBuffer.length - 150)
      extraLogHandlers.forEach((h) => h(message))
    })

    // Prefer the multi-threaded core (all CPU cores) and fall back to the
    // single-threaded core when SharedArrayBuffer isn't available or the MT
    // core fails to initialize.
    engineIsMT = false
    if (multiThreadAvailable()) {
      try {
        await instance.load({
          coreURL: await toBlobURL(CORE_MT_JS, "text/javascript"),
          wasmURL: await toBlobURL(CORE_MT_WASM, "application/wasm"),
          workerURL: await toBlobURL(CORE_MT_WORKER, "text/javascript"),
        })
        engineIsMT = true
        ffmpeg = instance
        return instance
      } catch {
        // MT core failed to load — fall through to the single-threaded core.
      }
    }

    await instance.load({
      coreURL: await toBlobURL(CORE_JS, "text/javascript"),
      wasmURL: await toBlobURL(CORE_WASM, "application/wasm"),
    })

    ffmpeg = instance
    return instance
  })()

  try {
    return await loadingPromise
  } finally {
    loadingPromise = null
  }
}

/**
 * Throws away the current ffmpeg instance. Called after a WASM crash (e.g.
 * "memory access out of bounds") because the worker is dead afterwards and
 * every subsequent call would fail. A fresh engine loads in ~1s.
 */
export function resetFFmpeg() {
  if (ffmpeg) {
    try {
      ffmpeg.terminate()
    } catch {
      // already dead — ignore
    }
  }
  ffmpeg = null
  loadingPromise = null
  logBuffer = []
  movieMountedFor = null
  engineIsMT = false
}

function isCrashError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    msg.includes("memory access out of bounds") ||
    msg.includes("out of memory") ||
    msg.includes("cannot enlarge memory") ||
    msg.includes("oom") ||
    msg.includes("abort") ||
    msg.includes("unreachable") ||
    msg.includes("terminated") ||
    msg.includes("called ffmpeg.terminate")
  )
}

/**
 * Normalizes anything thrown by ffmpeg.wasm into a readable Error. On a WASM
 * crash the engine is reset so the user's Retry starts from a clean instance.
 */
export function toFriendlyError(err: unknown, context: string): Error {
  if (isCrashError(err)) {
    resetFFmpeg()
    return new Error(
      `${context}: the browser video engine ran out of memory and was restarted. ` +
        `Click Retry — the movie is now streamed from disk instead of being copied into memory, ` +
        `so it should go through. If it still fails, close other tabs or use a smaller movie file.`,
    )
  }
  if (err instanceof Error) return err
  const tail = logBuffer.slice(-6).join(" | ")
  return new Error(`${context}: ${String(err)}${tail ? ` — ${tail}` : ""}`)
}

async function safeDelete(ff: FFmpeg, name: string) {
  try {
    await ff.deleteFile(name)
  } catch {
    // file may not exist — ignore
  }
}

export interface ExtractedClip {
  index: number
  name: string
  url: string
  data: Uint8Array
  durationSeconds: number
}

// ---------------------------------------------------------------------------
// Movie input — MOUNTED, never copied.
//
// The movie is mounted with WORKERFS so ffmpeg reads it straight from the
// browser's File handle. Copying a multi-GB movie into the WASM heap with
// writeFile() is what previously caused "memory access out of bounds".
// ---------------------------------------------------------------------------

const MOVIE_MOUNT_DIR = "/movie_in"
let movieMountedFor: File | null = null

function extOf(file: File): string {
  const m = file.name.match(/\.(\w{2,5})$/)
  return m ? m[1].toLowerCase() : "mp4"
}

function movieInputPath(file: File): string {
  return `${MOVIE_MOUNT_DIR}/source.${extOf(file)}`
}

/**
 * Makes the movie available to ffmpeg (zero-copy mount) and returns its path
 * inside the ffmpeg virtual filesystem. Safe to call repeatedly.
 */
export async function ensureMovieMounted(ff: FFmpeg, movieFile: File): Promise<string> {
  const path = movieInputPath(movieFile)
  if (movieMountedFor === movieFile) return path

  try {
    await ff.unmount(MOVIE_MOUNT_DIR)
  } catch {
    // not mounted — ignore
  }
  try {
    await ff.deleteDir(MOVIE_MOUNT_DIR)
  } catch {
    // dir may not exist — ignore
  }

  await ff.createDir(MOVIE_MOUNT_DIR)
  await ff.mount(WORKERFS, { blobs: [{ name: `source.${extOf(movieFile)}`, data: movieFile }] }, MOVIE_MOUNT_DIR)
  movieMountedFor = movieFile
  return path
}

// ---------------------------------------------------------------------------
// Preview cutting mode
//
// "fast"    — stream copy (-c copy). No decoding / encoding at all, so a clip
//             takes seconds instead of minutes. Cuts snap to the nearest
//             keyframe before the start time (typically 0–3 s early).
// "precise" — frame-accurate re-encode to 720p H.264. Very slow for 4K sources
//             because single-threaded WASM must decode every 4K frame.
//
// Export always re-cuts from the original at the chosen quality, so the
// preview mode never affects the final file.
// ---------------------------------------------------------------------------
export type PreviewMode = "fast" | "precise"

const PREVIEW_MODE_KEY = "clipper.previewMode"
let previewMode: PreviewMode = (() => {
  if (typeof window === "undefined") return "fast"
  const saved = window.localStorage.getItem(PREVIEW_MODE_KEY)
  return saved === "precise" ? "precise" : "fast"
})()

export function getPreviewMode(): PreviewMode {
  return previewMode
}

// Preview clips in precise mode are capped at 720p — the preview only needs to
// be watchable, and this keeps encode time and WASM memory small for 4K.
const PREVIEW_MAX_HEIGHT = 720

function buildCutArgs(mode: PreviewMode, input: string, pair: MappingPair, duration: number, outName: string) {
  const head = ["-ss", pair.movieStart.toFixed(3), "-i", input, "-t", duration.toFixed(3)]
  if (mode === "fast") {
    return [
      ...head,
      // Only the first video + first audio stream; drop subtitles/data so the
      // concat step never sees mismatched stream layouts.
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-sn",
      "-dn",
      "-c",
      "copy",
      "-avoid_negative_ts",
      "make_zero",
      "-y",
      outName,
    ]
  }
  return [
    ...head,
    // Use every available CPU core when the MT engine is active (4-6x faster
    // re-encode). Harmless no-op on the single-threaded core.
    ...(engineIsMT ? ["-threads", "0"] : []),
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-sn",
    "-dn",
    "-vf",
    `scale=-2:'min(${PREVIEW_MAX_HEIGHT},ih)',scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=24,format=yuv420p`,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "26",
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
  ]
}

// Extracts a single movie-side clip according to the current preview mode.
async function extractOneClip(ff: FFmpeg, movieFile: File, pair: MappingPair): Promise<ExtractedClip> {
  const input = await ensureMovieMounted(ff, movieFile)
  const outName = `clip_${String(pair.index).padStart(3, "0")}.mp4`
  const duration = pair.movieEnd - pair.movieStart
  if (!(duration > 0)) {
    throw new Error(`Clip ${pair.index + 1} (${pair.label}) has an invalid time range.`)
  }

  logBuffer = []
  const ret = await ff.exec(buildCutArgs(previewMode, input, pair, duration, outName))

  if (ret !== 0) {
    const tail = logBuffer.slice(-8).join(" | ")
    await safeDelete(ff, outName)
    throw new Error(`Failed to cut clip ${pair.index + 1} (${pair.label}).${tail ? ` ffmpeg: ${tail}` : ""}`)
  }

  const data = (await ff.readFile(outName)) as Uint8Array
  // Free the WASM copy immediately — we keep our own copy in JS memory.
  await safeDelete(ff, outName)

  if (data.byteLength === 0) {
    throw new Error(`Clip ${pair.index + 1} (${pair.label}) came out empty — check its timestamps.`)
  }

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

function snapshotBg(): BackgroundState {
  return {
    running: bgState.running,
    doneCount: bgState.doneCount,
    total: bgState.total,
    clips: new Map(bgState.clips),
    error: bgState.error,
  }
}

function notifyBg() {
  const snapshot = snapshotBg()
  bgListeners.forEach((l) => l(snapshot))
}

export function subscribeBackground(listener: BackgroundListener): () => void {
  bgListeners.add(listener)
  listener(snapshotBg())
  return () => {
    bgListeners.delete(listener)
  }
}

export function getBackgroundState(): BackgroundState {
  return snapshotBg()
}

export function resetBackground() {
  bgSessionId++
  bgState.running = false
  bgState.doneCount = 0
  bgState.total = 0
  bgState.clips.forEach((c) => URL.revokeObjectURL(c.url))
  bgState.clips.clear()
  bgState.error = null
  movieMountedFor = null
  notifyBg()
}

/**
 * Switches the preview cutting mode. Already-cut clips are discarded (they
 * were produced with different settings) and background cutting restarts in
 * the new mode when a movie + pairs are supplied.
 */
export function setPreviewMode(mode: PreviewMode, movieFile?: File, pairs?: MappingPair[]) {
  if (mode === previewMode) return
  previewMode = mode
  try {
    window.localStorage.setItem(PREVIEW_MODE_KEY, mode)
  } catch {
    // storage unavailable — ignore
  }
  const mounted = movieMountedFor
  resetBackground()
  // resetBackground clears the mount marker so a new movie re-mounts; the same
  // File is still mounted inside ffmpeg, so restore the marker to skip a remount.
  movieMountedFor = mounted
  if (movieFile && pairs && pairs.length > 0) startBackgroundExtraction(movieFile, pairs)
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
      await ensureMovieMounted(ff, movieFile)
      if (session !== bgSessionId) return

      for (const pair of pairs) {
        if (session !== bgSessionId) return
        if (bgState.clips.has(pair.index)) continue
        const clip = await extractOneClip(ff, movieFile, pair)
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
      const friendly = toFriendlyError(err, "Background clip cutting stopped")
      bgState.running = false
      bgState.error = friendly.message
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

  try {
    const ff = await getFFmpeg()
    await ensureMovieMounted(ff, movieFile)

    const results: ExtractedClip[] = []
    for (const pair of pairs) {
      const cached = bgState.clips.get(pair.index)
      if (cached) {
        results.push(cached)
        onClipDone?.(results.length, pairs.length)
        continue
      }
      onStatus?.(`Cutting clip ${pair.index + 1} of ${pairs.length} (${pair.label})...`)
      const clip = await extractOneClip(ff, movieFile, pair)
      bgState.clips.set(pair.index, clip)
      bgState.doneCount = bgState.clips.size
      notifyBg()
      results.push(clip)
      onClipDone?.(results.length, pairs.length)
    }

    return results.sort((a, b) => a.index - b.index)
  } catch (err) {
    throw toFriendlyError(err, "Clip cutting failed")
  }
}

// Concatenates already-extracted clips into a single MP4 using the concat
// demuxer with stream copy (fast, since all clips share the same encoding).
export async function mergeClips(
  clips: ExtractedClip[],
  handlers: { onLog?: LogHandler; onStatus?: (message: string) => void } = {},
): Promise<string> {
  const { onLog, onStatus } = handlers
  if (clips.length === 0) throw new Error("No clips to merge.")

  const ff = await getFFmpeg(onLog)
  const names: string[] = []

  try {
    const listLines: string[] = []
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i]
      onStatus?.(`Preparing clip ${i + 1} of ${clips.length} for merge...`)
      const name = `clip_${String(clip.index).padStart(3, "0")}.mp4`
      await ff.writeFile(name, clip.data)
      names.push(name)
      listLines.push(`file '${name}'`)
    }

    onStatus?.("Merging all clips into one video...")
    await ff.writeFile("concat_list.txt", new TextEncoder().encode(listLines.join("\n")))

    logBuffer = []
    const ret = await ff.exec([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      "concat_list.txt",
      "-c",
      "copy",
      "-fflags",
      "+genpts",
      "-avoid_negative_ts",
      "make_zero",
      "-y",
      "merged.mp4",
    ])
    if (ret !== 0) {
      const tail = logBuffer.slice(-8).join(" | ")
      throw new Error(`Merging the clips failed.${tail ? ` ffmpeg: ${tail}` : ""}`)
    }

    const data = (await ff.readFile("merged.mp4")) as Uint8Array
    if (data.byteLength === 0) throw new Error("Merged video came out empty.")
    const blob = new Blob([data as BlobPart], { type: "video/mp4" })
    return URL.createObjectURL(blob)
  } catch (err) {
    throw toFriendlyError(err, "Merge failed")
  } finally {
    // Free every intermediate file from WASM memory (engine may be dead after
    // a crash — safeDelete swallows that).
    if (ffmpeg) {
      for (const name of names) await safeDelete(ffmpeg, name)
      await safeDelete(ffmpeg, "concat_list.txt")
      await safeDelete(ffmpeg, "merged.mp4")
    }
  }
}
