"use client"

import { upload } from "@vercel/blob/client"

export interface HistoryVideo {
  pathname: string
  filename: string
  size: number
  uploadedAt: string
}

export interface HistoryData {
  videos: HistoryVideo[]
  totalBytes: number
}

/** Blob storage quota shown to the user (10GB plan). */
export const STORAGE_QUOTA_BYTES = 10 * 1024 * 1024 * 1024

/**
 * Saves a merged video to Blob storage so it survives refresh/crash.
 * Uploads DIRECTLY from the browser to Blob (multipart) — the file never
 * passes through a server function, so multi-GB videos work fine.
 */
export async function saveToHistory(
  blob: Blob,
  filename: string,
  onProgress?: (percent: number) => void,
): Promise<{ pathname: string }> {
  const safeName = filename.replace(/[^\w.\- ]/g, "_")
  const result = await upload(`merged/${safeName}`, blob, {
    access: "private",
    handleUploadUrl: "/api/history/upload",
    multipart: true,
    contentType: "video/mp4",
    onUploadProgress: ({ percentage }) => {
      onProgress?.(Math.round(percentage))
    },
  })
  return { pathname: result.pathname }
}

export async function fetchHistory(): Promise<HistoryData> {
  const res = await fetch("/api/history")
  if (!res.ok) throw new Error("Failed to load history")
  return res.json()
}

export async function deleteFromHistory(pathname: string): Promise<void> {
  const res = await fetch("/api/history/delete", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pathname }),
  })
  if (!res.ok) throw new Error("Delete failed")
}

/** URL that streams a saved video for inline playback. */
export function historyFileUrl(pathname: string, download = false): string {
  return `/api/history/file?pathname=${encodeURIComponent(pathname)}${download ? "&download=1" : ""}`
}
