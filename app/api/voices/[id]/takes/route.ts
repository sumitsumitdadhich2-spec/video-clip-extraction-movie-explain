import { NextResponse } from "next/server"
import { addTake, getProfile, ReadOnlyStoreError } from "@/lib/voice-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/** Saves a generated take into the project files so it is committed with the code. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const profile = await getProfile(id)
  if (!profile) return NextResponse.json({ error: "Voice not found." }, { status: 404 })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 })
  }

  const audio = form.get("audio")
  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: "No audio to save." }, { status: 400 })
  }

  try {
    const result = await addTake(id, {
      data: Buffer.from(await audio.arrayBuffer()),
      text: String(form.get("text") ?? ""),
      language: String(form.get("language") ?? profile.language),
    })
    if (!result) return NextResponse.json({ error: "Voice not found." }, { status: 404 })
    return NextResponse.json({ profile: result.profile, take: result.take }, { status: 201 })
  } catch (err) {
    if (err instanceof ReadOnlyStoreError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    return NextResponse.json({ error: "Could not save the take." }, { status: 500 })
  }
}
