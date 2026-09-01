import { NextResponse } from "next/server"
import { z } from "zod"
import { createProfile, listProfiles, isWritable, ReadOnlyStoreError } from "@/lib/voice-store"
import { isSupportedLanguage } from "@/lib/voice-languages"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const [profiles, writable] = await Promise.all([listProfiles(), isWritable()])
  return NextResponse.json({ profiles, writable })
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  language: z.string().refine(isSupportedLanguage, "Unsupported language"),
  notes: z.string().max(300).optional(),
})

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 })
  }

  try {
    const profile = await createProfile(parsed.data)
    return NextResponse.json({ profile }, { status: 201 })
  } catch (err) {
    if (err instanceof ReadOnlyStoreError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    return NextResponse.json({ error: "Could not create the voice." }, { status: 500 })
  }
}
