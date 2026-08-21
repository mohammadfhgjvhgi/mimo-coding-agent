import { NextRequest, NextResponse } from "next/server"
import { analyzeTask, generatePlan, validatePlan, type Plan } from "@/lib/agent/planning"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/planning — analyze a task and generate a plan
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const task = String(body.task || "").trim()
    const generate = body.generatePlan !== false

    if (!task) return NextResponse.json({ error: "task required" }, { status: 400 })

    const intelligence = analyzeTask(task)
    let plan: Plan | null = null
    let validation: { valid: boolean; issues: string[] } | null = null

    if (generate) {
      plan = generatePlan(task, intelligence)
      validation = validatePlan(plan)
    }

    return NextResponse.json({
      intelligence,
      plan,
      validation,
    })
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
