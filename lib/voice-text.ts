/**
 * Text chunking shared by the browser (segment preview) and the server
 * (actual synthesis). The engine truncates each request at 300 characters,
 * so longer scripts are split on sentence boundaries and stitched back
 * together after generation.
 */
import { MAX_CHARS_PER_CHUNK } from "./voice-languages"

export function chunkText(text: string, limit = MAX_CHARS_PER_CHUNK): string[] {
  const clean = text.replace(/\s+/g, " ").trim()
  if (!clean) return []
  if (clean.length <= limit) return [clean]

  // Hindi danda (।) plus western sentence terminators.
  const sentences = clean.match(/[^.!?।]+[.!?।]+|[^.!?।]+$/g) ?? [clean]
  const chunks: string[] = []
  let current = ""

  const flush = () => {
    if (current.trim()) chunks.push(current.trim())
    current = ""
  }

  for (const sentence of sentences) {
    const piece = sentence.trim()
    if (!piece) continue

    if (piece.length > limit) {
      flush()
      // A single sentence longer than the limit: fall back to word splitting.
      let buffer = ""
      for (const word of piece.split(" ")) {
        if (`${buffer} ${word}`.trim().length > limit) {
          if (buffer.trim()) chunks.push(buffer.trim())
          buffer = word.slice(0, limit)
        } else {
          buffer = `${buffer} ${word}`.trim()
        }
      }
      if (buffer.trim()) chunks.push(buffer.trim())
      continue
    }

    if (`${current} ${piece}`.trim().length > limit) {
      flush()
      current = piece
    } else {
      current = `${current} ${piece}`.trim()
    }
  }
  flush()
  return chunks
}

export function chunkCount(text: string, limit = MAX_CHARS_PER_CHUNK): number {
  return chunkText(text, limit).length
}
