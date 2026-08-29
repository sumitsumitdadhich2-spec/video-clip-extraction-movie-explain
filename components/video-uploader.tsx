"use client"

import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { parseReport, type ParsedReport } from "@/lib/report-parser"

interface VideoUploaderProps {
  onFilesSelected: (shortFile: File, movieFile: File, report: ParsedReport) => void
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
  const ready = !!shortFile && !!movieFile && reportReady

  const handleContinue = () => {
    if (shortFile && movieFile && parsed && parsed.pairs.length > 0) {
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
        {videoZone("Short Video (the clip to verify)", "border-purple-600/60", shortFile, shortInputRef, setShortFile)}
        {videoZone("Movie File (the full source)", "border-blue-600/60", movieFile, movieInputRef, setMovieFile)}
      </div>

      {/* Analysis report */}
      <div className="rounded-lg bg-slate-800 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="block text-sm font-semibold text-slate-200">Analysis Report</span>
            <p className="mt-1 text-xs text-slate-400">
              Paste the text report — mappings are read from the HISSA 2 section.
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
            placeholder={`Paste the full analysis report here...\n\nMapping lines look like:\n${EXAMPLE_LINE}`}
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
                {pairCount} mapping{pairCount === 1 ? "" : "s"} found
                {parsed?.verdict.verdict ? ` — Verdict: ${parsed.verdict.verdict}` : ""}
                {parsed?.verdict.matched ? ` (${parsed.verdict.matched})` : ""}
              </p>
            ) : (
              <p className="text-red-400">
                No mapping lines found. Expected HISSA 2 lines like: <br />
                <code className="text-slate-400">{EXAMPLE_LINE}</code>
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-center">
        <Button
          onClick={handleContinue}
          disabled={!ready}
          className="bg-blue-600 px-8 hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-600"
        >
          Continue to Compare
        </Button>
      </div>

      {/* Format reference */}
      <div className="rounded-lg bg-slate-800/60 p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-200">Expected Report Format</h3>
        <p className="mb-2 text-xs text-slate-400">
          The report contains HISSA 0/1/2 sections and a FINAL VERDICT. Only HISSA 2 mapping lines are used for
          extraction — one line per matched segment:
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
