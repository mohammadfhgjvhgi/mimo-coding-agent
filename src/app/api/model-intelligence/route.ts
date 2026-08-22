// /api/model-intelligence — POST + GET
import { NextRequest, NextResponse } from "next/server"
import {
  modelHealth, modelCapabilityProfile, toolCallingReliability, contextReliability,
  taskSpecificModelRouting, fastStrongModelPair, draftAndVerify,
  fallbackModel, providerFailover, modelWarmup, modelIdleUnload,
  modelIntelligenceSnapshot,
} from "@/lib/model-intelligence/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      case "model_health": return wrap(await modelHealth(body.modelId))
      case "capability_profile": return wrap(await modelCapabilityProfile(body.modelId))
      case "tool_reliability": return wrap(await toolCallingReliability(body.modelId))
      case "context_reliability": return wrap(await contextReliability(body.modelId))
      case "task_routing": return wrap(await taskSpecificModelRouting(body.taskType ?? "coding"))
      case "fast_strong_pair": return wrap(await fastStrongModelPair())
      case "draft_verify": return wrap(await draftAndVerify({ prompt: body.prompt ?? "", fastModelId: body.fastModelId, strongModelId: body.strongModelId }))
      case "fallback_model": return wrap(await fallbackModel(body.modelId))
      case "provider_failover": return wrap(await providerFailover(body.failedProvider))
      case "model_warmup": return wrap(await modelWarmup(body.modelId))
      case "model_unload": return wrap(await modelIdleUnload(body.idleThresholdMs))
      default: return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 })
    }
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const mode = sp.get("mode") ?? "snapshot"
    switch (mode) {
      case "health": return wrap(await modelHealth(sp.get("modelId") ?? undefined))
      case "profile": return wrap(await modelCapabilityProfile(sp.get("modelId") ?? undefined))
      case "tool_reliability": return wrap(await toolCallingReliability(sp.get("modelId") ?? undefined))
      case "context_reliability": return wrap(await contextReliability(sp.get("modelId") ?? undefined))
      case "snapshot": return wrap(await modelIntelligenceSnapshot())
      default: return NextResponse.json({ error: `unknown mode: ${mode}` }, { status: 400 })
    }
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}

function wrap<T>(result: { ok: boolean; data?: T; error?: string; message?: string }) {
  if (result.ok) return NextResponse.json(result.data)
  return NextResponse.json({ error: result.error, message: result.message }, { status: 400 })
}
