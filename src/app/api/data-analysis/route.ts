// /api/data-analysis — POST (csv_analyze/sql_query/clean/stats/viz/dataset_register) + GET (list)
import { NextRequest, NextResponse } from "next/server"
import { csvAnalyze, excelAnalyze, sqlQuery, dataClean, statistics, visualization, datasetRegister, datasetList } from "@/lib/data-analysis/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      case "csv_analyze": {
        const res = await csvAnalyze({ sourcePath: body.sourcePath, content: body.content, name: body.name, sampleSize: body.sampleSize, conversationId: body.conversationId })
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "excel_analyze": {
        const res = await excelAnalyze({ sourcePath: body.sourcePath, name: body.name, conversationId: body.conversationId })
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "dataset_register": {
        const res = await datasetRegister(body)
        return res.ok ? NextResponse.json({ dataset: res.data }) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "sql_query": {
        const res = await sqlQuery({ datasetId: body.datasetId, query: body.query, conversationId: body.conversationId })
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "clean": {
        const res = await dataClean(body.datasetId, body.opts ?? {}, body.conversationId)
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "stats": {
        const res = await statistics(body.datasetId, { columns: body.columns, conversationId: body.conversationId })
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "viz": {
        const res = await visualization({ datasetId: body.datasetId, chartType: body.chartType, xColumn: body.xColumn, yColumn: body.yColumn, title: body.title, conversationId: body.conversationId })
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
    if (sp.get("mode") === "analyses") {
      const { analysisList } = await import("@/lib/data-analysis/os")
      const res = await analysisList({ type: sp.get("type") as never, datasetId: sp.get("datasetId") ?? undefined, success: sp.get("success") === "true" ? true : undefined, limit: sp.get("limit") ? Number(sp.get("limit")) : undefined })
      return res.ok ? NextResponse.json({ analyses: res.data }) : NextResponse.json({ error: res.message }, { status: 400 })
    }
    const res = await datasetList({ source: sp.get("source") as never, limit: sp.get("limit") ? Number(sp.get("limit")) : undefined, conversationId: sp.get("conversationId") ?? undefined })
    return res.ok ? NextResponse.json({ datasets: res.data }) : NextResponse.json({ error: res.message }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
