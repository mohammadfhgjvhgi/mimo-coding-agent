// /api/artifacts/[id]/share — POST create share + GET list shares
import { NextRequest, NextResponse } from "next/server"
import { artifactShare, artifactListShares, artifactRevokeShare } from "@/lib/artifacts/system"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await artifactListShares(id)
  if (!res.ok) {
    return NextResponse.json({ error: res.error, message: res.message }, { status: 400 })
  }
  return NextResponse.json({ shares: res.data })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const res = await artifactShare({ artifactId: id, ...body })
  if (!res.ok) {
    return NextResponse.json({ error: res.error, message: res.message }, { status: 400 })
  }
  return NextResponse.json({ share: res.data }, { status: 201 })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sp = req.nextUrl.searchParams
  const token = sp.get("token")
  if (!token) {
    return NextResponse.json({ error: "token query required" }, { status: 400 })
  }
  const res = await artifactRevokeShare(token)
  if (!res.ok) {
    return NextResponse.json({ error: res.error, message: res.message }, { status: 400 })
  }
  return NextResponse.json({ revoked: true })
}
