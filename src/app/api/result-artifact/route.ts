// /api/result-artifact — POST (generate/modify/export) + GET (preview)
import { NextRequest, NextResponse } from "next/server"
import { runResultArtifactPipeline, modifyArtifact, exportArtifact, formatPipelineResult, parseGenType, generateContent } from "@/lib/result-artifact/pipeline"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      case "generate": {
        const res = await runResultArtifactPipeline({ message: body.message, conversationId: body.conversationId, content: body.content, type: body.type })
        if (res.ok) {
          return NextResponse.json({ ...res.data, formatted: formatPipelineResult(res.data) })
        }
        return NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "modify": {
        const res = await modifyArtifact(body.artifactId, body.content, body.reason)
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "export": {
        const res = await exportArtifact(body.artifactId, body.format ?? "raw")
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "preview_type": {
        const parsed = parseGenType(body.message)
        const gen = generateContent(parsed.type, body.message, body.content)
        return NextResponse.json({ type: parsed.type, title: parsed.title, contentPreview: gen.content.slice(0, 500), fullLength: gen.content.length })
      }
      default:
        return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
