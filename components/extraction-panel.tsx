"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  completeExtraction,
  mergeClips,
  getBackgroundState,
  subscribeBackground,
  getPreviewMode,
  setPreviewMode,
  type BackgroundState,
  type ExtractedClip,
  type PreviewMode,
} from "@/lib/ffmpeg-client"
import {
  exportMerged,
  RESOLUTION_PRESETS,
  FPS_PRESETS,
  BITRATE_PRESETS,
} from "@/lib/export"
import type { MappingPair } from "@/lib/report-parser"

interface ExtractionPanelProps {
  movieFile: File
  pairs: MappingPair[]
  onBack: () => void
}

type Phase = "idle" | "extracting" | "merging" | "done" | "error"
type ExportPhase = "idle" | "exporting" | "done" | "error"

export function ExtractionPanel({ movieFile, pairs, onBack }: ExtractionPanelProps) {
  const [phase, setPhase] = useState<Phase>("idle")
  const [status, setStatus] = useState("")
  const [doneCount, setDoneCount] = useState(0)
  const [extracted, setExtracted] = useState<ExtractedClip[]>([])
  const [mergedUrl, setMergedUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Export state
  const [resId, setResId] = useState<string>("original")
  const [fpsId, setFpsId] = useState<string>("original")
  const [brId, setBrId] = useState<string>("original")
  const [exportCopy, setExportCopy] = useState(true)
  const [exportPhase, setExportPhase] = useState<ExportPhase>("idle")
  const [exportStatus, setExportStatus] = useState("")
  const [exportProgress, setExportProgress] = useState(0)
  const [exportUrl, setExportUrl] = useState<string | null>(null)
  const [exportSize, setExportSize] = useState(0)
  const [exportError, setExportError] = useState<string | null>(null)

  const [mode, setMode] = useState<PreviewMode>(() => getPreviewMode())
  const [bg, setBg] = useState<BackgroundState>(() => getBackgroundState())
  useEffect(() => subscribeBackground(setBg), [])

  const cachedCount = bg.clips.size
  const bgError = bg.error

  const changeMode = (next: PreviewMode) => {
    if (next === mode) return
    setMode(next)
    setPreviewMode(next, movieFile, pairs)
  }

  const run = async () => {
    setPhase("extracting")
    setError(null)
    setDoneCount(getBackgroundState().clips.size)
    setExtracted([])
    setMergedUrl(null)

    try {
      const clipResults = await completeExtraction(movieFile, pairs, {
        onStatus: setStatus,
        onClipDone: (count) => setDoneCount(count),
      })
      setExtracted(clipResults)

      setPhase("merging")
      const url = await mergeClips(clipResults, { onStatus: setStatus })
      setMergedUrl(url)
      setStatus("Done! Your merged preview is ready.")
      setPhase("done")
    } catch (err) {
      console.error("[v0] processing error:", err)
      setError(err instanceof Error ? err.message : "Something went wrong during processing.")
      setPhase("error")
    }
  }

  const runExport = async () => {
    setExportPhase("exporting")
    setExportError(null)
    setExportUrl(null)
    setExportProgress(0)

    const res = RESOLUTION_PRESETS.find((r) => r.id === resId)
    const fps = FPS_PRESETS.find((f) => f.id === fpsId)
    const br = BITRATE_PRESETS.find((b) => b.id === brId)

    try {
      const result = await exportMerged(
        movieFile,
        pairs,
        {
          width: res?.width,
          height: res?.height,
          fps: fps?.fps,
          videoBitrateMbps: br?.mbps,
          streamCopy: exportCopy,
        },
        {
          onStatus: setExportStatus,
          onProgress: (done, total) => setExportProgress(Math.round((done / total) * 100)),
        },
      )
      setExportUrl(result.url)
      setExportSize(result.sizeBytes)
      setExportPhase("done")
    } catch (err) {
      console.error("[v0] export error:", err)
      setExportError(err instanceof Error ? err.message : "Export failed.")
      setExportPhase("error")
    }
  }

  const progress = pairs.length ? Math.round((doneCount / pairs.length) * 100) : 0
  const busy = phase === "extracting" || phase === "merging"
  const exporting = exportPhase === "exporting"
  const isOriginalExport = resId === "original" && fpsId === "original" && brId === "original"
  const exportFileName = `export_${resId === "original" ? "original" : resId}_${
    fpsId === "original" ? "src" : fpsId
  }fps.mp4`

  const selectClass =
    "w-full rounded border border-slate-600 bg-slate-800 p-2 text-sm text-slate-200 outline-none focus:border-blue-500"

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Merge &amp; Export</h2>
          <p className="text-sm text-slate-400">
            {pairs.length} movie clips from <span className="text-slate-300">{movieFile.name}</span>
            {cachedCount > 0 && phase === "idle" && (
              <span className="text-emerald-400"> — {cachedCount} already cut in background</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={onBack}
            disabled={busy || exporting}
            className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
          >
            Back
          </Button>
          {phase === "idle" || phase === "error" ? (
            <Button onClick={run} className="bg-blue-600 hover:bg-blue-500">
              {phase === "error" ? "Retry" : "Merge Clips"}
            </Button>
          ) : null}
        </div>
      </div>

      {phase === "idle" && (
        <div className="rounded-lg border border-slate-800 bg-slate-950 p-6 text-center">
          <p className="text-slate-300">
            Ready to merge {pairs.length} movie clips into one preview video.
          </p>
          <p className="mt-2 text-sm text-slate-500">
            {cachedCount === pairs.length
              ? "All clips were already cut in the background — merging will be fast."
              : cachedCount > 0
                ? `${cachedCount} of ${pairs.length} clips are pre-cut; the rest will be cut now.`
                : "Clips will be cut from the movie, then merged. Everything runs in your browser."}
          </p>
          {bgError && (
            <p className="mt-3 text-xs text-amber-400/90">
              Background cutting stopped early ({bgError}). The remaining clips will be cut when you press Merge Clips.
            </p>
          )}

          <fieldset className="mx-auto mt-5 max-w-md text-left">
            <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Cutting mode
            </legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label
                className={`flex cursor-pointer flex-col gap-1 rounded-md border p-3 ${
                  mode === "fast"
                    ? "border-blue-500 bg-blue-950/30"
                    : "border-slate-800 bg-slate-900 hover:border-slate-700"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-slate-100">
                  <input
                    type="radio"
                    name="preview-mode"
                    value="fast"
                    checked={mode === "fast"}
                    onChange={() => changeMode("fast")}
                    className="accent-blue-500"
                  />
                  Fast
                </span>
                <span className="text-xs leading-relaxed text-slate-400">
                  No re-encode — seconds per clip. Cuts snap to the nearest keyframe (may start a moment
                  early); audio and video are kept aligned so the merged voice stays in sync.
                </span>
              </label>
              <label
                className={`flex cursor-pointer flex-col gap-1 rounded-md border p-3 ${
                  mode === "precise"
                    ? "border-blue-500 bg-blue-950/30"
                    : "border-slate-800 bg-slate-900 hover:border-slate-700"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-slate-100">
                  <input
                    type="radio"
                    name="preview-mode"
                    value="precise"
                    checked={mode === "precise"}
                    onChange={() => changeMode("precise")}
                    className="accent-blue-500"
                  />
                  Precise
                </span>
                <span className="text-xs leading-relaxed text-slate-400">
                  Frame-accurate 720p re-encode. Very slow for 4K movies (minutes per clip).
                </span>
              </label>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Export below always re-cuts from the original at full accuracy, whichever mode you pick here.
            </p>
          </fieldset>
        </div>
      )}

      {busy && (
        <div className="rounded-lg border border-slate-800 bg-slate-950 p-6">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="text-slate-300">{status}</span>
            {phase === "extracting" && (
              <span className="font-mono text-slate-400">
                {doneCount}/{pairs.length}
              </span>
            )}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{ width: phase === "merging" ? "100%" : `${progress}%` }}
            />
          </div>
          <p className="mt-3 text-xs text-slate-500">Keep this tab open while processing.</p>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-md border border-red-800 bg-red-950/50 p-3 text-sm text-red-300">{error}</p>
      )}

      {phase === "done" && mergedUrl && (
        <div className="space-y-6">
          <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/20 p-4">
            <h3 className="mb-3 font-semibold text-emerald-200">Merged Video Preview</h3>
            <video src={mergedUrl} controls className="w-full rounded-lg border border-slate-800 bg-black" />
            <a href={mergedUrl} download="merged_preview.mp4" className="mt-4 inline-block">
              <Button
                variant="outline"
                className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
              >
                Download preview
              </Button>
            </a>
          </div>

          {/* Export section */}
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
            <h3 className="mb-1 font-semibold text-slate-100">Export at Custom Quality</h3>
            <p className="mb-4 text-xs text-slate-400">
              Export always cuts from the original uploaded movie (not the preview above) for best quality.
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Resolution</label>
                <select value={resId} onChange={(e) => setResId(e.target.value)} disabled={exporting} className={selectClass}>
                  {RESOLUTION_PRESETS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Frame Rate</label>
                <select value={fpsId} onChange={(e) => setFpsId(e.target.value)} disabled={exporting} className={selectClass}>
                  {FPS_PRESETS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Video Bitrate</label>
                <select value={brId} onChange={(e) => setBrId(e.target.value)} disabled={exporting} className={selectClass}>
                  {BITRATE_PRESETS.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {isOriginalExport && (
              <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={exportCopy}
                  onChange={(e) => setExportCopy(e.target.checked)}
                  disabled={exporting}
                  className="mt-0.5 accent-blue-500"
                />
                <span>
                  Fast cut (no video re-encode)
                  <span className="block text-xs leading-relaxed text-slate-500">
                    Bit-exact source video in seconds; audio is re-synced to picture at every join so voice
                    never drifts. Cuts snap to the nearest keyframe. Untick for frame-accurate cuts (full
                    re-encode, very slow for 4K).
                  </span>
                </span>
              </label>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={runExport} disabled={exporting} className="bg-blue-600 hover:bg-blue-500">
                {exporting
                  ? "Exporting..."
                  : isOriginalExport
                    ? exportCopy
                      ? "Fast Export (Original Quality)"
                      : "Precise Export (Original Quality)"
                    : "Export"}
              </Button>
              {(!isOriginalExport || !exportCopy) && !exporting && (
                <p className="text-xs text-amber-400/90">
                  This needs a full re-encode — very slow for 4K movies in the browser.
                </p>
              )}
            </div>

            {exporting && (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-slate-300">{exportStatus}</span>
                  <span className="font-mono text-slate-400">{exportProgress}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all"
                    style={{ width: `${exportProgress}%` }}
                  />
                </div>
              </div>
            )}

            {exportError && (
              <p className="mt-4 rounded-md border border-red-800 bg-red-950/50 p-3 text-sm text-red-300">
                {exportError}
              </p>
            )}

            {exportPhase === "done" && exportUrl && (
              <div className="mt-4 rounded-lg border border-emerald-800/50 bg-emerald-950/20 p-4">
                <video src={exportUrl} controls className="w-full rounded-lg border border-slate-800 bg-black" />
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <a href={exportUrl} download={exportFileName}>
                    <Button className="bg-emerald-600 hover:bg-emerald-500">Download {exportFileName}</Button>
                  </a>
                  <span className="text-xs text-slate-400">{(exportSize / (1024 * 1024)).toFixed(2)} MB</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {extracted.length > 0 && phase === "done" && (
        <div className="mt-6">
          <h3 className="mb-3 text-sm font-semibold text-slate-300">Individual clips ({extracted.length})</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {extracted.map((clip) => (
              <div key={clip.index} className="rounded-lg border border-slate-800 bg-slate-950 p-2">
                <video src={clip.url} controls className="aspect-video w-full rounded bg-black object-cover" />
                <p className="mt-1 truncate text-xs text-slate-400" title={clip.name}>
                  {clip.index + 1}. {clip.name}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
