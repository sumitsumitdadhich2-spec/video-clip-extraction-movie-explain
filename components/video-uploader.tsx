'use client'

import { useState, useRef } from 'react'
import { Button } from './ui/button'

interface VideoUploaderProps {
  onFilesSelected: (video: File, json: File) => void
}

export function VideoUploader({ onFilesSelected }: VideoUploaderProps) {
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [jsonFile, setJsonFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    const files = e.dataTransfer.files
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (file.type.startsWith('video/')) {
        setVideoFile(file)
      } else if (file.type === 'application/json') {
        setJsonFile(file)
      }
    }
  }

  const handleVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setVideoFile(e.target.files[0])
    }
  }

  const handleJsonChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setJsonFile(e.target.files[0])
    }
  }

  const videoInputRef = useRef<HTMLInputElement>(null)
  const jsonInputRef = useRef<HTMLInputElement>(null)

  const handleContinue = () => {
    if (videoFile && jsonFile) {
      onFilesSelected(videoFile, jsonFile)
    }
  }

  return (
    <div className="space-y-6">
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-12 text-center transition ${
          dragActive ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-600'
        }`}
      >
        <p className="text-slate-300 text-lg mb-4">Drag and drop your files here or select them below</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Video File Upload */}
          <div className="bg-slate-700 p-6 rounded-lg">
            <label className="block mb-3">
              <span className="text-slate-200 font-semibold mb-2 block">Movie File (MP4, MKV, etc.)</span>
              <input
                ref={videoInputRef}
                type="file"
                accept="video/*"
                onChange={handleVideoChange}
                className="hidden"
              />
              <div
                onClick={() => videoInputRef.current?.click()}
                className="bg-slate-600 hover:bg-slate-500 cursor-pointer p-4 rounded border border-slate-500 transition"
              >
                <p className="text-slate-300 text-sm">Click to select video</p>
              </div>
            </label>
            {videoFile && (
              <div className="mt-3 p-3 bg-green-900/30 rounded border border-green-700">
                <p className="text-green-300 text-sm font-semibold">✓ {videoFile.name}</p>
                <p className="text-slate-400 text-xs">{(videoFile.size / (1024 * 1024)).toFixed(2)} MB</p>
              </div>
            )}
          </div>

          {/* JSON File Upload */}
          <div className="bg-slate-700 p-6 rounded-lg">
            <label className="block mb-3">
              <span className="text-slate-200 font-semibold mb-2 block">Metadata JSON File</span>
              <input
                ref={jsonInputRef}
                type="file"
                accept="application/json"
                onChange={handleJsonChange}
                className="hidden"
              />
              <div
                onClick={() => jsonInputRef.current?.click()}
                className="bg-slate-600 hover:bg-slate-500 cursor-pointer p-4 rounded border border-slate-500 transition"
              >
                <p className="text-slate-300 text-sm">Click to select JSON</p>
              </div>
            </label>
            {jsonFile && (
              <div className="mt-3 p-3 bg-green-900/30 rounded border border-green-700">
                <p className="text-green-300 text-sm font-semibold">✓ {jsonFile.name}</p>
                <p className="text-slate-400 text-xs">{(jsonFile.size / 1024).toFixed(2)} KB</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-4 justify-center mt-8">
          <Button
            onClick={handleContinue}
            disabled={!videoFile || !jsonFile}
            className="px-8 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed"
          >
            Continue to Preview
          </Button>
        </div>
      </div>

      <div className="bg-slate-700 p-4 rounded-lg">
        <h3 className="text-slate-200 font-semibold mb-2">Expected JSON Format</h3>
        <p className="text-xs text-slate-400 mb-2">
          {"Timestamps use MM:SS:FF (minutes:seconds:frames) at the given fps_match."}
        </p>
        <pre className="bg-slate-800 p-3 rounded text-xs text-slate-300 overflow-x-auto">
{`[
  {
    "short_video_clip": "Scene_01",
    "matched_in_movie": {
      "movie_name": "1000171613.mp4",
      "start_timestamp": "00:01:16",
      "end_timestamp": "00:03:03",
      "confidence": "87.9%",
      "fps_match": 24,
      "total_matching_frames": 33
    }
  }
]`}
        </pre>
      </div>
    </div>
  )
}
