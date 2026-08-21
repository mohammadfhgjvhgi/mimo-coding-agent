// /api/creative/[id] — GET single creation
import { NextRequest, NextResponse } from "next/server"
import { creativeGet } from "@/lib/creative/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await creativeGet(id)
  if (!res.ok) {
    return NextResponse.json({ error: res.error, message: res.message }, { status: 404 })
  }
  return NextResponse.json({ creation: res.data })
}
