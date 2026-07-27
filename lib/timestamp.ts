// The matched_in_movie timestamps in the JSON use the format MM:SS:FF
// (minutes : seconds : frames) at the given fps (fps_match, default 24).
// Example: "00:01:07" at 24fps = 0min + 1sec + 7frames = 1 + 7/24 = 1.29s
//
// This is confirmed by the short_duration blocks:
//   start "00:00:00" end "00:01:07" => duration_seconds 1.33 (~1.29 rounded)

export function timecodeToSeconds(timecode: string, fps = 24): number {
  const parts = timecode.split(":").map((p) => parseInt(p, 10))
  if (parts.some((n) => Number.isNaN(n))) return 0

  // Support MM:SS:FF (3 parts) or HH:MM:SS:FF (4 parts) or plain SS.
  let minutes = 0
  let seconds = 0
  let frames = 0

  if (parts.length === 3) {
    ;[minutes, seconds, frames] = parts
  } else if (parts.length === 4) {
    const [hours, m, s, f] = parts
    minutes = hours * 60 + m
    seconds = s
    frames = f
  } else if (parts.length === 2) {
    ;[seconds, frames] = parts
  } else {
    seconds = parts[0] ?? 0
  }

  return minutes * 60 + seconds + frames / fps
}

export interface Clip {
  short_video_clip?: string
  short_duration?: {
    start: string | number
    end: string | number
    duration_seconds?: number
  }
  shortStart?: number
  shortEnd?: number
  movieStart?: number
  movieEnd?: number
  matched_in_movie?: {
    movie_name?: string
    start_timestamp?: string
    end_timestamp?: string
    confidence?: string | number
    fps_match?: number
    total_matching_frames?: number
    metadata_validation?: string
  }
  confidence?: number
  frameCount?: number
}

export interface ResolvedClip extends Clip {
  index: number
  startSeconds: number
  endSeconds: number
  durationSeconds: number
}

// Resolves a raw clip into concrete start/duration in seconds, applying a
// minimum duration so single-frame matches still produce a valid, visible clip.
export function resolveClip(clip: Clip, index: number, minDuration = 0.4): ResolvedClip {
  let startSeconds = 0
  let endSeconds = 0
  let fps = 24

  // Try to extract timestamps from various possible formats
  if (clip.matched_in_movie?.start_timestamp) {
    // Old format: MM:SS:FF timecode
    fps = clip.matched_in_movie.fps_match || 24
    startSeconds = timecodeToSeconds(clip.matched_in_movie.start_timestamp, fps)
    endSeconds = timecodeToSeconds(clip.matched_in_movie.end_timestamp || "00:00:00", fps)
  } else if (clip.movieStart !== undefined && clip.movieEnd !== undefined) {
    // New format: direct seconds
    startSeconds = clip.movieStart
    endSeconds = clip.movieEnd
  } else if (clip.short_duration?.start !== undefined && clip.short_duration?.end !== undefined) {
    // Alternative format: short_duration with direct values
    startSeconds = typeof clip.short_duration.start === 'string' 
      ? timecodeToSeconds(clip.short_duration.start, fps)
      : clip.short_duration.start
    endSeconds = typeof clip.short_duration.end === 'string'
      ? timecodeToSeconds(clip.short_duration.end, fps)
      : clip.short_duration.end
  }

  // Some entries have end < start (bad data) — swap them.
  if (endSeconds < startSeconds) {
    ;[startSeconds, endSeconds] = [endSeconds, startSeconds]
  }

  let durationSeconds = endSeconds - startSeconds

  // Fall back to the matching-frame count when the range is empty.
  if (durationSeconds <= 0) {
    const frames = clip.matched_in_movie?.total_matching_frames || clip.frameCount || 1
    durationSeconds = frames / fps
  }

  // Guarantee a minimum visible duration.
  if (durationSeconds < minDuration) {
    durationSeconds = minDuration
  }

  return {
    ...clip,
    index,
    startSeconds,
    endSeconds: startSeconds + durationSeconds,
    durationSeconds,
  }
}

export function formatSeconds(total: number): string {
  const m = Math.floor(total / 60)
  const s = Math.floor(total % 60)
  const ms = Math.round((total % 1) * 1000)
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`
}
