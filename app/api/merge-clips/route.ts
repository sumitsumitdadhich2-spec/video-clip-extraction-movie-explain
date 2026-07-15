import { writeFile, readFile } from 'fs/promises'
import { join } from 'path'
import ffmpeg from 'fluent-ffmpeg'
import { NextRequest, NextResponse } from 'next/server'

export const config = {
  maxDuration: 300,
}

async function mergeVideos(clipPaths: string[], outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let command = ffmpeg()

    // Add each input file
    clipPaths.forEach((path) => {
      command = command.input(path)
    })

    command
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .mergeToFile(outputPath, join(process.cwd(), 'public', 'temp'))
  })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { clips } = body

    if (!clips || !Array.isArray(clips) || clips.length === 0) {
      return NextResponse.json({ error: 'No clips provided' }, { status: 400 })
    }

    const tempDir = join(process.cwd(), 'public', 'temp')
    const outputPath = join(tempDir, 'merged_video.mp4')

    // Get full paths for clips
    const clipPaths = clips.map((clip: any) => {
      const clipPath = clip.path.startsWith('/') ? clip.path : `/${clip.path}`
      return join(process.cwd(), 'public', clipPath)
    })

    // Merge videos
    await mergeVideos(clipPaths, outputPath)

    // Read the merged file
    const mergedBuffer = await readFile(outputPath)

    // Return the file
    return new NextResponse(mergedBuffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': 'attachment; filename="merged_video.mp4"',
        'Content-Length': mergedBuffer.length.toString(),
      },
    })
  } catch (error) {
    console.error('Merge clips error:', error)
    return NextResponse.json({ error: 'Failed to merge clips' }, { status: 500 })
  }
}
