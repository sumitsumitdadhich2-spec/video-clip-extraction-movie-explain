"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { formatTimecode, type MovieTrim } from "@/lib/merge-client"

// ---------------------------------------------------------------------------
// MovieTrimmer — pick "kaha se kaha tak" of the movie (Part B) BEFORE merging.
// Pure UI: reads duration from the browser's native video metadata (instant,
// zero processing) and reports {startSec, endSec} up to the page. The actual
// cut happens inside the SAME stream-copy merge pass via concat inpoint /
// outpoint — so merge speed is completely unaffected.
// ---------------------------------------------------------------------------

interface MovieTrimmerProps {
  movieFile: File
  trim: MovieTrim | null
  onTrimChange: (trim: MovieTrim | null) => void
  disabled?: boolean
}

/** Parses "HH:MM:SS", "MM:SS" or "SS" into seconds; null when invalid. */
function parseTimecode(text: string): number | null {
  const t = text.trim()
  if (!t) return null
  const parts = t.split(":").map((p) => p.trim())
  if (parts.length > 3 || parts.some((p) => p === "" || !/^\d+$/.test(p))) return null
  const nums = parts.map((p) => Number.parseInt(p, 10))
  if (nums.some((n) => !Number.isFinite(n))) return null
  if (parts.length === 3) {
    if (nums[1] > 59 || nums[2] > 59) return null
    return nums[0] * 3600 + nums[1] * 60 + nums[2]
  }
  if (parts.length === 2) {
    if (nums[1] > 59) return null
    return nums[0] * 60 + nums[1]
  }
  return nums[0]
}

export function MovieTrimmer({ movieFile, trim, onTrimChange, disabled }: MovieTrimmerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  // Text the user is currently typing (may be mid-edit / invalid until blur).
  const [startText, setStartText] = useState("")
  const [endText, setEndText] = useState("")
  const [startInvalid, setStartInvalid] = useState(false)
  const [endInvalid, setEndInvalid] = useState(false)
  const [dragging, setDragging] = useState<"start" | "end" | null>(null)

  // Object URL for the local preview — created/revoked with the file.
  useEffect(() => {
    const url = URL.createObjectURL(movieFile)
    setVideoUrl(url)
    setDuration(null)
    return () => URL.revokeObjectURL(url)
  }, [movieFile])

  const startSec = trim?.startSec ?? 0
  const endSec = trim?.endSec ?? duration ?? 0

  // Keep the text inputs in sync with the effective range (unless mid-drag —
  // then they update live anyway since trim changes).
  useEffect(() => {
    setStartText(formatTimecode(startSec))
    setStartInvalid(false)
  }, [startSec])
  useEffect(() => {
    setEndText(formatTimecode(endSec))
    setEndInvalid(false)
  }, [endSec])

  const applyRange = useCallback(
    (nextStart: number, nextEnd: number) => {
      if (duration === null) return
      const s = Math.max(0, Math.min(nextStart, duration))
      const e = Math.max(0, Math.min(nextEnd, duration))
      if (e <= s) return
      // Full range = no trim (keeps behavior identical to before).
      if (s <= 0 && e >= duration) {
        onTrimChange(null)
      } else {
        onTrimChange({ startSec: s, endSec: e })
      }
    },
    [duration, onTrimChange],
  )

  const seekPreview = useCallback((sec: number) => {
    const v = videoRef.current
    if (v && Number.isFinite(sec)) {
      try {
        v.currentTime = sec
      } catch {
        // metadata not ready yet — ignore
      }
    }
  }, [])

  // --- Dual-handle slider drag logic ---------------------------------------
  const posToSec = useCallback(
    (clientX: number): number => {
      const track = trackRef.current
      if (!track || duration === null) return 0
      const rect = track.getBoundingClientRect()
      const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      return f * duration
    },
    [duration],
  )

  useEffect(() => {
    if (!dragging) return
    const onMove = (ev: PointerEvent) => {
      const sec = posToSec(ev.clientX)
      if (dragging === "start") {
        applyRange(Math.min(sec, endSec - 1), endSec)
        seekPreview(Math.min(sec, endSec - 1))
      } else {
        applyRange(startSec, Math.max(sec, startSec + 1))
        seekPreview(Math.max(sec, startSec + 1))
      }
    }
    const onUp = () => setDragging(null)
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
  }, [dragging, posToSec, applyRange, seekPreview, startSec, endSec])

  const commitStartText = () => {
    const sec = parseTimecode(startText)
    if (sec === null || duration === null || sec >= endSec || sec < 0 || sec > duration) {
      setStartInvalid(true)
      return
    }
    setStartInvalid(false)
    applyRange(sec, endSec)
    seekPreview(sec)
  }

  const commitEndText = () => {
    const sec = parseTimecode(endText)
    if (sec === null || duration === null || sec <= startSec || sec > duration) {
      setEndInvalid(true)
      return
    }
    setEndInvalid(false)
    applyRange(startSec, sec)
    seekPreview(sec)
  }

  const setFromPreview = (which: "start" | "end") => {
    const v = videoRef.current
    if (!v || duration === null) return
    const t = v.currentTime
    if (which === "start") {
      if (t < endSec) applyRange(t, endSec)
    } else {
      if (t > startSec) applyRange(startSec, t)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, commit: () => void) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      commit()
    }
  }

  const startPct = duration ? (startSec / duration) * 100 : 0
  const endPct = duration ? (endSec / duration) * 100 : 100
  const selectedSec = Math.max(0, endSec - startSec)
  const isTrimmed = trim !== null

  return (
    <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-200">Movie section to merge (Part B)</h3>
        {isTrimmed && (
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => onTrimChange(null)}
            className="h-7 border-slate-700 bg-slate-800 px-2 text-xs text-slate-200 hover:bg-slate-700"
          >
            Reset (full movie)
          </Button>
        )}
      </div>

      {videoUrl && (
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          preload="metadata"
          className="w-full rounded-lg border border-slate-800 bg-black"
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration
            if (Number.isFinite(d) && d > 0) setDuration(d)
          }}
        />
      )}

      {duration === null ? (
        <p className="mt-3 text-xs text-slate-500">Reading movie length...</p>
      ) : (
        <>
          {/* Set from preview */}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => setFromPreview("start")}
              className="h-8 border-slate-700 bg-slate-800 text-xs text-slate-200 hover:bg-slate-700"
            >
              Set Start = preview position
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => setFromPreview("end")}
              className="h-8 border-slate-700 bg-slate-800 text-xs text-slate-200 hover:bg-slate-700"
            >
              Set End = preview position
            </Button>
          </div>

          {/* Dual-handle timeline slider */}
          <div className="mt-4 px-2">
            <div
              ref={trackRef}
              className="relative h-2 cursor-pointer rounded-full bg-slate-800"
              onPointerDown={(e) => {
                if (disabled) return
                // Clicking the track grabs the NEAREST handle.
                const sec = posToSec(e.clientX)
                const nearStart = Math.abs(sec - startSec) <= Math.abs(sec - endSec)
                setDragging(nearStart ? "start" : "end")
                if (nearStart) {
                  applyRange(Math.min(sec, endSec - 1), endSec)
                  seekPreview(Math.min(sec, endSec - 1))
                } else {
                  applyRange(startSec, Math.max(sec, startSec + 1))
                  seekPreview(Math.max(sec, startSec + 1))
                }
              }}
            >
              {/* Selected range highlight */}
              <div
                className="absolute inset-y-0 rounded-full bg-blue-500"
                style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
              />
              {/* Start handle */}
              <button
                type="button"
                disabled={disabled}
                aria-label={`Start time: ${formatTimecode(startSec)}`}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  if (!disabled) setDragging("start")
                }}
                className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 border-blue-400 bg-slate-100 shadow active:cursor-grabbing"
                style={{ left: `${startPct}%` }}
              />
              {/* End handle */}
              <button
                type="button"
                disabled={disabled}
                aria-label={`End time: ${formatTimecode(endSec)}`}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  if (!disabled) setDragging("end")
                }}
                className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 border-blue-400 bg-slate-100 shadow active:cursor-grabbing"
                style={{ left: `${endPct}%` }}
              />
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-slate-500">
              <span>00:00:00</span>
              <span>{formatTimecode(duration)}</span>
            </div>
          </div>

          {/* Exact time inputs */}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="trim-start" className="mb-1 block text-xs text-slate-400">
                Start (HH:MM:SS)
              </label>
              <input
                id="trim-start"
                type="text"
                inputMode="numeric"
                value={startText}
                disabled={disabled}
                onChange={(e) => setStartText(e.target.value)}
                onBlur={commitStartText}
                onKeyDown={(e) => handleKeyDown(e, commitStartText)}
                className={`h-9 w-full rounded-md border bg-slate-900 px-3 font-mono text-sm text-slate-100 outline-none focus:border-blue-500 ${
                  startInvalid ? "border-red-500" : "border-slate-700"
                }`}
              />
              {startInvalid && <p className="mt-1 text-xs text-red-400">Invalid — must be before End</p>}
            </div>
            <div>
              <label htmlFor="trim-end" className="mb-1 block text-xs text-slate-400">
                End (HH:MM:SS)
              </label>
              <input
                id="trim-end"
                type="text"
                inputMode="numeric"
                value={endText}
                disabled={disabled}
                onChange={(e) => setEndText(e.target.value)}
                onBlur={commitEndText}
                onKeyDown={(e) => handleKeyDown(e, commitEndText)}
                className={`h-9 w-full rounded-md border bg-slate-900 px-3 font-mono text-sm text-slate-100 outline-none focus:border-blue-500 ${
                  endInvalid ? "border-red-500" : "border-slate-700"
                }`}
              />
              {endInvalid && <p className="mt-1 text-xs text-red-400">Invalid — must be after Start, within movie</p>}
            </div>
          </div>

          {/* Summary */}
          <p className="mt-3 text-xs text-slate-400">
            {isTrimmed ? (
              <>
                Movie: <span className="font-mono text-blue-300">{formatTimecode(startSec)}</span>
                {" → "}
                <span className="font-mono text-blue-300">{formatTimecode(endSec)}</span>
                {" — "}
                <span className="text-slate-300">{formatTimecode(selectedSec)}</span> of {formatTimecode(duration)}{" "}
                selected. Cut lands on the nearest keyframe (start can shift a few seconds) — zero re-encoding, same
                merge speed.
              </>
            ) : (
              <>Full movie selected ({formatTimecode(duration)}). Drag the handles or type times to take only a part.</>
            )}
          </p>
        </>
      )}
    </div>
  )
}
