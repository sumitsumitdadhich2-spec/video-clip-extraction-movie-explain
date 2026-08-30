import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// Tells the client whether Blob storage is connected. When it isn't,
// the client SKIPS all cloud saving (merge + download still work).
export async function GET() {
  return NextResponse.json({ connected: !!process.env.BLOB_READ_WRITE_TOKEN })
}
