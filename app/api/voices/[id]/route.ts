import { NextResponse } from "next/server"
import { z } from "zod"
import { deleteProfile, getProfile, updateProfile, ReadOnlyStoreError } from "@/lib/voice-store"
import { isSupportedLanguage } from "@/lib/voice-languages"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const profile = await getProfile(id)
  if (!profile) return NextResponse.json({ error: "Voice not found." }, { status: 404 })
  return NextResponse.json({ profile })
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  language: z.string().refine(isSupportedLanguage, "Unsupported language").optional(),
  notes: z.string().max(300).optional(),
  primarySampleId: z.string().min(1).optional(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 })
  }

  try {
    const profile = await updateProfile(id, parsed.data)
    if (!profile) return NextResponse.json({ error: "Voice or sample not found." }, { status: 404 })
    return NextResponse.json({ profile })
  } catch (err) {
    if (err instanceof ReadOnlyStoreError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    return NextResponse.json({ error: "Could not update the voice." }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const removed = await deleteProfile(id)
    if (!removed) return NextResponse.json({ error: "Voice not found." }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ReadOnlyStoreError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    return NextResponse.json({ error: "Could not delete the voice." }, { status: 500 })
  }
}
