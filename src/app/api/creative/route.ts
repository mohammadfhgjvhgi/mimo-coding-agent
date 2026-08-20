// /api/creative — POST generate (all types) + GET list
import { NextRequest, NextResponse } from "next/server"
import {
  imageGenerate,
  imageEdit,
  diagramGenerate,
  flowchartGenerate,
  architectureDiagramGenerate,
  chartGenerate,
  creativeList,
} from "@/lib/creative/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const action = body.action ?? "image_generate"

    switch (action) {
      case "image_generate": {
        const res = await imageGenerate({ prompt: body.prompt, size: body.size, conversationId: body.conversationId })
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "image_edit": {
        const res = await imageEdit({ base64: body.base64, path: body.path, prompt: body.prompt, size: body.size, conversationId: body.conversationId })
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "diagram": {
        const res = await diagramGenerate({ description: body.description, context: body.context, conversationId: body.conversationId })
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "flowchart": {
        const res = await flowchartGenerate({ description: body.description, context: body.context, conversationId: body.conversationId })
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "architecture": {
        const res = await architectureDiagramGenerate({ description: body.description, context: body.context, conversationId: body.conversationId })
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "chart": {
        const res = await chartGenerate({
          type: body.type,
          title: body.title,
          dataPoints: body.dataPoints,
          xLabel: body.xLabel,
          yLabel: body.yLabel,
          width: body.width,
          height: body.height,
          colors: body.colors,
        })
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      default:
        return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const res = await creativeList({
      type: sp.get("type") as never,
      success: sp.get("success") === "true" ? true : sp.get("success") === "false" ? false : undefined,
      limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
      conversationId: sp.get("conversationId") ?? undefined,
    })
    return res.ok ? NextResponse.json({ creations: res.data }) : NextResponse.json({ error: res.message }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
