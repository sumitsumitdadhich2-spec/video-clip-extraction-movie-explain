"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { useSWRConfig } from "swr"
import { MergeUploader } from "@/components/merge-uploader"
import { HistoryPanel } from "@/components/history-panel"
import { Button } from "@/components/ui/button"
import { mergeVideos, totalSizeOk, formatBytes, formatEta, MAX_TOTAL_BYTES } from "@/lib/merge-client"
import { saveToHistory } from "@/lib/history-client"

type JobPhase = "merging" | "saving" | "done" | "error"

interface MergeJob {
  id: number
  name: string
  phase: JobPhase
  status: string
  progress: number
  eta: number | null
  saveProgress: number
  error: string
  /** Local object URL for instant playback/download (this session only). */
  localUrl: string | null
  sizeBytes: number
  usedFallback: boolean
  /** Set once saved to Blob — survives refresh via History. */
  savedPathname: string | null
  saveFailed: boolean
}

let nextJobId = 1

export default function Page() {
  const [shortFile, setShortFile] = useState<File | null>(null)
  const [movieFile, setMovieFile] = useState<File | null>(null)
  const [jobs, setJobs] = useState<MergeJob[]>([])
  const { mutate } = useSWRConfig()
  // Keeps the merged blobs around for "retry save" without re-merging.
  const blobCache = useRef<Map<number, Blob>>(new Map())

  const sizeOk = totalSizeOk(shortFile, movieFile)
  const canMerge = !!shortFile && !!movieFile && sizeOk

  const updateJob = (id: number, patch: Partial<MergeJob>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)))
  }

  const saveJobToHistory = async (id: number, blob: Blob, downloadName: string) => {
    updateJob(id, { phase: "saving", saveProgress: 0, saveFailed: false })
    try {
      const { pathname } = await saveToHistory(blob, downloadName, (percent) => {
        updateJob(id, { saveProgress: percent })
      })
      updateJob(id, { phase: "done", savedPathname: pathname, saveProgress: 100 })
      blobCache.current.delete(id)
      mutate("history")
    } catch (err) {
      console.error("[v0] history save error:", err)
      // Merge succeeded — keep the local download working, just flag the save.
      updateJob(id, { phase: "done", saveFailed: true })
    }
  }

  const handleMerge = () => {
    if (!shortFile || !movieFile) return
    const a = shortFile
    const b = movieFile
    const id = nextJobId++
    const downloadName = `${a.name.replace(/\.[^.]+$/, "")}_merged.mp4`

    // Clear the pickers immediately so another merge can start in parallel.
    setShortFile(null)
    setMovieFile(null)

    setJobs((prev) => [
      {
        id,
        name: downloadName,
        phase: "merging",
        status: "Starting...",
        progress: 0,
        eta: null,
        saveProgress: 0,
        error: "",
        localUrl: null,
        sizeBytes: 0,
        usedFallback: false,
        savedPathname: null,
        saveFailed: false,
      },
      ...prev,
    ])

    // Run in the background — each job has its own isolated ffmpeg engine.
    ;(async () => {
      try {
        const result = await mergeVideos(a, b, {
          onStatus: (status) => updateJob(id, { status }),
          onProgress: (progress) => updateJob(id, { progress }),
          onEta: (eta) => updateJob(id, { eta }),
        })
        blobCache.current.set(id, result.blob)
        updateJob(id, {
          localUrl: result.url,
          sizeBytes: result.sizeBytes,
          usedFallback: result.usedFallback,
        })
        // Auto-save to cloud storage so a refresh/crash can't lose it.
        await saveJobToHistory(id, result.blob, downloadName)
      } catch (err) {
        console.error("[v0] merge error:", err)
        updateJob(id, {
          phase: "error",
          error:
            err instanceof Error && err.message
              ? err.message
              : "Merge failed. The files may be too large for the browser, or in an unsupported format.",
        })
      }
    })()
  }

  const dismissJob = (id: number) => {
    setJobs((prev) => {
      const job = prev.find((j) => j.id === id)
      if (job?.localUrl) URL.revokeObjectURL(job.localUrl)
      return prev.filter((j) => j.id !== id)
    })
    blobCache.current.delete(id)
  }

  const retrySave = (job: MergeJob) => {
    const blob = blobCache.current.get(job.id)
    if (blob) void saveJobToHistory(job.id, blob, job.name)
  }

  const activeJobs = jobs.filter((j) => j.phase === "merging" || j.phase === "saving").length

  return (
    <main className="min-h-screen bg-slate-950 p-4 md:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-balance text-2xl font-bold text-slate-50 md:text-3xl">Fast Video Merger</h1>
            <p className="mt-2 text-pretty text-slate-400">
              Upload a short video (Part A) and a full movie (Part B). They merge into one video — short in
              front, movie after — with no cuts, no re-encoding, and original quality. Merged videos are
              saved to History automatically, so a refresh or crash never loses your work.
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
          <MergeUploader
            shortFile={shortFile}
            movieFile={movieFile}
            disabled={false}
            onShortFile={setShortFile}
            onMovieFile={setMovieFile}
          />

          {!sizeOk && (
            <p className="mt-4 rounded-lg border border-amber-600/40 bg-amber-500/10 p-3 text-sm text-amber-300">
              Combined file size is too large for browser merging (limit ~{formatBytes(MAX_TOTAL_BYTES)}).
              Try a smaller movie file.
            </p>
          )}

          <Button
            onClick={handleMerge}
            disabled={!canMerge}
            className="mt-6 h-11 w-full bg-blue-600 text-base font-semibold hover:bg-blue-500 disabled:opacity-50"
          >
            {activeJobs > 0 ? `Merge Videos (${activeJobs} running — parallel OK)` : "Merge Videos"}
          </Button>

          {activeJobs > 0 && (
            <p className="mt-2 text-center text-xs text-slate-500">
              You can pick two new files and start another merge while these run.
            </p>
          )}
        </div>

        {jobs.length > 0 && (
          <section className="mt-6 flex flex-col gap-4" aria-label="Merge jobs">
            {jobs.map((job) => (
              <div key={job.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4 md:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-100">{job.name}</p>
                    {job.phase === "done" && (
                      <p className="text-xs text-slate-400">
                        {formatBytes(job.sizeBytes)}
                        {job.usedFallback
                          ? " — short converted to match movie format (movie kept original quality)"
                          : " — pure stream copy, 100% original quality"}
                        {job.savedPathname && " · Saved to History"}
                      </p>
                    )}
                  </div>
                  {(job.phase === "done" || job.phase === "error") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => dismissJob(job.id)}
                      className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                    >
                      Dismiss
                    </Button>
                  )}
                </div>

                {job.phase === "merging" && (
                  <div className="mt-3">
                    <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 flex-1 truncate text-slate-300">{job.status}</span>
                      <span className="shrink-0 font-mono text-slate-400">
                        {job.eta !== null && job.eta > 0 && (
                          <span className="mr-3 text-slate-500">~{formatEta(job.eta)} left</span>
                        )}
                        {job.progress}%
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all duration-300"
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>
                  </div>
                )}

                {job.phase === "saving" && (
                  <div className="mt-3">
                    <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                      <span className="text-slate-300">Saving to History (cloud storage)...</span>
                      <span className="font-mono text-slate-400">{job.saveProgress}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                        style={{ width: `${job.saveProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                {job.phase === "error" && (
                  <p className="mt-3 rounded-lg border border-red-600/40 bg-red-500/10 p-3 text-sm text-red-300">
                    {job.error}
                  </p>
                )}

                {job.phase === "done" && (
                  <div className="mt-3 flex flex-col gap-3">
                    {job.saveFailed && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-600/40 bg-amber-500/10 p-3">
                        <p className="text-sm text-amber-300">
                          Merge succeeded but saving to History failed (storage may be full). Download below
                          before leaving the page.
                        </p>
                        {blobCache.current.has(job.id) && (
                          <Button
                            size="sm"
                            onClick={() => retrySave(job)}
                            className="bg-amber-600 font-medium hover:bg-amber-500"
                          >
                            Retry Save
                          </Button>
                        )}
                      </div>
                    )}

                    {job.localUrl && (
                      <>
                        <video
                          src={job.localUrl}
                          controls
                          className="w-full rounded-lg border border-slate-800 bg-black"
                        />
                        <a href={job.localUrl} download={job.name} className="block">
                          <Button className="h-11 w-full bg-emerald-600 text-base font-semibold hover:bg-emerald-500">
                            Download Merged Video
                          </Button>
                        </a>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </section>
        )}

        <HistoryPanel />

        <p className="mt-4 text-center text-xs text-slate-500">
          Merging happens on your device; the finished video is then saved to your 10GB cloud History so it
          survives refresh and crashes. Use Delete in History to free up storage.
        </p>
      </div>
    </main>
  )
}
