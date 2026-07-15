'use client'

import { useState } from 'react'
import { VideoUploader } from '@/components/video-uploader'
import { ClipPreviewer } from '@/components/clip-previewer'
import { VideoMerger } from '@/components/video-merger'
import { Button } from '@/components/ui/button'

export default function Page() {
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [jsonFile, setJsonFile] = useState<File | null>(null)
  const [clips, setClips] = useState<any[]>([])
  const [extractedClips, setExtractedClips] = useState<any[]>([])
  const [step, setStep] = useState<'upload' | 'preview' | 'merge'>('upload')
  const [loading, setLoading] = useState(false)

  const handleFilesSelected = (video: File, json: File) => {
    setVideoFile(video)
    setJsonFile(json)
    
    // Parse JSON and extract clips info
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string)
        setClips(data)
        setStep('preview')
      } catch (error) {
        alert('Failed to parse JSON file')
      }
    }
    reader.readAsText(json)
  }

  const handleExtractClips = async () => {
    if (!videoFile || !clips.length) return
    
    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('video', videoFile)
      formData.append('clips', JSON.stringify(clips))

      const response = await fetch('/api/extract-clips', {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        const data = await response.json()
        setExtractedClips(data.clips)
        setStep('merge')
      } else {
        alert('Failed to extract clips')
      }
    } catch (error) {
      console.error('Error extracting clips:', error)
      alert('Error extracting clips')
    } finally {
      setLoading(false)
    }
  }

  const handleMerge = async () => {
    if (!extractedClips.length) return
    
    setLoading(true)
    try {
      const response = await fetch('/api/merge-clips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clips: extractedClips }),
      })

      if (response.ok) {
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'merged_video.mp4'
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
      } else {
        alert('Failed to merge clips')
      }
    } catch (error) {
      console.error('Error merging clips:', error)
      alert('Error merging clips')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">Video Clip Extractor & Merger</h1>
          <p className="text-slate-300">Extract clips from a movie using temporal grounding data and merge them into one video</p>
        </div>

        {/* Progress Steps */}
        <div className="mb-8 flex gap-4">
          <div className={`flex-1 p-4 rounded-lg transition ${step === 'upload' ? 'bg-blue-600' : 'bg-slate-700'}`}>
            <p className="text-white font-semibold">Step 1: Upload Files</p>
            <p className="text-sm text-slate-300">Upload movie & JSON metadata</p>
          </div>
          <div className={`flex-1 p-4 rounded-lg transition ${step === 'preview' ? 'bg-blue-600' : 'bg-slate-700'}`}>
            <p className="text-white font-semibold">Step 2: Preview Clips</p>
            <p className="text-sm text-slate-300">Review clips to extract</p>
          </div>
          <div className={`flex-1 p-4 rounded-lg transition ${step === 'merge' ? 'bg-blue-600' : 'bg-slate-700'}`}>
            <p className="text-white font-semibold">Step 3: Merge & Download</p>
            <p className="text-sm text-slate-300">Combine clips into one video</p>
          </div>
        </div>

        {/* Content */}
        <div className="bg-slate-800 rounded-lg p-8 shadow-2xl">
          {step === 'upload' && (
            <VideoUploader onFilesSelected={handleFilesSelected} />
          )}

          {step === 'preview' && clips.length > 0 && (
            <div>
              <ClipPreviewer clips={clips} />
              <div className="mt-8 flex gap-4">
                <Button
                  onClick={() => setStep('upload')}
                  variant="outline"
                  className="bg-slate-700 text-white hover:bg-slate-600"
                >
                  Back
                </Button>
                <Button
                  onClick={handleExtractClips}
                  disabled={loading}
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                >
                  {loading ? 'Extracting Clips...' : 'Extract All Clips'}
                </Button>
              </div>
            </div>
          )}

          {step === 'merge' && extractedClips.length > 0 && (
            <div>
              <h2 className="text-2xl font-bold text-white mb-6">Extracted Clips Ready to Merge</h2>
              <p className="text-slate-300 mb-6">
                Successfully extracted {extractedClips.length} clips. Ready to merge them into one video?
              </p>
              <div className="flex gap-4">
                <Button
                  onClick={() => setStep('preview')}
                  variant="outline"
                  className="bg-slate-700 text-white hover:bg-slate-600"
                >
                  Back
                </Button>
                <Button
                  onClick={handleMerge}
                  disabled={loading}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                >
                  {loading ? 'Merging Videos...' : 'Merge & Download'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
