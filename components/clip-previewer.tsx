'use client'

interface ClipPreviewerProps {
  clips: any[]
}

export function ClipPreviewer({ clips }: ClipPreviewerProps) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">Clips to Extract ({clips.length} total)</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-96 overflow-y-auto">
        {clips.map((clip, index) => {
          const startTime = clip.matched_in_movie?.start_timestamp
          const endTime = clip.matched_in_movie?.end_timestamp
          const confidence = clip.matched_in_movie?.confidence
          const duration = clip.short_duration?.duration_seconds

          return (
            <div key={index} className="bg-slate-700 p-4 rounded-lg border border-slate-600 hover:border-blue-400 transition">
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-white font-semibold">{clip.short_video_clip}</h3>
                <span className="text-xs bg-blue-900 text-blue-300 px-2 py-1 rounded">#{index + 1}</span>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Duration:</span>
                  <span className="text-slate-300 font-mono">{duration?.toFixed(2)}s</span>
                </div>

                {startTime && endTime && (
                  <div>
                    <p className="text-slate-400">Movie Location:</p>
                    <p className="text-slate-300 font-mono text-xs bg-slate-800 p-2 rounded">
                      {startTime} → {endTime}
                    </p>
                  </div>
                )}

                {confidence && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Match Confidence:</span>
                    <span className="text-green-400 font-semibold">{confidence}</span>
                  </div>
                )}

                {clip.matched_in_movie?.total_matching_frames && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Frames:</span>
                    <span className="text-slate-300">{clip.matched_in_movie.total_matching_frames}</span>
                  </div>
                )}

                {clip.matched_in_movie?.fps_match && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">FPS:</span>
                    <span className="text-slate-300">{clip.matched_in_movie.fps_match}</span>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-6 p-4 bg-slate-700 rounded-lg border border-slate-600">
        <p className="text-slate-300 text-sm">
          <span className="font-semibold text-white">{clips.length}</span> clips will be extracted from the movie and merged into a single video file.
        </p>
      </div>
    </div>
  )
}
