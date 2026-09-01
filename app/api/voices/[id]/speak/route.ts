import { NextResponse } from "next/server"
import { z } from "zod"
import { getProfile, readSampleFile } from "@/lib/voice-store"
import { synthesize } from "@/lib/voice-clone"
import { isSupportedLanguage, MAX_TOTAL_CHARS } from "@/lib/voice-languages"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Long scripts are synthesized in 300-char chunks, so allow generous time.
export const maxDuration = 300

const speakSchema = z.object({
  text: z.string().trim().min(1, "Enter some text to generate.").max(MAX_TOTAL_CHARS),
  language: z.string().refine(isSupportedLanguage, "Unsupported language").optional(),
  sampleId: z.string().optional(),
  exaggeration: z.number().min(0.25).max(2).optional(),
  temperature: z.number().min(0.05).max(5).optional(),
  cfgWeight: z.number().min(0.2).max(1).optional(),
  seed: z.number().int().min(0).max(2_147_483_647).optional(),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const profile = await getProfile(id)
  if (!profile) return NextResponse.json({ error: "Voice not found." }, { status: 404 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  const parsed = speakSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 })
  }

  const sampleId = parsed.data.sampleId || profile.primarySampleId
  if (!sampleId) {
    return NextResponse.json(
      { error: "Add at least one reference clip to this voice before generating." },
      { status: 400 },
    )
  }

  const reference = await readSampleFile(profile.id, sampleId)
  if (!reference) {
    return NextResponse.json({ error: "The selected reference clip is missing on disk." }, { status: 404 })
  }

  try {
    const { wav, chunks } = await synthesize({
      text: parsed.data.text,
      language: parsed.data.language ?? profile.language,
      reference: reference.data,
      referenceMimeType: reference.mimeType,
      exaggeration: parsed.data.exaggeration,
      temperature: parsed.data.temperature,
      cfgWeight: parsed.data.cfgWeight,
      seed: parsed.data.seed,
    })

    return new NextResponse(new Uint8Array(wav), {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(wav.byteLength),
        "Cache-Control": "no-store",
        "X-Chunk-Count": String(chunks),
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Voice generation failed."
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
