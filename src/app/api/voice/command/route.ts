// /api/voice/command — POST register/match/execute + GET list + DELETE
import { NextRequest, NextResponse } from "next/server"
import { voiceCommandRegister, voiceCommandList, voiceCommandMatch, voiceCommandExecute, voiceCommandDelete, voiceSeedDefaultCommands } from "@/lib/voice/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (body.action === "match") {
      const res = await voiceCommandMatch(body.text)
      if (!res.ok) return NextResponse.json({ error: res.message }, { status: 400 })
      return NextResponse.json({ match: res.data })
    }
    if (body.action === "execute") {
      const res = await voiceCommandExecute(body.commandId, { captures: body.captures })
      if (!res.ok) return NextResponse.json({ error: res.message }, { status: 400 })
      return NextResponse.json(res.data)
    }
    if (body.action === "seed") {
      const res = await voiceSeedDefaultCommands()
      if (!res.ok) return NextResponse.json({ error: res.message }, { status: 400 })
      return NextResponse.json(res.data)
    }
    // default: register
    const res = await voiceCommandRegister(body)
    if (!res.ok) return NextResponse.json({ error: res.message }, { status: 400 })
    return NextResponse.json({ command: res.data }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function GET() {
  try {
    const res = await voiceCommandList()
    if (!res.ok) return NextResponse.json({ error: res.message }, { status: 400 })
    return NextResponse.json({ commands: res.data })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const id = sp.get("id")
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })
    const res = await voiceCommandDelete(id)
    if (!res.ok) return NextResponse.json({ error: res.message }, { status: 400 })
    return NextResponse.json({ deleted: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
