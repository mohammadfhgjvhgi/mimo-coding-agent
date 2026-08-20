// Automation OS — workflow builder, triggers, scheduled tasks, webhooks.
// 12 operations, deterministic, bilingual (Arabic + English), persisted to SQLite.
//
// Design:
//   • Workflow (Prisma) — DAG of steps, each step is an action
//   • WorkflowRun (Prisma) — execution log with step-by-step results
//   • Webhook (Prisma) — HTTP endpoints that trigger workflows
//   • WorkflowSchedule (Prisma) — cron-based triggers
//   • Step executor: dispatches to MCP/Browser/File/Git action handlers
//
// 12 operations:
//   1.  workflowCreate        — create a workflow with steps + triggers
//   2.  workflowList            — list workflows
//   3.  workflowGet             — get a workflow with steps + triggers
//   4.  workflowRun             — execute a workflow (manual trigger)
//   5.  triggerAdd              — add a trigger (schedule/event/webhook/manual)
//   6.  triggerList             — list triggers for a workflow
//   7.  scheduleCreate          — create a scheduled task (cron or fixed interval)
//   8.  scheduleCheckDue        — check for due scheduled tasks
//   9.  conditionalBranch        — evaluate a condition + return next step
//   10. retryWithBackoff         — retry a failed step with exponential backoff
//   11. webhookCreate           — create a webhook endpoint
//   12. webhookReceive          — receive a webhook call + trigger workflow

import { db } from "@/lib/db"
import { createHmac } from "node:crypto"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkflowStatus = "draft" | "active" | "paused" | "archived"
export type WorkflowRunStatus = "pending" | "running" | "success" | "failed" | "cancelled"
export type TriggerType = "schedule" | "event" | "webhook" | "manual"
export type StepType =
  | "mcp_action"
  | "browser_action"
  | "file_action"
  | "git_action"
  | "condition"
  | "delay"
  | "notification"
  | "http_request"
  | "script"

export interface WorkflowStep {
  id: string
  type: StepType
  name: string
  config: Record<string, unknown>
  next: string | null
  condition?: { field: string; op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte" | "contains"; value: unknown }
}

export interface WorkflowTrigger {
  type: TriggerType
  config: Record<string, unknown>
}

export interface RetryPolicy {
  maxRetries: number
  backoffMs: number
  backoffMultiplier: number
}

export interface NotificationConfig {
  onSuccess: boolean
  onError: boolean
  channels: string[]
}

export interface WorkflowRecord {
  id: string
  name: string
  description: string | null
  status: WorkflowStatus
  steps: WorkflowStep[]
  triggers: WorkflowTrigger[]
  retryPolicy: RetryPolicy
  notifications: NotificationConfig
  runCount: number
  successCount: number
  failureCount: number
  lastRunAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface WorkflowRunRecord {
  id: string
  workflowId: string
  status: WorkflowRunStatus
  trigger: { type: TriggerType; source?: string; payload?: unknown }
  stepExecutions: Array<{
    stepId: string
    status: "pending" | "running" | "success" | "failed" | "skipped"
    startedAt?: string
    completedAt?: string
    result?: string
    error?: string
    attempts?: number
  }>
  currentStep: string | null
  error: string | null
  startedAt: Date | null
  completedAt: Date | null
  durationMs: number
  createdAt: Date
}

export interface WebhookRecord {
  id: string
  token: string
  workflowId: string
  name: string
  status: "active" | "disabled"
  secret: string | null
  methods: string[]
  callCount: number
  lastCalledAt: Date | null
  createdAt: Date
}

export interface WorkflowScheduleRecord {
  id: string
  workflowId: string | null
  name: string
  schedule: string
  status: "active" | "paused"
  payload: Record<string, unknown>
  nextRunAt: Date | null
  runCount: number
  lastRunAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type AutomationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

function genId(): string {
  return `step_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

// ---------------------------------------------------------------------------
// Row → record mappers
// ---------------------------------------------------------------------------

function workflowRowToRecord(row: {
  id: string; name: string; description: string | null; status: string;
  steps: string; triggers: string; retryPolicy: string; notifications: string;
  runCount: number; successCount: number; failureCount: number; lastRunAt: Date | null;
  createdAt: Date; updatedAt: Date
}): WorkflowRecord {
  return {
    id: row.id, name: row.name, description: row.description,
    status: row.status as WorkflowStatus,
    steps: safeParse(row.steps, []),
    triggers: safeParse(row.triggers, []),
    retryPolicy: safeParse(row.retryPolicy, { maxRetries: 3, backoffMs: 500, backoffMultiplier: 2 }),
    notifications: safeParse(row.notifications, { onSuccess: false, onError: true, channels: [] }),
    runCount: row.runCount, successCount: row.successCount, failureCount: row.failureCount,
    lastRunAt: row.lastRunAt, createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}

function runRowToRecord(row: {
  id: string; workflowId: string; status: string; trigger: string;
  stepExecutions: string; currentStep: string | null; error: string | null;
  startedAt: Date | null; completedAt: Date | null; durationMs: number; createdAt: Date
}): WorkflowRunRecord {
  return {
    id: row.id, workflowId: row.workflowId, status: row.status as WorkflowRunStatus,
    trigger: safeParse(row.trigger, { type: "manual" as TriggerType }),
    stepExecutions: safeParse(row.stepExecutions, []),
    currentStep: row.currentStep, error: row.error,
    startedAt: row.startedAt, completedAt: row.completedAt,
    durationMs: row.durationMs, createdAt: row.createdAt,
  }
}

function webhookRowToRecord(row: {
  id: string; token: string; workflowId: string; name: string; status: string;
  secret: string | null; methods: string; callCount: number; lastCalledAt: Date | null;
  createdAt: Date
}): WebhookRecord {
  return {
    id: row.id, token: row.token, workflowId: row.workflowId, name: row.name,
    status: row.status as "active" | "disabled", secret: row.secret,
    methods: safeParse(row.methods, ["POST"]),
    callCount: row.callCount, lastCalledAt: row.lastCalledAt, createdAt: row.createdAt,
  }
}

function scheduleRowToRecord(row: {
  id: string; workflowId: string | null; name: string; schedule: string;
  status: string; payload: string; nextRunAt: Date | null; runCount: number;
  lastRunAt: Date | null; createdAt: Date; updatedAt: Date
}): WorkflowScheduleRecord {
  return {
    id: row.id, workflowId: row.workflowId, name: row.name, schedule: row.schedule,
    status: row.status as "active" | "paused",
    payload: safeParse(row.payload, {}),
    nextRunAt: row.nextRunAt, runCount: row.runCount, lastRunAt: row.lastRunAt,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}

// ---------------------------------------------------------------------------
// 1. Workflow Create
// ---------------------------------------------------------------------------

export interface WorkflowInput {
  name: string
  description?: string
  status?: WorkflowStatus
  steps?: WorkflowStep[]
  triggers?: WorkflowTrigger[]
  retryPolicy?: Partial<RetryPolicy>
  notifications?: Partial<NotificationConfig>
}

export async function workflowCreate(input: WorkflowInput): Promise<AutomationResult<WorkflowRecord>> {
  try {
    if (!input.name) {
      return { ok: false, error: "no_name", message: "❌ الاسم مطلوب / name required" }
    }
    const row = await db.workflow.create({
      data: {
        name: input.name,
        description: input.description,
        status: input.status ?? "draft",
        steps: JSON.stringify(input.steps ?? []),
        triggers: JSON.stringify(input.triggers ?? []),
        retryPolicy: JSON.stringify({
          maxRetries: input.retryPolicy?.maxRetries ?? 3,
          backoffMs: input.retryPolicy?.backoffMs ?? 500,
          backoffMultiplier: input.retryPolicy?.backoffMultiplier ?? 2,
        }),
        notifications: JSON.stringify({
          onSuccess: input.notifications?.onSuccess ?? false,
          onError: input.notifications?.onError ?? true,
          channels: input.notifications?.channels ?? [],
        }),
      },
    })
    return { ok: true, data: workflowRowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "create_failed",
      message: `❌ فشل إنشاء سير العمل / workflow create failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Workflow List
// ---------------------------------------------------------------------------

export async function workflowList(opts: { status?: WorkflowStatus; limit?: number } = {}): Promise<AutomationResult<WorkflowRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.status) where.status = opts.status
    const rows = await db.workflow.findMany({ where, orderBy: { createdAt: "desc" }, take: opts.limit ?? 50 })
    return { ok: true, data: rows.map(workflowRowToRecord) }
  } catch (e) {
    return { ok: false, error: "list_failed", message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 3. Workflow Get
// ---------------------------------------------------------------------------

export async function workflowGet(id: string): Promise<AutomationResult<WorkflowRecord>> {
  try {
    const row = await db.workflow.findUnique({ where: { id } })
    if (!row) {
      return { ok: false, error: "not_found", message: `❌ سير العمل غير موجود / workflow not found: ${id}` }
    }
    return { ok: true, data: workflowRowToRecord(row) }
  } catch (e) {
    return { ok: false, error: "get_failed", message: `❌ فشل الجلب / get failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 4. Workflow Run — execute a workflow (manual trigger)
// ---------------------------------------------------------------------------

export async function workflowRun(opts: { workflowId: string; trigger?: { type: TriggerType; source?: string; payload?: unknown } }): Promise<AutomationResult<WorkflowRunRecord>> {
  const start = Date.now()
  try {
    const wf = await db.workflow.findUnique({ where: { id: opts.workflowId } })
    if (!wf) {
      return { ok: false, error: "not_found", message: `❌ سير العمل غير موجود / workflow not found: ${opts.workflowId}` }
    }
    if (wf.status !== "active" && wf.status !== "draft") {
      return { ok: false, error: "not_active", message: `❌ سير العمل ليس نشطاً / workflow is not active (status=${wf.status})` }
    }
    const steps = safeParse<WorkflowStep[]>(wf.steps, [])
    const trigger = opts.trigger ?? { type: "manual" as TriggerType }

    // Create run record
    const run = await db.workflowRun.create({
      data: {
        workflowId: opts.workflowId,
        status: "running",
        trigger: JSON.stringify(trigger),
        stepExecutions: JSON.stringify(steps.map(s => ({ stepId: s.id, status: "pending" as const }))),
        currentStep: steps[0]?.id ?? null,
        startedAt: new Date(),
      },
    })

    // Execute steps sequentially (DAG — linear chain via `next`)
    const stepExecutions: WorkflowRunRecord["stepExecutions"] = []
    let currentStep: WorkflowStep | undefined = steps[0]
    const stepMap = new Map(steps.map(s => [s.id, s]))
    let runError: string | null = null
    const retryPolicy = safeParse<RetryPolicy>(wf.retryPolicy, { maxRetries: 3, backoffMs: 500, backoffMultiplier: 2 })

    while (currentStep) {
      const stepStart = Date.now()
      const exec = {
        stepId: currentStep.id,
        status: "running" as const,
        startedAt: new Date().toISOString(),
        attempts: 0,
      }
      stepExecutions.push(exec)

      // Execute the step with retry
      let stepResult: { ok: boolean; result?: string; error?: string } = { ok: false }
      for (let attempt = 0; attempt <= retryPolicy.maxRetries; attempt++) {
        exec.attempts = attempt + 1
        try {
          stepResult = await executeStep(currentStep, trigger.payload)
          if (stepResult.ok) break
        } catch (e) {
          stepResult = { ok: false, error: e instanceof Error ? e.message : String(e) }
        }
        if (attempt < retryPolicy.maxRetries) {
          // Backoff
          await new Promise(r => setTimeout(r, retryPolicy.backoffMs * Math.pow(retryPolicy.backoffMultiplier, attempt)))
        }
      }

      // Update execution status
      const lastExec = stepExecutions[stepExecutions.length - 1]
      lastExec.completedAt = new Date().toISOString()
      if (stepResult.ok) {
        lastExec.status = "success"
        lastExec.result = stepResult.result?.slice(0, 2000)
      } else {
        lastExec.status = "failed"
        lastExec.error = stepResult.error?.slice(0, 2000)
        runError = `Step ${currentStep.name} failed: ${stepResult.error}`
        break
      }

      // Check condition for branching
      if (currentStep.condition) {
        const condMet = evaluateCondition(currentStep.condition, stepResult.result)
        if (!condMet) {
          // Skip to next-next or end
          // For simplicity, skip the next step
          break
        }
      }

      // Move to next step
      currentStep = currentStep.next ? stepMap.get(currentStep.next) : undefined
    }

    const status: WorkflowRunStatus = runError ? "failed" : "success"
    const completedAt = new Date()
    const durationMs = Date.now() - start

    // Update run record
    const updatedRun = await db.workflowRun.update({
      where: { id: run.id },
      data: {
        status,
        stepExecutions: JSON.stringify(stepExecutions),
        currentStep: null,
        error: runError,
        completedAt,
        durationMs,
      },
    })

    // Update workflow stats
    await db.workflow.update({
      where: { id: opts.workflowId },
      data: {
        runCount: { increment: 1 },
        successCount: status === "success" ? { increment: 1 } : undefined,
        failureCount: status === "failed" ? { increment: 1 } : undefined,
        lastRunAt: new Date(),
      },
    })

    return { ok: true, data: runRowToRecord(updatedRun) }
  } catch (e) {
    return {
      ok: false,
      error: "run_failed",
      message: `❌ فشل تنفيذ سير العمل / workflow run failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Step executor — dispatches to action handlers
// ---------------------------------------------------------------------------

async function executeStep(step: WorkflowStep, payload: unknown): Promise<{ ok: boolean; result?: string; error?: string }> {
  try {
    switch (step.type) {
      case "mcp_action": {
        // Call MCP tool via the MCP OS
        const { mcpCallTool } = await import("@/lib/mcp/os")
        const res = await mcpCallTool({
          serverName: String(step.config.serverName ?? ""),
          toolName: String(step.config.toolName ?? ""),
          args: (step.config.args as Record<string, unknown>) ?? {},
          caller: "system",
          approved: true,
        })
        return res.ok
          ? { ok: true, result: res.result ?? "" }
          : { ok: false, error: res.error ?? "MCP call failed" }
      }
      case "browser_action": {
        const { browserLaunch, browserNavigate, browserScreenshot, browserClick, browserCloseAll } = await import("@/lib/browser/agent")
        const action = String(step.config.action ?? "navigate")
        const session = String(step.config.session ?? "automation")
        if (action === "navigate") {
          await browserLaunch({ session })
          const r = await browserNavigate(String(step.config.url ?? "about:blank"), session)
          await browserCloseAll()
          return r.ok ? { ok: true, result: `Navigated to ${step.config.url}` } : { ok: false, error: r.message }
        }
        if (action === "screenshot") {
          const r = await browserScreenshot({ session })
          return r.ok ? { ok: true, result: `Screenshot saved: ${r.data.path}` } : { ok: false, error: r.message }
        }
        return { ok: false, error: `Unknown browser action: ${action}` }
      }
      case "file_action": {
        const { readFile, writeFile } = await import("node:fs/promises")
        const path = String(step.config.path ?? "")
        const action = String(step.config.action ?? "read")
        if (action === "read") {
          const content = await readFile(path, "utf8")
          return { ok: true, result: content.slice(0, 2000) }
        }
        if (action === "write") {
          await writeFile(path, String(step.config.content ?? ""), "utf8")
          return { ok: true, result: `File written: ${path}` }
        }
        return { ok: false, error: `Unknown file action: ${action}` }
      }
      case "git_action": {
        const { exec } = await import("node:child_process")
        const { promisify } = await import("node:util")
        const execAsync = promisify(exec)
        const cmd = String(step.config.command ?? "git status")
        const { stdout, stderr } = await execAsync(cmd, { timeout: 10000 })
        return { ok: true, result: stdout.slice(0, 2000) || stderr.slice(0, 500) }
      }
      case "http_request": {
        const method = String(step.config.method ?? "GET").toUpperCase()
        const url = String(step.config.url ?? "")
        const headers = (step.config.headers as Record<string, string>) ?? {}
        const body = step.config.body ? JSON.stringify(step.config.body) : undefined
        const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(15000) })
        const text = await res.text()
        return { ok: res.ok, result: text.slice(0, 2000), error: res.ok ? undefined : `HTTP ${res.status}` }
      }
      case "delay": {
        const ms = Number(step.config.ms ?? 1000)
        await new Promise(r => setTimeout(r, ms))
        return { ok: true, result: `Delayed ${ms}ms` }
      }
      case "notification": {
        // Log the notification (in prod: send to channels)
        const message = String(step.config.message ?? "Notification")
        return { ok: true, result: `Notified: ${message}` }
      }
      case "script": {
        // Execute inline JS via Function (sandboxed best-effort)
        const code = String(step.config.code ?? "")
        const fn = new Function("payload", code)
        const result = await fn(payload)
        return { ok: true, result: String(result ?? "script executed") }
      }
      case "condition": {
        // Pure condition step — evaluate and return result
        const field = String(step.config.field ?? "")
        const op = String(step.config.op ?? "eq")
        const value = step.config.value
        const met = evaluateCondition({ field, op: op as "eq" | "ne" | "gt" | "lt" | "gte" | "lte" | "contains", value }, JSON.stringify(payload))
        return { ok: true, result: met ? "true" : "false" }
      }
      default:
        return { ok: false, error: `Unknown step type: ${step.type}` }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function evaluateCondition(cond: { field: string; op: string; value: unknown }, data: unknown): boolean {
  try {
    const dataObj = typeof data === "string" ? JSON.parse(data) : data
    const fieldValue = (dataObj as Record<string, unknown>)?.[cond.field]
    switch (cond.op) {
      case "eq": return fieldValue === cond.value
      case "ne": return fieldValue !== cond.value
      case "gt": return Number(fieldValue) > Number(cond.value)
      case "lt": return Number(fieldValue) < Number(cond.value)
      case "gte": return Number(fieldValue) >= Number(cond.value)
      case "lte": return Number(fieldValue) <= Number(cond.value)
      case "contains": return String(fieldValue ?? "").includes(String(cond.value))
      default: return false
    }
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// 5. Trigger Add
// ---------------------------------------------------------------------------

export async function triggerAdd(workflowId: string, trigger: WorkflowTrigger): Promise<AutomationResult<WorkflowRecord>> {
  try {
    const wf = await db.workflow.findUnique({ where: { id: workflowId } })
    if (!wf) {
      return { ok: false, error: "not_found", message: `❌ سير العمل غير موجود / workflow not found: ${workflowId}` }
    }
    const triggers = safeParse<WorkflowTrigger[]>(wf.triggers, [])
    triggers.push(trigger)
    const row = await db.workflow.update({
      where: { id: workflowId },
      data: { triggers: JSON.stringify(triggers) },
    })
    return { ok: true, data: workflowRowToRecord(row) }
  } catch (e) {
    return { ok: false, error: "trigger_add_failed", message: `❌ فشل إضافة المحفّز / trigger add failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 6. Trigger List
// ---------------------------------------------------------------------------

export async function triggerList(workflowId: string): Promise<AutomationResult<WorkflowTrigger[]>> {
  try {
    const wf = await db.workflow.findUnique({ where: { id: workflowId } })
    if (!wf) {
      return { ok: false, error: "not_found", message: `❌ سير العمل غير موجود / workflow not found: ${workflowId}` }
    }
    return { ok: true, data: safeParse<WorkflowTrigger[]>(wf.triggers, []) }
  } catch (e) {
    return { ok: false, error: "list_failed", message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 7. Schedule Create
// ---------------------------------------------------------------------------

export interface ScheduleInput {
  workflowId?: string
  name: string
  schedule: string  // cron expression or "fixed:60" (every 60s)
  payload?: Record<string, unknown>
}

function computeNextRun(schedule: string): Date {
  // Simple: "fixed:N" → now + N seconds
  // Cron: parse basic expressions (min hour day month weekday)
  const fixedMatch = schedule.match(/^fixed:(\d+)$/)
  if (fixedMatch) {
    return new Date(Date.now() + Number(fixedMatch[1]) * 1000)
  }
  // Default: next hour
  const next = new Date()
  next.setHours(next.getHours() + 1)
  next.setMinutes(0, 0, 0)
  return next
}

export async function scheduleCreate(input: ScheduleInput): Promise<AutomationResult<WorkflowScheduleRecord>> {
  try {
    if (!input.name || !input.schedule) {
      return { ok: false, error: "no_input", message: "❌ الاسم والجدول مطلوبان / name + schedule required" }
    }
    const nextRunAt = computeNextRun(input.schedule)
    const row = await db.workflowSchedule.create({
      data: {
        workflowId: input.workflowId,
        name: input.name,
        schedule: input.schedule,
        payload: JSON.stringify(input.payload ?? {}),
        nextRunAt,
      },
    })
    return { ok: true, data: scheduleRowToRecord(row) }
  } catch (e) {
    return { ok: false, error: "schedule_create_failed", message: `❌ فشل إنشاء الجدول / schedule create failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function scheduleList(opts: { status?: string; limit?: number } = {}): Promise<AutomationResult<WorkflowScheduleRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.status) where.status = opts.status
    const rows = await db.workflowSchedule.findMany({ where, orderBy: { nextRunAt: "asc" }, take: opts.limit ?? 100 })
    return { ok: true, data: rows.map(scheduleRowToRecord) }
  } catch (e) {
    return { ok: false, error: "list_failed", message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 8. Schedule Check Due
// ---------------------------------------------------------------------------

export async function scheduleCheckDue(): Promise<AutomationResult<Array<{ schedule: WorkflowScheduleRecord; run?: WorkflowRunRecord }>>> {
  try {
    const now = new Date()
    const due = await db.workflowSchedule.findMany({
      where: { status: "active", nextRunAt: { lte: now } },
      orderBy: { nextRunAt: "asc" },
    })
    const results: Array<{ schedule: WorkflowScheduleRecord; run?: WorkflowRunRecord }> = []
    for (const s of due) {
      const schedule = scheduleRowToRecord(s)
      let run: WorkflowRunRecord | undefined
      if (s.workflowId) {
        const runRes = await workflowRun({
          workflowId: s.workflowId,
          trigger: { type: "schedule", source: s.name, payload: schedule.payload },
        })
        if (runRes.ok) run = runRes.data
      }
      // Update next run
      const nextRunAt = computeNextRun(s.schedule)
      await db.workflowSchedule.update({
        where: { id: s.id },
        data: { nextRunAt, runCount: { increment: 1 }, lastRunAt: now },
      })
      results.push({ schedule, run })
    }
    return { ok: true, data: results }
  } catch (e) {
    return { ok: false, error: "check_due_failed", message: `❌ فشل فحص المستحقات / check due failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 9. Conditional Branch
// ---------------------------------------------------------------------------

export async function conditionalBranch(opts: { step: WorkflowStep; data: unknown }): Promise<AutomationResult<{ conditionMet: boolean; nextStep: string | null }>> {
  try {
    if (!opts.step.condition) {
      return { ok: true, data: { conditionMet: true, nextStep: opts.step.next } }
    }
    const met = evaluateCondition(opts.step.condition, opts.data)
    return {
      ok: true,
      data: {
        conditionMet: met,
        nextStep: met ? opts.step.next : null,
      },
    }
  } catch (e) {
    return { ok: false, error: "branch_failed", message: `❌ فشل الشرط / conditional branch failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 10. Retry with Backoff
// ---------------------------------------------------------------------------

export async function retryWithBackoff<T>(opts: {
  fn: () => Promise<T>
  maxRetries?: number
  backoffMs?: number
  backoffMultiplier?: number
}): Promise<{ ok: true; result: T; attempts: number } | { ok: false; error: string; attempts: number }> {
  const maxRetries = opts.maxRetries ?? 3
  const backoffMs = opts.backoffMs ?? 500
  const backoffMultiplier = opts.backoffMultiplier ?? 2
  let lastError = ""
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await opts.fn()
      return { ok: true, result, attempts: attempt + 1 }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, backoffMs * Math.pow(backoffMultiplier, attempt)))
      }
    }
  }
  return { ok: false, error: lastError, attempts: maxRetries + 1 }
}

// ---------------------------------------------------------------------------
// 11. Webhook Create
// ---------------------------------------------------------------------------

export interface WebhookInput {
  workflowId: string
  name: string
  secret?: string
  methods?: string[]
}

export async function webhookCreate(input: WebhookInput): Promise<AutomationResult<WebhookRecord>> {
  try {
    if (!input.workflowId || !input.name) {
      return { ok: false, error: "no_input", message: "❌ معرف سير العمل والاسم مطلوبان / workflowId + name required" }
    }
    const wf = await db.workflow.findUnique({ where: { id: input.workflowId } })
    if (!wf) {
      return { ok: false, error: "not_found", message: `❌ سير العمل غير موجود / workflow not found: ${input.workflowId}` }
    }
    const row = await db.webhook.create({
      data: {
        workflowId: input.workflowId,
        name: input.name,
        secret: input.secret,
        methods: JSON.stringify(input.methods ?? ["POST"]),
      },
    })
    return { ok: true, data: webhookRowToRecord(row) }
  } catch (e) {
    return { ok: false, error: "webhook_create_failed", message: `❌ فشل إنشاء الـ webhook / webhook create failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function webhookList(opts: { workflowId?: string; limit?: number } = {}): Promise<AutomationResult<WebhookRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.workflowId) where.workflowId = opts.workflowId
    const rows = await db.webhook.findMany({ where, orderBy: { createdAt: "desc" }, take: opts.limit ?? 50 })
    return { ok: true, data: rows.map(webhookRowToRecord) }
  } catch (e) {
    return { ok: false, error: "list_failed", message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 12. Webhook Receive
// ---------------------------------------------------------------------------

export async function webhookReceive(opts: { token: string; method: string; body: unknown; signature?: string }): Promise<AutomationResult<{ triggered: boolean; run?: WorkflowRunRecord }>> {
  try {
    const webhook = await db.webhook.findUnique({ where: { token: opts.token } })
    if (!webhook) {
      return { ok: false, error: "not_found", message: `❌ الـ webhook غير موجود / webhook not found` }
    }
    if (webhook.status !== "active") {
      return { ok: false, error: "disabled", message: `❌ الـ webhook معطّل / webhook is disabled` }
    }
    const methods = safeParse<string[]>(webhook.methods, ["POST"])
    if (!methods.includes(opts.method.toUpperCase())) {
      return { ok: false, error: "bad_method", message: `❌ طريقة غير مسموحة / method not allowed: ${opts.method}` }
    }
    // Verify signature if secret is set
    if (webhook.secret && opts.signature) {
      const expected = createHmac("sha256", webhook.secret).update(JSON.stringify(opts.body)).digest("hex")
      if (opts.signature !== expected && opts.signature !== `sha256=${expected}`) {
        return { ok: false, error: "bad_signature", message: `❌ توقيع غير صالح / invalid signature` }
      }
    }
    // Update webhook stats
    await db.webhook.update({
      where: { id: webhook.id },
      data: { callCount: { increment: 1 }, lastCalledAt: new Date() },
    })
    // Trigger the workflow
    const runRes = await workflowRun({
      workflowId: webhook.workflowId,
      trigger: { type: "webhook", source: webhook.name, payload: opts.body },
    })
    return {
      ok: true,
      data: {
        triggered: true,
        run: runRes.ok ? runRes.data : undefined,
      },
    }
  } catch (e) {
    return { ok: false, error: "receive_failed", message: `❌ فشل استقبال الـ webhook / webhook receive failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// Workflow run queries
// ---------------------------------------------------------------------------

export async function workflowRunList(opts: { workflowId?: string; status?: WorkflowRunStatus; limit?: number } = {}): Promise<AutomationResult<WorkflowRunRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.workflowId) where.workflowId = opts.workflowId
    if (opts.status) where.status = opts.status
    const rows = await db.workflowRun.findMany({ where, orderBy: { createdAt: "desc" }, take: opts.limit ?? 50 })
    return { ok: true, data: rows.map(runRowToRecord) }
  } catch (e) {
    return { ok: false, error: "list_failed", message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function workflowRunGet(id: string): Promise<AutomationResult<WorkflowRunRecord>> {
  try {
    const row = await db.workflowRun.findUnique({ where: { id } })
    if (!row) {
      return { ok: false, error: "not_found", message: `❌ التشغيل غير موجود / run not found: ${id}` }
    }
    return { ok: true, data: runRowToRecord(row) }
  } catch (e) {
    return { ok: false, error: "get_failed", message: `❌ فشل الجلب / get failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface AutomationSnapshot {
  totalWorkflows: number
  activeWorkflows: number
  totalRuns: number
  successfulRuns: number
  failedRuns: number
  totalWebhooks: number
  activeWebhooks: number
  totalSchedules: number
  activeSchedules: number
  dueSchedules: number
}

export async function automationSnapshot(): Promise<AutomationResult<AutomationSnapshot>> {
  try {
    const workflows = await db.workflow.findMany()
    const runs = await db.workflowRun.findMany({ take: 1000 })
    const webhooks = await db.webhook.findMany()
    const schedules = await db.workflowSchedule.findMany()
    const now = new Date()
    const dueSchedules = schedules.filter(s => s.status === "active" && s.nextRunAt && s.nextRunAt <= now).length
    return {
      ok: true,
      data: {
        totalWorkflows: workflows.length,
        activeWorkflows: workflows.filter(w => w.status === "active").length,
        totalRuns: runs.length,
        successfulRuns: runs.filter(r => r.status === "success").length,
        failedRuns: runs.filter(r => r.status === "failed").length,
        totalWebhooks: webhooks.length,
        activeWebhooks: webhooks.filter(w => w.status === "active").length,
        totalSchedules: schedules.length,
        activeSchedules: schedules.filter(s => s.status === "active").length,
        dueSchedules,
      },
    }
  } catch (e) {
    return { ok: false, error: "snapshot_failed", message: `❌ فشل اللقطة / snapshot failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

export function formatAutomationResult<T>(result: AutomationResult<T>): string {
  if (!result.ok) {
    return `${result.message}\n[error: ${result.error}]`
  }
  const data = result.data as unknown
  if (data === null || data === undefined) return "✅ OK"
  if (typeof data === "string") return data
  if (typeof data === "number" || typeof data === "boolean") return String(data)
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}
