import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { runAgentStep, type AgentMessage } from "@/lib/agent"
import { buildAgentSystemPrompt } from "@/lib/agent/prompt"
import { getProjectMemoryBlock } from "@/lib/tools/memory"
import { getRepoMap } from "@/lib/code-intel/symbol-index"
import type { ProviderSettings } from "@/lib/llm-provider"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const MAX_LOOP_STEPS = 10

// POST /api/autonomous/run — runs the autonomous loop for one cycle:
// 1. Scan for issues → create tasks
// 2. Get next task from DAG → run one agent step
// 3. Verify → checkpoint → next
// 4. After N steps, re-scan
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const maxSteps = Math.min(Number(body.maxSteps) || MAX_LOOP_STEPS, 20)
    const { getSettings } = await import("@/lib/llm-provider")
    const settings: ProviderSettings = getSettings()

    const results: { step: number; action: string; detail: string }[] = []

    // Step 1: Scan for issues — use the existing scanner endpoint
    let issuesFound = 0
    let tasksCreated = 0
    try {
      const scanRes = await fetch("http://localhost:3000/api/autonomous/scan", { method: "POST" })
      const scanData = await scanRes.json()
      issuesFound = scanData.issuesFound || 0
      tasksCreated = scanData.tasksCreated || 0
      results.push({ step: 0, action: "scan", detail: `وُجد ${issuesFound} مشكلة، أُنشئ ${tasksCreated} مهمة` })
    } catch {
      results.push({ step: 0, action: "scan", detail: "فشل المسح — متابعة بالمهام الموجودة" })
    }

    // Step 2: Get pending tasks and execute them
    const pendingTasks = await db.task.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: maxSteps,
    })

    if (pendingTasks.length === 0) {
      return NextResponse.json({
        completed: true,
        steps: results,
        message: "لا مهام معلّقة — النظام نظيف",
      })
    }

    // Build the system prompt with memory + evidence
    const basePrompt = buildAgentSystemPrompt()
    const memoryBlock = await getProjectMemoryBlock()
    const systemPrompt = basePrompt + memoryBlock

    for (const task of pendingTasks) {
      if (results.length >= maxSteps) break

      // Mark as running
      await db.task.update({ where: { id: task.id }, data: { status: "running" } })

      // Build initial conversation from the task goal
      const criteria = JSON.parse(task.acceptanceCriteria) as string[]
      const conversation: AgentMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: `🎯 المهمة: ${task.goal}\n\n📋 معايير القبول:\n${criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\nنفّذ المهمة خطوة بخطوة.` },
      ]

      // Run ONE agent step
      try {
        const stepResult = await runAgentStep({ conversation, settings })

        if (stepResult.isFinal) {
          // Check if goal achieved
          const achieved =
            stepResult.finalText.includes("✅") ||
            stepResult.finalText.includes("محقق") ||
            stepResult.finalText.includes("اكتمل")

          await db.task.update({
            where: { id: task.id },
            data: {
              status: achieved ? "done" : "pending",
              result: stepResult.finalText.slice(0, 500),
              currentStep: task.currentStep + 1,
            },
          })

          results.push({
            step: results.length,
            action: achieved ? "done" : "interim",
            detail: `${task.goal.slice(0, 40)}... → ${achieved ? "✅ محقق" : "تحقق مطلوب"}`,
          })
        } else if (stepResult.toolCall) {
          // Tool was executed — save state
          await db.task.update({
            where: { id: task.id },
            data: {
              currentStep: task.currentStep + 1,
              agentState: JSON.stringify(stepResult.conversation),
            },
          })

          results.push({
            step: results.length,
            action: "tool",
            detail: `${stepResult.toolCall.name} → ${stepResult.toolResult?.status || "?"} (${stepResult.worker})`,
          })
        }
      } catch (e) {
        // Recovery: mark as failed, continue to next task
        await db.task.update({
          where: { id: task.id },
          data: { status: "failed", result: `فشل: ${e instanceof Error ? e.message : String(e)}` },
        })
        results.push({ step: results.length, action: "failed", detail: task.goal.slice(0, 40) })
      }
    }

    // Final summary
    const done = results.filter((r) => r.action === "done").length
    const failed = results.filter((r) => r.action === "failed").length

    return NextResponse.json({
      completed: true,
      steps: results,
      summary: `نُفذ ${results.length} خطوة: ${done} مكتمل، ${failed} فشل، ${issuesFound} مشكلة وُجدت`,
      issuesFound,
      tasksCreated,
    })
  } catch (error) {
    console.error("[POST /api/autonomous/run]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "فشل الحلقة المستقلة" },
      { status: 500 }
    )
  }
}
