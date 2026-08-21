// /api/model-os/snapshot — GET
import { NextResponse } from "next/server"
import { modelSnapshot } from "@/lib/model-os/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const res = await modelSnapshot()
    return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
