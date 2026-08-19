// /api/voice/tts — POST text → audio file
import { NextRequest, NextResponse } from "next/server"
import { voiceTts } from "@/lib/voice/os"
import { readFile } from "node:fs/promises"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const res = await voiceTts({
      text: body.text,
      voice: body.voice,
      speed: body.speed,
      format: body.format,
      sessionId: body.sessionId,
      save: true,
    })
    if (!res.ok) {
      return NextResponse.json({ error: res.error, message: res.message }, { status: 400 })
    }
    // Return metadata + audio URL.
    const audioUrl = `/api/voice/tts?path=${encodeURIComponent(res.data.audioPath)}`
    return NextResponse.json({
      ...res.data,
      audioUrl,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// GET ?path=... — stream the audio file.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams.get("path")
  if (!p) {
    return NextResponse.json({ error: "path required" }, { status: 400 })
  }
  try {
    const buffer = await readFile(p)
    const ext = p.split(".").pop()?.toLowerCase() ?? "wav"
    const mime = ext === "mp3" ? "audio/mpeg" : ext === "ogg" ? "audio/ogg" : "audio/wav"
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(buffer.length),
        "Cache-Control": "public, max-age=86400",
      },
    })
  } catch {
    return NextResponse.json({ error: "file not found" }, { status: 404 })
  }
}
