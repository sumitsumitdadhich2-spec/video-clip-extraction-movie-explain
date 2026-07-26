"use client"

import { useState } from "react"
import { VideoUploader } from "@/components/video-uploader"
import { ClipPreviewer } from "@/components/clip-previewer"
import { ExtractionPanel } from "@/components/extraction-panel"
import { Button } from "@/components/ui/button"
import { resolveClip, type Clip, type ResolvedClip } from "@/lib/timestamp"

type Step = "upload" | "preview" | "process"

export default function Page() {
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [clips, setClips] = useState<ResolvedClip[]>([])
  const [step, setStep] = useState<Step>("upload")
  const [parseError, setParseError] = useState<string | null>(null)
  const [videoSource, setVideoSource] = useState<'short' | 'full'>('full')

  const handleFilesSelected = (video: File, json: File, source: 'short' | 'full') => {
    setParseError(null)
    setVideoSource(source)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const raw = JSON.parse(e.target?.result as string)
        const list: Clip[] = Array.isArray(raw) ? raw : raw.clips || raw.scenes || raw.segments || []
        if (!list.length) {
          setParseError("No clips found in the JSON. Expected an array of scenes or segments.")
          return
        }
        
        // Filter and map clips based on video source selection
        let resolved: ResolvedClip[]
        if (source === 'short') {
          // For short videos, extract clips from shortStart and shortEnd
          resolved = list
            .filter((c) => c?.shortStart !== undefined && c?.shortEnd !== undefined)
            .map((c, i) => {
              // Convert short video times to the ResolvedClip format
              const clipWithShortTime: Clip = {
                ...c,
                movieStart: c.shortStart,
                movieEnd: c.shortEnd,
              }
              return resolveClip(clipWithShortTime, i)
            })
        } else {
          // For full movies, extract clips from movieStart and movieEnd
          resolved = list
            .filter((c) => c?.movieStart !== undefined && c?.movieEnd !== undefined)
            .map((c, i) => {
              // Use movieStart and movieEnd directly
              const clipWithMovieTime: Clip = {
                ...c,
                movieStart: c.movieStart,
                movieEnd: c.movieEnd,
              }
              return resolveClip(clipWithMovieTime, i)
            })
        }
        
        if (!resolved.length) {
          const fieldName = source === 'short' ? 'shortStart/shortEnd' : 'movieStart/movieEnd'
          setParseError(`No clips found with ${fieldName} data for ${source === 'short' ? 'short video' : 'full movie'}.`)
          return
        }
        
        setVideoFile(video)
        setClips(resolved)
        setStep("preview")
      } catch (error) {
        console.error("[v0] JSON parsing error:", error)
        setParseError("Failed to parse the JSON file. Make sure it is valid JSON.")
      }
    }
    reader.readAsText(json)
  }

  const steps: { key: Step; title: string; desc: string }[] = [
    { key: "upload", title: "1. Upload", desc: "Movie + JSON metadata" },
    { key: "preview", title: "2. Preview Clips", desc: "Review matched segments" },
    { key: "process", title: "3. Extract & Merge", desc: "Build the final video" },
  ]

  const activeIndex = steps.findIndex((s) => s.key === step)

  return (
    <main className="min-h-screen bg-slate-950 p-4 md:p-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-slate-50 text-balance">
            Video Clip Extractor &amp; Merger
          </h1>
          <p className="mt-2 text-slate-400 text-pretty">
            Upload a movie and its temporal-grounding JSON. The app reads each matched timestamp,
            cuts the clip from the movie, then merges everything into a single previewable video —
            all in your browser.
          </p>
        </header>

        <nav className="mb-8 grid grid-cols-3 gap-3">
          {steps.map((s, i) => (
            <div
              key={s.key}
              className={`rounded-lg border p-3 transition ${
                i === activeIndex
                  ? "border-blue-500 bg-blue-500/10"
                  : i < activeIndex
                    ? "border-emerald-600/40 bg-emerald-500/5"
                    : "border-slate-800 bg-slate-900"
              }`}
            >
              <p className="text-sm font-semibold text-slate-100">{s.title}</p>
              <p className="text-xs text-slate-400">{s.desc}</p>
            </div>
          ))}
        </nav>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 md:p-6">
          {step === "upload" && (
            <>
              <VideoUploader onFilesSelected={handleFilesSelected} />
              {parseError && (
                <p className="mt-4 rounded-md border border-red-800 bg-red-950/50 p-3 text-sm text-red-300">
                  {parseError}
                </p>
              )}
            </>
          )}

          {step === "preview" && (
            <div>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-100">
                    {clips.length} clips detected
                  </h2>
                  <div className="space-y-1">
                    <p className="text-sm text-slate-400">
                      Video: <span className="text-slate-300">{videoFile?.name}</span>
                    </p>
                    <p className="text-sm text-slate-400">
                      Type: <span className={`text-sm font-semibold ${videoSource === 'short' ? 'text-purple-400' : 'text-blue-400'}`}>
                        {videoSource === 'short' ? '📹 Short Video' : '🎬 Full Movie'}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setStep("upload")}
                    className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                  >
                    Back
                  </Button>
                  <Button onClick={() => setStep("process")} className="bg-blue-600 hover:bg-blue-500">
                    Extract &amp; Merge
                  </Button>
                </div>
              </div>
              <ClipPreviewer clips={clips} />
            </div>
          )}

          {step === "process" && videoFile && (
            <ExtractionPanel videoFile={videoFile} clips={clips} onBack={() => setStep("preview")} />
          )}
        </div>
      </div>
    </main>
  )
}
