import { del } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"

// Deletes a saved merged video from Blob storage (frees up the 10GB quota).
export async function DELETE(request: NextRequest) {
  try {
    const { pathname } = (await request.json()) as { pathname?: string }

    if (!pathname || !pathname.startsWith("merged/")) {
      return NextResponse.json({ error: "Invalid pathname" }, { status: 400 })
    }

    await del(pathname)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] history delete error:", error)
    return NextResponse.json({ error: "Delete failed" }, { status: 500 })
  }
}
