import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"
import { NextResponse } from "next/server"

// Client-upload token route: the browser uploads video segments DIRECTLY
// to Blob storage (multipart, resumable), so multi-GB files never pass
// through this server function.
//
// Two prefixes are allowed:
//   merged/...              — legacy single-file saves (random suffix ok)
//   history/<fp>/part-N.mp4 — resumable job parts + manifest.json. These
//     MUST keep their exact deterministic pathname (no random suffix) so an
//     interrupted job can be found and resumed later, and re-uploads of the
//     same part after a retry/resume simply overwrite.
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const isJobPath = /^history\/[a-f0-9]{6,64}\/(part-\d{3}\.mp4|manifest\.json)$/.test(pathname)
        const isLegacyPath = pathname.startsWith("merged/")
        if (!isJobPath && !isLegacyPath) {
          throw new Error("Uploads are only allowed into the merged/ or history/<job>/ folders.")
        }
        return {
          allowedContentTypes: [
            "video/mp4",
            "video/webm",
            "video/quicktime",
            "video/x-matroska",
            "video/mp2t",
            "application/json",
          ],
          maximumSizeInBytes: 4 * 1024 * 1024 * 1024, // 4GB per file
          // Deterministic paths are REQUIRED for resume — same job, same part,
          // same pathname. Overwrite allowed so retries/resumes never 409.
          addRandomSuffix: !isJobPath,
          allowOverwrite: isJobPath,
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
