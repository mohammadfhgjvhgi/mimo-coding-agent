// /api/spreadsheet/[id] — GET workbook
import { NextRequest, NextResponse } from "next/server"
import { workbookGet } from "@/lib/spreadsheet/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await workbookGet(id)
  if (!res.ok) {
    return NextResponse.json({ error: res.error, message: res.message }, { status: 404 })
  }
  return NextResponse.json({ workbook: res.data })
}
