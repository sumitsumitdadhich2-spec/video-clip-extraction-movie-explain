"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useSWRConfig } from "swr"
import { MergeUploader } from "@/components/merge-uploader"
import { MovieTrimmer } from "@/components/movie-trimmer"
import { HistoryPanel } from "@/components/history-panel"
import { Button } from "@/components/ui/button"
import {
  processMergeInSegments,
  processPreviewMerge,
  totalSizeOk,
  formatBytes,
  formatEta,
  formatTimecode,
  MAX_TOTAL_BYTES,
  SEGMENT_DURATION_SEC,
  type MovieTrim,
} from "@/lib/merge-client"
import {
  computeFingerprint,
  getManifest,
  saveManifest,
  removeManifest,
  uploadWithRetry,
  uploadJobManifest,
  partPathname,
  finalPathname,
  type JobManifest,
} from "@/lib/resumable"
import {
  fetchPartBlob,
  fetchHistory,
  consolidateJob,
  deleteJobFromHistory,
  isBlobConnected,
  STORAGE_QUOTA_BYTES,
} from "@/lib/history-client"
import { useHistory } from "@/components/history-panel"

type JobPhase = "merging" | "done" | "error"

interface MergeJob {
  id: number
  name: string
  fingerprint: string
  phase: JobPhase
  status: string
  /** Combined "Merging + Saving" percent (one bar — no separate save step). */
  progress: number
  /** Raw processing percent from ffmpeg (0..100). */
  processPercent: number
  eta: number | null
  error: string
  /** Local object URL for instant playback/download (this session only). */
  localUrl: string | null
  sizeBytes: number
  usedFallback: boolean
  totalSegments: number | null
  uploadedSegments: number
  /** True while parts are still uploading after the merge itself finished. */
  savingInBackground: boolean
  /** True if any part exhausted its 3 upload retries (merge still completes). */
  uploadsFailed: boolean
  /** True when Blob storage isn't connected — cloud saving was skipped entirely. */
  cloudSkipped: boolean
  /** Chosen export height (720, 1080, ...) — null = original quality (stream copy). */
  exportHeight: number | null
}

interface PreviewState {
  running: boolean
  status: string
  progress: number
  eta: number | null
  url: string | null
  error: string
  movieSecIncluded: number
  truncated: boolean
}

const QUALITY_OPTIONS: { label: string; value: number | null }[] = [
  { label: "Original", value: null },
  { label: "1080p", value: 1080 },
  { label: "720p", value: 720 },
  { label: "480p", value: 480 },
  { label: "360p", value: 360 },
]

interface JobUploadState {
  manifest: JobManifest
  pending: Promise<void>[]
  failed: boolean
}

let nextJobId = 1

export default function Page() {
  const [shortFile, setShortFile] = useState<File | null>(null)
  const [movieFile, setMovieFile] = useState<File | null>(null)
  const [movieTrim, setMovieTrim] = useState<MovieTrim | null>(null)
  const [jobs, setJobs] = useState<MergeJob[]>([])
  const [exportQuality, setExportQuality] = useState<number | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [resumeCandidate, setResumeCandidate] = useState<JobManifest | null>(null)
  const { mutate } = useSWRConfig()
  const uploadStates = useRef<Map<number, JobUploadState>>(new Map())
  const { data: historyData } = useHistory()

  const sizeOk = totalSizeOk(shortFile, movieFile)
  const canMerge = !!shortFile && !!movieFile && sizeOk

  // Storage warning is informational only — merging and downloading keep
  // working even when the 10GB cloud quota is exhausted.
  const storageUsed = historyData?.totalBytes ?? 0
  const storageNearlyFull = storageUsed >= STORAGE_QUOTA_BYTES * 0.9

  const updateJob = (id: number, patch: Partial<MergeJob> | ((j: MergeJob) => Partial<MergeJob>)) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...(typeof patch === "function" ? patch(j) : patch) } : j)))
  }

  // Combined progress: processing carries 75% of the bar; part uploads
  // (which run in parallel with processing) carry 25% — ONE bar total.
  const setCombined = (id: number, processPercent: number | null, uploadedSegments: number | null) => {
    updateJob(id, (j) => {
      const proc = processPercent ?? j.processPercent
      const uploaded = uploadedSegments ?? j.uploadedSegments
      const total = j.totalSegments
      const uploadPct = total && total > 0 ? (uploaded / total) * 100 : 0
      return {
        processPercent: proc,
        uploadedSegments: uploaded,
        // No cloud saving → processing IS the whole bar.
        progress: j.cloudSkipped
          ? Math.min(100, Math.round(proc))
          : Math.min(100, Math.round(proc * 0.75 + uploadPct * 0.25)),
      }
    })
  }

  // Movie file changed/cleared → the old trim no longer applies.
  useEffect(() => {
    setMovieTrim(null)
  }, [movieFile])

  // Files or trim changed → an existing preview no longer matches; drop it.
  // (Never interrupts a RUNNING preview — only stale finished ones.)
  useEffect(() => {
    setPreview((prev) => {
      if (!prev || prev.running) return prev
      if (prev.url) URL.revokeObjectURL(prev.url)
      return null
    })
  }, [shortFile, movieFile, movieTrim])

  const dismissPreview = () => {
    setPreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url)
      return null
    })
  }

  // Low-quality preview: cut + merge at 360p just to CHECK the result.
  // Export is completely separate and always uses the original files.
  const runPreview = async () => {
    if (!shortFile || !movieFile || preview?.running) return
    if (preview?.url) URL.revokeObjectURL(preview.url)
    setPreview({
      running: true,
      status: "Starting...",
      progress: 0,
      eta: null,
      url: null,
      error: "",
      movieSecIncluded: 0,
      truncated: false,
    })
    try {
      const result = await processPreviewMerge(shortFile, movieFile, movieTrim, {
        onStatus: (status) => setPreview((p) => (p ? { ...p, status } : p)),
        onProgress: (progress) => setPreview((p) => (p ? { ...p, progress } : p)),
        onEta: (eta) => setPreview((p) => (p ? { ...p, eta } : p)),
      })
      setPreview({
        running: false,
        status: "Preview ready",
        progress: 100,
        eta: null,
        url: result.url,
        error: "",
        movieSecIncluded: result.movieSecIncluded,
        truncated: result.truncated,
      })
    } catch (err) {
      console.error("[v0] preview error:", err)
      setPreview({
        running: false,
        status: "",
        progress: 0,
        eta: null,
        url: null,
        error: err instanceof Error && err.message ? err.message : "Preview failed. Try again.",
        movieSecIncluded: 0,
        truncated: false,
      })
    }
  }

  // --- Resume detection: same files + same trim re-selected → offer resume --
  useEffect(() => {
    let cancelled = false
    setResumeCandidate(null)
    if (!shortFile || !movieFile) return
    ;(async () => {
      try {
        const fp = await computeFingerprint(shortFile, movieFile, movieTrim)
        if (cancelled) return
        const manifest = getManifest(fp)
        if (
          manifest &&
          manifest.totalSegments !== null &&
          manifest.completedSegments.length > 0 &&
          manifest.completedSegments.length < manifest.totalSegments
        ) {
          setResumeCandidate(manifest)
          return
        }

        // No local manifest (cleared storage / different browser) — fall back
        // to the cloud: incomplete jobs live under history/<fp>/ in Blob.
        const history = await fetchHistory().catch(() => null)
        if (cancelled || !history) return
        const cloudJob = history.jobs.find((j) => j.fingerprint === fp && !j.complete)
        if (
          cloudJob &&
          cloudJob.totalSegments !== null &&
          cloudJob.completedSegments.length > 0 &&
          cloudJob.completedSegments.length < cloudJob.totalSegments
        ) {
          const rebuilt: JobManifest = {
            fingerprint: fp,
            name: cloudJob.name,
            inputs: { aName: shortFile.name, aSize: shortFile.size, bName: movieFile.name, bSize: movieFile.size },
            totalSegments: cloudJob.totalSegments,
            segmentDurationSec: cloudJob.segmentDurationSec ?? SEGMENT_DURATION_SEC,
            totalDurationSec: cloudJob.totalDurationSec,
            completedSegments: cloudJob.completedSegments,
            createdAt: cloudJob.uploadedAt,
          }
          saveManifest(rebuilt)
          setResumeCandidate(rebuilt)
        }
      } catch (err) {
        console.error("[v0] fingerprint error:", err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [shortFile, movieFile, movieTrim])

  const startMerge = (resumeCandidateIn: JobManifest | null) => {
    if (!shortFile || !movieFile) return
    const a = shortFile
    const b = movieFile
    // Snapshot the trim + quality NOW — the state is cleared below so a
    // parallel merge can be configured while this one runs.
    const trim = movieTrim
    const exportHeight = exportQuality
    // Resume (saved cloud parts) only applies to original-quality exports —
    // a re-encoded export is a different output entirely.
    const resumeFrom = exportHeight === null ? resumeCandidateIn : null
    const id = nextJobId++
    const downloadName = `${a.name.replace(/\.[^.]+$/, "")}_merged${exportHeight ? `_${exportHeight}p` : ""}.mp4`

    // Clear the pickers immediately so another merge can start in parallel.
    setShortFile(null)
    setMovieFile(null)
    setMovieTrim(null)
    setResumeCandidate(null)

    setJobs((prev) => [
      {
        id,
        name: downloadName,
        fingerprint: "",
        phase: "merging",
        status: "Starting...",
        progress: 0,
        processPercent: 0,
        eta: null,
        error: "",
        localUrl: null,
        sizeBytes: 0,
        usedFallback: false,
        totalSegments: resumeFrom?.totalSegments ?? null,
        uploadedSegments: resumeFrom?.completedSegments.length ?? 0,
        savingInBackground: false,
        uploadsFailed: false,
        cloudSkipped: false,
        exportHeight,
      },
      ...prev,
    ])

    // Run in the background — each job has its own isolated ffmpeg engine.
    ;(async () => {
      let fingerprint = ""
      try {
        fingerprint = resumeFrom?.fingerprint ?? (await computeFingerprint(a, b, trim))
        updateJob(id, { fingerprint })

        // Blob storage not connected → skip ALL cloud saving. The merge and
        // the local download work exactly the same, just without History.
        // Re-encoded quality exports also skip cloud saving/resume — they're
        // one-off local downloads, separate from the resumable original path.
        const cloudEnabled = exportHeight === null && (await isBlobConnected())
        if (!cloudEnabled) updateJob(id, { cloudSkipped: true })

        // FRESH start (not a resume): purge any stale cloud remnants at this
        // fingerprint from a previous run — leftover extra parts or an old
        // final.mp4 would otherwise get mixed into History for this job.
        if (cloudEnabled && !resumeFrom) {
          removeManifest(fingerprint)
          await deleteJobFromHistory(fingerprint).catch(() => {})
        }

        const manifest: JobManifest = resumeFrom ?? {
          fingerprint,
          name: downloadName,
          inputs: { aName: a.name, aSize: a.size, bName: b.name, bSize: b.size },
          totalSegments: null,
          segmentDurationSec: SEGMENT_DURATION_SEC,
          totalDurationSec: null,
          completedSegments: [],
          createdAt: new Date().toISOString(),
        }
        const state: JobUploadState = { manifest, pending: [], failed: false }
        uploadStates.current.set(id, state)
        if (cloudEnabled) saveManifest(manifest)

        const result = await processMergeInSegments(
          a,
          b,
          {
            // No cloud saving → no reason to cut the output into parts.
            // One direct stream-copy pass = much faster, no "part X of Y".
            segmented: cloudEnabled,
            // Chosen export quality — re-encodes FROM THE ORIGINAL files.
            exportHeight,
            onStatus: (status) => updateJob(id, { status }),
            onProcessProgress: (percent) => setCombined(id, percent, null),
            onEta: (eta) => updateJob(id, { eta }),
            onPlan: (plan) => {
              // A plan change (e.g. fallback to a single pass) invalidates any
              // previously uploaded parts — reset the manifest to match.
              if (state.manifest.totalSegments !== null && state.manifest.totalSegments !== plan.totalSegments) {
                state.manifest.completedSegments = []
                updateJob(id, { uploadedSegments: 0 })
              }
              state.manifest.totalSegments = plan.totalSegments
              state.manifest.segmentDurationSec = plan.segmentDurationSec
              state.manifest.totalDurationSec = plan.totalDurationSec
              if (cloudEnabled) saveManifest(state.manifest)
              updateJob(id, { totalSegments: plan.totalSegments })
            },
            onSegmentReady: (index, data) => {
              // Blob not connected → skip saving this part entirely.
              if (!cloudEnabled) return
              // Fire-and-forget: the upload runs WHILE the next segment is
              // still processing. Never blocks or breaks the merge.
              const p = uploadWithRetry(partPathname(fingerprint, index), data, "video/mp4")
                .then(() => {
                  if (!state.manifest.completedSegments.includes(index)) {
                    state.manifest.completedSegments.push(index)
                    state.manifest.completedSegments.sort((x, y) => x - y)
                  }
                  saveManifest(state.manifest)
                  setCombined(id, null, state.manifest.completedSegments.length)
                  // Best-effort cloud manifest so incomplete jobs are visible
                  // in History from any session.
                  void uploadJobManifest(state.manifest).catch(() => {})
                })
                .catch((err) => {
                  console.error("[v0] part upload failed permanently:", err)
                  state.failed = true
                  updateJob(id, { uploadsFailed: true })
                })
              state.pending.push(p)
            },
          },
          resumeFrom && resumeFrom.totalSegments !== null
            ? {
                completedSegments: resumeFrom.completedSegments,
                expectedTotalSegments: resumeFrom.totalSegments,
                fetchPart: (index) => fetchPartBlob(partPathname(fingerprint, index)),
              }
            : undefined,
          trim,
        )

        // Merge done — video is download-ready NOW. Any still-running part
        // uploads finish in the background.
        updateJob(id, {
          phase: "done",
          localUrl: result.url,
          sizeBytes: result.sizeBytes,
          usedFallback: result.usedFallback,
          savingInBackground: cloudEnabled,
          eta: null,
        })

        if (!cloudEnabled) {
          // Nothing was (or will be) saved — finish here.
          updateJob(id, { savingInBackground: false, progress: 100 })
          return
        }

        await Promise.allSettled(state.pending)

        if (!state.failed && state.manifest.totalSegments !== null &&
            state.manifest.completedSegments.length >= state.manifest.totalSegments) {
          // Fully saved: consolidate into ONE history/<fp>/final.mp4 and
          // delete the redundant parts + manifest. All background + best
          // effort — the user's download has been ready since 100%.
          removeManifest(fingerprint)
          updateJob(id, { savingInBackground: false, progress: 100 })
          try {
            if (state.manifest.totalSegments > 1) {
              // The browser already holds the assembled final video — upload
              // it in the background, then the server cleans up the parts.
              await uploadWithRetry(finalPathname(fingerprint), result.blob, "video/mp4")
            }
            // Single-segment jobs: the server just COPIES part-000 → final.mp4
            // (no re-upload). Multi-part: parts + manifest get deleted now.
            await consolidateJob(fingerprint)
          } catch (err) {
            // Consolidation failed (e.g. storage full) — keep the parts +
            // cloud manifest so History playback/reassembly still works.
            console.error("[v0] consolidation failed (parts kept):", err)
            await uploadJobManifest(state.manifest).catch(() => {})
          }
        } else {
          // Some parts didn't make it — keep the manifest so resume works.
          updateJob(id, { savingInBackground: false, uploadsFailed: state.failed })
        }
        mutate("history")
      } catch (err) {
        console.error("[v0] merge error:", err)
        updateJob(id, {
          phase: "error",
          error:
            err instanceof Error && err.message
              ? err.message
              : "Merge failed. The files may be too large for the browser, or in an unsupported format.",
        })
        mutate("history")
      } finally {
        uploadStates.current.delete(id)
      }
    })()
  }

  const dismissJob = (id: number) => {
    setJobs((prev) => {
      const job = prev.find((j) => j.id === id)
      if (job?.localUrl) URL.revokeObjectURL(job.localUrl)
      return prev.filter((j) => j.id !== id)
    })
  }

  const activeJobs = jobs.filter((j) => j.phase === "merging" || j.savingInBackground).length

  return (
    <main className="min-h-screen bg-slate-950 p-4 md:p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-balance text-2xl font-bold text-slate-50 md:text-3xl">Fast Video Merger</h1>
            <p className="mt-2 text-pretty text-slate-400">
              Upload a short video (Part A) and a full movie (Part B). They merge into one video — short in
              front, movie after — with original quality. Each part is saved to cloud History WHILE the merge
              runs, so a refresh or crash never loses progress: re-select the same files and resume.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/matcher"
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
            >
              Clip Matcher (Page 2) →
            </Link>
            <Link
              href="/voice-clone"
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
            >
              Voice Clone (Page 3) →
            </Link>
          </div>
        </header>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 md:p-6">
          <MergeUploader
            shortFile={shortFile}
            movieFile={movieFile}
            disabled={false}
            onShortFile={setShortFile}
            onMovieFile={setMovieFile}
          />

          {movieFile && <MovieTrimmer movieFile={movieFile} trim={movieTrim} onTrimChange={setMovieTrim} />}

          {/* Export quality — separate from the low-quality preview */}
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
            <h3 className="text-sm font-semibold text-slate-200">Export quality</h3>
            <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Export quality">
              {QUALITY_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  role="radio"
                  aria-checked={exportQuality === opt.value}
                  onClick={() => setExportQuality(opt.value)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                    exportQuality === opt.value
                      ? "border-blue-500 bg-blue-500/15 text-blue-300"
                      : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {exportQuality === null
                ? "Original = pure stream copy from the original files (fastest, 100% quality, saved to History)."
                : `Export re-encodes at ${exportQuality}p FROM THE ORIGINAL videos (slower — local download only, no cloud save/resume). Preview quality never affects the export.`}
            </p>
          </div>

          {!sizeOk && (
            <p className="mt-4 rounded-lg border border-amber-600/40 bg-amber-500/10 p-3 text-sm text-amber-300">
              Combined file size is too large for browser merging (limit ~{formatBytes(MAX_TOTAL_BYTES)}).
              Try a smaller movie file.
            </p>
          )}

          {storageNearlyFull && (
            <p className="mt-4 rounded-lg border border-amber-600/40 bg-amber-500/10 p-3 text-sm text-amber-300">
              Cloud storage is {storageUsed >= STORAGE_QUOTA_BYTES ? "full" : "almost full"} (
              {formatBytes(storageUsed)} / {formatBytes(STORAGE_QUOTA_BYTES)}). Merging and downloading keep
              working, but cloud saves may fail — delete old videos in History to free up space.
            </p>
          )}

          {resumeCandidate && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-600/40 bg-blue-500/10 p-3">
              <p className="text-sm text-blue-200">
                Previous merge of these files stopped at{" "}
                <span className="font-semibold">
                  {resumeCandidate.completedSegments.length}/{resumeCandidate.totalSegments} parts saved
                </span>
                {" — resume to skip the already-saved parts."}
              </p>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  onClick={() => startMerge(resumeCandidate)}
                  className="bg-blue-600 font-semibold hover:bg-blue-500"
                >
                  Resume
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    removeManifest(resumeCandidate.fingerprint)
                    setResumeCandidate(null)
                  }}
                  className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                >
                  Start Fresh
                </Button>
              </div>
            </div>
          )}

          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <Button
              onClick={runPreview}
              disabled={!canMerge || preview?.running === true}
              variant="outline"
              className="h-11 border-slate-700 bg-slate-800 text-base font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            >
              {preview?.running ? "Making preview..." : "Preview (Low Quality)"}
            </Button>
            <Button
              onClick={() => startMerge(resumeCandidate)}
              disabled={!canMerge}
              className="h-11 bg-blue-600 text-base font-semibold hover:bg-blue-500 disabled:opacity-50"
            >
              {resumeCandidate && exportQuality === null
                ? "Resume Merge"
                : activeJobs > 0
                  ? `Export Merge (${activeJobs} running)`
                  : `Export Merge${exportQuality ? ` — ${exportQuality}p` : " — Original"}`}
            </Button>
          </div>

          {/* Low-quality preview player — for checking only, never exported */}
          {preview && (
            <div className="mt-4 rounded-lg border border-purple-600/40 bg-purple-500/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-purple-200">Low-Quality Preview (360p — checking only)</h3>
                {!preview.running && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={dismissPreview}
                    className="h-7 border-slate-700 bg-slate-800 px-2 text-xs text-slate-200 hover:bg-slate-700"
                  >
                    Dismiss
                  </Button>
                )}
              </div>

              {preview.running && (
                <div className="mt-3">
                  <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 flex-1 truncate text-slate-300">{preview.status}</span>
                    <span className="shrink-0 font-mono text-slate-400">
                      {preview.eta !== null && preview.eta > 0 && (
                        <span className="mr-3 text-slate-500">~{formatEta(preview.eta)} left</span>
                      )}
                      {preview.progress}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-purple-500 transition-all duration-300"
                      style={{ width: `${preview.progress}%` }}
                    />
                  </div>
                </div>
              )}

              {preview.error && (
                <p className="mt-3 rounded-lg border border-red-600/40 bg-red-500/10 p-3 text-sm text-red-300">
                  {preview.error}
                </p>
              )}

              {preview.url && (
                <div className="mt-3 flex flex-col gap-2">
                  <video src={preview.url} controls className="w-full rounded-lg border border-slate-800 bg-black" />
                  <p className="text-xs text-slate-400">
                    This preview is low quality (360p) just to check the cut + join point.
                    {preview.truncated &&
                      ` It shows the short + the first ${formatTimecode(preview.movieSecIncluded)} of your selected movie section.`}{" "}
                    The exported video is always made from the ORIGINAL files at your chosen quality.
                  </p>
                </div>
              )}
            </div>
          )}

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
                        {job.exportHeight
                          ? ` — exported at ${job.exportHeight}p (re-encoded from the original videos)`
                          : job.usedFallback
                            ? " — short converted to match movie format (movie kept original quality)"
                            : " — pure stream copy, 100% original quality"}
                        {job.cloudSkipped
                          ? job.exportHeight
                            ? " · Local download only (quality exports skip cloud save)"
                            : " · Cloud save skipped (storage not connected)"
                          : !job.savingInBackground && !job.uploadsFailed && " · Saved to History"}
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
                      <span className="min-w-0 flex-1 truncate text-slate-300">
                        {job.cloudSkipped ? "Merging" : "Merging + Saving"} — {job.status}
                      </span>
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
                    {job.cloudSkipped ? (
                      <p className="mt-1.5 text-xs text-slate-500">
                        {job.exportHeight
                          ? `Re-encoding at ${job.exportHeight}p from the original videos — local download when done`
                          : "Cloud storage not connected — saving skipped, download will still work"}
                      </p>
                    ) : (
                      job.totalSegments !== null &&
                      job.totalSegments > 1 && (
                        <p className="mt-1.5 text-xs text-slate-500">
                          {job.uploadedSegments}/{job.totalSegments} parts saved to cloud (uploads run
                          alongside the merge)
                        </p>
                      )
                    )}
                  </div>
                )}

                {job.phase === "error" && (
                  <p className="mt-3 rounded-lg border border-red-600/40 bg-red-500/10 p-3 text-sm text-red-300">
                    {job.error}
                  </p>
                )}

                {job.phase === "done" && (
                  <div className="mt-3 flex flex-col gap-3">
                    {job.savingInBackground && (
                      <p className="rounded-lg border border-blue-600/40 bg-blue-500/10 p-3 text-sm text-blue-200">
                        Finishing cloud save in the background ({job.uploadedSegments}
                        {job.totalSegments !== null ? `/${job.totalSegments}` : ""} parts saved) — your download
                        below is already ready.
                      </p>
                    )}

                    {job.uploadsFailed && !job.savingInBackground && (
                      <p className="rounded-lg border border-amber-600/40 bg-amber-500/10 p-3 text-sm text-amber-300">
                        Merge succeeded but some parts could not be saved to History (storage may be full).
                        Download below before leaving the page — or re-select the same files later to retry
                        saving via Resume.
                      </p>
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
          Merging happens on your device; each finished part uploads to your 10GB cloud History while the next
          part is still processing — merge 100% means saved. Use Delete in History to free up storage.
        </p>
      </div>
    </main>
  )
}
