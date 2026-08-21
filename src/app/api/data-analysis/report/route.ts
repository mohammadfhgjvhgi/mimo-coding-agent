// /api/data-analysis/report — POST generate report
import { NextRequest, NextResponse } from "next/server"
import { reportGenerate } from "@/lib/data-analysis/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const res = await reportGenerate({ title: body.title, sections: body.sections, conversationId: body.conversationId })
    return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
