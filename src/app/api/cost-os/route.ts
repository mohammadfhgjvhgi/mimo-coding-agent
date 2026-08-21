// /api/cost-os — POST (compute/route) + GET (system/summary/history)
import { NextRequest, NextResponse } from "next/server"
import {
  computeCostBreakdown, resourceAwareRoute, systemResources,
  getCostSummary, getCostHistory, recordCost,
} from "@/lib/cost-os/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      case "compute": {
        const res = await computeCostBreakdown(body)
        if (res.ok && body.taskId) {
          recordCost({ taskId: body.taskId, modelId: body.modelId, breakdown: res.data, timestamp: new Date().toISOString() })
        }
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "route": {
        const res = await resourceAwareRoute({ task: body.task })
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      default:
        return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const mode = sp.get("mode") ?? "summary"
    switch (mode) {
      case "system": return NextResponse.json(systemResources())
      case "summary": return NextResponse.json(getCostSummary())
      case "history": return NextResponse.json({ records: getCostHistory(sp.get("limit") ? Number(sp.get("limit")) : 50) })
      default: return NextResponse.json({ error: `unknown mode: ${mode}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
