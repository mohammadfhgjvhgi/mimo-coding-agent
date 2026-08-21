// /api/data-analysis/[id] — GET dataset OR analysis
import { NextRequest, NextResponse } from "next/server"
import { datasetGet, analysisGet } from "@/lib/data-analysis/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sp = req.nextUrl.searchParams
  const mode = sp.get("mode") ?? "dataset"
  const res = mode === "analysis" ? await analysisGet(id) : await datasetGet(id)
  if (!res.ok) {
    return NextResponse.json({ error: res.error, message: res.message }, { status: 404 })
  }
  return NextResponse.json(mode === "analysis" ? { analysis: res.data } : { dataset: res.data })
}
