"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { formatSeconds, type MappingPair } from "@/lib/report-parser"
import { subscribeBackground, type BackgroundState } from "@/lib/ffmpeg-client"

interface ComparisonViewerProps {
  shortFile: File
  movieFile: File
  pairs: MappingPair[]
}

export function ComparisonViewer({ shortFile, movieFile, pairs }: ComparisonViewerProps) {
  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [bg, setBg] = useState<BackgroundState | null>(null)

  const shortRef = useRef<HTMLVideoElement>(null)
  const movieRef = useRef<HTMLVideoElement>(null)

  const shortUrl = useMemo(() => URL.createObjectURL(shortFile), [shortFile])
  const movieUrl = useMemo(() => URL.createObjectURL(movieFile), [movieFile])

  useEffect(() => {
    return () => {
      URL.revokeObjectURL(shortUrl)
      URL.revokeObjectURL(movieUrl)
    }
  }, [shortUrl, movieUrl])

  useEffect(() => subscribeBackground(setBg), [])

  const pair = pairs[current]

  // Seek both videos to the current pair's segment start whenever pair changes.
  useEffect(() => {
    const sv = shortRef.current
    const mv = movieRef.current
    if (!sv || !mv || !pair) return
    sv.pause()
    mv.pause()
    setPlaying(false)
    sv.currentTime = pair.shortStart
    mv.currentTime = pair.movieStart
  }, [pair])

  // Loop each video within its segment bounds.
  useEffect(() => {
    const sv = shortRef.current
    const mv = movieRef.current
    if (!sv || !mv || !pair) return

    const clamp = (video: HTMLVideoElement, start: number, end: number) => () => {
      if (video.currentTime >= end - 0.03) {
        video.currentTime = start
        if (video.paused) return
        video.play().catch(() => {})
      }
    }
    const onShort = clamp(sv, pair.shortStart, pair.shortEnd)
    const onMovie = clamp(mv, pair.movieStart, pair.movieEnd)
    sv.addEventListener("timeupdate", onShort)
    mv.addEventListener("timeupdate", onMovie)
    return () => {
      sv.removeEventListener("timeupdate", onShort)
      mv.removeEventListener("timeupdate", onMovie)
    }
  }, [pair])

  const togglePlay = useCallback(() => {
    const sv = shortRef.current
    const mv = movieRef.current
    if (!sv || !mv || !pair) return
    if (playing) {
      sv.pause()
      mv.pause()
      setPlaying(false)
    } else {
      // Re-seek if either video is out of its segment
      if (sv.currentTime < pair.shortStart || sv.currentTime >= pair.shortEnd) {
        sv.currentTime = pair.shortStart
      }
      if (mv.currentTime < pair.movieStart || mv.currentTime >= pair.movieEnd) {
        mv.currentTime = pair.movieStart
      }
      Promise.all([sv.play(), mv.play()])
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false))
    }
  }, [playing, pair])

  const restart = useCallback(() => {
    const sv = shortRef.current
    const mv = movieRef.current
    if (!sv || !mv || !pair) return
    sv.currentTime = pair.shortStart
    mv.currentTime = pair.movieStart
  }, [pair])

  const goTo = useCallback(
    (i: number) => {
      if (i < 0 || i >= pairs.length) return
      setCurrent(i)
    },
    [pairs.length],
  )

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return
      if (e.key === "ArrowLeft") goTo(current - 1)
      else if (e.key === "ArrowRight") goTo(current + 1)
      else if (e.key === " ") {
        e.preventDefault()
        togglePlay()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [current, goTo, togglePlay])

  if (!pair) return null

  const bgDone = bg?.clips.size ?? 0
  const bgTotal = bg?.total ?? pairs.length

  return (
    <div className="space-y-4">
      {/* Pair navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => goTo(current - 1)}
            disabled={current === 0}
            className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
          >
            ← Prev
          </Button>
          <span className="px-2 text-sm font-medium text-slate-300">
            Pair {current + 1} of {pairs.length}
          </span>
          <Button
            variant="outline"
            onClick={() => goTo(current + 1)}
            disabled={current === pairs.length - 1}
            className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
          >
            Next →
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={restart}
            className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
          >
            Restart
          </Button>
          <Button onClick={togglePlay} className="bg-blue-600 hover:bg-blue-500">
            {playing ? "Pause Both" : "Play Both"}
          </Button>
        </div>
      </div>

      {/* Match info */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 p-3">
        <span className="rounded bg-blue-500/15 px-2 py-0.5 text-xs font-semibold text-blue-300">
          {pair.matchType}
        </span>
        <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300">
          {pair.confidence}
        </span>
        <span className="text-sm text-slate-200">{pair.label}</span>
      </div>

      {/* Side-by-side videos */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-purple-800/50 bg-slate-950 p-3">
          <p className="mb-2 text-sm font-semibold text-purple-300">Short Video</p>
          <video
            ref={shortRef}
            src={shortUrl}
            playsInline
            muted
            preload="auto"
            className="aspect-video w-full rounded bg-black"
          />
          <div className="mt-2 space-y-0.5 text-xs text-slate-400">
            <p className="font-mono">
              {formatSeconds(pair.shortStart)} → {formatSeconds(pair.shortEnd)}
            </p>
            <p className="font-mono text-slate-500">
              f{pair.shortStartFrame} → f{pair.shortEndFrame}
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-blue-800/50 bg-slate-950 p-3">
          <p className="mb-2 text-sm font-semibold text-blue-300">Movie</p>
          <video
            ref={movieRef}
            src={movieUrl}
            playsInline
            preload="auto"
            className="aspect-video w-full rounded bg-black"
          />
          <div className="mt-2 space-y-0.5 text-xs text-slate-400">
            <p className="font-mono">
              {formatSeconds(pair.movieStart)} → {formatSeconds(pair.movieEnd)}
            </p>
            <p className="font-mono text-slate-500">
              f{pair.movieStartFrame} → f{pair.movieEndFrame}
            </p>
          </div>
        </div>
      </div>

      {/* Clip chip strip */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium text-slate-400">Jump to pair</p>
          <p className="text-xs text-slate-500">
            {bg?.error ? (
              <span className="text-red-400">Background cutting failed — clips will cut in Step 3</span>
            ) : (
              <>
                Background cutting: <span className="font-mono text-slate-300">{bgDone}/{bgTotal}</span>
                {bg?.running ? " (running…)" : bgDone === bgTotal && bgTotal > 0 ? " — done" : ""}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {pairs.map((p, i) => {
            const cut = bg?.clips.has(p.index)
            return (
              <button
                key={p.index}
                type="button"
                onClick={() => goTo(i)}
                title={p.label}
                className={`relative flex h-8 w-10 items-center justify-center rounded border text-xs font-medium transition ${
                  i === current
                    ? "border-blue-500 bg-blue-600 text-white"
                    : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                {i + 1}
                {cut && (
                  <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-[9px] leading-none text-white">
                    ✓
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Use ← → arrow keys to switch pairs, Space to play/pause. Green check = movie clip already cut in the
        background for fast merging.
      </p>
    </div>
  )
}
