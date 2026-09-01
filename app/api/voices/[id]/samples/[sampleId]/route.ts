import { NextResponse } from "next/server"
import { deleteSample, readSampleFile, ReadOnlyStoreError } from "@/lib/voice-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Streams a stored reference clip so the UI can play it back. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; sampleId: string }> }) {
  const { id, sampleId } = await params
  const file = await readSampleFile(id, sampleId)
  if (!file) return NextResponse.json({ error: "Sample not found." }, { status: 404 })

  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.data.byteLength),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; sampleId: string }> }) {
  const { id, sampleId } = await params
  try {
    const profile = await deleteSample(id, sampleId)
    if (!profile) return NextResponse.json({ error: "Sample not found." }, { status: 404 })
    return NextResponse.json({ profile })
  } catch (err) {
    if (err instanceof ReadOnlyStoreError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    return NextResponse.json({ error: "Could not delete the sample." }, { status: 500 })
  }
}
