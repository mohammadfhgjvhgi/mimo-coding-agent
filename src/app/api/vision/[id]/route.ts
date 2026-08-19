// /api/vision/[id] — GET specific analysis
import { NextRequest, NextResponse } from "next/server"
import { visionAnalysisGet } from "@/lib/vision/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await visionAnalysisGet(id)
  if (!res.ok) {
    return NextResponse.json({ error: res.error, message: res.message }, { status: 404 })
  }
  return NextResponse.json({ analysis: res.data })
}
