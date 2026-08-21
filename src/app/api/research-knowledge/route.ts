// /api/research-knowledge — POST (research) + GET (preview)
import { NextRequest, NextResponse } from "next/server"
import { runResearchPipeline, parseResearchTopic, formatResearchReport } from "@/lib/research-knowledge/pipeline"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      case "research": {
        const res = await runResearchPipeline(body.message, { numResults: body.numResults ?? 10 })
        if (res.ok) {
          return NextResponse.json({ ...res.data, formatted: formatResearchReport(res.data) })
        }
        return NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "preview_topic": {
        const topic = parseResearchTopic(body.message)
        return NextResponse.json({ topic })
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
    description: "حوّل البحث إلى Knowledge — Research → Sources → Report → Knowledge Base → Future Retrieval",
    action: "POST with { action: 'research', message: 'اعمل بحثاً عن PLC' }",
  })
}
