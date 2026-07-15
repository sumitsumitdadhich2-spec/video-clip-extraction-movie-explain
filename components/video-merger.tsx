'use client'

interface VideoMergerProps {
  clips: any[]
}

export function VideoMerger({ clips }: VideoMergerProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-white">Merge Video Clips</h2>
      <p className="text-slate-300">These {clips.length} clips will be merged into a single video file.</p>

      <div className="bg-slate-700 p-4 rounded-lg space-y-3">
        {clips.map((clip, index) => (
          <div key={index} className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-semibold">
              {index + 1}
            </div>
            <div className="flex-1">
              <p className="text-slate-200 font-semibold">{clip.name || `Clip ${index + 1}`}</p>
              <p className="text-slate-400 text-sm">{clip.duration || 'Processing...'}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
