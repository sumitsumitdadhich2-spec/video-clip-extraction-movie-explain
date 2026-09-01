"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import { VoiceLibrary } from "@/components/voice-library"
import { VoiceSamples } from "@/components/voice-samples"
import { VoiceGenerator } from "@/components/voice-generator"
import { voicesFetcher, type VoicesResponse } from "@/lib/voice-client"

export default function VoiceClonePage() {
  const { data, error, isLoading, mutate } = useSWR<VoicesResponse>("/api/voices", voicesFetcher)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const profiles = data?.profiles ?? []
  const readOnly = data ? !data.writable : false

  // Keep a valid selection as voices are added and removed.
  useEffect(() => {
    if (profiles.length === 0) {
      if (selectedId !== null) setSelectedId(null)
      return
    }
    if (!selectedId || !profiles.some((p) => p.id === selectedId)) {
      setSelectedId(profiles[0].id)
    }
  }, [profiles, selectedId])

  const selected = profiles.find((p) => p.id === selectedId) ?? null

  return (
    <main className="min-h-screen bg-slate-950 p-4 md:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-balance text-2xl font-bold text-slate-50 md:text-3xl">
              Voice Clone Studio
            </h1>
            <p className="mt-2 max-w-3xl text-pretty text-slate-400">
              Build a library of cloned voices for your narrations. Add a voice, drop in 5–6 clean clips of
              that person speaking, then type any Hindi or English text to hear it in their voice. Powered by
              Chatterbox Multilingual — open source, no API key, no card. Every voice is stored in{" "}
              <code className="rounded bg-slate-800 px-1 py-0.5 text-xs text-slate-300">data/voices/</code>{" "}
              inside the project, so it is committed and pushed to GitHub along with your code.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/"
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
            >
              ← Merger (Page 1)
            </Link>
            <Link
              href="/matcher"
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
            >
              Clip Matcher (Page 2)
            </Link>
          </div>
        </header>

        {readOnly && (
          <p className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
            This deployment has a read-only filesystem, so voices can be played but not added or deleted
            here. Manage the library while running the app in v0 or locally, then push — the voices ship with
            the code.
          </p>
        )}

        {error && (
          <p className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
            {error instanceof Error ? error.message : "Could not load the voice library."}
          </p>
        )}

        <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
          <div className="lg:sticky lg:top-8 lg:self-start">
            <VoiceLibrary
              profiles={profiles}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChanged={mutate}
              readOnly={readOnly}
            />
          </div>

          <div className="flex flex-col gap-6">
            {isLoading && (
              <p className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">
                Loading voice library…
              </p>
            )}

            {!isLoading && !selected && (
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
                <h2 className="text-lg font-semibold text-slate-100">Start with your first voice</h2>
                <ol className="mt-3 flex flex-col gap-2 text-sm leading-relaxed text-slate-400">
                  <li>1. Click "New voice" and give it a name plus a default language.</li>
                  <li>2. Upload or record 5–6 clips of that person — 7 to 20 seconds each works best.</li>
                  <li>3. Star the cleanest clip: it becomes the cloning reference.</li>
                  <li>4. Type your script and generate. Save the takes you like into the project files.</li>
                </ol>
              </div>
            )}

            {selected && (
              <>
                <VoiceSamples profile={selected} onChanged={mutate} readOnly={readOnly} />
                <VoiceGenerator profile={selected} onChanged={mutate} readOnly={readOnly} />
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
