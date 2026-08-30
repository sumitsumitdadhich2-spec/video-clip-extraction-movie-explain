"use client"

import { upload } from "@vercel/blob/client"

// ---------------------------------------------------------------------------
// Resumable merge jobs — fingerprinting, localStorage manifests, and
// retry-with-backoff part uploads. The cloud layout for one job is:
//   history/<fingerprint>/manifest.json
//   history/<fingerprint>/part-000.mp4, part-001.mp4, ...
// Parts upload DIRECTLY from the browser (multipart) while the next segment
// is still processing, so saving adds no extra time after the merge.
// ---------------------------------------------------------------------------

export const MERGE_SETTINGS_VERSION = "concat-copy-v1"

export interface JobManifest {
  fingerprint: string
  /** Output filename shown in History. */
  name: string
  /** Original input identities — lets the UI tell the user which files to re-select. */
  inputs: { aName: string; aSize: number; bName: string; bSize: number }
  totalSegments: number | null
  segmentDurationSec: number
  totalDurationSec: number | null
  completedSegments: number[]
  createdAt: string
}

/**
 * Deterministic job ID: same two files + same merge settings = same
 * fingerprint, which is how an interrupted job is recognized later.
 */
export async function computeFingerprint(fileA: File, fileB: File): Promise<string> {
  const key = [
    fileA.name,
    fileA.size,
    fileA.lastModified,
    fileB.name,
    fileB.size,
    fileB.lastModified,
    MERGE_SETTINGS_VERSION,
  ].join("\n")
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40)
}

export function partPathname(fingerprint: string, index: number): string {
  return `history/${fingerprint}/part-${String(index).padStart(3, "0")}.mp4`
}

export function manifestPathname(fingerprint: string): string {
  return `history/${fingerprint}/manifest.json`
}

export function finalPathname(fingerprint: string): string {
  return `history/${fingerprint}/final.mp4`
}

// ---------------------------------------------------------------------------
// localStorage manifests
// ---------------------------------------------------------------------------

const LS_KEY = "merge-job-manifests-v1"

function loadAll(): Record<string, JobManifest> {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, JobManifest>
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function persistAll(all: Record<string, JobManifest>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(all))
  } catch {
    // localStorage full/unavailable — resume via cloud part listing still works.
  }
}

export function getManifest(fingerprint: string): JobManifest | null {
  return loadAll()[fingerprint] ?? null
}

export function saveManifest(manifest: JobManifest) {
  const all = loadAll()
  all[manifest.fingerprint] = manifest
  persistAll(all)
}

export function removeManifest(fingerprint: string) {
  const all = loadAll()
  if (fingerprint in all) {
    delete all[fingerprint]
    persistAll(all)
  }
}

// ---------------------------------------------------------------------------
// Uploads with retry + backoff
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Uploads one blob with up to 3 attempts (2s / 8s backoff between retries).
 * Throws only after all attempts fail — the caller keeps the merge running.
 */
export async function uploadWithRetry(
  pathname: string,
  data: Blob,
  contentType: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(2000 * attempt * attempt)
    try {
      await upload(pathname, data, {
        access: "private",
        handleUploadUrl: "/api/history/upload",
        multipart: data.size > 5 * 1024 * 1024,
        contentType,
        onUploadProgress: ({ percentage }) => onProgress?.(Math.round(percentage)),
      })
      return
    } catch (err) {
      lastError = err
      console.log("[v0] part upload attempt", attempt + 1, "failed for", pathname, err)
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Upload failed after 3 attempts")
}

/** Uploads the small manifest.json for a job (best-effort). */
export async function uploadJobManifest(manifest: JobManifest): Promise<void> {
  const blob = new Blob([JSON.stringify(manifest)], { type: "application/json" })
  await uploadWithRetry(manifestPathname(manifest.fingerprint), blob, "application/json")
}
