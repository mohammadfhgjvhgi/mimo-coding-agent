// Agent Teams — logical role-based agent coordination.
// NOT 7 independent models — ONE model, 7 roles via system prompt switching.
// Sequential execution for i7-3770 (future: parallel when hardware allows).
//
// Design:
//   • Uses existing swarm-roles.ts for role definitions (prompts + tools)
//   • Team = sequence of roles, each runs on the SAME model with different prompt
//   • Context passes between roles (output of role N = input to role N+1)
//   • Coordinator picks the best role for a task (deterministic)
//   • No Prisma models needed — pure orchestration layer over the agent loop
//
// 7 core roles:
//   1. Researcher  — gather info, read files, search
//   2. Coder       — write/edit code
//   3. Debugger    — find + fix bugs
//   4. Tester     — write/run tests
//   5. Reviewer    — code review, quality check
//   6. Architect   — design, plan, structure
//   7. Security    — security audit, vulnerabilities
//
// Operations:
//   - teamPlan     — break a task into role-assigned subtasks
//   - teamRun      — execute subtasks sequentially (same model, different prompts)
//   - teamRoute    — pick the best single role for a task
//   - teamCompose  — combine outputs from multiple roles

import { matchRole, getRoleTools, getRolePrompt, ROLE_PROMPTS, ROLE_TOOLS, type MiMoRole, type Subtask, type SwarmPlan } from "@/lib/agent/swarm-roles"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamMember {
  role: MiMoRole
  displayName: string
  description: string
  tools: string[]
  systemPrompt: string
}

export interface TeamResult {
  plan: SwarmPlan
  executions: Array<{
    subtask: Subtask
    role: MiMoRole
    status: "pending" | "running" | "success" | "failed" | "skipped"
    input: string
    output: string
    durationMs: number
    error?: string
  }>
  finalOutput: string
  totalDurationMs: number
  success: boolean
}

export interface TeamRouteResult {
  role: MiMoRole
  member: TeamMember
  reason: string
}

export type TeamResult2<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string }

// ---------------------------------------------------------------------------
// Team registry — 7 core roles with bilingual descriptions
// ---------------------------------------------------------------------------

export const CORE_TEAM: Partial<Record<MiMoRole, TeamMember>> = {
  researcher: {
    role: "researcher",
    displayName: "🔍 باحث / Researcher",
    description: "يجمع المعلومات، يقرأ الملفات، يبحث في الكود / Gathers info, reads files, searches code",
    tools: ROLE_TOOLS.researcher,
    systemPrompt: ROLE_PROMPTS.researcher,
  },
  coder: {
    role: "coder",
    displayName: "💻 مبرمج / Coder",
    description: "يكتب ويعدّل الكود / Writes and edits code",
    tools: ROLE_TOOLS.coder,
    systemPrompt: ROLE_PROMPTS.coder,
  },
  // Debugger = generalist role with debugger-specific prompt
  generalist: {
    role: "generalist",
    displayName: "🐛 منقّح / Debugger",
    description: "يبحث عن الأخطاء ويصلحها / Finds and fixes bugs",
    tools: ["read_file", "find_symbol", "get_references", "edit_file", "run_terminal_command"],
    systemPrompt: `You are a Debugger agent. Your job is to:
1. Reproduce the bug (read the error, find the failing code)
2. Identify the root cause (not just the symptom)
3. Fix the code (minimal change, no side effects)
4. Verify the fix (run the test or reproduce again)
Use read_file + find_symbol + get_references to navigate. Use edit_file to fix. Use run_terminal_command to verify.`,
  },
  tester: {
    role: "tester",
    displayName: "🧪 مختبر / Tester",
    description: "يكتب ويشغل الاختبارات / Writes and runs tests",
    tools: ROLE_TOOLS.tester,
    systemPrompt: ROLE_PROMPTS.tester,
  },
  // Reviewer = analyst role with review-specific prompt
  analyst: {
    role: "analyst",
    displayName: "👀 مراجع / Reviewer",
    description: "يراجع الكود، يفحص الجودة / Code review, quality check",
    tools: ["read_file", "find_symbol", "get_references", "structural_search"],
    systemPrompt: `You are a Code Reviewer agent. Your job is to:
1. Read the code carefully (check for bugs, style, performance, security)
2. Identify issues (categorize: critical/major/minor/suggestion)
3. Suggest improvements (specific, actionable, with code examples)
4. Approve or request changes
Be constructive — point out what's good AND what needs work.`,
  },
  architect: {
    role: "architect",
    displayName: "🏛️ مهندس / Architect",
    description: "يصمم، يخطط، يحدد البنية / Designs, plans, structures",
    tools: ROLE_TOOLS.architect,
    systemPrompt: ROLE_PROMPTS.architect,
  },
  security_analyst: {
    role: "security_analyst",
    displayName: "🔒 أمن / Security",
    description: "تدقيق أمني، ثغرات / Security audit, vulnerabilities",
    tools: ROLE_TOOLS.security_analyst,
    systemPrompt: ROLE_PROMPTS.security_analyst,
  },
  writer: {
    role: "writer",
    displayName: "✍️ كاتب / Writer",
    description: "يكتب التوثيق والمحتوى / Writes documentation and content",
    tools: ROLE_TOOLS.writer,
    systemPrompt: ROLE_PROMPTS.writer,
  },
  refactorer: {
    role: "refactorer",
    displayName: "🔄 معيد بناء / Refactorer",
    description: "يعيد هيكلة الكود / Refactors code",
    tools: ROLE_TOOLS.refactorer,
    systemPrompt: ROLE_PROMPTS.refactorer,
  },
  electrical_engineer: {
    role: "electrical_engineer",
    displayName: "⚡ مهندس كهرباء / EE",
    description: "أنظمة مدمجة / Embedded systems",
    tools: ROLE_TOOLS.electrical_engineer,
    systemPrompt: ROLE_PROMPTS.electrical_engineer,
  },
  fact_checker: {
    role: "fact_checker",
    displayName: "✓ مدقق / Fact Checker",
    description: "يتحقق من الحقائق / Verifies facts",
    tools: ROLE_TOOLS.fact_checker,
    systemPrompt: ROLE_PROMPTS.fact_checker,
  },
  bias_auditor: {
    role: "bias_auditor",
    displayName: "⚖️ مدقق تحيز / Bias Auditor",
    description: "يفحص التحيز / Audits bias",
    tools: ROLE_TOOLS.bias_auditor,
    systemPrompt: ROLE_PROMPTS.bias_auditor,
  },
  device_controller: {
    role: "device_controller",
    displayName: "🎮 متحكم / Device Controller",
    description: "يتحكم بالأجهزة / Controls devices",
    tools: ROLE_TOOLS.device_controller,
    systemPrompt: ROLE_PROMPTS.device_controller,
  },
}

// ---------------------------------------------------------------------------
// Team Plan — break a task into role-assigned subtasks
// ---------------------------------------------------------------------------

export interface TeamPlanInput {
  task: string
  /** Max subtasks (default 4 — keep it small for i7-3770) */
  maxSubtasks?: number
  /** Preferred roles (if known) */
  preferredRoles?: MiMoRole[]
}

export function teamPlan(input: TeamPlanInput): TeamResult2<SwarmPlan> {
  try {
    if (!input.task || !input.task.trim()) {
      return { ok: false, error: "no_task", message: "❌ لا مهمة / no task provided" }
    }
    const maxSubtasks = input.maxSubtasks ?? 4
    // Deterministic planning: analyze the task keywords + assign roles
    const task = input.task.toLowerCase()
    const subtasks: Subtask[] = []
    let stepIdx = 1

    // 1. If task mentions "design", "architecture", "plan", "structure" → Architect
    if (/\b(design|architect|plan|structur|تصميم|تخطيط|بنية|هيكل)\b/i.test(task)) {
      subtasks.push({
        id: `s${stepIdx++}`,
        description: `صمم بنية/خطة للمهمة: ${input.task.slice(0, 200)}`,
        role: "architect",
      })
    }

    // 2. If task mentions "research", "find", "investigate", "understand" → Researcher
    if (/\b(research|investigat|find|understand|explor|بحث|استكشاف|فهم)\b/i.test(task)) {
      subtasks.push({
        id: `s${stepIdx++}`,
        description: `ابحث واجمع معلومات: ${input.task.slice(0, 200)}`,
        role: "researcher",
      })
    }

    // 3. If task mentions "code", "write", "implement", "build", "create" → Coder
    if (/\b(code|write|implement|build|creat|develop|كود|اكتب|برمج|أنشئ|طور)\b/i.test(task)) {
      subtasks.push({
        id: `s${stepIdx++}`,
        description: `اكتب الكود: ${input.task.slice(0, 200)}`,
        role: "coder",
      })
    }

    // 4. If task mentions "test", "verify", "check" → Tester
    if (/\b(test|verify|check|validate|اختبر|تحقق|فحص)\b/i.test(task)) {
      subtasks.push({
        id: `s${stepIdx++}`,
        description: `اكتب وشغل اختبارات: ${input.task.slice(0, 200)}`,
        role: "tester",
      })
    }

    // 5. If task mentions "debug", "fix", "error", "bug", "crash" → Debugger
    if (/\b(debug|fix|error|bug|crash|broken|منقّح|خطأ|خلل|إصلاح)\b/i.test(task)) {
      subtasks.push({
        id: `s${stepIdx++}`,
        description: `ابحث عن الخطأ وأصلحه: ${input.task.slice(0, 200)}`,
        role: "generalist", // mapped to debugger role
      })
    }

    // 6. If task mentions "review", "audit", "quality" → Reviewer
    if (/\b(review|audit|quality|refactor|مراجع|تدقيق|جودة)\b/i.test(task)) {
      subtasks.push({
        id: `s${stepIdx++}`,
        description: `راجع الكود واقترح تحسينات: ${input.task.slice(0, 200)}`,
        role: "analyst", // mapped to reviewer role
      })
    }

    // 7. If task mentions "security", "vulnerable", "CVE" → Security
    if (/\b(secur|vulnerab|cve|exploit|أمن|ثغرة)\b/i.test(task)) {
      subtasks.push({
        id: `s${stepIdx++}`,
        description: `تدقيق أمني: ${input.task.slice(0, 200)}`,
        role: "security_analyst",
      })
    }

    // Fallback: if no roles matched, use generalist
    if (subtasks.length === 0) {
      subtasks.push({
        id: "s1",
        description: input.task,
        role: "generalist",
      })
    }

    // Cap at maxSubtasks
    const plan: SwarmPlan = {
      taskId: `team_${Date.now()}`,
      task: input.task,
      subtasks: subtasks.slice(0, maxSubtasks),
    }
    return { ok: true, data: plan }
  } catch (e) {
    return {
      ok: false,
      error: "plan_failed",
      message: `❌ فشل التخطيط / plan failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Team Route — pick the best single role for a task
// ---------------------------------------------------------------------------

export function teamRoute(task: string): TeamResult2<TeamRouteResult> {
  try {
    if (!task || !task.trim()) {
      return { ok: false, error: "no_task", message: "❌ لا مهمة / no task" }
    }
    const role = matchRole(task)
    const member = CORE_TEAM[role] ?? CORE_TEAM.generalist
    if (!member) {
      return { ok: false, error: "no_member", message: `❌ لا يوجد عضو للدور / no member for role: ${role}` }
    }
    const reasons: Record<string, string> = {
      researcher: "المهمة تتطلب جمع معلومات / task requires information gathering",
      coder: "المهمة تتطلب كتابة كود / task requires code writing",
      architect: "المهمة تتطلب تصميم/تخطيط / task requires design/planning",
      tester: "المهمة تتطلب اختبارات / task requires testing",
      security_analyst: "المهمة تتطلب تدقيق أمني / task requires security audit",
      generalist: "مهمة عامة / general task",
      analyst: "المهمة تتطلب تحليل / task requires analysis",
    }
    return {
      ok: true,
      data: {
        role,
        member,
        reason: reasons[role] ?? "تم اختيار الدور بناءً على الكلمات المفتاحية / role selected based on keywords",
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "route_failed",
      message: `❌ فشل التوجيه / route failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Team Run — execute subtasks sequentially (same model, different prompts)
// ---------------------------------------------------------------------------

export interface TeamRunInput {
  plan: SwarmPlan
  /** Function to call the LLM with a role's system prompt + message */
  callLLM: (systemPrompt: string, userMessage: string, tools: string[]) => Promise<string>
  /** Optional callback for progress updates */
  onProgress?: (step: number, total: number, role: MiMoRole, status: string) => void
}

export async function teamRun(input: TeamRunInput): Promise<TeamResult2<TeamResult>> {
  const startTotal = Date.now()
  try {
    if (!input.plan || !input.plan.subtasks || input.plan.subtasks.length === 0) {
      return { ok: false, error: "no_plan", message: "❌ لا خطة / no plan or subtasks" }
    }
    const executions: TeamResult["executions"] = []
    let context = input.plan.task // initial context = the original task

    for (let i = 0; i < input.plan.subtasks.length; i++) {
      const subtask = input.plan.subtasks[i]
      const member = CORE_TEAM[subtask.role] ?? CORE_TEAM.generalist
      if (!member) continue
      const stepStart = Date.now()

      // Report progress
      input.onProgress?.(i + 1, input.plan.subtasks.length, subtask.role, "running")

      // Build the message: original task + context from previous steps
      const message = `المهمة الأصلية / Original task: ${input.plan.task}

الخطوة الفرعية / Subtask (${i + 1}/${input.plan.subtasks.length}):
${subtask.description}

${i > 0 ? `السياق من الخطوات السابقة / Context from previous steps:\n${context.slice(0, 3000)}\n` : ""}

نفّذ هذه الخطوة الفرعية. / Execute this subtask.`

      // Call LLM with the role's system prompt
      let output = ""
      let status: "success" | "failed" = "success"
      let error: string | undefined

      try {
        output = await input.callLLM(member.systemPrompt, message, member.tools)
      } catch (e) {
        status = "failed"
        error = e instanceof Error ? e.message : String(e)
        output = `❌ فشل: ${error}`
      }

      const durationMs = Date.now() - stepStart

      executions.push({
        subtask,
        role: subtask.role,
        status,
        input: message.slice(0, 500),
        output,
        durationMs,
        error,
      })

      // Pass output as context to next step
      context = output

      // Report progress
      input.onProgress?.(i + 1, input.plan.subtasks.length, subtask.role, status)

      // If a step failed, continue anyway (don't break — other roles might still help)
    }

    // Compose final output = last step's output (or synthesis of all)
    const finalOutput = executions.length > 0
      ? executions[executions.length - 1].output
      : ""

    const success = executions.every(e => e.status === "success")

    return {
      ok: true,
      data: {
        plan: input.plan,
        executions,
        finalOutput,
        totalDurationMs: Date.now() - startTotal,
        success,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "run_failed",
      message: `❌ فشل تنفيذ الفريق / team run failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Team Compose — combine outputs from multiple roles into one
// ---------------------------------------------------------------------------

export function teamCompose(outputs: Array<{ role: MiMoRole; output: string }>): string {
  if (outputs.length === 0) return ""
  if (outputs.length === 1) return outputs[0].output

  let composed = "# نتائج الفريق / Team Results\n\n"
  for (const { role, output } of outputs) {
    const member = CORE_TEAM[role]
    composed += `## ${member?.displayName ?? role}\n\n${output}\n\n---\n\n`
  }
  return composed
}

// ---------------------------------------------------------------------------
// List available team members
// ---------------------------------------------------------------------------

export function teamList(): TeamMember[] {
  return Object.values(CORE_TEAM)
}

export function teamGet(role: MiMoRole): TeamMember | null {
  return CORE_TEAM[role] ?? null
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface TeamSnapshot {
  totalRoles: number
  roles: Array<{ role: MiMoRole; displayName: string; toolCount: number }>
}

export function teamSnapshot(): TeamSnapshot {
  return {
    totalRoles: Object.keys(CORE_TEAM).length,
    roles: Object.entries(CORE_TEAM).map(([role, member]) => ({
      role: role as MiMoRole,
      displayName: member.displayName,
      toolCount: member.tools.length,
    })),
  }
}
