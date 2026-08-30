import { list, get } from "@vercel/blob"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

interface CloudManifest {
  fingerprint?: string
  name?: string
  totalSegments?: number | null
  completedSegments?: number[]
  createdAt?: string
}

// Lists everything saved in cloud History:
//  - legacy single-file videos under merged/
//  - segment-based jobs under history/<fingerprint>/ (complete OR incomplete)
export async function GET() {
  try {
    const [legacy, jobs] = await Promise.all([list({ prefix: "merged/" }), list({ prefix: "history/" })])

    const videos = legacy.blobs
      .map((b) => ({
        pathname: b.pathname,
        filename: b.pathname.split("/").pop() || "video.mp4",
        size: b.size,
        uploadedAt: b.uploadedAt,
      }))
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())

    // Group history/<fp>/* blobs into jobs.
    const byFingerprint = new Map<string, typeof jobs.blobs>()
    for (const b of jobs.blobs) {
      const fp = b.pathname.split("/")[1]
      if (!fp) continue
      const bucket = byFingerprint.get(fp)
      if (bucket) bucket.push(b)
      else byFingerprint.set(fp, [b])
    }

    const jobEntries = await Promise.all(
      Array.from(byFingerprint.entries()).map(async ([fingerprint, blobs]) => {
        const partBlobs = blobs
          .filter((b) => /\/part-\d{3}\.mp4$/.test(b.pathname))
          .sort((a, b) => a.pathname.localeCompare(b.pathname))
        const sizeBytes = blobs.reduce((sum, b) => sum + b.size, 0)
        const newest = blobs.reduce(
          (max, b) => Math.max(max, new Date(b.uploadedAt).getTime()),
          0,
        )

        // Best-effort read of the small manifest.json for the display name +
        // expected segment count. Jobs without one still show up (degraded).
        let manifest: CloudManifest | null = null
        try {
          const res = await get(`history/${fingerprint}/manifest.json`, { access: "private" })
          if (res) {
            const text = await new Response(res.stream).text()
            manifest = JSON.parse(text) as CloudManifest
          }
        } catch {
          // missing/corrupt manifest — fall back to part info only
        }

        const totalSegments = manifest?.totalSegments ?? null
        const savedParts = partBlobs.length
        const complete = totalSegments !== null && savedParts >= totalSegments && savedParts > 0

        return {
          fingerprint,
          name: manifest?.name || `merge-${fingerprint.slice(0, 8)}.mp4`,
          totalSegments,
          savedParts,
          partPathnames: partBlobs.map((b) => b.pathname),
          sizeBytes,
          complete,
          uploadedAt: new Date(newest || Date.now()).toISOString(),
        }
      }),
    )

    jobEntries.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())

    const totalBytes =
      videos.reduce((sum, v) => sum + v.size, 0) + jobEntries.reduce((sum, j) => sum + j.sizeBytes, 0)

    return NextResponse.json({ videos, jobs: jobEntries, totalBytes })
  } catch (error) {
    console.error("[v0] history list error:", error)
    return NextResponse.json({ error: "Failed to load history" }, { status: 500 })
  }
}
