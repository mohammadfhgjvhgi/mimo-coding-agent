// /api/artifacts/[id]/versions — GET list + POST restore
import { NextRequest, NextResponse } from "next/server"
import { artifactListVersions, artifactGetVersion, artifactRestore } from "@/lib/artifacts/system"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await artifactListVersions(id)
  if (!res.ok) {
    return NextResponse.json({ error: res.error, message: res.message }, { status: 404 })
  }
  return NextResponse.json({ versions: res.data })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  if (body.action === "get_version") {
    const res = await artifactGetVersion(id, Number(body.version))
    if (!res.ok) return NextResponse.json({ error: res.message }, { status: 404 })
    return NextResponse.json({ version: res.data })
  }
  if (body.action === "restore") {
    const res = await artifactRestore(id, Number(body.version), {
      authorId: body.authorId,
      reason: body.reason,
    })
    if (!res.ok) return NextResponse.json({ error: res.message }, { status: 400 })
    return NextResponse.json({ artifact: res.data })
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 })
}
