import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface Params {
  params: Promise<{ id: string }>
}

// GET /api/goals/:id -> one task (with steps + plan, no agentState blob)
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const task = await db.task.findUnique({ where: { id } })
    if (!task) {
      return NextResponse.json({ error: "المهمة غير موجودة" }, { status: 404 })
    }
    return NextResponse.json({
      task: {
        ...task,
        acceptanceCriteria: safeParse(task.acceptanceCriteria, []),
        plan: safeParse(task.plan, null),
        steps: safeParse(task.steps, []),
        verificationResult: safeParse(task.verificationResult, null),
      },
    })
  } catch (error) {
    console.error("[GET /api/goals/:id]", error)
    return NextResponse.json({ error: "فشل تحميل المهمة" }, { status: 500 })
  }
}

// PATCH /api/goals/:id -> update status (pause/resume/etc.)
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const data: { status?: string; result?: string } = {}
    if (typeof body.status === "string") data.status = body.status
    if (typeof body.result === "string") data.result = body.result

    const task = await db.task.update({ where: { id }, data })
    return NextResponse.json({ task })
  } catch (error) {
    console.error("[PATCH /api/goals/:id]", error)
    return NextResponse.json({ error: "فشل تحديث المهمة" }, { status: 500 })
  }
}

// DELETE /api/goals/:id
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    await db.task.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[DELETE /api/goals/:id]", error)
    return NextResponse.json({ error: "فشل حذف المهمة" }, { status: 500 })
  }
}

function safeParse(raw: string | null, fallback: unknown) {
  if (!raw) return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}
