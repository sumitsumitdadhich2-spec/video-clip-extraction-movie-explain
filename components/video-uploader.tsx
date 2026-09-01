"use client"

import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { parseReport, type ParsedReport } from "@/lib/report-parser"

interface VideoUploaderProps {
  onFilesSelected: (shortFile: File | null, movieFile: File, report: ParsedReport) => void
}

const EXAMPLE_LINE =
  "Short 00:41.000 [f984] - 00:44.000 [f1056] --> Movie 04:14.000 [f3216] - 04:17.000 [f3288] | EXACT | HIGH | Ryan's baby"

export function VideoUploader({ onFilesSelected }: VideoUploaderProps) {
  const [shortFile, setShortFile] = useState<File | null>(null)
  const [movieFile, setMovieFile] = useState<File | null>(null)
  const [reportMode, setReportMode] = useState<"paste" | "upload">("paste")
  const [reportText, setReportText] = useState("")
  const [parsed, setParsed] = useState<ParsedReport | null>(null)
  const [reportFileName, setReportFileName] = useState<string | null>(null)

  const shortInputRef = useRef<HTMLInputElement>(null)
  const movieInputRef = useRef<HTMLInputElement>(null)
  const reportInputRef = useRef<HTMLInputElement>(null)

  const handleReportText = (text: string) => {
    setReportText(text)
    if (!text.trim()) {
      setParsed(null)
      return
    }
    setParsed(parseReport(text))
  }

  const handleReportFile = (file: File) => {
    setReportFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => handleReportText((e.target?.result as string) || "")
    reader.readAsText(file)
  }

  const pairCount = parsed?.pairs.length ?? 0
  const reportReady = pairCount > 0
  const isSimple = parsed?.format === "simple"
  // Short is OPTIONAL — movie + timestamps alone is enough (cut & merge mode).
  const ready = !!movieFile && reportReady

  const handleContinue = () => {
    if (movieFile && parsed && parsed.pairs.length > 0) {
      onFilesSelected(shortFile, movieFile, parsed)
    }
  }

  const videoZone = (
    label: string,
    accent: string,
    file: File | null,
    inputRef: React.RefObject<HTMLInputElement | null>,
    onChange: (f: File) => void,
  ) => (
    <div className="rounded-lg bg-slate-800 p-5">
      <span className="mb-3 block text-sm font-semibold text-slate-200">{label}</span>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) onChange(e.target.files[0])
        }}
      />
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const f = e.dataTransfer.files?.[0]
          if (f && f.type.startsWith("video/")) onChange(f)
        }}
        className={`cursor-pointer rounded border-2 border-dashed p-6 text-center transition hover:bg-slate-700/60 ${
          file ? "border-emerald-600 bg-emerald-950/20" : `${accent} bg-slate-700/40`
        }`}
      >
        {file ? (
          <>
            <p className="text-sm font-semibold text-emerald-300">{file.name}</p>
            <p className="mt-1 text-xs text-slate-400">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
          </>
        ) : (
          <p className="text-sm text-slate-300">Click or drop video here</p>
        )}
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Dual video upload */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {videoZone(
          "Short Video (optional — for side-by-side compare)",
          "border-purple-600/60",
          shortFile,
          shortInputRef,
          setShortFile,
        )}
        {videoZone("Movie File (the full source)", "border-blue-600/60", movieFile, movieInputRef, setMovieFile)}
      </div>

      {/* Analysis report */}
      <div className="rounded-lg bg-slate-800 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="block text-sm font-semibold text-slate-200">Report / Timestamp List</span>
            <p className="mt-1 text-xs text-slate-400">
              Paste the HISSA report, OR a plain timestamp list — one range per line, hh:mm:ss:fff or
              mm:ss:fff (hours optional).
            </p>
          </div>
          <div className="flex overflow-hidden rounded border border-slate-600 text-xs">
            <button
              type="button"
              onClick={() => setReportMode("paste")}
              className={`px-3 py-1 transition ${
                reportMode === "paste" ? "bg-blue-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"
              }`}
            >
              Paste
            </button>
            <button
              type="button"
              onClick={() => setReportMode("upload")}
              className={`px-3 py-1 transition ${
                reportMode === "upload" ? "bg-blue-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"
              }`}
            >
              Upload .txt
            </button>
          </div>
        </div>

        {reportMode === "paste" ? (
          <textarea
            value={reportText}
            onChange={(e) => handleReportText(e.target.value)}
            placeholder={`Paste the analysis report OR a plain timestamp list here...\n\nPlain list (one range per line, hours optional):\n10:24:208 - 10:25:424\n12:15:333 - 12:16:729\n1:02:15:333 - 1:02:16:729\n\nOr HISSA mapping lines:\n${EXAMPLE_LINE}`}
            rows={8}
            spellCheck={false}
            className={`w-full resize-none rounded border bg-slate-900 p-3 font-mono text-xs text-slate-200 outline-none transition ${
              reportText && !reportReady
                ? "border-red-500 focus:border-red-400"
                : reportReady
                  ? "border-emerald-600 focus:border-emerald-500"
                  : "border-slate-600 focus:border-blue-500"
            }`}
          />
        ) : (
          <>
            <input
              ref={reportInputRef}
              type="file"
              accept=".txt,.log,.md,text/plain"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) handleReportFile(e.target.files[0])
              }}
            />
            <div
              onClick={() => reportInputRef.current?.click()}
              className="cursor-pointer rounded border border-slate-600 bg-slate-700/50 p-4 text-center transition hover:bg-slate-700"
            >
              <p className="text-sm text-slate-300">
                {reportFileName ? reportFileName : "Click to select report file (.txt)"}
              </p>
            </div>
          </>
        )}

        {/* Live validation */}
        {(reportText || reportFileName) && (
          <div className="mt-2 text-xs">
            {reportReady ? (
              <p className="text-emerald-400">
                {isSimple ? (
                  <>
                    {pairCount} cut{pairCount === 1 ? "" : "s"} found (plain timestamp list)
                    {!shortFile ? " — movie-only mode: cuts will be merged directly" : ""}
                  </>
                ) : (
                  <>
                    {pairCount} mapping{pairCount === 1 ? "" : "s"} found
                    {parsed?.verdict.verdict ? ` — Verdict: ${parsed.verdict.verdict}` : ""}
                    {parsed?.verdict.matched ? ` (${parsed.verdict.matched})` : ""}
                  </>
                )}
              </p>
            ) : (
              <p className="text-red-400">
                Nothing parsed. Paste HISSA lines like <code className="text-slate-400">{EXAMPLE_LINE}</code>
                <br />
                or plain ranges like <code className="text-slate-400">10:24:208 - 10:25:424</code> (one per
                line).
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-2">
        <Button
          onClick={handleContinue}
          disabled={!ready}
          className="bg-blue-600 px-8 hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-600"
        >
          {shortFile ? "Continue to Compare" : "Cut, Merge & Preview"}
        </Button>
        {ready && !shortFile && (
          <p className="text-xs text-slate-400">
            No short uploaded — cuts will be made from the movie and merged directly.
          </p>
        )}
      </div>

      {/* Format reference */}
      <div className="rounded-lg bg-slate-800/60 p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-200">Accepted Formats</h3>
        <p className="mb-2 text-xs text-slate-400">
          <span className="font-semibold text-slate-300">1. Plain timestamp list</span> — one movie range per
          line. Milliseconds via <code>:fff</code> or <code>.fff</code>; hours are optional:
        </p>
        <pre className="mb-3 overflow-x-auto rounded bg-slate-900 p-3 text-xs leading-relaxed text-slate-300">
          {`10:24:208 - 10:25:424          (mm:ss:fff)
1:02:15:333 - 1:02:16:729      (hh:mm:ss:fff)
04:14.000 - 04:17.500          (mm:ss.fff)
12:15 - 12:20                  (mm:ss)`}
        </pre>
        <p className="mb-2 text-xs text-slate-400">
          <span className="font-semibold text-slate-300">2. HISSA analysis report</span> — mapping lines from
          the HISSA 2 section, one per matched segment:
        </p>
        <pre className="overflow-x-auto rounded bg-slate-900 p-3 text-xs leading-relaxed text-slate-300">
          {`=== HISSA 2: MAPPING ===
${EXAMPLE_LINE}
Short 00:44.000 [f1056] - 00:48.000 [f1152] --> Movie 05:02.000 [f7248] - 05:06.000 [f7344] | EXACT | HIGH | Hospital scene

=== FINAL VERDICT ===
MATCHED: 94%
VERDICT: COPIED`}
        </pre>
      </div>
    </div>
  )
}
