// /api/artifacts/[id] — GET single artifact + PATCH edit + DELETE
import { NextRequest, NextResponse } from "next/server"
import { artifactGet, artifactEdit, artifactDelete, artifactArchive } from "@/lib/artifacts/system"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await artifactGet(id)
  if (!res.ok) {
    return NextResponse.json({ error: res.error, message: res.message }, { status: 404 })
  }
  return NextResponse.json({ artifact: res.data })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  if (body.action === "archive") {
    const res = await artifactArchive(id)
    if (!res.ok) return NextResponse.json({ error: res.message }, { status: 400 })
    return NextResponse.json({ artifact: res.data })
  }
  const res = await artifactEdit(id, body)
  if (!res.ok) {
    return NextResponse.json({ error: res.error, message: res.message }, { status: 400 })
  }
  return NextResponse.json({ artifact: res.data })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await artifactDelete(id)
  if (!res.ok) {
    return NextResponse.json({ error: res.error, message: res.message }, { status: 400 })
  }
  return NextResponse.json({ deleted: true })
}
