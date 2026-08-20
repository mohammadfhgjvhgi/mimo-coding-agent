import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET — list all folders
export async function GET() {
  try {
    const convs = await db.conversation.findMany({
      where: { folder: { not: null } },
      select: { folder: true },
      distinct: ["folder"],
    })
    const folders = convs.map(c => c.folder).filter(Boolean)
    return NextResponse.json({ folders })
  } catch {
    return NextResponse.json({ folders: [] })
  }
}

// POST — create/rename a folder (folders are implicit — just set on conversations)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const name = String(body.name || "").trim()
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 })
    return NextResponse.json({ folder: name })
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
