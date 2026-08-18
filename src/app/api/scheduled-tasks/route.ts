import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET — list all scheduled tasks
export async function GET() {
  try {
    const tasks = await db.scheduledTask.findMany({
      orderBy: { nextRun: "asc" },
    })
    return NextResponse.json({ tasks })
  } catch (error) {
    return NextResponse.json({ error: "فشل تحميل المهام المجدولة" }, { status: 500 })
  }
}

// POST — create a scheduled task
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const name = String(body.name || "").trim()
    const schedule = String(body.schedule || "daily").trim()
    const goal = String(body.goal || "").trim()
    if (!name || !goal) {
      return NextResponse.json({ error: "الاسم والهدف مطلوبان" }, { status: 400 })
    }

    // Calculate next run based on schedule
    const now = new Date()
    let nextRun = new Date(now)
    if (schedule === "daily") nextRun.setDate(now.getDate() + 1)
    else if (schedule === "weekly") nextRun.setDate(now.getDate() + 7)
    else if (schedule === "monthly") nextRun.setMonth(now.getMonth() + 1)
    else nextRun = new Date(now.getTime() + 3600000) // default: 1 hour

    const task = await db.scheduledTask.create({
      data: { name, schedule, goal, nextRun, enabled: true },
    })
    return NextResponse.json({ task })
  } catch (error) {
    return NextResponse.json({ error: "فشل إنشاء المهمة" }, { status: 500 })
  }
}

// DELETE — delete a scheduled task
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id")
    if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 })
    await db.scheduledTask.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "فشل الحذف" }, { status: 500 })
  }
}

// PATCH — toggle enabled/disabled
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const id = String(body.id || "")
    if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 })
    const task = await db.scheduledTask.update({
      where: { id },
      data: { enabled: !!body.enabled },
    })
    return NextResponse.json({ task })
  } catch {
    return NextResponse.json({ error: "فشل التحديث" }, { status: 500 })
  }
}
