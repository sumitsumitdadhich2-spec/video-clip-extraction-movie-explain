import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// Reports whether Blob storage is connected. The client checks this ONCE
// per session and silently skips all cloud saving when it isn't — merging
// and downloading keep working with zero errors.
export async function GET() {
  return NextResponse.json({ connected: !!process.env.BLOB_READ_WRITE_TOKEN })
}
