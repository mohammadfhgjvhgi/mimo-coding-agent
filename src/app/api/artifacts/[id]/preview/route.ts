// /api/artifacts/[id]/preview — GET render-safe preview HTML
import { NextRequest, NextResponse } from "next/server"
import { artifactPreview } from "@/lib/artifacts/system"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const versionParam = req.nextUrl.searchParams.get("version")
  const raw = req.nextUrl.searchParams.get("raw") === "true"
  const res = await artifactPreview(id, {
    version: versionParam ? Number(versionParam) : undefined,
    raw,
  })
  if (!res.ok) {
    return NextResponse.json({ error: res.error, message: res.message }, { status: 404 })
  }
  return NextResponse.json(res.data)
}
