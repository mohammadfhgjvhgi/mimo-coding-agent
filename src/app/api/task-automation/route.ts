// /api/task-automation — POST (convert/preview) + GET (list)
import { NextRequest, NextResponse } from "next/server"
import { runTaskAutomationPipeline, parseAutomation, formatAutomationResult } from "@/lib/task-automation/pipeline"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      case "convert": {
        const res = await runTaskAutomationPipeline(body.message, { conversationId: body.conversationId })
        if (res.ok) {
          return NextResponse.json({ ...res.data, formatted: formatAutomationResult(res.data) })
        }
        return NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "preview": {
        const parsed = parseAutomation(body.message)
        return NextResponse.json(parsed)
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
    description: "حوّل المهمة إلى Automation — Chat → Automation → Schedule → Agent → Report",
    usage: "POST with { action: 'convert', message: 'افحص المشروع كل أسبوع' }",
  })
}
