// /api/conversation-to — POST (all 10 conversions + everything)
import { NextRequest, NextResponse } from "next/server"
import {
  chatToTask, chatToProject, chatToResearch, chatToKnowledge,
  chatToAutomation, chatToAgentRun, chatToArtifact, chatToCode,
  chatToChecklist, chatToDecision, chatToEverything,
} from "@/lib/conversation-to/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const conversationId = body.conversationId
    if (!conversationId) return NextResponse.json({ error: "conversationId is required" }, { status: 400 })

    switch (body.action) {
      case "to_task": return wrap(await chatToTask(conversationId))
      case "to_project": return wrap(await chatToProject(conversationId))
      case "to_research": return wrap(await chatToResearch(conversationId))
      case "to_knowledge": return wrap(await chatToKnowledge(conversationId))
      case "to_automation": return wrap(await chatToAutomation(conversationId))
      case "to_agent": return wrap(await chatToAgentRun(conversationId))
      case "to_artifact": return wrap(await chatToArtifact(conversationId))
      case "to_code": return wrap(await chatToCode(conversationId, body.targetDir))
      case "to_checklist": return wrap(await chatToChecklist(conversationId))
      case "to_decision": return wrap(await chatToDecision(conversationId))
      case "to_everything": return wrap(await chatToEverything(conversationId))
      default: return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 })
    }
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}

function wrap<T>(result: { ok: true; data: T } | { ok: false; error: string; message: string }) {
  if (result.ok) return NextResponse.json(result.data)
  return NextResponse.json({ error: result.error, message: result.message }, { status: 400 })
}
