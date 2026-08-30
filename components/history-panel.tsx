"use client"

import { useState } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import {
  fetchHistory,
  deleteFromHistory,
  deleteJobFromHistory,
  historyFileUrl,
  fetchPartBlob,
  STORAGE_QUOTA_BYTES,
  type HistoryData,
  type HistoryJob,
} from "@/lib/history-client"
import { formatBytes, concatPartBlobs } from "@/lib/merge-client"

export function useHistory() {
  return useSWR<HistoryData>("history", fetchHistory, {
    revalidateOnFocus: false,
  })
}

/** Downloads all parts of a job and reassembles them into one MP4 (stream copy). */
async function assembleJob(job: HistoryJob, onProgress: (percent: number) => void): Promise<Blob> {
  const parts: Blob[] = []
  for (let i = 0; i < job.partPathnames.length; i++) {
    onProgress(Math.round((i / job.partPathnames.length) * 80))
    parts.push(await fetchPartBlob(job.partPathnames[i]))
  }
  onProgress(85)
  const blob = await concatPartBlobs(parts, (p) => onProgress(85 + Math.round(p * 0.15)))
  onProgress(100)
  return blob
}

function JobRow({ job, onDelete, deleting }: { job: HistoryJob; onDelete: () => void; deleting: boolean }) {
  const [assembling, setAssembling] = useState<"play" | "download" | null>(null)
  const [assembleProgress, setAssembleProgress] = useState(0)
  const [playUrl, setPlayUrl] = useState<string | null>(null)
  const [assembleError, setAssembleError] = useState("")

  const runAssemble = async (mode: "play" | "download") => {
    setAssembling(mode)
    setAssembleProgress(0)
    setAssembleError("")
    try {
      const blob = await assembleJob(job, setAssembleProgress)
      const url = URL.createObjectURL(blob)
      if (mode === "play") {
        if (playUrl) URL.revokeObjectURL(playUrl)
        setPlayUrl(url)
      } else {
        const a = document.createElement("a")
        a.href = url
        a.download = job.name
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
      }
    } catch (err) {
      console.error("[v0] job assemble error:", err)
      setAssembleError("Could not rebuild the video from its saved parts. Try again.")
    } finally {
      setAssembling(null)
    }
  }

  return (
    <li className="rounded-lg border border-slate-800 bg-slate-950 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-200">{job.name}</p>
          <p className="text-xs text-slate-500">
            {formatBytes(job.sizeBytes)} · {new Date(job.uploadedAt).toLocaleString()}
            {!job.complete && (
              <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-300">
                Incomplete — {job.savedParts}
                {job.totalSegments !== null ? `/${job.totalSegments}` : ""} parts saved
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {job.complete ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={assembling !== null}
                onClick={() => (playUrl ? (URL.revokeObjectURL(playUrl), setPlayUrl(null)) : runAssemble("play"))}
                className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-50"
              >
                {playUrl ? "Hide" : assembling === "play" ? `Preparing ${assembleProgress}%` : "Play"}
              </Button>
              <Button
                size="sm"
                disabled={assembling !== null}
                onClick={() => runAssemble("download")}
                className="bg-emerald-600 font-medium hover:bg-emerald-500 disabled:opacity-50"
              >
                {assembling === "download" ? `Preparing ${assembleProgress}%` : "Download"}
              </Button>
            </>
          ) : (
            <span className="text-xs text-slate-500">Re-select the same two files above to resume</span>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={deleting}
            onClick={onDelete}
            className="border-red-900/60 bg-red-950/40 text-red-300 hover:bg-red-900/40 disabled:opacity-50"
          >
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </div>

      {assembleError && (
        <p className="mt-2 rounded-lg border border-red-600/40 bg-red-500/10 p-2 text-xs text-red-300">
          {assembleError}
        </p>
      )}

      {playUrl && (
        <video src={playUrl} controls autoPlay className="mt-3 w-full rounded-lg border border-slate-800 bg-black" />
      )}
    </li>
  )
}

export function HistoryPanel() {
  const { data, error, isLoading, mutate } = useHistory()
  const [playing, setPlaying] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const videos = data?.videos ?? []
  const jobs = data?.jobs ?? []
  const totalBytes = data?.totalBytes ?? 0
  const usedPercent = Math.min(100, Math.round((totalBytes / STORAGE_QUOTA_BYTES) * 100))
  const isEmpty = videos.length === 0 && jobs.length === 0

  const handleDelete = async (pathname: string) => {
    setDeleting(pathname)
    try {
      await deleteFromHistory(pathname)
      if (playing === pathname) setPlaying(null)
      await mutate()
    } catch (err) {
      console.error("[v0] delete error:", err)
    } finally {
      setDeleting(null)
    }
  }

  const handleDeleteJob = async (fingerprint: string) => {
    setDeleting(fingerprint)
    try {
      await deleteJobFromHistory(fingerprint)
      await mutate()
    } catch (err) {
      console.error("[v0] job delete error:", err)
    } finally {
      setDeleting(null)
    }
  }

  return (
    <section className="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">History (saved merges)</h2>
          <p className="text-sm text-slate-400">
            Saved to cloud storage — survives refresh, crash, and browser close.
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-slate-300">
            {formatBytes(totalBytes)} <span className="text-slate-500">/ {formatBytes(STORAGE_QUOTA_BYTES)}</span>
          </p>
          <p className="text-xs text-slate-500">storage used</p>
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-valuenow={usedPercent} aria-valuemin={0} aria-valuemax={100} aria-label="Storage used">
        <div
          className={`h-full rounded-full transition-all duration-300 ${usedPercent > 90 ? "bg-red-500" : usedPercent > 70 ? "bg-amber-500" : "bg-emerald-500"}`}
          style={{ width: `${usedPercent}%` }}
        />
      </div>

      {isLoading && <p className="mt-4 text-sm text-slate-500">Loading history...</p>}

      {error && (
        <p className="mt-4 rounded-lg border border-red-600/40 bg-red-500/10 p-3 text-sm text-red-300">
          Could not load history. Check your connection and try again.
        </p>
      )}

      {!isLoading && !error && isEmpty && (
        <p className="mt-4 text-sm text-slate-500">
          No saved videos yet. Merged videos are saved here automatically — part by part, while merging.
        </p>
      )}

      <ul className="mt-4 flex flex-col gap-3">
        {jobs.map((job) => (
          <JobRow
            key={job.fingerprint}
            job={job}
            deleting={deleting === job.fingerprint}
            onDelete={() => handleDeleteJob(job.fingerprint)}
          />
        ))}

        {videos.map((v) => (
          <li key={v.pathname} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-200">{v.filename}</p>
                <p className="text-xs text-slate-500">
                  {formatBytes(v.size)} · {new Date(v.uploadedAt).toLocaleString()}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPlaying(playing === v.pathname ? null : v.pathname)}
                  className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                >
                  {playing === v.pathname ? "Hide" : "Play"}
                </Button>
                <a href={historyFileUrl(v.pathname, true)} download>
                  <Button size="sm" className="bg-emerald-600 font-medium hover:bg-emerald-500">
                    Download
                  </Button>
                </a>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={deleting === v.pathname}
                  onClick={() => handleDelete(v.pathname)}
                  className="border-red-900/60 bg-red-950/40 text-red-300 hover:bg-red-900/40 disabled:opacity-50"
                >
                  {deleting === v.pathname ? "Deleting..." : "Delete"}
                </Button>
              </div>
            </div>

            {playing === v.pathname && (
              <video
                src={historyFileUrl(v.pathname)}
                controls
                autoPlay
                className="mt-3 w-full rounded-lg border border-slate-800 bg-black"
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
