// /api/study/snapshot — GET
import { NextResponse } from "next/server"
import { studySnapshot } from "@/lib/study/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const res = await studySnapshot()
    return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
