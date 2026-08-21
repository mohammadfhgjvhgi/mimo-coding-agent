// /api/vision/template — POST register + GET list + DELETE
import { NextRequest, NextResponse } from "next/server"
import { visionTemplateRegister, visionTemplateList, visionTemplateDelete } from "@/lib/vision/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const res = await visionTemplateRegister(body)
    return res.ok ? NextResponse.json({ template: res.data }) : NextResponse.json({ error: res.message }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const res = await visionTemplateList({
      type: sp.get("type") as never,
      active: sp.get("active") === "true" ? true : sp.get("active") === "false" ? false : undefined,
    })
    return res.ok ? NextResponse.json({ templates: res.data }) : NextResponse.json({ error: res.message }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const name = sp.get("name")
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 })
    const res = await visionTemplateDelete(name)
    return res.ok ? NextResponse.json({ deleted: true }) : NextResponse.json({ error: res.message }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
