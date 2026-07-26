'use client'

import { useState, useRef } from 'react'
import { Button } from './ui/button'

interface VideoUploaderProps {
  onFilesSelected: (video: File, json: File, source: 'short' | 'full') => void
}

export function VideoUploader({ onFilesSelected }: VideoUploaderProps) {
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [jsonFile, setJsonFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [videoSource, setVideoSource] = useState<'short' | 'full'>('full')
  const [jsonMode, setJsonMode] = useState<'upload' | 'paste'>('upload')
  const [pastedJson, setPastedJson] = useState('')
  const [pasteError, setPasteError] = useState('')

  const videoInputRef = useRef<HTMLInputElement>(null)
  const jsonInputRef = useRef<HTMLInputElement>(null)

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true)
    else if (e.type === 'dragleave') setDragActive(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    const files = e.dataTransfer.files
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (file.type.startsWith('video/')) setVideoFile(file)
      else if (file.type === 'application/json' || file.name.endsWith('.json')) setJsonFile(file)
    }
  }

  const handleVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setVideoFile(e.target.files[0])
  }

  const handleJsonChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setJsonFile(e.target.files[0])
  }

  const handlePasteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setPastedJson(val)
    setPasteError('')
    if (!val.trim()) {
      setJsonFile(null)
      return
    }
    try {
      JSON.parse(val)
      const blob = new Blob([val], { type: 'application/json' })
      const file = new File([blob], 'clips.json', { type: 'application/json' })
      setJsonFile(file)
      setPasteError('')
    } catch {
      setJsonFile(null)
      setPasteError('Invalid JSON — please check the format.')
    }
  }

  const handleContinue = () => {
    if (videoFile && jsonFile) onFilesSelected(videoFile, jsonFile, videoSource)
  }

  const jsonReady = jsonMode === 'upload' ? !!jsonFile : !!jsonFile && !pasteError

  return (
    <div className="space-y-6">
      {/* Video Source Selection */}
      <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
        <label className="text-slate-200 font-semibold text-sm block mb-3">
          What type of video are you extracting clips from?
        </label>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setVideoSource('short')}
            className={`flex-1 py-3 px-4 rounded-lg border-2 transition font-semibold text-sm ${
              videoSource === 'short'
                ? 'border-blue-500 bg-blue-600 text-white'
                : 'border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            📹 Short Video Clip
          </button>
          <button
            type="button"
            onClick={() => setVideoSource('full')}
            className={`flex-1 py-3 px-4 rounded-lg border-2 transition font-semibold text-sm ${
              videoSource === 'full'
                ? 'border-blue-500 bg-blue-600 text-white'
                : 'border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            🎬 Full Movie
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-3">
          {videoSource === 'short'
            ? 'Upload a short video file and JSON data to extract and merge matching scenes.'
            : 'Upload a full movie file and JSON data to extract matching clips and merge them.'}
        </p>
      </div>

      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-6 transition ${
          dragActive ? 'border-blue-400 bg-blue-900/20' : 'border-slate-600'
        }`}
      >
        <p className="text-slate-400 text-sm text-center mb-5">
          Drag and drop files here, or use the options below
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Video File Upload */}
          <div className="bg-slate-700 p-5 rounded-lg">
            <span className="text-slate-200 font-semibold text-sm mb-3 block">
              {videoSource === 'full' ? '🎬 Movie File' : '📹 Video File'} (MP4, MKV, AVI, etc.)
            </span>
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*"
              onChange={handleVideoChange}
              className="hidden"
            />
            <div
              onClick={() => videoInputRef.current?.click()}
              className="bg-slate-600 hover:bg-slate-500 cursor-pointer p-4 rounded border border-slate-500 transition text-center"
            >
              <p className="text-slate-300 text-sm">Click to select video</p>
            </div>
            {videoFile && (
              <div className="mt-3 p-3 bg-green-900/30 rounded border border-green-700">
                <p className="text-green-300 text-sm font-semibold">{videoFile.name}</p>
                <p className="text-slate-400 text-xs">{(videoFile.size / (1024 * 1024)).toFixed(2)} MB</p>
              </div>
            )}
          </div>

          {/* JSON — Upload or Paste toggle */}
          <div className="bg-slate-700 p-5 rounded-lg">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
              <div>
                <span className="text-slate-200 font-semibold text-sm block">📋 Metadata (JSON, TXT, etc.)</span>
                <p className="text-xs text-slate-400 mt-1">Any file format containing JSON data</p>
              </div>
              {/* Toggle buttons */}
              <div className="flex rounded overflow-hidden border border-slate-500 text-xs flex-shrink-0">
                <button
                  type="button"
                  onClick={() => { setJsonMode('upload'); setPasteError('') }}
                  className={`px-3 py-1 transition whitespace-nowrap ${
                    jsonMode === 'upload'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                  }`}
                >
                  Upload
                </button>
                <button
                  type="button"
                  onClick={() => { setJsonMode('paste'); setPasteError('') }}
                  className={`px-3 py-1 transition whitespace-nowrap ${
                    jsonMode === 'paste'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                  }`}
                >
                  Paste
                </button>
              </div>
            </div>

            {jsonMode === 'upload' ? (
              <>
                <input
                  ref={jsonInputRef}
                  type="file"
                  accept=".json,.txt,.csv,*"
                  onChange={handleJsonChange}
                  className="hidden"
                />
                <div
                  onClick={() => jsonInputRef.current?.click()}
                  className="bg-slate-600 hover:bg-slate-500 cursor-pointer p-4 rounded border border-slate-500 transition text-center"
                >
                  <p className="text-slate-300 text-sm">Click to select file (JSON, TXT, etc.)</p>
                </div>
                {jsonFile && (
                  <div className="mt-3 p-3 bg-green-900/30 rounded border border-green-700">
                    <p className="text-green-300 text-sm font-semibold">{jsonFile.name}</p>
                    <p className="text-slate-400 text-xs">{(jsonFile.size / 1024).toFixed(2)} KB</p>
                  </div>
                )}
              </>
            ) : (
              <>
                <textarea
                  value={pastedJson}
                  onChange={handlePasteChange}
                  placeholder={'[\n  {\n    "short_video_clip": "Scene_01",\n    "matched_in_movie": { ... }\n  }\n]'}
                  rows={7}
                  spellCheck={false}
                  className={`w-full bg-slate-800 text-slate-200 text-xs font-mono p-3 rounded border resize-none outline-none transition ${
                    pasteError
                      ? 'border-red-500 focus:border-red-400'
                      : pastedJson && !pasteError
                      ? 'border-green-600 focus:border-green-500'
                      : 'border-slate-500 focus:border-blue-500'
                  }`}
                />
                {pasteError && (
                  <p className="text-red-400 text-xs mt-1">{pasteError}</p>
                )}
                {jsonFile && !pasteError && pastedJson && (
                  <p className="text-green-400 text-xs mt-1">
                    Valid JSON — {JSON.parse(pastedJson).length ?? '?'} clip(s) found
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex justify-center mt-6">
          <Button
            onClick={handleContinue}
            disabled={!videoFile || !jsonReady}
            className="px-8 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed"
          >
            Continue to Preview
          </Button>
        </div>
      </div>

      {/* Format reference */}
      <div className="bg-slate-700 p-4 rounded-lg">
        <h3 className="text-slate-200 font-semibold text-sm mb-2">📝 Expected JSON Format</h3>
        <p className="text-xs text-slate-400 mb-2">
          Your metadata file (JSON, TXT, etc.) should contain JSON data with clip segments. 
          Timestamps are <code className="text-slate-300">MM:SS:FF</code> (minutes : seconds : frames) at the given <code className="text-slate-300">fps_match</code>.
        </p>
        <pre className="bg-slate-800 p-3 rounded text-xs text-slate-300 overflow-x-auto leading-relaxed">
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
