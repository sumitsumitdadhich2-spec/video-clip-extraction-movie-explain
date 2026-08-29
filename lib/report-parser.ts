// Parses the plain-text analysis report the user pastes.
// Data is extracted from "HISSA 2" mapping lines of the form:
//
// Short 00:41.000 [f984] - 00:44.000 [f1056] --> Movie 04:14.000 [f3216] - 04:17.000 [f3288] | EXACT | HIGH | Ryan's baby
//
// Also parses the FINAL VERDICT block (MATCHED %, VERDICT) when present.

export interface MappingPair {
  index: number
  shortStart: number
  shortEnd: number
  movieStart: number
  movieEnd: number
  shortStartFrame: number
  shortEndFrame: number
  movieStartFrame: number
  movieEndFrame: number
  matchType: string
  confidence: string
  label: string
}

export interface Verdict {
  matched: string | null
  verdict: string | null
  summary: string | null
}

export interface ParsedReport {
  pairs: MappingPair[]
  verdict: Verdict
}

// Converts "MM:SS.mmm" or "HH:MM:SS.mmm" to seconds.
export function timestampToSeconds(ts: string): number {
  const parts = ts.trim().split(":")
  if (parts.length === 2) {
    const minutes = parseInt(parts[0], 10)
    const seconds = parseFloat(parts[1])
    return minutes * 60 + seconds
  }
  if (parts.length === 3) {
    const hours = parseInt(parts[0], 10)
    const minutes = parseInt(parts[1], 10)
    const seconds = parseFloat(parts[2])
    return hours * 3600 + minutes * 60 + seconds
  }
  return parseFloat(parts[0]) || 0
}

// One timestamp + frame token: 00:41.000 [f984]
const TS = String.raw`(\d+(?::\d+)?:\d+\.\d+)\s*\[f(\d+)\]`

const MAPPING_LINE = new RegExp(
  String.raw`Short\s+${TS}\s*-\s*${TS}\s*-->\s*Movie\s+${TS}\s*-\s*${TS}\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(.+)`,
  "i",
)

export function parseReport(text: string): ParsedReport {
  const pairs: MappingPair[] = []
  const lines = text.split(/\r?\n/)

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(MAPPING_LINE)
    if (!m) continue

    const [
      ,
      shortStartTs,
      shortStartF,
      shortEndTs,
      shortEndF,
      movieStartTs,
      movieStartF,
      movieEndTs,
      movieEndF,
      matchType,
      confidence,
      label,
    ] = m

    const shortStart = timestampToSeconds(shortStartTs)
    const shortEnd = timestampToSeconds(shortEndTs)
    const movieStart = timestampToSeconds(movieStartTs)
    const movieEnd = timestampToSeconds(movieEndTs)

    // Skip degenerate ranges (bad data)
    if (!(shortEnd > shortStart) || !(movieEnd > movieStart)) continue

    pairs.push({
      index: pairs.length,
      shortStart,
      shortEnd,
      movieStart,
      movieEnd,
      shortStartFrame: parseInt(shortStartF, 10),
      shortEndFrame: parseInt(shortEndF, 10),
      movieStartFrame: parseInt(movieStartF, 10),
      movieEndFrame: parseInt(movieEndF, 10),
      matchType: matchType.trim(),
      confidence: confidence.trim(),
      label: label.trim().replace(/\.$/, ""),
    })
  }

  const verdict: Verdict = { matched: null, verdict: null, summary: null }
  const matchedM = text.match(/MATCHED:\s*(.+)/i)
  if (matchedM) verdict.matched = matchedM[1].trim()
  const verdictM = text.match(/VERDICT:\s*(.+)/i)
  if (verdictM) verdict.verdict = verdictM[1].trim()
  const summaryM = text.match(/SUMMARY:\s*(.+)/i)
  if (summaryM) verdict.summary = summaryM[1].trim()

  return { pairs, verdict }
}

export function formatSeconds(total: number): string {
  const m = Math.floor(total / 60)
  const s = Math.floor(total % 60)
  const ms = Math.round((total % 1) * 1000)
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`
}
