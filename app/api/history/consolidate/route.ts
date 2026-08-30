import { copy, del, list } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"

// Consolidates a fully-saved segment job into ONE final file:
//   history/<fp>/final.mp4  ← the finished video
// and deletes the now-redundant part-NNN.mp4 files + manifest.json.
//
// Two paths:
//  - final.mp4 already uploaded by the client (multi-part jobs: the browser
//    already holds the assembled video, so it uploads it in the background)
//    → this route just cleans up the parts + manifest.
//  - exactly ONE part saved (single-segment jobs) → the part IS the final
//    video, so it is COPIED server-side to final.mp4 (zero re-upload from
//    the client) and then the part + manifest are deleted.
//
// Best-effort by design: if anything is missing the parts stay untouched,
// so History playback via parts keeps working and resume data is never lost.
export async function POST(request: NextRequest) {
  try {
    const { fingerprint } = (await request.json()) as { fingerprint?: string }
    if (!fingerprint || !/^[a-f0-9]{6,64}$/.test(fingerprint)) {
      return NextResponse.json({ error: "Invalid fingerprint" }, { status: 400 })
    }

    const prefix = `history/${fingerprint}/`
    const { blobs } = await list({ prefix })

    const finalBlob = blobs.find((b) => b.pathname === `${prefix}final.mp4`)
    const partBlobs = blobs
      .filter((b) => /\/part-\d{3}\.mp4$/.test(b.pathname))
      .sort((a, b) => a.pathname.localeCompare(b.pathname))
    const manifestBlob = blobs.find((b) => b.pathname === `${prefix}manifest.json`)

    if (!finalBlob && partBlobs.length === 1) {
      // Single-segment job: promote the lone part to final.mp4 server-side.
      await copy(partBlobs[0].pathname, `${prefix}final.mp4`, {
        access: "private",
        contentType: "video/mp4",
        addRandomSuffix: false,
      })
    } else if (!finalBlob) {
      // Multi-part job but the client hasn't uploaded final.mp4 — nothing to
      // consolidate. Keep parts intact (playback + resume still work).
      return NextResponse.json({ consolidated: false })
    }

    // final.mp4 is in place — remove the redundant parts + manifest.
    const toDelete = [...partBlobs.map((b) => b.pathname), ...(manifestBlob ? [manifestBlob.pathname] : [])]
    if (toDelete.length > 0) {
      await del(toDelete)
    }

    return NextResponse.json({ consolidated: true })
  } catch (error) {
    console.error("[v0] history consolidate error:", error)
    return NextResponse.json({ error: "Consolidate failed" }, { status: 500 })
  }
}
