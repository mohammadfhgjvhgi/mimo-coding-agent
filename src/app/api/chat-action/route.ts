// /api/chat-action — POST (preview/execute) + GET (list actions)
import { NextRequest, NextResponse } from "next/server"
import { executePipeline, previewPipeline, formatActionPlan, parseIntent, type ActionType } from "@/lib/chat-action/pipeline"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      case "preview": {
        const res = previewPipeline(body.message)
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "execute": {
        const res = await executePipeline(body.message, { conversationId: body.conversationId, schedule: body.schedule ?? false })
        if (res.ok) {
          return NextResponse.json({
            ...res.data,
            formatted: formatActionPlan(res.data),
          })
        }
        return NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "parse_intent": {
        const intent = parseIntent(body.message)
        return NextResponse.json(intent)
      }
      default:
        return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    actionTypes: [
      "create_project", "create_tasks", "create_study_plan", "create_artifact",
      "search_code", "debug_issue", "write_code", "run_command",
      "answer_question", "summarize", "translate",
    ] as ActionType[],
    description: "حوّل الرسالة إلى تنفيذ — Chat → Action pipeline",
  })
}
