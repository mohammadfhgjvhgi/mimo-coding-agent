// /api/data-analysis/python — POST execute Python script
import { NextRequest, NextResponse } from "next/server"
import { pythonExecute } from "@/lib/data-analysis/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const res = await pythonExecute({ script: body.script, timeoutMs: body.timeoutMs, conversationId: body.conversationId, datasetId: body.datasetId })
    return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
