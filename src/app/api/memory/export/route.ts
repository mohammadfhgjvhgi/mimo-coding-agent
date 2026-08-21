import { NextResponse } from "next/server"
import { exportMemories } from "@/lib/memory/engine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const data = await exportMemories()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: "Export failed" }, { status: 500 })
  }
}
