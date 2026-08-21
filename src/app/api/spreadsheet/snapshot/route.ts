// /api/spreadsheet/snapshot — GET
import { NextResponse } from "next/server"
import { spreadsheetSnapshot } from "@/lib/spreadsheet/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const res = await spreadsheetSnapshot()
    return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
