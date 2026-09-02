"use client"

// Export pipeline: always cuts from the ORIGINAL uploaded movie file (never
// the preview merge) at the chosen quality, then concatenates.
//
// - All settings "Original"  → fast path: single re-encode at source
//   resolution/fps with high quality (crf 18) — closest possible to source
//   while keeping cuts frame-accurate.
// - Custom settings → full re-encode with scale / fps / bitrate args.

import type { FFmpeg } from "@ffmpeg/ffmpeg"
import { getFFmpeg, toFriendlyError, buildAlignedCopyCutArgs, mergeClipFilesSynced } from "./ffmpeg-client"
import { planParallelism, runPool, mountFile } from "./ffmpeg-pool"
import type { MappingPair } from "./report-parser"

export interface ExportOptions {
  // undefined = keep original
  width?: number
  height?: number
  fps?: number
  videoBitrateMbps?: number
  // Stream copy: no decode/re-encode at all (seconds per clip). Only valid
  // with all other settings "Original". Cuts snap to the preceding keyframe.
  streamCopy?: boolean
}

export interface ExportHandlers {
  onStatus?: (message: string) => void
  onProgress?: (done: number, total: number) => void
}

export const RESOLUTION_PRESETS = [
  { id: "original", label: "Original", width: undefined, height: undefined },
  { id: "4k", label: "4K (3840×2160)", width: 3840, height: 2160 },
  { id: "2k", label: "2K (2560×1440)", width: 2560, height: 1440 },
  { id: "1080p", label: "1080p (1920×1080)", width: 1920, height: 1080 },
  { id: "720p", label: "720p (1280×720)", width: 1280, height: 720 },
] as const

export const FPS_PRESETS = [
  { id: "original", label: "Original", fps: undefined },
  { id: "24", label: "24 fps", fps: 24 },
  { id: "30", label: "30 fps", fps: 30 },
  { id: "60", label: "60 fps", fps: 60 },
  { id: "120", label: "120 fps", fps: 120 },
] as const

export const BITRATE_PRESETS = [
  { id: "original", label: "Auto (High Quality)", mbps: undefined },
  { id: "4", label: "4 Mbps", mbps: 4 },
  { id: "8", label: "8 Mbps", mbps: 8 },
  { id: "16", label: "16 Mbps", mbps: 16 },
  { id: "30", label: "30 Mbps", mbps: 30 },
  { id: "50", label: "50 Mbps", mbps: 50 },
] as const

// Bounded tail of ffmpeg log lines for readable export error messages.
const logs: string[] = []
const tapLog = (m: string) => {
  logs.push(m)
  if (logs.length > 200) logs.splice(0, logs.length - 100)
}

async function safeDelete(ff: FFmpeg, name: string) {
  try {
    await ff.deleteFile(name)
  } catch {
    // ignore
  }
}

export async function exportMerged(
  movieFile: File,
  pairs: MappingPair[],
  options: ExportOptions,
  handlers: ExportHandlers = {},
): Promise<{ url: string; sizeBytes: number }> {
  const { onStatus, onProgress } = handlers
  if (pairs.length === 0) throw new Error("No clips to export.")

  // getFFmpeg dedupes handlers by reference, so this module-level tap is
  // registered exactly once no matter how many exports run.
  const ff = await getFFmpeg(tapLog)

  const written: string[] = []

  try {
    // Clips are cut on the CPU pool (one engine per core, movie MOUNTED in
    // each — zero copy), then merged on the main engine.
    onStatus?.("Opening original movie (direct disk access)...")
    return await runExport(ff, movieFile, pairs, options, written, onStatus, onProgress)
  } catch (err) {
    throw toFriendlyError(err, "Export failed")
  } finally {
    for (const name of written) await safeDelete(ff, name)
    await safeDelete(ff, "export_concat.txt")
    await safeDelete(ff, "export_final.mp4")
  }
}

async function runExport(
  ff: FFmpeg,
  movieFile: File,
  pairs: MappingPair[],
  options: ExportOptions,
  written: string[],
  onStatus?: (message: string) => void,
  onProgress?: (done: number, total: number) => void,
): Promise<{ url: string; sizeBytes: number }> {
  const isOriginal =
    options.width === undefined && options.fps === undefined && options.videoBitrateMbps === undefined
  const streamCopy = isOriginal && !!options.streamCopy

  // Build video filter chain
  const filters: string[] = []
  if (options.width && options.height) {
    // Lanczos for best upscale/downscale quality; force even dimensions
    filters.push(
      `scale=${options.width}:${options.height}:flags=lanczos:force_original_aspect_ratio=decrease`,
      `pad=${options.width}:${options.height}:(ow-iw)/2:(oh-ih)/2`,
    )
  } else {
    filters.push("scale=trunc(iw/2)*2:trunc(ih/2)*2")
  }
  if (options.fps) {
    filters.push(`fps=${options.fps}`)
  }
  filters.push("format=yuv420p")

  // Validate every range up front so a bad clip fails fast, before any work.
  for (let i = 0; i < pairs.length; i++) {
    const duration = pairs[i].movieEnd - pairs[i].movieStart
    if (!(duration > 0)) {
      throw new Error(`Clip ${i + 1} (${pairs[i].label}) has an invalid time range.`)
    }
  }

  const buildArgs = (input: string, pair: MappingPair, outName: string, threads: number): string[] => {
    const duration = pair.movieEnd - pair.movieStart

    if (streamCopy) {
      // Zero re-encode: bit-exact source video, keyframe-aligned cuts with
      // audio and video starting from the SAME keyframe (no per-clip A/V
      // offset that would drift after concatenation).
      return buildAlignedCopyCutArgs(input, pair.movieStart, duration, outName)
    }

    // `-threads` before -i = decoder threads, after -i = x264 encoder threads.
    // The pool sizes these so all parallel engines together fill every core.
    const th = ["-threads", String(threads)]
    const args: string[] = [...th, "-ss", pair.movieStart.toFixed(3), "-i", input, "-t", duration.toFixed(3), ...th]
    args.push(
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-sn",
        "-dn",
        "-vf",
        filters.join(","),
        "-c:v",
        "libx264",
        "-preset",
        isOriginal ? "veryfast" : "ultrafast",
      )

      if (options.videoBitrateMbps) {
        const br = `${options.videoBitrateMbps}M`
        args.push("-b:v", br, "-maxrate", br, "-bufsize", `${options.videoBitrateMbps * 2}M`)
      } else {
        // Quality-based encode close to source quality
        args.push("-crf", "18")
      }

      // aresample keeps voice locked to video at every cut boundary so the
      // concatenated export never drifts out of sync.
      args.push(
        "-af",
        "aresample=async=1:first_pts=0",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-y",
        outName,
      )
    return args
  }

  // --- Cut every clip in PARALLEL on the CPU pool (one engine per core) ----
  const plan = planParallelism(pairs.length, !streamCopy)
  onStatus?.(
    `Exporting ${pairs.length} clip${pairs.length === 1 ? "" : "s"} in parallel on ${plan.workers} CPU engine${
      plan.workers === 1 ? "" : "s"
    } (${plan.cores} cores)...`,
  )
  onProgress?.(0, pairs.length)

  const results: (Uint8Array | null)[] = new Array(pairs.length).fill(null)
  let done = 0

  await runPool(pairs, plan.workers, async (worker, pair, i) => {
    const input = await mountFile(worker, movieFile)
    const outName = `export_${String(i).padStart(3, "0")}.mp4`
    worker.logs.length = 0
    const ret = await worker.ff.exec(buildArgs(input, pair, outName, plan.threadsPerWorker))
    if (ret !== 0) {
      const tail = worker.logs.slice(-8).join(" | ")
      try {
        await worker.ff.deleteFile(outName)
      } catch {
        // ignore
      }
      throw new Error(`Failed to export clip ${i + 1} (${pair.label}).${tail ? ` ffmpeg: ${tail}` : ""}`)
    }
    const data = (await worker.ff.readFile(outName)) as Uint8Array
    try {
      await worker.ff.deleteFile(outName)
    } catch {
      // ignore
    }
    if (data.byteLength === 0) {
      throw new Error(`Clip ${i + 1} (${pair.label}) came out empty — check its timestamps.`)
    }
    results[i] = data
    done++
    onProgress?.(done, pairs.length)
    onStatus?.(`Exported clip ${done} of ${pairs.length} (${plan.workers} running in parallel)...`)
  })

  // --- Hand the finished clips to the main engine for the merge ------------
  onStatus?.("Preparing clips for merge...")
  const clipNames: string[] = []
  for (let i = 0; i < pairs.length; i++) {
    const data = results[i]
    if (!data) throw new Error(`Clip ${i + 1} (${pairs[i].label}) was not produced.`)
    const name = `export_${String(i).padStart(3, "0")}.mp4`
    written.push(name)
    await ff.writeFile(name, data)
    // Drop the JS copy right away — the WASM FS now owns it.
    results[i] = null
    clipNames.push(name)
  }

  const data = await mergeClipFilesSynced(ff, clipNames, "export_concat.txt", "export_final.mp4", onStatus)
  const blob = new Blob([data as BlobPart], { type: "video/mp4" })

  onStatus?.("Export complete.")
  return { url: URL.createObjectURL(blob), sizeBytes: blob.size }
}
