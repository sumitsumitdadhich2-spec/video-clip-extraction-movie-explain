"use client"

import { useEffect, useMemo, useState } from "react"
import { Download, Save, Sparkles, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MAX_TOTAL_CHARS, VOICE_LANGUAGES } from "@/lib/voice-languages"
import { chunkCount } from "@/lib/voice-text"
import {
  deleteTake,
  generateSpeech,
  saveTake,
  type VoiceProfile,
} from "@/lib/voice-client"

interface VoiceGeneratorProps {
  profile: VoiceProfile
  onChanged: () => Promise<unknown>
  readOnly: boolean
}

const SAMPLE_TEXTS: Record<string, string> = {
  hi: "नमस्ते, यह मेरी क्लोन की हुई आवाज़ है। आज हम एक नई कहानी शुरू करने जा रहे हैं।",
  en: "Hello, this is my cloned voice. Today we are starting a brand new story.",
}

export function VoiceGenerator({ profile, onChanged, readOnly }: VoiceGeneratorProps) {
  const [text, setText] = useState(SAMPLE_TEXTS[profile.language] ?? SAMPLE_TEXTS.en)
  const [language, setLanguage] = useState(profile.language)
  const [sampleId, setSampleId] = useState(profile.primarySampleId ?? "")
  const [exaggeration, setExaggeration] = useState(0.5)
  const [temperature, setTemperature] = useState(0.8)
  const [cfgWeight, setCfgWeight] = useState(0.5)
  const [seed, setSeed] = useState(0)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<{ url: string; blob: Blob } | null>(null)
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")

  // Keep the form in sync when a different voice is selected.
  useEffect(() => {
    setLanguage(profile.language)
    setSampleId(profile.primarySampleId ?? "")
    setResult(null)
    setError("")
    setStatus("")
  }, [profile.id, profile.language, profile.primarySampleId])

  // Release the previous object URL when a new result replaces it.
  useEffect(() => {
    return () => {
      if (result) URL.revokeObjectURL(result.url)
    }
  }, [result])

  const chunks = useMemo(() => chunkCount(text), [text])
  const hasSamples = profile.samples.length > 0

  const handleGenerate = async () => {
    if (!text.trim() || !hasSamples) return
    setGenerating(true)
    setError("")
    setResult(null)
    setStatus(chunks > 1 ? `Generating ${chunks} segments…` : "Generating…")
    try {
      const blob = await generateSpeech(profile.id, {
        text,
        language,
        sampleId: sampleId || undefined,
        exaggeration,
        temperature,
        cfgWeight,
        seed,
      })
      setResult({ url: URL.createObjectURL(blob), blob })
      setStatus("Done")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Voice generation failed.")
      setStatus("")
    } finally {
      setGenerating(false)
    }
  }

  const handleSave = async () => {
    if (!result) return
    setStatus("Saving into project files…")
    setError("")
    try {
      await saveTake(profile.id, { blob: result.blob, text, language })
      await onChanged()
      setStatus("Saved to data/voices — it will be committed with your next push.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the take.")
      setStatus("")
    }
  }

  const handleDeleteTake = async (takeId: string) => {
    setError("")
    try {
      await deleteTake(profile.id, takeId)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the take.")
    }
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-4 md:p-6">
      <h2 className="text-lg font-semibold text-slate-100">Generate speech</h2>
      <p className="mb-4 text-pretty text-sm text-slate-400">
        Type any text and hear it in this cloned voice. Longer text is split into segments automatically
        and stitched into one audio file.
      </p>

      {!hasSamples && (
        <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          Add at least one reference clip above before generating.
        </p>
      )}

      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400" htmlFor="tts-text">
            Text to speak
          </label>
          <textarea
            id="tts-text"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_TOTAL_CHARS))}
            rows={4}
            placeholder="यहाँ हिंदी या English text लिखें…"
            className="w-full resize-y rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm leading-relaxed text-slate-100 outline-none focus:border-blue-500"
          />
          <p className="mt-1 text-xs text-slate-500">
            {text.length} / {MAX_TOTAL_CHARS} characters
            {chunks > 1 && ` · ${chunks} segments`}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="min-w-40 flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-400" htmlFor="tts-language">
              Language
            </label>
            <select
              id="tts-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-blue-500"
            >
              {VOICE_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-40 flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-400" htmlFor="tts-sample">
              Reference clip
            </label>
            <select
              id="tts-sample"
              value={sampleId}
              onChange={(e) => setSampleId(e.target.value)}
              disabled={!hasSamples}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-blue-500 disabled:opacity-50"
            >
              {profile.samples.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                  {s.id === profile.primarySampleId ? " (starred)" : ""}
                </option>
              ))}
              {!hasSamples && <option value="">No clips yet</option>}
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="self-start text-xs font-medium text-blue-400 hover:text-blue-300"
        >
          {showAdvanced ? "Hide" : "Show"} advanced controls
        </button>

        {showAdvanced && (
          <div className="grid gap-3 rounded-lg border border-slate-800 bg-slate-950 p-3 sm:grid-cols-2">
            <Slider
              id="exaggeration"
              label="Expressiveness"
              value={exaggeration}
              min={0.25}
              max={2}
              step={0.05}
              onChange={setExaggeration}
            />
            <Slider
              id="temperature"
              label="Variation"
              value={temperature}
              min={0.05}
              max={2}
              step={0.05}
              onChange={setTemperature}
            />
            <Slider
              id="cfg"
              label="Pacing / similarity"
              value={cfgWeight}
              min={0.2}
              max={1}
              step={0.05}
              onChange={setCfgWeight}
            />
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400" htmlFor="seed">
                Seed (0 = random)
              </label>
              <input
                id="seed"
                type="number"
                min={0}
                value={seed}
                onChange={(e) => setSeed(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-blue-500"
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={handleGenerate}
            disabled={generating || !text.trim() || !hasSamples}
            className="bg-blue-600 text-white hover:bg-blue-500"
          >
            <Sparkles className="size-4" aria-hidden="true" />
            {generating ? "Generating…" : "Generate voice"}
          </Button>
          {status && !error && <span className="text-xs text-slate-400">{status}</span>}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {result && (
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio controls autoPlay src={result.url} className="h-10 w-full" />
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={result.url}
                download={`${profile.id}-${Date.now()}.wav`}
                className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
              >
                <Download className="size-4" aria-hidden="true" />
                Download WAV
              </a>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={readOnly}
                onClick={handleSave}
                className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
              >
                <Save className="size-4" aria-hidden="true" />
                Save to project files
              </Button>
            </div>
          </div>
        )}
      </div>

      {profile.takes.length > 0 && (
        <div className="mt-6 border-t border-slate-800 pt-4">
          <h3 className="mb-2 text-sm font-semibold tracking-wide text-slate-300 uppercase">
            Saved takes ({profile.takes.length})
          </h3>
          <ul className="flex flex-col gap-2">
            {profile.takes
              .slice()
              .reverse()
              .map((take) => (
                <li key={take.id} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                  <div className="flex items-start gap-3">
                    <p className="min-w-0 flex-1 text-sm text-slate-300">{take.text || "(no text)"}</p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={readOnly}
                      onClick={() => handleDeleteTake(take.id)}
                      className="size-8 shrink-0 text-slate-500 hover:bg-red-500/10 hover:text-red-400"
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      <span className="sr-only">Delete take</span>
                    </Button>
                  </div>
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <audio
                    controls
                    preload="none"
                    src={`/api/voices/${profile.id}/takes/${take.id}`}
                    className="mt-2 h-9 w-full"
                  />
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function Slider({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <div>
      <label className="mb-1 flex items-center justify-between text-xs font-medium text-slate-400" htmlFor={id}>
        <span>{label}</span>
        <span className="text-slate-500">{value.toFixed(2)}</span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-blue-500"
      />
    </div>
  )
}
