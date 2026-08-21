// /api/vision — POST analyze (all types) + GET list
import { NextRequest, NextResponse } from "next/server"
import {
  imageAnalyze,
  screenshotAnalyze,
  screenshotToCodeFix,
  pdfVision,
  uiScreenshotUnderstanding,
  diagramUnderstanding,
  chartUnderstanding,
  imageUpload,
  visionAnalysisList,
} from "@/lib/vision/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const action = body.action ?? "analyze"
    const image = body.image ?? { base64: body.base64, path: body.path, mimeType: body.mimeType }

    switch (action) {
      case "upload":
        return NextResponse.json(await imageUpload(image))

      case "analyze": {
        const res = await imageAnalyze(image, body.prompt ?? "حلّل هذه الصورة / analyze this image", {
          systemPrompt: body.systemPrompt,
          conversationId: body.conversationId,
          wantJson: body.wantJson,
        })
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }

      case "screenshot": {
        const res = await screenshotAnalyze(image, { context: body.context, conversationId: body.conversationId })
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }

      case "fix": {
        const res = await screenshotToCodeFix(image, { context: body.context, conversationId: body.conversationId })
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }

      case "pdf": {
        const res = await pdfVision(
          { pdfPath: body.pdfPath, pdfBase64: body.pdfBase64, prompt: body.prompt, conversationId: body.conversationId },
          { pageRange: body.pageRange }
        )
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }

      case "ui": {
        const res = await uiScreenshotUnderstanding(image, { conversationId: body.conversationId })
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }

      case "diagram": {
        const res = await diagramUnderstanding(image, { conversationId: body.conversationId })
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }

      case "chart": {
        const res = await chartUnderstanding(image, { conversationId: body.conversationId })
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
    const res = await visionAnalysisList({
      type: sp.get("type") as never,
      limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
      conversationId: sp.get("conversationId") ?? undefined,
    })
    return res.ok ? NextResponse.json({ analyses: res.data }) : NextResponse.json({ error: res.message }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
