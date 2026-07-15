import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import ffmpeg from 'fluent-ffmpeg'
import { NextRequest, NextResponse } from 'next/server'

export const config = {
  maxDuration: 300,
}

function convertTimestampToSeconds(timestamp: string): number {
  const parts = timestamp.split(':')
  const hours = parseInt(parts[0], 10)
  const minutes = parseInt(parts[1], 10)
  const seconds = parseInt(parts[2], 10)
  return hours * 3600 + minutes * 60 + seconds
}

async function extractClip(
  inputPath: string,
  outputPath: string,
  startTime: number,
  endTime: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .seekInput(startTime)
      .duration(endTime - startTime)
      .output(outputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions('-preset fast')
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run()
  })
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const videoFile = formData.get('video') as File
    const clipsData = JSON.parse(formData.get('clips') as string)

    if (!videoFile) {
      return NextResponse.json({ error: 'No video file provided' }, { status: 400 })
    }

    // Create temp directory
    const tempDir = join(process.cwd(), 'public', 'temp')
    if (!existsSync(tempDir)) {
      await mkdir(tempDir, { recursive: true })
    }

    // Save uploaded video
    const videoBuffer = await videoFile.arrayBuffer()
    const videoPath = join(tempDir, 'input_video.mp4')
    await writeFile(videoPath, Buffer.from(videoBuffer))

    // Extract clips
    const extractedClips = []
    for (let i = 0; i < clipsData.length; i++) {
      const clip = clipsData[i]
      const startTime = convertTimestampToSeconds(clip.matched_in_movie.start_timestamp)
      const endTime = convertTimestampToSeconds(clip.matched_in_movie.end_timestamp)

      const clipPath = join(tempDir, `clip_${i + 1}.mp4`)
      
      try {
        await extractClip(videoPath, clipPath, startTime, endTime)
        extractedClips.push({
          id: i,
          name: clip.short_video_clip,
          path: `/temp/clip_${i + 1}.mp4`,
          order: i,
        })
      } catch (error) {
        console.error(`Failed to extract clip ${i + 1}:`, error)
      }
    }

    return NextResponse.json({
      success: true,
      clips: extractedClips,
      message: `Extracted ${extractedClips.length} clips`,
    })
  } catch (error) {
    console.error('Extract clips error:', error)
    return NextResponse.json({ error: 'Failed to extract clips' }, { status: 500 })
  }
}
