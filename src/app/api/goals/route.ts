import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/goals -> list all tasks (newest first)
export async function GET() {
  try {
    const tasks = await db.task.findMany({
      orderBy: { updatedAt: "desc" },
      take: 100,
    })
    // Deserialize JSON fields for the UI
    const parsed = tasks.map((t) => ({
      ...t,
      acceptanceCriteria: safeParse(t.acceptanceCriteria, []),
      plan: safeParse(t.plan, null),
      steps: safeParse(t.steps, []),
      agentState: t.agentState ? "[persisted]" : null,
      verificationResult: safeParse(t.verificationResult, null),
    }))
    return NextResponse.json({ tasks: parsed })
  } catch (error) {
    console.error("[GET /api/goals]", error)
    return NextResponse.json({ error: "فشل تحميل المهام" }, { status: 500 })
  }
}

// POST /api/goals -> create a new task
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const goal = String(body.goal || "").trim()
    const criteria: string[] = Array.isArray(body.acceptanceCriteria)
      ? body.acceptanceCriteria.map((c: unknown) => String(c))
      : []

    if (!goal) {
      return NextResponse.json({ error: "الهدف مطلوب" }, { status: 400 })
    }
    if (criteria.length === 0) {
      return NextResponse.json({ error: "معايير القبول مطلوبة" }, { status: 400 })
    }

    const task = await db.task.create({
      data: {
        goal,
        acceptanceCriteria: JSON.stringify(criteria),
        conversationId: body.conversationId || null,
        status: "pending",
      },
    })
    return NextResponse.json({
      task: {
        ...task,
        acceptanceCriteria: criteria,
        steps: [],
        plan: null,
      },
    })
  } catch (error) {
    console.error("[POST /api/goals]", error)
    return NextResponse.json({ error: "فشل إنشاء المهمة" }, { status: 500 })
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
