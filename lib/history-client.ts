"use client"

export interface HistoryVideo {
  pathname: string
  filename: string
  size: number
  uploadedAt: string
}

/** A segment-based merge job saved in cloud storage (complete or incomplete). */
export interface HistoryJob {
  fingerprint: string
  name: string
  totalSegments: number | null
  segmentDurationSec: number | null
  totalDurationSec: number | null
  savedParts: number
  /** Segment indices already uploaded — enables resume from any device/session. */
  completedSegments: number[]
  partPathnames: string[]
  /** Set once the job has been consolidated into a single final.mp4. */
  finalPathname: string | null
  sizeBytes: number
  complete: boolean
  uploadedAt: string
}

export interface HistoryData {
  videos: HistoryVideo[]
  jobs: HistoryJob[]
  totalBytes: number
}

/** Blob storage quota shown to the user (10GB plan). */
export const STORAGE_QUOTA_BYTES = 10 * 1024 * 1024 * 1024

export async function fetchHistory(): Promise<HistoryData> {
  const res = await fetch("/api/history")
  if (!res.ok) throw new Error("Failed to load history")
  const data = (await res.json()) as Partial<HistoryData>
  return { videos: data.videos ?? [], jobs: data.jobs ?? [], totalBytes: data.totalBytes ?? 0 }
}

export async function deleteFromHistory(pathname: string): Promise<void> {
  const res = await fetch("/api/history/delete", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pathname }),
  })
  if (!res.ok) throw new Error("Delete failed")
}

/** Deletes an entire segment job (all parts + manifest) from cloud storage. */
export async function deleteJobFromHistory(fingerprint: string): Promise<void> {
  const res = await fetch("/api/history/delete", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fingerprint }),
  })
  if (!res.ok) throw new Error("Delete failed")
}

/** URL that streams a saved video/part for inline playback. */
export function historyFileUrl(pathname: string, download = false): string {
  return `/api/history/file?pathname=${encodeURIComponent(pathname)}${download ? "&download=1" : ""}`
}

/**
 * Asks the server to consolidate a fully-saved job: promotes/keeps
 * history/<fp>/final.mp4 and deletes the redundant parts + manifest.
 * Best-effort — on failure the parts simply remain (nothing is lost).
 */
export async function consolidateJob(fingerprint: string): Promise<boolean> {
  const res = await fetch("/api/history/consolidate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fingerprint }),
  })
  if (!res.ok) throw new Error("Consolidate failed")
  const data = (await res.json()) as { consolidated?: boolean }
  return data.consolidated === true
}

/** Downloads one saved part of a segment job as a Blob (used for resume + reassembly). */
export async function fetchPartBlob(pathname: string): Promise<Blob> {
  const res = await fetch(historyFileUrl(pathname))
  if (!res.ok) throw new Error(`Failed to fetch saved part: ${pathname}`)
  return res.blob()
}
