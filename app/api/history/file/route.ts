import { get } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// Streams a saved merged video from the PRIVATE Blob store (for playback
// and download). Private blob URLs are never exposed to the client.
export async function GET(request: NextRequest) {
  try {
    const pathname = request.nextUrl.searchParams.get("pathname")
    const download = request.nextUrl.searchParams.get("download") === "1"

    const isLegacy = !!pathname && pathname.startsWith("merged/")
    const isJobPart = !!pathname && /^history\/[a-f0-9]{6,64}\/(part-\d{3}|final)\.mp4$/.test(pathname)
    if (!pathname || (!isLegacy && !isJobPart)) {
      return NextResponse.json({ error: "Invalid pathname" }, { status: 400 })
    }

    const result = await get(pathname, {
      access: "private",
      ifNoneMatch: request.headers.get("if-none-match") ?? undefined,
    })

    if (!result) {
      return new NextResponse("Not found", { status: 404 })
    }

    if (result.statusCode === 304) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: result.blob.etag,
          "Cache-Control": "private, no-cache",
        },
      })
    }

    const headers: Record<string, string> = {
      "Content-Type": result.blob.contentType || "video/mp4",
      "Content-Length": String(result.blob.size),
      ETag: result.blob.etag,
      "Cache-Control": "private, no-cache",
    }
    if (download) {
      const filename = pathname.split("/").pop() || "merged.mp4"
      headers["Content-Disposition"] = `attachment; filename="${filename.replace(/[^\w.\- ]/g, "_")}"`
    }

    return new NextResponse(result.stream, { headers })
  } catch (error) {
    console.error("[v0] history file error:", error)
    return NextResponse.json({ error: "Failed to serve file" }, { status: 500 })
  }
}
