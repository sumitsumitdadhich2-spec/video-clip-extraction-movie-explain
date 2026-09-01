"use client"

// Export pipeline: always cuts from the ORIGINAL uploaded movie file (never
// the preview merge) at the chosen quality, then concatenates.
//
// - All settings "Original"  → fast path: single re-encode at source
//   resolution/fps with high quality (crf 18) — closest possible to source
//   while keeping cuts frame-accurate.
// - Custom settings → full re-encode with scale / fps / bitrate args.

import { fetchFile } from "@ffmpeg/util"
import { getFFmpeg } from "./ffmpeg-client"
import type { MappingPair } from "./report-parser"

export interface ExportOptions {
  // undefined = keep original
  width?: number
  height?: number
  fps?: number
  videoBitrateMbps?: number
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

const EXPORT_INPUT = "export_source.mp4"
let exportSourceFor: File | null = null

export async function exportMerged(
  movieFile: File,
  pairs: MappingPair[],
  options: ExportOptions,
  handlers: ExportHandlers = {},
): Promise<{ url: string; sizeBytes: number }> {
  const { onStatus, onProgress } = handlers
  const ff = await getFFmpeg()

  onStatus?.("Loading original movie into the engine...")
  if (exportSourceFor !== movieFile) {
    await ff.writeFile(EXPORT_INPUT, await fetchFile(movieFile))
    exportSourceFor = movieFile
  }

  const isOriginal =
    options.width === undefined && options.fps === undefined && options.videoBitrateMbps === undefined

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

  const listLines: string[] = []

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]
    const outName = `export_${String(i).padStart(3, "0")}.mp4`
    const duration = pair.movieEnd - pair.movieStart
    onStatus?.(`Exporting clip ${i + 1} of ${pairs.length} (${pair.label})...`)

    const args = [
      "-ss",
      pair.movieStart.toFixed(3),
      "-i",
      EXPORT_INPUT,
      "-t",
      duration.toFixed(3),
      "-vf",
      filters.join(","),
      "-c:v",
      "libx264",
      "-preset",
      isOriginal ? "veryfast" : "ultrafast",
    ]

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

    await ff.exec(args)
    listLines.push(`file '${outName}'`)
    onProgress?.(i + 1, pairs.length)
  }

  onStatus?.("Merging exported clips...")
  await ff.writeFile("export_concat.txt", new TextEncoder().encode(listLines.join("\n")))
  await ff.exec([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    "export_concat.txt",
    "-c",
    "copy",
    "-y",
    "export_final.mp4",
  ])

  const data = (await ff.readFile("export_final.mp4")) as Uint8Array
  const blob = new Blob([data as BlobPart], { type: "video/mp4" })

  // Clean up intermediate export files to free WASM FS memory
  for (let i = 0; i < pairs.length; i++) {
    try {
      await ff.deleteFile(`export_${String(i).padStart(3, "0")}.mp4`)
    } catch {
      // ignore
    }
  }

  onStatus?.("Export complete.")
  return { url: URL.createObjectURL(blob), sizeBytes: blob.size }
}
