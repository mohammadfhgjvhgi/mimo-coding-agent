// /api/voice/session — POST start + GET list + DELETE end
import { NextRequest, NextResponse } from "next/server"
import { voiceSessionStart, voiceSessionEnd, voiceSessionList, voiceSessionPause, voiceSessionResume } from "@/lib/voice/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (body.action === "end") {
      const res = await voiceSessionEnd(body.sessionId)
      if (!res.ok) return NextResponse.json({ error: res.message }, { status: 400 })
      return NextResponse.json({ session: res.data })
    }
    if (body.action === "pause") {
      const res = await voiceSessionPause(body.sessionId)
      if (!res.ok) return NextResponse.json({ error: res.message }, { status: 400 })
      return NextResponse.json({ session: res.data })
    }
    if (body.action === "resume") {
      const res = await voiceSessionResume(body.sessionId)
      if (!res.ok) return NextResponse.json({ error: res.message }, { status: 400 })
      return NextResponse.json({ session: res.data })
    }
    // default: start
    const res = await voiceSessionStart(body)
    if (!res.ok) return NextResponse.json({ error: res.message }, { status: 400 })
    return NextResponse.json({ session: res.data }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const status = sp.get("status") as "active" | "paused" | "ended" | null
    const res = await voiceSessionList({ status: status ?? undefined })
    if (!res.ok) return NextResponse.json({ error: res.message }, { status: 400 })
    return NextResponse.json({ sessions: res.data })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
