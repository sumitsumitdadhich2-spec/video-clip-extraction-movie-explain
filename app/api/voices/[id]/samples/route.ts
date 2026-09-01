import { NextResponse } from "next/server"
import { addSample, getProfile, ReadOnlyStoreError } from "@/lib/voice-store"
import { MAX_SAMPLE_BYTES, MAX_SAMPLES_PER_VOICE } from "@/lib/voice-languages"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

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

  const files = form.getAll("samples").filter((f): f is File => f instanceof File && f.size > 0)
  if (files.length === 0) {
    return NextResponse.json({ error: "Select at least one non-empty audio clip." }, { status: 400 })
  }
  if (profile.samples.length + files.length > MAX_SAMPLES_PER_VOICE) {
    return NextResponse.json(
      {
        error: `This voice can hold ${MAX_SAMPLES_PER_VOICE} samples. It already has ${profile.samples.length}.`,
      },
      { status: 400 },
    )
  }

  const labels = form.getAll("labels").map((l) => String(l))
  const added: string[] = []

  try {
    for (const [i, file] of files.entries()) {
      if (file.size === 0) continue
      if (file.size > MAX_SAMPLE_BYTES) {
        return NextResponse.json(
          { error: `"${file.name}" is larger than ${Math.round(MAX_SAMPLE_BYTES / 1024 / 1024)} MB.` },
          { status: 400 },
        )
      }
      const data = Buffer.from(await file.arrayBuffer())
      const result = await addSample(id, {
        fileName: file.name || `sample-${i + 1}.wav`,
        mimeType: file.type,
        label: labels[i] || file.name,
        data,
      })
      if (result) added.push(result.sample.id)
    }
  } catch (err) {
    if (err instanceof ReadOnlyStoreError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    const message = err instanceof Error ? err.message : "Could not save the samples."
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const updated = await getProfile(id)
  return NextResponse.json({ profile: updated, added }, { status: 201 })
}
