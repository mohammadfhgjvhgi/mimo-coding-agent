// /api/model-os — POST (all actions) + GET (list/snapshot)
import { NextRequest, NextResponse } from "next/server"
import {
  modelRegister, providerList, modelProfileGet, modelProfileUpdate,
  modelRoute, modelFallback, modelHealthCheck, modelBenchmark,
  contextLimitGet, ramEstimate, vramEstimate, measuredTpsGet,
  toolReliabilityGet, taskSuccessRateGet,
  modelList, modelSnapshot, seedDefaultModels,
} from "@/lib/model-os/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      case "register": return wrap(await modelRegister(body))
      case "profile_get": return wrap(await modelProfileGet(body.modelId))
      case "profile_update": return wrap(await modelProfileUpdate(body.modelId, body.patch ?? body))
      case "route": return wrap(await modelRoute(body))
      case "fallback": return wrap(await modelFallback(body.modelId))
      case "health": return wrap(await modelHealthCheck(body.modelId))
      case "benchmark": return wrap(await modelBenchmark(body))
      case "context_limit": return wrap(await contextLimitGet(body.modelId))
      case "ram_estimate": return wrap(await ramEstimate(body.modelId))
      case "vram_estimate": return wrap(await vramEstimate(body.modelId))
      case "measured_tps": return wrap(await measuredTpsGet(body.modelId))
      case "tool_reliability": return wrap(await toolReliabilityGet(body.modelId))
      case "task_success_rate": return wrap(await taskSuccessRateGet(body.modelId))
      case "seed": return wrap(await seedDefaultModels())
      default: return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const mode = sp.get("mode") ?? "list"
    switch (mode) {
      case "list": return wrap(await modelList({ provider: sp.get("provider") ?? undefined, active: sp.get("active") === "true" ? true : sp.get("active") === "false" ? false : undefined, limit: sp.get("limit") ? Number(sp.get("limit")) : undefined }))
      case "providers": return wrap(await providerList())
      case "snapshot": return wrap(await modelSnapshot())
      default: return NextResponse.json({ error: `unknown mode: ${mode}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

function wrap<T>(result: { ok: boolean; data?: T; error?: string; message?: string }) {
  if (result.ok) return NextResponse.json(result.data)
  return NextResponse.json({ error: result.error, message: result.message }, { status: 400 })
}
