import { NextRequest, NextResponse } from "next/server"
import { edgeTtsSynthesize } from "@/lib/tts/edge-client"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { text, voice = 'ar-EG-SalmaNeural', rate = '+0%', pitch = '+0Hz' } = body
    if (!text || typeof text !== 'string') return NextResponse.json({ error: 'text is required' }, { status: 400 })
    if (text.length > 3000) return NextResponse.json({ error: 'text exceeds 3000 character limit' }, { status: 413 })

    const { audio } = await edgeTtsSynthesize(text, { voice, rate, pitch, lang: voice.split('-').slice(0, 2).join('-') })

    return new Response(audio as unknown as BodyInit, {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(audio.length), 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    console.error('[/api/voice/tts/edge] error:', e)
    return NextResponse.json({ error: 'Edge TTS synthesis failed', details: (e as Error)?.message }, { status: 500 })
  }
}
