"use client"

import { useRef, useState } from "react"
import { CircleStop, Mic, Star, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MAX_SAMPLES_PER_VOICE } from "@/lib/voice-languages"
import {
  deleteSample,
  formatBytes,
  updateVoice,
  uploadSamples,
  type VoiceProfile,
} from "@/lib/voice-client"

interface VoiceSamplesProps {
  profile: VoiceProfile
  onChanged: () => Promise<unknown>
  readOnly: boolean
}

export function VoiceSamples({ profile, onChanged, readOnly }: VoiceSamplesProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")

  const remaining = MAX_SAMPLES_PER_VOICE - profile.samples.length

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setBusy("Uploading clips…")
    setError("")
    try {
      await uploadSamples(profile.id, Array.from(files))
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload the clips.")
    } finally {
      setBusy("")
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  const startRecording = async () => {
    setError("")
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      const chunks: Blob[] = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" })
        const file = new File([blob], `recording-${Date.now()}.webm`, { type: blob.type })
        setBusy("Saving recording…")
        try {
          await uploadSamples(profile.id, [file])
          await onChanged()
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not save the recording.")
        } finally {
          setBusy("")
        }
      }
      recorder.start()
      recorderRef.current = recorder
      setRecording(true)
    } catch {
      setError("Microphone access was denied or is unavailable.")
    }
  }

  const stopRecording = () => {
    recorderRef.current?.stop()
    recorderRef.current = null
    setRecording(false)
  }

  const handleSetPrimary = async (sampleId: string) => {
    setError("")
    try {
      await updateVoice(profile.id, { primarySampleId: sampleId })
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set the reference clip.")
    }
  }

  const handleDelete = async (sampleId: string, label: string) => {
    if (!window.confirm(`Delete the clip "${label}"?`)) return
    setError("")
    try {
      await deleteSample(profile.id, sampleId)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the clip.")
    }
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-4 md:p-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-100">Reference clips</h2>
        <span className="text-xs text-slate-400">
          {profile.samples.length} / {MAX_SAMPLES_PER_VOICE}
        </span>
      </div>
      <p className="mb-4 text-pretty text-sm text-slate-400">
        Add 5–6 clean clips (7–20 seconds each, one speaker, no music). The starred clip is used as the
        cloning reference — try a few and star whichever sounds closest.
      </p>

      {profile.samples.length > 0 && (
        <ul className="mb-4 flex flex-col gap-2">
          {profile.samples.map((sample) => {
            const isPrimary = sample.id === profile.primarySampleId
            return (
              <li
                key={sample.id}
                className={`rounded-lg border p-3 ${
                  isPrimary ? "border-blue-500/60 bg-blue-500/5" : "border-slate-800 bg-slate-950"
                }`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleSetPrimary(sample.id)}
                    disabled={readOnly || isPrimary}
                    title={isPrimary ? "Current reference clip" : "Use as reference clip"}
                    className="shrink-0 text-slate-500 transition hover:text-amber-300 disabled:cursor-default"
                  >
                    <Star
                      className={`size-4 ${isPrimary ? "fill-amber-300 text-amber-300" : ""}`}
                      aria-hidden="true"
                    />
                    <span className="sr-only">
                      {isPrimary ? "Reference clip" : `Use ${sample.label} as reference`}
                    </span>
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-100">{sample.label}</p>
                    <p className="text-xs text-slate-500">
                      {formatBytes(sample.bytes)}
                      {isPrimary && <span className="ml-2 text-blue-300">reference</span>}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={readOnly}
                    onClick={() => handleDelete(sample.id, sample.label)}
                    className="size-8 shrink-0 text-slate-500 hover:bg-red-500/10 hover:text-red-400"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    <span className="sr-only">Delete {sample.label}</span>
                  </Button>
                </div>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio
                  controls
                  preload="none"
                  src={`/api/voices/${profile.id}/samples/${sample.id}`}
                  className="mt-2 h-9 w-full"
                />
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept="audio/*,video/webm"
          multiple
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
        />
        <Button
          type="button"
          variant="outline"
          disabled={readOnly || remaining <= 0 || Boolean(busy)}
          onClick={() => fileInput.current?.click()}
          className="border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-800"
        >
          <Upload className="size-4" aria-hidden="true" />
          Upload clips
        </Button>
        {recording ? (
          <Button type="button" onClick={stopRecording} className="bg-red-600 text-white hover:bg-red-500">
            <CircleStop className="size-4" aria-hidden="true" />
            Stop recording
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={readOnly || remaining <= 0 || Boolean(busy)}
            onClick={startRecording}
            className="border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-800"
          >
            <Mic className="size-4" aria-hidden="true" />
            Record clip
          </Button>
        )}
        {busy && <span className="text-xs text-slate-400">{busy}</span>}
        {remaining <= 0 && !busy && (
          <span className="text-xs text-amber-300">Limit reached — delete a clip to add another.</span>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </section>
  )
}
