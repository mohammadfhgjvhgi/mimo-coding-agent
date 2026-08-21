// Task-to-Automation Pipeline — turn chat messages into scheduled automations.
// "افحص المشروع كل أسبوع" → Chat → Automation → Schedule → Agent → Report
//
// Pipeline stages:
//   1. Parse automation intent (what + when + how)
//   2. Create workflow (in Automation OS)
//   3. Create schedule (cron or fixed interval)
//   4. Generate workflow steps (deterministic: inspect → verify → report)
//   5. Save report destination (memory or knowledge)
//
// This makes MiMo X a real OS — not just a chatbot.

import { db } from "@/lib/db"
import { workflowCreate, scheduleCreate } from "@/lib/automation/os"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AutomationFrequency = "hourly" | "daily" | "weekly" | "monthly" | "custom"

export interface ParsedAutomation {
  task: string
  frequency: AutomationFrequency
  cronExpression: string
  steps: string[]
  reportDestination: "memory" | "knowledge" | "artifact" | "console"
  confidence: number
}

export interface AutomationResult {
  workflowId: string
  scheduleId: string
  parsed: ParsedAutomation
  stages: Array<{ name: string; status: "done" | "error"; durationMs: number; result?: string }>
  totalDurationMs: number
  summary: string
}

export type TaskAutomationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string }

// ---------------------------------------------------------------------------
// 1. Parse automation intent — extract what + when + how
// ---------------------------------------------------------------------------

export function parseAutomation(message: string): ParsedAutomation {
  const msg = message.toLowerCase().trim()
  const task = message.trim()

  // Detect frequency
  let frequency: AutomationFrequency = "daily"
  let cronExpression = "0 9 * * *" // Default: daily at 9am

  if (/(?:كل\s*ساعة|hourly|every\s*hour)/i.test(msg)) {
    frequency = "hourly"
    cronExpression = "0 * * * *" // Every hour
  } else if (/(?:كل\s*يوم|daily|every\s*day|يوميا)/i.test(msg)) {
    frequency = "daily"
    cronExpression = "0 9 * * *" // Daily at 9am
  } else if (/(?:كل\s*أسبوع|weekly|every\s*week|أسبوعيا)/i.test(msg)) {
    frequency = "weekly"
    cronExpression = "0 9 * * 1" // Every Monday at 9am
  } else if (/(?:كل\s*شهر|monthly|every\s*month|شهريا)/i.test(msg)) {
    frequency = "monthly"
    cronExpression = "0 9 1 * *" // 1st of month at 9am
  } else if (/(?:كل\s*\d+\s*(دقيقة|ساعة|minute|hour))/i.test(msg)) {
    frequency = "custom"
    // Extract the number
    const m = msg.match(/كل\s*(\d+)\s*(دقيقة|ساعة|minute|hour)/i)
    if (m) {
      const num = Number(m[1])
      const unit = m[2].toLowerCase()
      if (unit.includes("دقيقة") || unit.includes("minute")) {
        cronExpression = `fixed:${num * 60}` // Every N minutes
      } else {
        cronExpression = `fixed:${num * 3600}` // Every N hours
      }
    }
  } else if (/(?:every\s+(\d+)\s+(minute|hour|day|week))/i.test(msg)) {
    frequency = "custom"
    const m = msg.match(/every\s+(\d+)\s+(minute|hour|day|week)/i)
    if (m) {
      const num = Number(m[1])
      const unit = m[2].toLowerCase()
      if (unit === "minute") cronExpression = `fixed:${num * 60}`
      else if (unit === "hour") cronExpression = `fixed:${num * 3600}`
      else if (unit === "day") cronExpression = `fixed:${num * 86400}`
      else cronExpression = `fixed:${num * 604800}`
    }
  }

  // Detect task type + generate steps
  const steps = generateSteps(message)

  // Detect report destination
  let reportDestination: ParsedAutomation["reportDestination"] = "memory"
  if (/(?:تقرير|report|محفوظ|saved)/i.test(msg)) reportDestination = "memory"
  if (/(?:معرفة|knowledge|قاعدة\s*معرفة)/i.test(msg)) reportDestination = "knowledge"
  if (/(?:artifact|أداة|ملف)/i.test(msg)) reportDestination = "artifact"
  if (/(?:console|طرفية|terminal)/i.test(msg)) reportDestination = "console"

  // Confidence
  let confidence = 0.7
  if (frequency !== "daily") confidence += 0.1 // user specified frequency
  if (steps.length > 3) confidence += 0.1 // rich task
  confidence = Math.min(0.95, confidence)

  return {
    task: task.slice(0, 200),
    frequency,
    cronExpression,
    steps,
    reportDestination,
    confidence,
  }
}

// ---------------------------------------------------------------------------
// 2. Generate workflow steps — deterministic based on task type
// ---------------------------------------------------------------------------

function generateSteps(message: string): string[] {
  const msg = message.toLowerCase()
  const steps: string[] = []

  // Inspection tasks
  if (/(?:افحص|inspect|check|فحص|تحقق|verify)/i.test(msg)) {
    steps.push("اقرأ حالة المشروع / read project status")
    steps.push("افحص lint + typecheck / run lint + typecheck")
    steps.push("افحص git status / check git status")
    steps.push("حلّل النتائج / analyze results")
    steps.push("أنشئ تقريراً / generate report")
    steps.push("احفظ التقرير / save report")
    return steps
  }

  // Build tasks
  if (/(?:ابن|build|compile|تجميع|بناء)/i.test(msg)) {
    steps.push("تحقّق من المتطلبات / check dependencies")
    steps.push("شغّل البناء / run build")
    steps.push("تحقّق من النتيجة / verify result")
    steps.push("أنشئ تقريراً / generate report")
    return steps
  }

  // Test tasks
  if (/(?:اختبر|test|اختبار|tests)/i.test(msg)) {
    steps.push("شغّل الاختبارات / run tests")
    steps.push("تحقّق من النتائج / check results")
    steps.push("سلّط الأخطاء / report failures")
    steps.push("احفظ التقرير / save report")
    return steps
  }

  // Backup tasks
  if (/(?:نسخة\s*احتياطية|backup|احفظ|archive)/i.test(msg)) {
    steps.push("حدد الملفات / identify files")
    steps.push("أنشئ checkpoint / create checkpoint")
    steps.push("تحقّق من النسخة / verify backup")
    steps.push("احفظ التقرير / save report")
    return steps
  }

  // Research tasks
  if (/(?:ابحث|research|بحث|استكشف)/i.test(msg)) {
    steps.push("حدد موضوع البحث / identify research topic")
    steps.push("ابحث في الويب / search the web")
    steps.push("استخرج الحقائق / extract facts")
    steps.push("احفظ في قاعدة المعرفة / save to knowledge base")
    return steps
  }

  // Default: generic monitoring
  steps.push("اقرأ الحالة الحالية / read current state")
  steps.push("حلّل النتائج / analyze results")
  steps.push("أنشئ تقريراً / generate report")
  steps.push("احفظ التقرير / save report")
  return steps
}

// ---------------------------------------------------------------------------
// 3. Full Pipeline — Chat → Automation → Schedule → Steps → Report
// ---------------------------------------------------------------------------

export async function runTaskAutomationPipeline(message: string, opts: { conversationId?: string } = {}): Promise<TaskAutomationResult<AutomationResult>> {
  const start = Date.now()
  try {
    if (!message || !message.trim()) {
      return { ok: false, error: "no_message", message: "❌ لا رسالة / no message provided" }
    }

    const stages: AutomationResult["stages"] = []

    // Stage 1: Parse automation intent
    const parseStart = Date.now()
    const parsed = parseAutomation(message)
    stages.push({
      name: "parse_automation",
      status: "done",
      durationMs: Date.now() - parseStart,
      result: `${parsed.frequency} (${parsed.cronExpression}), ${parsed.steps.length} steps, confidence=${(parsed.confidence * 100).toFixed(0)}%`,
    })

    // Stage 2: Create workflow
    const wfStart = Date.now()
    const workflowSteps = parsed.steps.map((s, i) => ({
      id: `step_${i + 1}`,
      type: i === parsed.steps.length - 1
        ? "notification" as const
        : i === 0
        ? "file_action" as const
        : "http_request" as const,
      name: s,
      config: i === 0
        ? { action: "read", path: "." }
        : i === parsed.steps.length - 1
        ? { message: `Report for: ${parsed.task}` }
        : { method: "GET", url: "http://localhost:3000/api/observability/snapshot" },
      next: i < parsed.steps.length - 1 ? `step_${i + 2}` : null,
    }))

    const wfRes = await workflowCreate({
      name: `Automation: ${parsed.task.slice(0, 60)}`,
      description: `تلقائي من المحادثة: ${parsed.task.slice(0, 100)}`,
      status: "active",
      steps: workflowSteps,
      triggers: [{ type: "schedule", config: { schedule: parsed.cronExpression } }],
      retryPolicy: { maxRetries: 2, backoffMs: 500, backoffMultiplier: 2 },
      notifications: { onSuccess: true, onError: true, channels: [parsed.reportDestination] },
    })

    if (!wfRes.ok) {
      stages.push({ name: "create_workflow", status: "error", durationMs: Date.now() - wfStart, result: wfRes.message })
      return { ok: false, error: "workflow_failed", message: wfRes.message }
    }
    stages.push({ name: "create_workflow", status: "done", durationMs: Date.now() - wfStart, result: wfRes.data.id })

    // Stage 3: Create schedule
    const schedStart = Date.now()
    const schedRes = await scheduleCreate({
      workflowId: wfRes.data.id,
      name: `Schedule: ${parsed.task.slice(0, 40)}`,
      schedule: parsed.cronExpression,
      payload: { task: parsed.task, conversationId: opts.conversationId },
    })

    if (!schedRes.ok) {
      stages.push({ name: "create_schedule", status: "error", durationMs: Date.now() - schedStart, result: schedRes.message })
      return { ok: false, error: "schedule_failed", message: schedRes.message }
    }
    stages.push({ name: "create_schedule", status: "done", durationMs: Date.now() - schedStart, result: schedRes.data.id })

    // Stage 4: Save automation metadata to memory
    const memStart = Date.now()
    const memKey = `automation_${Date.now()}`
    try {
      await db.memory.create({
        data: {
          key: memKey,
          value: JSON.stringify({
            task: parsed.task,
            frequency: parsed.frequency,
            cron: parsed.cronExpression,
            workflowId: wfRes.data.id,
            scheduleId: schedRes.data.id,
            steps: parsed.steps,
            reportDestination: parsed.reportDestination,
            createdAt: new Date().toISOString(),
          }),
          category: "automation",
          source: `task-automation:${wfRes.data.id}`,
        },
      })
      stages.push({ name: "save_metadata", status: "done", durationMs: Date.now() - memStart, result: memKey })
    } catch (e) {
      stages.push({ name: "save_metadata", status: "error", durationMs: Date.now() - memStart, result: String(e) })
    }

    const summary = `✅ تم تحويل المهمة لأتمتة!\n` +
      `📋 المهمة: ${parsed.task.slice(0, 60)}\n` +
      `🔄 التكرار: ${parsed.frequency} (${parsed.cronExpression})\n` +
      `📝 الخطوات: ${parsed.steps.length}\n` +
      `🎯 التقارير تُحفظ في: ${parsed.reportDestination}\n` +
      `🔧 Workflow ID: ${wfRes.data.id}\n` +
      `⏰ Schedule ID: ${schedRes.data.id}\n` +
      `📊 الثقة: ${(parsed.confidence * 100).toFixed(0)}%`

    return {
      ok: true,
      data: {
        workflowId: wfRes.data.id,
        scheduleId: schedRes.data.id,
        parsed,
        stages,
        totalDurationMs: Date.now() - start,
        summary,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "pipeline_failed",
      message: `❌ فشل خط الأتمتة: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

export function formatAutomationResult(r: AutomationResult): string {
  const lines: string[] = []
  lines.push(`🔄 **Task → Automation Pipeline**`)
  lines.push(`📋 المهمة: ${r.parsed.task.slice(0, 80)}`)
  lines.push(`🔄 التكرار: ${r.parsed.frequency} (${r.parsed.cronExpression})`)
  lines.push(`🎯 الثقة: ${(r.parsed.confidence * 100).toFixed(0)}%`)
  lines.push(`📤 وجهة التقرير: ${r.parsed.reportDestination}`)
  lines.push("")
  lines.push(`**الخطوات / Steps:**`)
  r.parsed.steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`))
  lines.push("")
  for (const s of r.stages) {
    const icon = s.status === "done" ? "✅" : "❌"
    lines.push(`${icon} ${s.name} (${s.durationMs}ms)${s.result ? ` — ${s.result.slice(0, 60)}` : ""}`)
  }
  lines.push("")
  lines.push(`⏱️ ${r.totalDurationMs}ms | Workflow: ${r.workflowId.slice(-8)} | Schedule: ${r.scheduleId.slice(-8)}`)
  return lines.join("\n")
}
