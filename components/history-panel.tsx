"use client"

import { useState } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import {
  fetchHistory,
  deleteFromHistory,
  historyFileUrl,
  STORAGE_QUOTA_BYTES,
  type HistoryData,
} from "@/lib/history-client"
import { formatBytes } from "@/lib/merge-client"

export function useHistory() {
  return useSWR<HistoryData>("history", fetchHistory, {
    revalidateOnFocus: false,
  })
}

export function HistoryPanel() {
  const { data, error, isLoading, mutate } = useHistory()
  const [playing, setPlaying] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const videos = data?.videos ?? []
  const totalBytes = data?.totalBytes ?? 0
  const usedPercent = Math.min(100, Math.round((totalBytes / STORAGE_QUOTA_BYTES) * 100))

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

      {!isLoading && !error && videos.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">
          No saved videos yet. Merged videos are saved here automatically.
        </p>
      )}

      <ul className="mt-4 flex flex-col gap-3">
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
