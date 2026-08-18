import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { runAgentStep, type AgentMessage } from "@/lib/agent"
import { buildAgentSystemPrompt } from "@/lib/agent/prompt"
import { getProjectMemoryBlock } from "@/lib/tools/memory"
import type { ProviderSettings } from "@/lib/llm-provider"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

interface Params {
  params: Promise<{ id: string }>
}

const MAX_GOAL_STEPS = 40

// Check if the agent declared the goal achieved
function isGoalAchieved(text: string): boolean {
  const t = text.toLowerCase()
  return (
    (t.includes("✅") || t.includes("محقق") || t.includes("تحقق") || t.includes("اكتمل") || t.includes("achieved")) &&
    (t.includes("محقق") || t.includes("هدف") || t.includes("achieved") || t.includes("goal"))
  )
}

// Build the initial conversation for a new goal
async function buildInitialConversation(
  goal: string,
  criteria: string[]
): Promise<AgentMessage[]> {
  const basePrompt = buildAgentSystemPrompt()
  const memoryBlock = await getProjectMemoryBlock()
  const systemPrompt = basePrompt + memoryBlock

  const criteriaText = criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")
  const userMsg = [
    `🎯 المهمة: ${goal}`,
    ``,
    `📋 معايير القبول (يجب تحقيقها جميعاً):`,
    criteriaText,
    ``,
    `ابدأ بالتخطيط ثم التنفيذ خطوة بخطوة باستخدام الأدوات.`,
    `عند الانتهاء، تحقق ذاتياً من تحقيق كل معيار قبول عبر تشغيل الاختبارات/الأوامر المناسبة.`,
    `إذا تأكدت أن كل المعايير محققة، أنهِ إجابتك بـ: ✅ الهدف محقق — مع ملخص ما أنجزته.`,
  ].join("\n")

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMsg },
  ]
}

// POST /api/goals/:id/run — runs ONE agent step, persists state, returns status.
// The client polls this endpoint repeatedly until status is done/failed/paused.
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const task = await db.task.findUnique({ where: { id } })

    if (!task) {
      return NextResponse.json({ error: "المهمة غير موجودة" }, { status: 404 })
    }

    // Don't run if already done/failed/paused
    if (task.status === "done" || task.status === "failed") {
      return NextResponse.json({
        task,
        step: null,
        action: "noop",
        message: `المهمة ${task.status}`,
      })
    }

    // Safety: max steps
    if (task.currentStep >= MAX_GOAL_STEPS) {
      const updated = await db.task.update({
        where: { id },
        data: { status: "failed", result: `تجاوز الحد الأقصى من الخطوات (${MAX_GOAL_STEPS})` },
      })
      return NextResponse.json({
        task: updated,
        step: null,
        action: "failed",
        message: "تجاوز الحد الأقصى من الخطوات",
      })
    }

    // Mark as running
    if (task.status !== "running") {
      task.status = "running"
      await db.task.update({ where: { id }, data: { status: "running" } })
    }

    // Deserialize or build the conversation
    let conversation: AgentMessage[]
    try {
      conversation = task.agentState
        ? (JSON.parse(task.agentState) as AgentMessage[])
        : await buildInitialConversation(
            task.goal,
            JSON.parse(task.acceptanceCriteria) as string[]
          )
    } catch {
      conversation = await buildInitialConversation(
        task.goal,
        JSON.parse(task.acceptanceCriteria) as string[]
      )
    }

    // Get settings (from server cache or defaults)
    const { getSettings } = await import("@/lib/llm-provider")
    const settings: ProviderSettings = getSettings()

    // Run ONE step
    const stepResult = await runAgentStep({
      conversation,
      settings,
    })

    const steps = safeParse(task.steps, []) as Array<Record<string, unknown>>

    if (stepResult.isFinal) {
      // Agent gave a final answer — check if goal is achieved
      if (isGoalAchieved(stepResult.finalText)) {
        const updated = await db.task.update({
          where: { id },
          data: {
            status: "done",
            result: stepResult.finalText,
            currentStep: task.currentStep + 1,
            steps: JSON.stringify([
              ...steps,
              {
                type: "final",
                text: stepResult.finalText.slice(0, 500),
                worker: stepResult.worker,
                ts: Date.now(),
              },
            ]),
            verificationResult: JSON.stringify({
              passed: true,
              reason: "أعلن الوكيل تحقق الهدف بعد التحقق الذاتي",
            }),
          },
        })
        return NextResponse.json({
          task: updated,
          step: { type: "done", text: stepResult.finalText.slice(0, 200) },
          action: "done",
          message: "✅ الهدف محقق",
        })
      }

      // Not yet achieved — inject the verification prompt and continue
      const criteria = JSON.parse(task.acceptanceCriteria) as string[]
      const verifyMsg = [
        `🔔 تذكير بالتحقق: لقد قدمت إجابتك، لكن الهدف لم يُعلن محققاً بعد.`,
        `تحقق من تحقيق معايير القبول التالية:`,
        criteria.map((c, i) => `${i + 1}. ${c}`).join("\n"),
        ``,
        `استخدم الأدوات (read_file, run_terminal_command) للتأكد.`,
        `إذا كان كل شيء محققاً، أنهِ بـ: ✅ الهدف محقق`,
        `إذا لم يكن، أصلح المشكلة ثم تحقق مجدداً.`,
      ].join("\n")

      conversation.push({ role: "user", content: verifyMsg })

      await db.task.update({
        where: { id },
        data: {
          agentState: JSON.stringify(conversation),
          currentStep: task.currentStep + 1,
          steps: JSON.stringify([
            ...steps,
            {
              type: "interim-answer",
              text: stepResult.finalText.slice(0, 300),
              worker: stepResult.worker,
              ts: Date.now(),
              action: "verification-requested",
            },
          ]),
        },
      })

      return NextResponse.json({
        task: { ...task, currentStep: task.currentStep + 1, status: "running" },
        step: {
          type: "verification-injected",
          text: stepResult.finalText.slice(0, 200),
        },
        action: "continue",
        message: "طلب تحقق — استمر",
      })
    }

    // Tool call executed — persist the new conversation + step
    const newStep = {
      type: "tool",
      tool: stepResult.toolCall?.name,
      args: stepResult.toolCall?.args,
      result: stepResult.toolResult?.result?.slice(0, 500),
      status: stepResult.toolResult?.status,
      worker: stepResult.worker,
      workerReason: stepResult.workerReason,
      ts: Date.now(),
    }

    const updated = await db.task.update({
      where: { id },
      data: {
        agentState: JSON.stringify(stepResult.conversation),
        currentStep: task.currentStep + 1,
        steps: JSON.stringify([...steps, newStep]),
      },
    })

    return NextResponse.json({
      task: updated,
      step: newStep,
      action: "continue",
      message: `${newStep.tool} → ${newStep.status} (${stepResult.worker})`,
    })
  } catch (error) {
    console.error("[POST /api/goals/:id/run]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "فشل تشغيل الخطوة" },
      { status: 500 }
    )
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
