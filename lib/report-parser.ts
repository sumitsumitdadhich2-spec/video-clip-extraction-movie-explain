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
  /** "hissa" = full analysis report, "simple" = plain timestamp-range list */
  format: "hissa" | "simple"
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

// ---------------------------------------------------------------------------
// Flexible timestamp parsing for the plain timestamp-range format.
//
// Accepts, per timestamp:
//   HH:MM:SS:FFF   (e.g. 1:10:24:208)
//   MM:SS:FFF      (e.g. 10:24:208)  — hours omitted
//   HH:MM:SS.FFF / MM:SS.FFF          — dot-millisecond variants
//   HH:MM:SS / MM:SS / SS             — no milliseconds
//
// Rule for colon-milliseconds: when there is no dot and the LAST segment has
// exactly 3 digits (and there are 3+ segments), it is treated as milliseconds.
// ---------------------------------------------------------------------------
export function flexibleTimestampToSeconds(raw: string): number | null {
  const t = raw.trim()
  if (!t) return null

  let main = t
  let msPart: string | null = null

  // Dot-millisecond form: strip ".FFF" off the end first.
  const dotIdx = t.lastIndexOf(".")
  if (dotIdx !== -1) {
    msPart = t.slice(dotIdx + 1)
    main = t.slice(0, dotIdx)
    if (!/^\d{1,3}$/.test(msPart)) return null
  }

  let parts = main.split(":").map((p) => p.trim())
  if (parts.length === 0 || parts.some((p) => p === "" || !/^\d+$/.test(p))) return null

  // Colon-millisecond form: mm:ss:fff or hh:mm:ss:fff (last segment = 3 digits).
  if (msPart === null && parts.length >= 3 && parts[parts.length - 1].length === 3) {
    msPart = parts[parts.length - 1]
    parts = parts.slice(0, -1)
  }
  if (parts.length > 3) return null

  const nums = parts.map((p) => Number.parseInt(p, 10))
  let seconds = 0
  if (parts.length === 3) seconds = nums[0] * 3600 + nums[1] * 60 + nums[2]
  else if (parts.length === 2) seconds = nums[0] * 60 + nums[1]
  else seconds = nums[0]

  if (msPart !== null) seconds += Number.parseInt(msPart.padEnd(3, "0"), 10) / 1000
  return seconds
}

// One range per line: "10:24:208 - 10:25:424" (also –, —, or "to" separators).
const SIMPLE_RANGE = /^([\d:.]+)\s*(?:-|–|—|to)\s*([\d:.]+)$/i

// Parses a plain list of movie timestamp ranges (one per line) into pairs.
// Short-side times are laid out sequentially (cut 1 starts at 0:00 of the
// short, cut 2 right after it, ...) so side-by-side compare still works when
// a short video is also uploaded.
export function parseSimpleRanges(text: string): MappingPair[] {
  const pairs: MappingPair[] = []
  let shortCursor = 0

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(SIMPLE_RANGE)
    if (!m) continue

    const start = flexibleTimestampToSeconds(m[1])
    const end = flexibleTimestampToSeconds(m[2])
    if (start === null || end === null || !(end > start)) continue

    const duration = end - start
    pairs.push({
      index: pairs.length,
      shortStart: shortCursor,
      shortEnd: shortCursor + duration,
      movieStart: start,
      movieEnd: end,
      shortStartFrame: 0,
      shortEndFrame: 0,
      movieStartFrame: 0,
      movieEndFrame: 0,
      matchType: "CUT",
      confidence: "TIMESTAMP",
      label: `Cut ${pairs.length + 1}`,
    })
    shortCursor += duration
  }

  return pairs
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

  // No HISSA mapping lines? Fall back to the plain timestamp-range format.
  if (pairs.length === 0) {
    const simple = parseSimpleRanges(text)
    if (simple.length > 0) {
      return { pairs: simple, verdict, format: "simple" }
    }
  }

  return { pairs, verdict, format: "hissa" }
}

export function formatSeconds(total: number): string {
  const m = Math.floor(total / 60)
  const s = Math.floor(total % 60)
  const ms = Math.round((total % 1) * 1000)
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`
}
