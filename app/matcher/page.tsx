"use client"

import { useState } from "react"
import { VideoUploader } from "@/components/video-uploader"
import { ComparisonViewer } from "@/components/comparison-viewer"
import { ExtractionPanel } from "@/components/extraction-panel"
import { Button } from "@/components/ui/button"
import { startBackgroundExtraction, resetBackground } from "@/lib/ffmpeg-client"
import type { MappingPair, Verdict, ParsedReport } from "@/lib/report-parser"

type Step = "upload" | "compare" | "export"

export default function Page() {
  const [shortFile, setShortFile] = useState<File | null>(null)
  const [movieFile, setMovieFile] = useState<File | null>(null)
  const [pairs, setPairs] = useState<MappingPair[]>([])
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [step, setStep] = useState<Step>("upload")

  const handleFilesSelected = (short: File | null, movie: File, report: ParsedReport) => {
    resetBackground()
    setShortFile(short)
    setMovieFile(movie)
    setPairs(report.pairs)
    setVerdict(report.verdict)
    // Movie-only mode (no short): skip compare, go straight to cut & merge.
    setStep(short ? "compare" : "export")
    // Kick off background cutting of movie clips right away.
    startBackgroundExtraction(movie, report.pairs)
  }

  const handleRestart = () => {
    resetBackground()
    setShortFile(null)
    setMovieFile(null)
    setPairs([])
    setVerdict(null)
    setStep("upload")
  }

  const steps: { key: Step; title: string; desc: string }[] = [
    { key: "upload", title: "1. Upload", desc: "Movie + Timestamps (Short optional)" },
    { key: "compare", title: "2. Compare", desc: "Side-by-side (needs Short)" },
    { key: "export", title: "3. Merge & Export", desc: "Build the final video" },
  ]

  const activeIndex = steps.findIndex((s) => s.key === step)

  return (
    <main className="min-h-screen bg-slate-950 p-4 md:p-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8">
          <h1 className="text-balance text-2xl font-bold text-slate-50 md:text-3xl">
            Short vs Movie — Clip Matcher &amp; Exporter
          </h1>
          <p className="mt-2 text-pretty text-slate-400">
            Upload the movie and paste timestamps (plain hh:mm:ss:fff / mm:ss:fff list or a full HISSA
            report) — cuts are made from the movie, merged, and previewed. Add the short video too and
            you also get side-by-side pair comparison. All in your browser.
          </p>
        </header>

        <nav className="mb-8 grid grid-cols-3 gap-3">
          {steps.map((s, i) => (
            <div
              key={s.key}
              className={`rounded-lg border p-3 transition ${
                i === activeIndex
                  ? "border-blue-500 bg-blue-500/10"
                  : i < activeIndex
                    ? "border-emerald-600/40 bg-emerald-500/5"
                    : "border-slate-800 bg-slate-900"
              }`}
            >
              <p className="text-sm font-semibold text-slate-100">{s.title}</p>
              <p className="text-xs text-slate-400">{s.desc}</p>
            </div>
          ))}
        </nav>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 md:p-6">
          {step === "upload" && <VideoUploader onFilesSelected={handleFilesSelected} />}

          {step === "compare" && shortFile && movieFile && (
            <div>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-slate-100">
                      {pairs.length} matched pairs
                    </h2>
                    {verdict?.verdict && (
                      <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs font-bold text-red-300">
                        {verdict.verdict}
                      </span>
                    )}
                    {verdict?.matched && (
                      <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-300">
                        MATCHED: {verdict.matched}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-400">
                    <span className="text-purple-300">{shortFile.name}</span> vs{" "}
                    <span className="text-blue-300">{movieFile.name}</span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={handleRestart}
                    className="border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                  >
                    Start Over
                  </Button>
                  <Button onClick={() => setStep("export")} className="bg-blue-600 hover:bg-blue-500">
                    Merge &amp; Export
                  </Button>
                </div>
              </div>
              <ComparisonViewer shortFile={shortFile} movieFile={movieFile} pairs={pairs} />
            </div>
          )}

          {step === "export" && movieFile && (
            <ExtractionPanel
              movieFile={movieFile}
              pairs={pairs}
              onBack={() => (shortFile ? setStep("compare") : handleRestart())}
            />
          )}
        </div>
      </div>
    </main>
  )
}
