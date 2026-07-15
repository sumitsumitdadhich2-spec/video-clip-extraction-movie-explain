"use client"

import { FFmpeg } from "@ffmpeg/ffmpeg"
import { toBlobURL, fetchFile } from "@ffmpeg/util"
import type { ResolvedClip } from "./timestamp"

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
export type ProgressHandler = (ratio: number) => void

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

// Extracts every clip from the source video, re-encoding each to a normalized
// H.264/AAC MP4 so they can be safely concatenated afterwards.
export async function extractClips(
  videoFile: File,
  clips: ResolvedClip[],
  handlers: {
    onLog?: LogHandler
    onClipDone?: (clip: ExtractedClip, doneCount: number, total: number) => void
    onStatus?: (message: string) => void
  } = {},
): Promise<ExtractedClip[]> {
  const { onLog, onClipDone, onStatus } = handlers
  const ff = await getFFmpeg(onLog)

  onStatus?.("Loading source video into the engine...")
  const inputName = "source.mp4"
  await ff.writeFile(inputName, await fetchFile(videoFile))

  const results: ExtractedClip[] = []

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i]
    const outName = `clip_${String(i).padStart(3, "0")}.mp4`
    onStatus?.(`Extracting clip ${i + 1} of ${clips.length} (${clip.short_video_clip})...`)

    await ff.exec([
      "-ss",
      clip.startSeconds.toFixed(3),
      "-i",
      inputName,
      "-t",
      clip.durationSeconds.toFixed(3),
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=24,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
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
    const blob = new Blob([data], { type: "video/mp4" })
    const extracted: ExtractedClip = {
      index: i,
      name: clip.short_video_clip,
      url: URL.createObjectURL(blob),
      data,
      durationSeconds: clip.durationSeconds,
    }
    results.push(extracted)
    onClipDone?.(extracted, i + 1, clips.length)
  }

  return results
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
    // Ensure the file exists in FS (it does from extraction, but re-write is safe).
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
  const blob = new Blob([data], { type: "video/mp4" })
  return URL.createObjectURL(blob)
}
