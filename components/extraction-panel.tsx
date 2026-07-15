"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { extractClips, mergeClips, type ExtractedClip } from "@/lib/ffmpeg-client"
import type { ResolvedClip } from "@/lib/timestamp"

interface ExtractionPanelProps {
  videoFile: File
  clips: ResolvedClip[]
  onBack: () => void
}

type Phase = "idle" | "extracting" | "merging" | "done" | "error"

export function ExtractionPanel({ videoFile, clips, onBack }: ExtractionPanelProps) {
  const [phase, setPhase] = useState<Phase>("idle")
  const [status, setStatus] = useState("")
  const [doneCount, setDoneCount] = useState(0)
  const [extracted, setExtracted] = useState<ExtractedClip[]>([])
  const [mergedUrl, setMergedUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setPhase("extracting")
    setError(null)
    setDoneCount(0)
    setExtracted([])
    setMergedUrl(null)

    try {
      const clipResults = await extractClips(videoFile, clips, {
        onStatus: setStatus,
        onClipDone: (clip, count) => {
          setDoneCount(count)
          setExtracted((prev) => [...prev, clip])
        },
      })

      setPhase("merging")
      const url = await mergeClips(clipResults, { onStatus: setStatus })
      setMergedUrl(url)
      setStatus("Done! Your merged video is ready.")
      setPhase("done")
    } catch (err) {
      console.error("[v0] processing error:", err)
      setError(err instanceof Error ? err.message : "Something went wrong during processing.")
      setPhase("error")
    }
  }

  const progress = clips.length ? Math.round((doneCount / clips.length) * 100) : 0
  const busy = phase === "extracting" || phase === "merging"

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Extract &amp; Merge</h2>
          <p className="text-sm text-slate-400">
            {clips.length} clips from <span className="text-slate-300">{videoFile.name}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={onBack}
            disabled={busy}
            className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
          >
            Back
          </Button>
          {phase === "idle" || phase === "error" ? (
            <Button onClick={run} className="bg-blue-600 hover:bg-blue-500">
              {phase === "error" ? "Retry" : "Start Processing"}
            </Button>
          ) : null}
        </div>
      </div>

      {phase === "idle" && (
        <div className="rounded-lg border border-slate-800 bg-slate-950 p-6 text-center">
          <p className="text-slate-300">
            Ready to cut {clips.length} clips from the movie and stitch them into one video.
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Processing happens entirely in your browser. Larger movies take longer to load.
          </p>
        </div>
      )}

      {busy && (
        <div className="rounded-lg border border-slate-800 bg-slate-950 p-6">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="text-slate-300">{status}</span>
            {phase === "extracting" && (
              <span className="font-mono text-slate-400">
                {doneCount}/{clips.length}
              </span>
            )}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{ width: phase === "merging" ? "100%" : `${progress}%` }}
            />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Keep this tab open. The first run downloads the video engine (~30MB) once.
          </p>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-md border border-red-800 bg-red-950/50 p-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {phase === "done" && mergedUrl && (
        <div className="space-y-6">
          <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/20 p-4">
            <h3 className="mb-3 font-semibold text-emerald-200">Merged Video Preview</h3>
            <video
              src={mergedUrl}
              controls
              className="w-full rounded-lg border border-slate-800 bg-black"
            />
            <a href={mergedUrl} download="merged_video.mp4" className="mt-4 inline-block">
              <Button className="bg-emerald-600 hover:bg-emerald-500">Download merged_video.mp4</Button>
            </a>
          </div>
        </div>
      )}

      {extracted.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-3 text-sm font-semibold text-slate-300">
            Extracted clips ({extracted.length})
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {extracted.map((clip) => (
              <div key={clip.index} className="rounded-lg border border-slate-800 bg-slate-950 p-2">
                <video
                  src={clip.url}
                  controls
                  className="aspect-video w-full rounded bg-black object-cover"
                />
                <p className="mt-1 truncate text-xs text-slate-400" title={clip.name}>
                  {clip.name}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
