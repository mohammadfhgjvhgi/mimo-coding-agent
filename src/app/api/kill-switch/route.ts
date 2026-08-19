import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const state = await db.systemState.findUnique({ where: { key: "kill_switch" } })
    return NextResponse.json({ active: state?.value === "true" })
  } catch {
    return NextResponse.json({ active: false })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const active = !!body.active
    await db.systemState.upsert({
      where: { key: "kill_switch" },
      create: { key: "kill_switch", value: String(active) },
      update: { value: String(active) },
    })
    return NextResponse.json({ active })
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
