// /api/artifacts/[id]/diff?from=X&to=Y — GET diff between two versions
import { NextRequest, NextResponse } from "next/server"
import { artifactDiff } from "@/lib/artifacts/system"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sp = req.nextUrl.searchParams
  const from = sp.get("from")
  const to = sp.get("to")
  if (!from || !to) {
    return NextResponse.json({ error: "from + to query params required" }, { status: 400 })
  }
  const res = await artifactDiff(id, Number(from), Number(to))
  if (!res.ok) {
    return NextResponse.json({ error: res.error, message: res.message }, { status: 404 })
  }
  return NextResponse.json(res.data)
}
