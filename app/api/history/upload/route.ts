import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"
import { NextResponse } from "next/server"

// Client-upload token route: the browser uploads the merged video DIRECTLY
// to Blob storage (multipart, resumable), so multi-GB files never pass
// through this server function.
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith("merged/")) {
          throw new Error("Uploads are only allowed into the merged/ folder.")
        }
        return {
          allowedContentTypes: ["video/mp4", "video/webm", "video/quicktime", "video/x-matroska", "video/mp2t"],
          maximumSizeInBytes: 4 * 1024 * 1024 * 1024, // 4GB per file
          addRandomSuffix: true,
        }
      },
      onUploadCompleted: async () => {
        // Nothing to persist server-side — history is read via list().
      },
    })

    return NextResponse.json(jsonResponse)
  } catch (error) {
    console.error("[v0] blob upload token error:", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload failed" }, { status: 400 })
  }
}
