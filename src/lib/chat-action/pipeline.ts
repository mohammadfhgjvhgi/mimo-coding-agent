// Chat-to-Action Pipeline — turn chat messages into real execution.
// "اعمل خطة لمشروع X" → Plan → Project → Tasks → Schedule
//
// Pipeline stages:
//   1. Parse intent from message
//   2. Generate plan (deterministic: keyword-based decomposition)
//   3. Create project (if project intent)
//   4. Create tasks (from plan steps)
//   5. Schedule tasks (optional: day plan or study plan)
//   6. Execute first step (optional: call the agent loop)
//
// This is NOT a chat bot. It's a Chat → Action converter.

import { db } from "@/lib/db"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActionType =
  | "create_project"
  | "create_tasks"
  | "create_study_plan"
  | "create_artifact"
  | "search_code"
  | "debug_issue"
  | "write_code"
  | "run_command"
  | "answer_question"
  | "summarize"
  | "translate"
  | "unknown"

export interface ParsedIntent {
  action: ActionType
  subject: string
  details: string
  confidence: number
  suggestedSteps: string[]
}

export interface ActionPlan {
  intent: ParsedIntent
  steps: Array<{
    id: string
    title: string
    type: "plan" | "create_project" | "create_task" | "create_artifact" | "schedule" | "execute" | "answer"
    status: "pending" | "done" | "error"
    result?: Record<string, unknown>
    error?: string
  }>
  projectId?: string
  taskIds: string[]
  artifactId?: string
  totalDurationMs: number
  success: boolean
}

export type ChatActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string }

// ---------------------------------------------------------------------------
// 1. Parse Intent — deterministic keyword matching
// ---------------------------------------------------------------------------

export function parseIntent(message: string): ParsedIntent {
  const msg = message.toLowerCase().trim()
  const subject = message.trim()

  // Project creation
  if (/(?:اعمل|أنشئ|create|build|start).*(?:خطة|مشروع|plan|project)/i.test(msg) ||
      /خطة\s*لمشروع/i.test(msg) || /plan\s+for/i.test(msg) || /مشروع\s+\w/i.test(msg)) {
    const projMatch = message.match(/(?:مشروع|project)\s+(.+?)(?:\.|$)/i)
    const projName = projMatch?.[1]?.trim() ?? "مشروع جديد / new project"
    return {
      action: "create_project",
      subject: projName,
      details: message,
      confidence: 0.85,
      suggestedSteps: decomposeProject(projName, message),
    }
  }

  // Task creation
  if (/(?:اكتب|أنشئ|create|add).*(?:مهام|tasks|to-do|قائمة)/i.test(msg) ||
      /قائمة\s*مهام/i.test(msg) || /task\s*list/i.test(msg)) {
    return {
      action: "create_tasks",
      subject: subject.slice(0, 100),
      details: message,
      confidence: 0.8,
      suggestedSteps: decomposeTasks(message),
    }
  }

  // Study plan
  if (/(?:خطة\s*دراسية|study\s*plan|schedule\s*study|جدول\s*دراسي)/i.test(msg)) {
    return {
      action: "create_study_plan",
      subject: subject.slice(0, 100),
      details: message,
      confidence: 0.85,
      suggestedSteps: [
        "حدد المقررات / identify courses",
        "خصّص وقت كل مقرر / allocate time per course",
        "أنشئ جدولاً أسبوعياً / create weekly schedule",
        "أضف breaks + مراجعات / add breaks + reviews",
      ],
    }
  }

  // Create artifact (diagram, chart, code, etc.)
  if (/(?:ارسم|generate|create).*(?:مخطط|diagram|flowchart|chart|رسم)/i.test(msg) ||
      /اكتب\s*كود/i.test(msg) || /write\s+code/i.test(msg)) {
    return {
      action: "create_artifact",
      subject: subject.slice(0, 100),
      details: message,
      confidence: 0.8,
      suggestedSteps: [
        "حدد نوع المحتوى / identify content type",
        "أنشئ المحتوى / generate content",
        "احفظ كـ artifact / save as artifact",
      ],
    }
  }

  // Search code
  if (/(?:ابحث|find|search|أوجد).*(?:دالة|function|class|symbol|رمز|كود)/i.test(msg) ||
      /where\s+is/i.test(msg) || /who\s+calls/i.test(msg)) {
    return {
      action: "search_code",
      subject: subject.slice(0, 100),
      details: message,
      confidence: 0.75,
      suggestedSteps: ["استخدم find_symbol / get_references"],
    }
  }

  // Debug
  if (/(?:صلح|debug|fix|أصلح).*(?:خطأ|bug|error|مشكلة|issue)/i.test(msg) ||
      /stack\s+trace/i.test(msg) || /crash/i.test(msg)) {
    return {
      action: "debug_issue",
      subject: subject.slice(0, 100),
      details: message,
      confidence: 0.85,
      suggestedSteps: [
        "اقرأ الخطأ / read the error",
        "حدد الملف والسطر / locate file + line",
        "حلّل السبب الجذري / analyze root cause",
        "أصلح الكود / fix the code",
        "تحقق / verify the fix",
      ],
    }
  }

  // Write code
  if (/(?:اكتب|write|implement|أنشئ).*(?:كود|code|function|دالة|component|ملف)/i.test(msg)) {
    return {
      action: "write_code",
      subject: subject.slice(0, 100),
      details: message,
      confidence: 0.8,
      suggestedSteps: [
        "حدد المتطلبات / identify requirements",
        "اكتب الكود / write the code",
        "تحقق من الصياغة / verify syntax",
        "اختبار / test",
      ],
    }
  }

  // Run command
  if (/(?:شغل|run|execute|نفّذ).*(?:أمر|command|script|test|اختبار)/i.test(msg)) {
    return {
      action: "run_command",
      subject: subject.slice(0, 100),
      details: message,
      confidence: 0.8,
      suggestedSteps: ["حدد الأمر / identify command", "نفّذ / execute", "اعرض النتيجة / show result"],
    }
  }

  // Summarize
  if (/(?:لخّص|summarize|summary|اختصر)/i.test(msg)) {
    return {
      action: "summarize",
      subject: subject.slice(0, 100),
      details: message,
      confidence: 0.8,
      suggestedSteps: ["اقرأ المحتوى / read content", "لخّص النقاط الرئيسية / summarize key points"],
    }
  }

  // Translate
  if (/(?:ترجم|translate|ترجمة)/i.test(msg)) {
    return {
      action: "translate",
      subject: subject.slice(0, 100),
      details: message,
      confidence: 0.8,
      suggestedSteps: ["حدد اللغة المصدر + الهدف / identify source + target language", "ترجم / translate"],
    }
  }

  // Default: answer question
  return {
    action: "answer_question",
    subject: subject.slice(0, 100),
    details: message,
    confidence: 0.5,
    suggestedSteps: ["حلّل السؤال / analyze question", "ابحث في السياق / search context", "أجب / answer"],
  }
}

// ---------------------------------------------------------------------------
// Decomposition helpers
// ---------------------------------------------------------------------------

function decomposeProject(name: string, message: string): string[] {
  const steps: string[] = []
  // Check for common project types
  if (/web|website|موقع/i.test(message)) {
    steps.push("صمم بنية الصفحات / design page structure")
    steps.push("أنشئ الواجهة / build the UI")
    steps.push("أضف API endpoints / add API endpoints")
    steps.push("اربط قاعدة البيانات / connect database")
    steps.push("اختبر / test")
  } else if (/api|backend|خادم/i.test(message)) {
    steps.push("صمم الـ routes / design routes")
    steps.push("أنشئ الـ models / create models")
    steps.push("اكتب الـ handlers / write handlers")
    steps.push("أضف middleware / add middleware")
    steps.push("اختبر / test")
  } else if (/mobile|تطبيق\s+موبايل/i.test(message)) {
    steps.push("صمم الشاشات / design screens")
    steps.push("أنشئ navigation / build navigation")
    steps.push("أضف state management / add state management")
    steps.push("اربط API / connect API")
    steps.push("اختبر / test")
  } else {
    // Generic project
    steps.push("حدد المتطلبات / identify requirements")
    steps.push("صمم البنية / design architecture")
    steps.push("نفّذ / implement")
    steps.push("اختبر / test")
    steps.push("وثّق / document")
  }
  return steps
}

function decomposeTasks(message: string): string[] {
  // Extract bullet points or numbered items from the message
  const lines = message.split("\n")
  const tasks: string[] = []
  for (const line of lines) {
    const m = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)/)
    if (m) tasks.push(m[1].trim())
  }
  if (tasks.length === 0) {
    tasks.push("مهمة 1 / task 1")
    tasks.push("مهمة 2 / task 2")
    tasks.push("مهمة 3 / task 3")
  }
  return tasks
}

// ---------------------------------------------------------------------------
// 2. Execute Pipeline — run the full Chat → Action chain
// ---------------------------------------------------------------------------

export async function executePipeline(message: string, opts: { conversationId?: string; schedule?: boolean } = {}): Promise<ChatActionResult<ActionPlan>> {
  const start = Date.now()
  try {
    const intent = parseIntent(message)
    const plan: ActionPlan = {
      intent,
      steps: [],
      taskIds: [],
      totalDurationMs: 0,
      success: true,
    }

    // Step 1: Plan (always)
    plan.steps.push({
      id: "step_plan",
      title: `خطة: ${intent.subject.slice(0, 60)}`,
      type: "plan",
      status: "done",
      result: { steps: intent.suggestedSteps },
    })

    // Step 2: Action based on intent
    switch (intent.action) {
      case "create_project": {
        // Create project
        const project = await db.project.create({
          data: {
            name: intent.subject,
            description: message,
            status: "active",
            milestones: JSON.stringify(intent.suggestedSteps.map((s, i) => ({ title: s, done: false, order: i }))),
          },
        })
        plan.projectId = project.id
        plan.steps.push({
          id: "step_project",
          title: `إنشاء مشروع: ${intent.subject}`,
          type: "create_project",
          status: "done",
          result: { projectId: project.id, name: project.name },
        })

        // Create tasks from suggested steps
        for (let i = 0; i < intent.suggestedSteps.length; i++) {
          const stepText = intent.suggestedSteps[i]
          const task = await db.task.create({
            data: {
              conversationId: opts.conversationId,
              goal: stepText,
              status: "pending",
              steps: JSON.stringify([{ id: `t${i+1}`, description: stepText, done: false }]),
              acceptanceCriteria: JSON.stringify([`${stepText} — مكتمل / done`]),
            },
          })
          plan.taskIds.push(task.id)
          plan.steps.push({
            id: `step_task_${i}`,
            title: `مهمة: ${stepText}`,
            type: "create_task",
            status: "done",
            result: { taskId: task.id, title: stepText },
          })
        }

        // Optional: schedule
        if (opts.schedule) {
          const { planningAssistant } = await import("@/lib/productivity/os")
          const dayPlan = await planningAssistant({ date: new Date() })
          plan.steps.push({
            id: "step_schedule",
            title: "جدولة المهام / schedule tasks",
            type: "schedule",
            status: dayPlan.ok ? "done" : "error",
            result: dayPlan.ok ? { dayPlanId: dayPlan.data.id } : undefined,
            error: dayPlan.ok ? undefined : dayPlan.message,
          })
        }
        break
      }

      case "create_tasks": {
        for (let i = 0; i < intent.suggestedSteps.length; i++) {
          const stepText = intent.suggestedSteps[i]
          const task = await db.task.create({
            data: {
              conversationId: opts.conversationId,
              goal: stepText,
              status: "pending",
              steps: JSON.stringify([{ id: `t${i+1}`, description: stepText, done: false }]),
            },
          })
          plan.taskIds.push(task.id)
          plan.steps.push({
            id: `step_task_${i}`,
            title: `مهمة: ${stepText}`,
            type: "create_task",
            status: "done",
            result: { taskId: task.id },
          })
        }
        break
      }

      case "create_study_plan": {
        const { studyPlanCreate } = await import("@/lib/study/os")
        const studyPlan = await studyPlanCreate({
          title: intent.subject,
          type: "weekly",
          items: intent.suggestedSteps.map((s, i) => ({
            date: new Date(Date.now() + i * 86400000).toISOString().slice(0, 10),
            topic: s,
            durationMin: 60,
            resources: [],
          })),
        })
        plan.steps.push({
          id: "step_study_plan",
          title: "إنشاء خطة دراسية",
          type: "schedule",
          status: studyPlan.ok ? "done" : "error",
          result: studyPlan.ok ? { planId: studyPlan.data.id } : undefined,
          error: studyPlan.ok ? undefined : studyPlan.message,
        })
        break
      }

      case "create_artifact": {
        const { artifactCreate } = await import("@/lib/artifacts/system")
        const artifact = await artifactCreate({
          title: intent.subject,
          type: "markdown",
          content: `# ${intent.subject}\n\n${intent.details}\n\n## Steps\n${intent.suggestedSteps.map((s, i) => `${i+1}. ${s}`).join("\n")}`,
          conversationId: opts.conversationId,
        })
        if (artifact.ok) {
          plan.artifactId = artifact.data.id
          plan.steps.push({
            id: "step_artifact",
            title: "إنشاء artifact",
            type: "create_artifact",
            status: "done",
            result: { artifactId: artifact.data.id },
          })
        }
        break
      }

      case "search_code": {
        plan.steps.push({
          id: "step_search",
          title: "البحث في الكود (يتطلب أدوات الوكيل)",
          type: "execute",
          status: "pending",
          result: { suggestedTools: ["find_symbol", "get_references"] },
        })
        break
      }

      case "debug_issue": {
        plan.steps.push({
          id: "step_debug",
          title: "تشخيص الخطأ (يتطلب أدوات الوكيل)",
          type: "execute",
          status: "pending",
          result: { suggestedTools: ["read_file", "find_symbol", "edit_file", "run_terminal_command"] },
        })
        break
      }

      case "write_code": {
        plan.steps.push({
          id: "step_write",
          title: "كتابة الكود (يتطلب أدوات الوكيل)",
          type: "execute",
          status: "pending",
          result: { suggestedTools: ["write_file", "edit_file"] },
        })
        break
      }

      case "run_command": {
        plan.steps.push({
          id: "step_run",
          title: "تنفيذ الأمر (يتطلب أدوات الوكيل)",
          type: "execute",
          status: "pending",
          result: { suggestedTools: ["run_terminal_command"] },
        })
        break
      }

      case "answer_question":
      case "summarize":
      case "translate":
      default: {
        plan.steps.push({
          id: "step_answer",
          title: "إجابة (يتطلب LLM)",
          type: "answer",
          status: "pending",
          result: { requiresLLM: true },
        })
        break
      }
    }

    plan.totalDurationMs = Date.now() - start
    plan.success = plan.steps.every(s => s.status !== "error")

    return { ok: true, data: plan }
  } catch (e) {
    return {
      ok: false,
      error: "pipeline_failed",
      message: `❌ فشل التنفيذ: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Get pipeline preview (without executing)
// ---------------------------------------------------------------------------

export function previewPipeline(message: string): ChatActionResult<{ intent: ParsedIntent; steps: Array<{ title: string; type: string }> }> {
  try {
    const intent = parseIntent(message)
    const steps = intent.suggestedSteps.map((s, i) => ({
      title: s,
      type: i === 0 ? "plan" : intent.action === "create_project" ? (i === 1 ? "create_project" : "create_task") : "action",
    }))
    // Add execute/answer step
    if (intent.action === "answer_question" || intent.action === "summarize" || intent.action === "translate") {
      steps.push({ title: "إجابة / answer (LLM)", type: "answer" })
    } else if (["search_code", "debug_issue", "write_code", "run_command"].includes(intent.action)) {
      steps.push({ title: "تنفيذ / execute (agent tools)", type: "execute" })
    }
    return { ok: true, data: { intent, steps } }
  } catch (e) {
    return { ok: false, error: "preview_failed", message: `❌ فشل المعاينة: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// Formatter — turn pipeline result into a readable summary
// ---------------------------------------------------------------------------

export function formatActionPlan(plan: ActionPlan): string {
  const lines: string[] = []
  lines.push(`🚀 **Chat → Action Pipeline**`)
  lines.push(`📋 النية: ${plan.intent.action} — ${plan.intent.subject.slice(0, 60)}`)
  lines.push(`🎯 الثقة: ${(plan.intent.confidence * 100).toFixed(0)}%`)
  lines.push("")
  for (const step of plan.steps) {
    const icon = step.status === "done" ? "✅" : step.status === "error" ? "❌" : "⏳"
    lines.push(`${icon} ${step.title}`)
    if (step.result) {
      const r = step.result as Record<string, unknown>
      for (const [k, v] of Object.entries(r)) {
        lines.push(`   ↳ ${k}: ${String(v).slice(0, 80)}`)
      }
    }
    if (step.error) lines.push(`   ❌ ${step.error}`)
  }
  lines.push("")
  lines.push(`⏱️ ${plan.totalDurationMs}ms | ${plan.success ? "✅ نجح" : "❌ فشل"}`)
  if (plan.projectId) lines.push(`📁 المشروع: ${plan.projectId}`)
  if (plan.taskIds.length > 0) lines.push(`📋 المهام: ${plan.taskIds.length}`)
  if (plan.artifactId) lines.push(`🎨 Artifact: ${plan.artifactId}`)
  return lines.join("\n")
}
