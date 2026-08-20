// /api/observability — POST (replay) + GET (all timelines + metrics)
import { NextRequest, NextResponse } from "next/server"
import {
  agentTimeline, toolTimeline, tokenTimeline, memoryTimeline,
  modelTimeline, errorTimeline, taskMetrics, systemMetrics, replay,
  observabilitySnapshot,
} from "@/lib/observability/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      case "replay": return wrap(await replay(body.conversationId))
      default: return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const mode = sp.get("mode") ?? "snapshot"
    switch (mode) {
      case "agent_timeline": return wrap(await agentTimeline({ conversationId: sp.get("conversationId") ?? undefined, limit: sp.get("limit") ? Number(sp.get("limit")) : undefined }))
      case "tool_timeline": return wrap(await toolTimeline())
      case "token_timeline": return wrap(await tokenTimeline({ limit: sp.get("limit") ? Number(sp.get("limit")) : undefined }))
      case "memory_timeline": return wrap(await memoryTimeline({ limit: sp.get("limit") ? Number(sp.get("limit")) : undefined }))
      case "model_timeline": return wrap(await modelTimeline())
      case "error_timeline": return wrap(await errorTimeline({ limit: sp.get("limit") ? Number(sp.get("limit")) : undefined }))
      case "task_metrics": return wrap(await taskMetrics())
      case "system": return NextResponse.json(systemMetrics())
      case "snapshot": return wrap(await observabilitySnapshot())
      default: return NextResponse.json({ error: `unknown mode: ${mode}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

function wrap<T>(result: { ok: true; data: T } | { ok: false; error: string; message: string }) {
  if (result.ok) return NextResponse.json(result.data)
  return NextResponse.json({ error: result.error, message: result.message }, { status: 400 })
}
