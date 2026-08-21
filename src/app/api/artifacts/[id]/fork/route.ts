// /api/artifacts/[id]/fork — POST fork the artifact into a new one
import { NextRequest, NextResponse } from "next/server"
import { artifactFork } from "@/lib/artifacts/system"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const res = await artifactFork(id, body)
  if (!res.ok) {
    return NextResponse.json({ error: res.error, message: res.message }, { status: 400 })
  }
  return NextResponse.json({ artifact: res.data }, { status: 201 })
}
