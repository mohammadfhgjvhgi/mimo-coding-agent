// /api/voice/snapshot — GET system snapshot
import { NextResponse } from "next/server"
import { voiceSnapshot } from "@/lib/voice/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const res = await voiceSnapshot()
    if (!res.ok) return NextResponse.json({ error: res.message }, { status: 400 })
    return NextResponse.json(res.data)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
