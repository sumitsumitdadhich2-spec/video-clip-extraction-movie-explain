import { del, list } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"

// Deletes a saved video from Blob storage (frees up the 10GB quota).
//  - { pathname }    → deletes one legacy merged/ file
//  - { fingerprint } → deletes an ENTIRE segment job (all parts + manifest)
export async function DELETE(request: NextRequest) {
  try {
    const { pathname, fingerprint } = (await request.json()) as {
      pathname?: string
      fingerprint?: string
    }

    if (fingerprint) {
      if (!/^[a-f0-9]{6,64}$/.test(fingerprint)) {
        return NextResponse.json({ error: "Invalid fingerprint" }, { status: 400 })
      }
      const { blobs } = await list({ prefix: `history/${fingerprint}/` })
      if (blobs.length > 0) {
        await del(blobs.map((b) => b.pathname))
      }
      return NextResponse.json({ success: true })
    }

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
