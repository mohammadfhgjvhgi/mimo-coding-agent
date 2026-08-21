// /api/spreadsheet — POST (all actions) + GET (list)
import { NextRequest, NextResponse } from "next/server"
import {
  spreadsheetRead,
  formulaAnalyze,
  formulaGenerate,
  formulaDebug,
  dataTransform,
  pivotAnalysis,
  chartGenerate,
  workbookSummarize,
  workbookList,
  formulaList,
} from "@/lib/spreadsheet/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      case "read": {
        const res = await spreadsheetRead(body)
        return res.ok ? NextResponse.json({ workbook: res.data }) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "formula_analyze": {
        const res = await formulaAnalyze(body.formula)
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "formula_generate": {
        const res = await formulaGenerate({ description: body.description, columnNames: body.columnNames, sampleValues: body.sampleValues })
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "formula_debug": {
        const res = await formulaDebug({ workbookId: body.workbookId, formula: body.formula, sheetName: body.sheetName })
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "transform": {
        const res = await dataTransform({ workbookId: body.workbookId, transforms: body.transforms, sheetName: body.sheetName })
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "pivot": {
        const res = await pivotAnalysis(body)
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "chart": {
        const res = await chartGenerate(body)
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "summarize": {
        const res = await workbookSummarize(body.workbookId)
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      default:
        return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    if (sp.get("mode") === "formulas") {
      const res = await formulaList({ workbookId: sp.get("workbookId") ?? undefined, category: sp.get("category") ?? undefined, status: sp.get("status") ?? undefined, limit: sp.get("limit") ? Number(sp.get("limit")) : undefined })
      return res.ok ? NextResponse.json({ formulas: res.data }) : NextResponse.json({ error: res.message }, { status: 400 })
    }
    const res = await workbookList({ source: sp.get("source") as never, limit: sp.get("limit") ? Number(sp.get("limit")) : undefined, conversationId: sp.get("conversationId") ?? undefined })
    return res.ok ? NextResponse.json({ workbooks: res.data }) : NextResponse.json({ error: res.message }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
