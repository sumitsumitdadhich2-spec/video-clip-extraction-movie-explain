import { list } from "@vercel/blob"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// Lists all saved merged videos (survives refresh/crash — stored in Blob).
export async function GET() {
  try {
    const { blobs } = await list({ prefix: "merged/" })

    const videos = blobs
      .map((b) => ({
        pathname: b.pathname,
        filename: b.pathname.split("/").pop() || "video.mp4",
        size: b.size,
        uploadedAt: b.uploadedAt,
      }))
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())

    const totalBytes = videos.reduce((sum, v) => sum + v.size, 0)

    return NextResponse.json({ videos, totalBytes })
  } catch (error) {
    console.error("[v0] history list error:", error)
    return NextResponse.json({ error: "Failed to load history" }, { status: 500 })
  }
}
