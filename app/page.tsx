"use client"

import { useState } from "react"
import Link from "next/link"
import { MergeUploader } from "@/components/merge-uploader"
import { Button } from "@/components/ui/button"
import { mergeVideos, totalSizeOk, formatBytes, MAX_TOTAL_BYTES, type MergeResult } from "@/lib/merge-client"

type Phase = "idle" | "merging" | "done" | "error"

export default function Page() {
  const [shortFile, setShortFile] = useState<File | null>(null)
  const [movieFile, setMovieFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<Phase>("idle")
  const [status, setStatus] = useState("")
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<MergeResult | null>(null)
  const [errorMsg, setErrorMsg] = useState("")

  const sizeOk = totalSizeOk(shortFile, movieFile)
  const canMerge = !!shortFile && !!movieFile && sizeOk && phase !== "merging"

  const handleMerge = async () => {
    if (!shortFile || !movieFile) return
    setPhase("merging")
    setErrorMsg("")
    setProgress(0)

    try {
      const merged = await mergeVideos(shortFile, movieFile, {
        onStatus: setStatus,
        onProgress: setProgress,
      })
      setResult(merged)
      setPhase("done")
    } catch (err) {
      console.error("[v0] merge error:", err)
      setErrorMsg(
        err instanceof Error && err.message
          ? err.message
          : "Merge failed. The files may be too large for the browser, or in an unsupported format.",
      )
      setPhase("error")
    }
  }

  const handleReset = () => {
    if (result) URL.revokeObjectURL(result.url)
    setResult(null)
    setShortFile(null)
    setMovieFile(null)
    setPhase("idle")
    setStatus("")
    setProgress(0)
    setErrorMsg("")
  }

  const downloadName = shortFile ? `${shortFile.name.replace(/\.[^.]+$/, "")}_merged.mp4` : "merged.mp4"

  return (
    <main className="min-h-screen bg-slate-950 p-4 md:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-balance text-2xl font-bold text-slate-50 md:text-3xl">Fast Video Merger</h1>
            <p className="mt-2 text-pretty text-slate-400">
              Upload a short video (Part A) and a full movie (Part B). They merge into one video — short in
              front, movie after — with no cuts, no re-encoding, and original quality. Everything runs in
              your browser.
            </p>
          </div>
          <Link
            href="/matcher"
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
          >
            Clip Matcher (Page 2) →
          </Link>
        </header>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 md:p-6">
          {phase !== "done" && (
            <>
              <MergeUploader
                shortFile={shortFile}
                movieFile={movieFile}
                disabled={phase === "merging"}
                onShortFile={setShortFile}
                onMovieFile={setMovieFile}
              />

              {!sizeOk && (
                <p className="mt-4 rounded-lg border border-amber-600/40 bg-amber-500/10 p-3 text-sm text-amber-300">
                  Combined file size is too large for browser merging (limit ~{formatBytes(MAX_TOTAL_BYTES)}).
                  Try a smaller movie file.
                </p>
              )}

              {phase === "error" && (
                <p className="mt-4 rounded-lg border border-red-600/40 bg-red-500/10 p-3 text-sm text-red-300">
                  {errorMsg}
                </p>
              )}

              <div className="mt-6 flex flex-col gap-4">
                <Button
                  onClick={handleMerge}
                  disabled={!canMerge}
                  className="h-11 w-full bg-blue-600 text-base font-semibold hover:bg-blue-500 disabled:opacity-50"
                >
                  {phase === "merging" ? "Merging..." : "Merge Videos"}
                </Button>

                {phase === "merging" && (
                  <div>
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="text-slate-300">{status}</span>
                      <span className="font-mono text-slate-400">{progress}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all duration-300"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {phase === "done" && result && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-slate-100">Merge complete</h2>
                  <p className="text-sm text-slate-400">
                    {formatBytes(result.sizeBytes)}
                    {result.usedFallback
                      ? " — short video was converted to match the movie format (movie kept original quality)"
                      : " — pure stream copy, both videos at 100% original quality"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={handleReset}
                  className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                >
                  Merge Another
                </Button>
              </div>

              <video src={result.url} controls className="w-full rounded-lg border border-slate-800 bg-black" />

              <a href={result.url} download={downloadName} className="block">
                <Button className="h-11 w-full bg-emerald-600 text-base font-semibold hover:bg-emerald-500">
                  Download Merged Video
                </Button>
              </a>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-slate-500">
          No uploads to any server — merging happens entirely on your device using stream copy for maximum
          speed.
        </p>
      </div>
    </main>
  )
}
