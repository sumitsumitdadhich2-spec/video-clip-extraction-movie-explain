"use client"

import { useState } from "react"
import { Mic2, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { VOICE_LANGUAGES, languageLabel } from "@/lib/voice-languages"
import { createVoice, deleteVoice, type VoiceProfile } from "@/lib/voice-client"

interface VoiceLibraryProps {
  profiles: VoiceProfile[]
  selectedId: string | null
  onSelect: (id: string) => void
  onChanged: () => Promise<unknown>
  readOnly: boolean
}

export function VoiceLibrary({ profiles, selectedId, onSelect, onChanged, readOnly }: VoiceLibraryProps) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const [language, setLanguage] = useState("hi")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError("")
    try {
      await createVoice({ name, language })
      setName("")
      setAdding(false)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the voice.")
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (profile: VoiceProfile) => {
    if (!window.confirm(`Delete the voice "${profile.name}" and all of its clips?`)) return
    setError("")
    try {
      await deleteVoice(profile.id)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the voice.")
    }
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-slate-300 uppercase">Voice library</h2>
        <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">{profiles.length}</span>
      </div>

      <ul className="flex flex-col gap-2">
        {profiles.map((profile) => {
          const active = profile.id === selectedId
          return (
            <li key={profile.id}>
              <div
                className={`flex items-center gap-2 rounded-lg border p-2 transition ${
                  active ? "border-blue-500 bg-blue-500/10" : "border-slate-800 bg-slate-950 hover:bg-slate-800/50"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(profile.id)}
                  aria-current={active ? "true" : undefined}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <Mic2
                    className={`size-4 shrink-0 ${active ? "text-blue-400" : "text-slate-500"}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-100">{profile.name}</span>
                    <span className="block truncate text-xs text-slate-400">
                      {languageLabel(profile.language)} · {profile.samples.length} clip
                      {profile.samples.length === 1 ? "" : "s"}
                    </span>
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={readOnly}
                  onClick={() => handleDelete(profile)}
                  className="size-8 shrink-0 text-slate-500 hover:bg-red-500/10 hover:text-red-400"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  <span className="sr-only">Delete {profile.name}</span>
                </Button>
              </div>
            </li>
          )
        })}
      </ul>

      {profiles.length === 0 && !adding && (
        <p className="py-4 text-sm text-slate-500">
          No voices yet. Add one, then upload 5–6 clean clips of that person speaking.
        </p>
      )}

      {adding ? (
        <form onSubmit={handleCreate} className="mt-3 flex flex-col gap-2 rounded-lg border border-slate-800 p-3">
          <label className="text-xs font-medium text-slate-400" htmlFor="voice-name">
            Voice name
          </label>
          <input
            id="voice-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Narrator — Ravi"
            maxLength={60}
            autoFocus
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-blue-500"
          />
          <label className="text-xs font-medium text-slate-400" htmlFor="voice-language">
            Default language
          </label>
          <select
            id="voice-language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-blue-500"
          >
            {VOICE_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          <div className="mt-1 flex gap-2">
            <Button type="submit" size="sm" disabled={busy || !name.trim()}>
              {busy ? "Creating…" : "Create"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={readOnly}
          onClick={() => setAdding(true)}
          className="mt-3 w-full border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-800"
        >
          <Plus className="size-4" aria-hidden="true" />
          New voice
        </Button>
      )}

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </section>
  )
}
