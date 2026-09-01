import { NextResponse } from "next/server"
import { deleteTake, readTakeFile, ReadOnlyStoreError } from "@/lib/voice-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; takeId: string }> }) {
  const { id, takeId } = await params
  const data = await readTakeFile(id, takeId)
  if (!data) return NextResponse.json({ error: "Take not found." }, { status: 404 })

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": String(data.byteLength),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; takeId: string }> }) {
  const { id, takeId } = await params
  try {
    const profile = await deleteTake(id, takeId)
    if (!profile) return NextResponse.json({ error: "Take not found." }, { status: 404 })
    return NextResponse.json({ profile })
  } catch (err) {
    if (err instanceof ReadOnlyStoreError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    return NextResponse.json({ error: "Could not delete the take." }, { status: 500 })
  }
}
