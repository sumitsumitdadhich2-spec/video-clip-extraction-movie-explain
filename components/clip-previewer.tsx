"use client"

import { formatSeconds, type ResolvedClip } from "@/lib/timestamp"

interface ClipPreviewerProps {
  clips: ResolvedClip[]
}

export function ClipPreviewer({ clips }: ClipPreviewerProps) {
  const totalDuration = clips.reduce((sum, c) => sum + c.durationSeconds, 0)

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-4 rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm">
        <span className="text-slate-400">
          Total clips: <span className="font-semibold text-slate-100">{clips.length}</span>
        </span>
        <span className="text-slate-400">
          Merged length:{" "}
          <span className="font-semibold text-slate-100">{formatSeconds(totalDuration)}</span>
        </span>
      </div>

      <div className="max-h-[480px] overflow-y-auto rounded-lg border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-slate-800 text-slate-300">
            <tr>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Start Time</th>
              <th className="px-3 py-2 font-medium">End Time</th>
              <th className="px-3 py-2 font-medium">Duration</th>
              <th className="px-3 py-2 font-medium">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {clips.map((clip) => {
              const confidence = clip.confidence || clip.matched_in_movie?.confidence || "N/A"
              return (
                <tr
                  key={clip.index}
                  className="border-t border-slate-800 odd:bg-slate-900 even:bg-slate-900/40"
                >
                  <td className="px-3 py-2 font-medium text-slate-100">{clip.index + 1}</td>
                  <td className="px-3 py-2 font-mono text-slate-300">
                    {formatSeconds(clip.startSeconds)}
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-300">
                    {formatSeconds(clip.endSeconds)}
                  </td>
                  <td className="px-3 py-2 text-slate-300">{formatSeconds(clip.durationSeconds)}</td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
                      {typeof confidence === 'number' ? confidence.toFixed(2) + '%' : confidence}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Timestamps are in seconds. Single-frame matches are extended to a short minimum duration so they stay visible in the merged video.
      </p>
    </div>
  )
}
