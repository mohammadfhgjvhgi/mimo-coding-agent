// /api/voice/stt — POST audio base64 → text
import { NextRequest, NextResponse } from "next/server"
import { voiceStt } from "@/lib/voice/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const res = await voiceStt({
      audioBase64: body.audioBase64,
      audioPath: body.audioPath,
      language: body.language,
      sessionId: body.sessionId,
    })
    if (!res.ok) {
      return NextResponse.json({ error: res.error, message: res.message }, { status: 400 })
    }
    return NextResponse.json(res.data)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
