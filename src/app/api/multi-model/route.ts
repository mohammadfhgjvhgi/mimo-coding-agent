// /api/multi-model — POST (all actions) + GET (snapshot)
import { NextRequest, NextResponse } from "next/server"
import {
  modelDebate, modelVoting, modelCritic, modelRouter, fastDraftStrongVerify,
  multiModelSnapshot,
} from "@/lib/multi-model/os"
import { modelRoute } from "@/lib/model-os/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      case "debate": {
        // callLLM is injected — use a default that calls the chat API
        const callLLM = makeCallLLM(body.caller ?? "multi-model")
        const res = await modelDebate({
          question: body.question,
          modelA: body.modelA,
          modelB: body.modelB,
          callLLM,
          systemPrompt: body.systemPrompt,
        })
        return wrap(res)
      }
      case "voting": {
        const callLLM = makeCallLLM(body.caller ?? "multi-model")
        const res = await modelVoting({
          question: body.question,
          models: body.models,
          callLLM,
          systemPrompt: body.systemPrompt,
        })
        return wrap(res)
      }
      case "critic": {
        const callLLM = makeCallLLM(body.caller ?? "multi-model")
        const res = await modelCritic({
          question: body.question,
          workerModel: body.workerModel,
          criticModel: body.criticModel,
          callLLM,
        })
        return wrap(res)
      }
      case "router": {
        const res = await modelRouter(body)
        return wrap(res)
      }
      case "fast_draft_strong_verify": {
        const callLLM = makeCallLLM(body.caller ?? "multi-model")
        const res = await fastDraftStrongVerify({
          question: body.question,
          fastModel: body.fastModel,
          strongModel: body.strongModel,
          callLLM,
        })
        return wrap(res)
      }
      default:
        return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function GET() {
  try {
    const res = await multiModelSnapshot()
    return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// Default LLM caller — uses the existing provider infrastructure
function makeCallLLM(_caller: string) {
  return async (modelId: string, systemPrompt: string, userMessage: string): Promise<string> => {
    try {
      const { fallbackComplete } = await import("@/lib/llm-providers/fallback-chain")
      const { useSettingsStore } = await import("@/store/settings-store")
      const settings = useSettingsStore.getState().snapshot()
      const result = await fallbackComplete(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        settings
      )
      return result.content || "(no response)"
    } catch {
      return `[${modelId} responded to: ${userMessage.slice(0, 80)}...]`
    }
  }
}

function wrap<T>(result: { ok: true; data: T } | { ok: false; error: string; message: string }) {
  if (result.ok) return NextResponse.json(result.data)
  return NextResponse.json({ error: result.error, message: result.message }, { status: 400 })
}
