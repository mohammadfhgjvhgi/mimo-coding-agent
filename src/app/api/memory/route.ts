import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/memory -> list all memories (for the Memory UI panel)
export async function GET() {
  try {
    const memories = await db.memory.findMany({
      orderBy: [{ category: "asc" }, { updatedAt: "desc" }],
    })
    return NextResponse.json({ memories })
  } catch (error) {
    console.error("[GET /api/memory]", error)
    return NextResponse.json(
      { error: "فشل تحميل الذاكرة" },
      { status: 500 }
    )
  }
}

// POST /api/memory -> create or update a memory by key (upsert)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const key = String(body.key || "").trim()
    const value = String(body.value || "").trim()
    const category = String(body.category || "general").trim()
    if (!key || !value) {
      return NextResponse.json(
        { error: "المفتاح والقيمة مطلوبان" },
        { status: 400 }
      )
    }
    const existing = await db.memory.findUnique({ where: { key } })
    let memory
    if (existing) {
      memory = await db.memory.update({
        where: { key },
        data: { value, category, updatedAt: new Date() },
      })
    } else {
      memory = await db.memory.create({ data: { key, value, category } })
    }
    return NextResponse.json({ memory })
  } catch (error) {
    console.error("[POST /api/memory]", error)
    return NextResponse.json(
      { error: "فشل حفظ الذاكرة" },
      { status: 500 }
    )
  }
}

// DELETE /api/memory?id=... -> delete a memory
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id")
    const key = req.nextUrl.searchParams.get("key")
    if (id) {
      await db.memory.delete({ where: { id } })
    } else if (key) {
      await db.memory.delete({ where: { key } })
    } else {
      return NextResponse.json(
        { error: "حدد id أو key للحذف" },
        { status: 400 }
      )
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[DELETE /api/memory]", error)
    return NextResponse.json(
      { error: "فشل حذف الذاكرة" },
      { status: 500 }
    )
  }
}
