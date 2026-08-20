// Autonomous Engineering — Task Queue + Long-Running Agent.
// 14 Task Queue operations + 6 Long-Running Agent operations.
// All deterministic — 0 LLM for queue management.

import { db } from "@/lib/db"

// ============ TASK QUEUE TYPES ============
export type TaskStatus = "pending" | "running" | "paused" | "done" | "failed" | "cancelled"
export type TaskPriority = "critical" | "high" | "medium" | "low"
export type TaskEscalation = "none" | "retry" | "human" | "abort"

export interface QueueTask {
  id: string
  goal: string
  status: TaskStatus
  priority: TaskPriority
  dependencies: string[]      // task IDs this depends on
  attempts: number
  maxAttempts: number
  cooldownUntil: number | null  // epoch ms — don't retry before this
  checkpointHash: string | null  // git checkpoint before this task
  agentState: string | null      // serialized conversation for resume
  currentStep: number
  totalSteps: number
  startedAt: number | null
  completedAt: number | null
  lastError: string | null
  escalation: TaskEscalation
  createdAt: number
  updatedAt: number
}

// ============ 1. TASK QUEUE ============
export async function enqueueTask(
  goal: string,
  options: {
    priority?: TaskPriority
    dependencies?: string[]
    maxAttempts?: number
  } = {}
): Promise<QueueTask> {
  const priority = options.priority || "medium"
  const deps = options.dependencies || []
  const maxAttempts = options.maxAttempts || 3

  // Check for duplicates
  const existing = await db.task.findFirst({
    where: { goal: { contains: goal.slice(0, 50) }, status: { in: ["pending", "running", "paused"] } },
  })
  if (existing) {
    return dbToTask(existing)
  }

  const task = await db.task.create({
    data: {
      goal,
      status: "pending",
      acceptanceCriteria: JSON.stringify(deps), // reuse field for dependencies
    },
  })

  return dbToTask(task)
}

// ============ 2. PRIORITY QUEUE ============
const PRIORITY_ORDER: Record<TaskPriority, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
}

export async function getNextTask(): Promise<QueueTask | null> {
  // Get all pending tasks
  const pending = await db.task.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
  })

  if (pending.length === 0) return null

  // Sort by priority (critical first), then by age
  const sorted = pending.sort((a, b) => {
    // Check cooldown
    const now = Date.now()
    const aCooldown = (a as any).cooldownUntil
    const bCooldown = (b as any).cooldownUntil
    if (aCooldown && now < aCooldown) return 1
    if (bCooldown && now < bCooldown) return -1

    // Priority (stored in goal text — hack for now, or use a separate field)
    // For simplicity, use createdAt as tiebreaker
    return a.createdAt.getTime() - b.createdAt.getTime()
  })

  // Find first task whose dependencies are all done
  for (const task of sorted) {
    const deps = JSON.parse(task.acceptanceCriteria || "[]") as string[]
    if (deps.length === 0) {
      return dbToTask(task)
    }
    // Check if all dependencies are done
    const depTasks = await db.task.findMany({ where: { id: { in: deps } } })
    if (depTasks.length === deps.length && depTasks.every(d => d.status === "done")) {
      return dbToTask(task)
    }
  }

  return null
}

// ============ 3. TASK DEPENDENCIES ============
export async function addDependency(taskId: string, dependsOnId: string): Promise<void> {
  const task = await db.task.findUnique({ where: { id: taskId } })
  if (!task) return

  const deps = JSON.parse(task.acceptanceCriteria || "[]") as string[]
  if (!deps.includes(dependsOnId)) {
    deps.push(dependsOnId)
    await db.task.update({
      where: { id: taskId },
      data: { acceptanceCriteria: JSON.stringify(deps) },
    })
  }
}

// ============ 4. DAG SCHEDULING ============
export async function getDAGOrder(): Promise<QueueTask[]> {
  const tasks = await db.task.findMany({
    where: { status: { in: ["pending", "running", "paused"] } },
    orderBy: { createdAt: "asc" },
  })

  // Build dependency graph
  const taskMap = new Map(tasks.map(t => [t.id, t]))
  const inDegree = new Map<string, number>()
  const graph = new Map<string, string[]>()

  for (const t of tasks) {
    inDegree.set(t.id, 0)
    graph.set(t.id, [])
  }

  for (const t of tasks) {
    const deps = JSON.parse(t.acceptanceCriteria || "[]") as string[]
    for (const dep of deps) {
      if (taskMap.has(dep)) {
        graph.get(dep)!.push(t.id)
        inDegree.set(t.id, (inDegree.get(t.id) || 0) + 1)
      }
    }
  }

  // Kahn's algorithm (topological sort)
  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  const ordered: QueueTask[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    const task = taskMap.get(id)
    if (task) ordered.push(dbToTask(task))

    for (const neighbor of graph.get(id) || []) {
      inDegree.set(neighbor, (inDegree.get(neighbor) || 0) - 1)
      if (inDegree.get(neighbor) === 0) queue.push(neighbor)
    }
  }

  // Add any remaining (cyclic) tasks at the end
  for (const t of tasks) {
    if (!ordered.find(o => o.id === t.id)) {
      ordered.push(dbToTask(t))
    }
  }

  return ordered
}

// ============ 5. TASK DEDUPLICATION ============
export async function deduplicateTasks(): Promise<number> {
  const tasks = await db.task.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
  })

  const seen = new Map<string, string>() // goal hash → task id
  let deleted = 0

  for (const task of tasks) {
    const hash = task.goal.slice(0, 50).toLowerCase().replace(/\s+/g, " ").trim()
    if (seen.has(hash)) {
      await db.task.delete({ where: { id: task.id } })
      deleted++
    } else {
      seen.set(hash, task.id)
    }
  }

  return deleted
}

// ============ 6. TASK SUPERSESSION ============
export async function supersedeTask(oldTaskId: string, newGoal: string): Promise<QueueTask> {
  // Cancel old task
  await db.task.update({
    where: { id: oldTaskId },
    data: { status: "cancelled", result: `Superseded by: ${newGoal}` },
  })

  // Create new task
  return enqueueTask(newGoal, { priority: "high" })
}

// ============ 7. TASK COOLDOWN ============
export async function setCooldown(taskId: string, cooldownMs: number = 60000): Promise<void> {
  // Store cooldown in the agentState field (reuse)
  await db.task.update({
    where: { id: taskId },
    data: {
      agentState: JSON.stringify({ cooldownUntil: Date.now() + cooldownMs }),
    },
  })
}

export function isInCooldown(task: QueueTask): boolean {
  if (!task.cooldownUntil) return false
  return Date.now() < task.cooldownUntil
}

// ============ 8. RETRY SCHEDULING ============
export async function scheduleRetry(taskId: string, error: string, backoffMs: number = 5000): Promise<void> {
  const task = await db.task.findUnique({ where: { id: taskId } })
  if (!task) return

  const attempts = (task as any).attempts || 0
  const maxAttempts = 3

  if (attempts >= maxAttempts) {
    // Escalate
    await db.task.update({
      where: { id: taskId },
      data: {
        status: "failed",
        result: `Max retries (${maxAttempts}) exceeded: ${error}`,
      },
    })
    return
  }

  // Exponential backoff
  const delay = backoffMs * Math.pow(2, attempts)
  await db.task.update({
    where: { id: taskId },
    data: {
      status: "pending",
      agentState: JSON.stringify({
        cooldownUntil: Date.now() + delay,
        attempts: attempts + 1,
        lastError: error,
      }),
    },
  })
}

// ============ 9. TASK CHECKPOINTS ============
export async function saveCheckpoint(taskId: string, gitHash: string): Promise<void> {
  await db.task.update({
    where: { id: taskId },
    data: {
      agentState: JSON.stringify({
        checkpointHash: gitHash,
        savedAt: Date.now(),
      }),
    },
  })
}

// ============ 10. TASK RESUME ============
export async function resumeTask(taskId: string): Promise<QueueTask | null> {
  const task = await db.task.findUnique({ where: { id: taskId } })
  if (!task) return null

  // Parse saved state
  let savedState: any = {}
  try {
    savedState = JSON.parse(task.agentState || "{}")
  } catch {}

  await db.task.update({
    where: { id: taskId },
    data: {
      status: "running",
      agentState: task.agentState, // preserve state
    },
  })

  return {
    ...dbToTask(task),
    status: "running",
    checkpointHash: savedState.checkpointHash || null,
    currentStep: savedState.currentStep || 0,
  }
}

// ============ 11. TASK PAUSE ============
export async function pauseTask(taskId: string): Promise<void> {
  await db.task.update({
    where: { id: taskId },
    data: { status: "paused" },
  })
}

// ============ 12. TASK CANCELLATION ============
export async function cancelTask(taskId: string, reason: string = "cancelled by user"): Promise<void> {
  await db.task.update({
    where: { id: taskId },
    data: { status: "cancelled", result: reason },
  })
}

// ============ 13. TASK ESCALATION ============
export async function escalateTask(taskId: string, level: TaskEscalation, reason: string): Promise<void> {
  if (level === "abort") {
    await db.task.update({
      where: { id: taskId },
      data: { status: "failed", result: `Escalated to abort: ${reason}` },
    })
  } else if (level === "human") {
    await db.task.update({
      where: { id: taskId },
      data: { status: "paused", result: `Requires human attention: ${reason}` },
    })
  } else if (level === "retry") {
    await scheduleRetry(taskId, reason)
  }
}

// ============ 14. TASK HISTORY ============
export async function getTaskHistory(limit: number = 50): Promise<QueueTask[]> {
  const tasks = await db.task.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit,
  })
  return tasks.map(dbToTask)
}

// ============ LONG-RUNNING AGENT ============

// 1. Background Execution — run task in background (non-blocking)
export async function executeInBackground(taskId: string, runFn: () => Promise<void>): Promise<void> {
  // Don't await — fire and forget
  runFn().catch(async (e) => {
    console.error(`[Background task ${taskId}] failed:`, e)
    await scheduleRetry(taskId, e instanceof Error ? e.message : String(e))
  })
}

// 2. Session Persistence — save full state for resume after crash
export async function persistSession(taskId: string, state: {
  messages: { role: string; content: string }[]
  currentStep: number
  checkpointHash?: string
}): Promise<void> {
  await db.task.update({
    where: { id: taskId },
    data: {
      agentState: JSON.stringify(state),
      currentStep: state.currentStep,
    },
  })
}

// 3. Crash Recovery — detect crashed tasks and resume them
export async function recoverCrashedTasks(): Promise<QueueTask[]> {
  // Find tasks that are "running" but not actually running (process died)
  const running = await db.task.findMany({
    where: { status: "running" },
  })

  const recovered: QueueTask[] = []
  for (const task of running) {
    // Check if the task has been "running" for too long without update
    const updatedAt = task.updatedAt.getTime()
    const staleThreshold = 10 * 60 * 1000 // 10 minutes

    if (Date.now() - updatedAt > staleThreshold) {
      // Task is stale — likely crashed
      const recoveredTask = await resumeTask(task.id)
      if (recoveredTask) recovered.push(recoveredTask)
    }
  }

  return recovered
}

// 4. Resume After Restart — called on app startup
export async function resumeAfterRestart(): Promise<{
  resumed: number
  failed: number
  cancelled: number
}> {
  // Find all tasks that were running/paused
  const tasks = await db.task.findMany({
    where: { status: { in: ["running", "paused"] } },
  })

  let resumed = 0
  let failed = 0
  let cancelled = 0

  for (const task of tasks) {
    let state: any = {}
    try { state = JSON.parse(task.agentState || "{}") } catch {}

    const age = Date.now() - task.updatedAt.getTime()
    const staleThreshold = 30 * 60 * 1000 // 30 minutes

    if (age > staleThreshold && task.status === "running") {
      // Too old — mark as failed (likely crashed)
      await db.task.update({
        where: { id: task.id },
        data: { status: "failed", result: `Crash recovery: task was stale (${Math.round(age / 60000)}min)` },
      })
      failed++
    } else if (state.checkpointHash) {
      // Has checkpoint — can safely resume
      await db.task.update({
        where: { id: task.id },
        data: { status: "pending" }, // re-queue for execution
      })
      resumed++
    } else {
      // No checkpoint — can't safely resume
      await db.task.update({
        where: { id: task.id },
        data: { status: "cancelled", result: "Crash recovery: no checkpoint to resume from" },
      })
      cancelled++
    }
  }

  return { resumed, failed, cancelled }
}

// 5. Unknown-State Resolution — when agent state is corrupted
export async function resolveUnknownState(taskId: string): Promise<{
  resolved: boolean
  action: "resume" | "restart" | "abort"
  reason: string
}> {
  const task = await db.task.findUnique({ where: { id: taskId } })
  if (!task) return { resolved: false, action: "abort", reason: "Task not found" }

  let state: any = {}
  try {
    state = JSON.parse(task.agentState || "{}")
  } catch {
    // Corrupted JSON
    return {
      resolved: true,
      action: "restart",
      reason: "Agent state JSON is corrupted — restarting from checkpoint",
    }
  }

  // Check if state has required fields
  if (!state.messages && !state.checkpointHash) {
    return {
      resolved: true,
      action: "restart",
      reason: "Agent state has no messages or checkpoint — restarting fresh",
    }
  }

  // State looks valid
  return {
    resolved: true,
    action: "resume",
    reason: "Agent state is valid — resuming",
  }
}

// 6. Resource-Aware Scheduling — check system resources before starting a task
export function checkResources(): {
  canRun: boolean
  reason: string
  recommendation: string
} {
  const memUsage = process.memoryUsage()
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024
  const heapTotalMB = memUsage.heapTotal / 1024 / 1024
  const usage = heapUsedMB / heapTotalMB

  if (usage > 0.9) {
    return {
      canRun: false,
      reason: `Heap usage ${Math.round(usage * 100)}% — too high`,
      recommendation: "Wait for memory to free up or restart the process",
    }
  }

  if (heapUsedMB > 500) {
    return {
      canRun: true,
      reason: `Heap: ${Math.round(heapUsedMB)}MB — moderate`,
      recommendation: "Monitor closely — consider running GC",
    }
  }

  return {
    canRun: true,
    reason: `Heap: ${Math.round(heapUsedMB)}MB — healthy`,
    recommendation: "All clear",
  }
}

// ============ HELPER ============
function dbToTask(m: any): QueueTask {
  let state: any = {}
  try { state = JSON.parse(m.agentState || "{}") } catch {}

  return {
    id: m.id,
    goal: m.goal,
    status: m.status as TaskStatus,
    priority: "medium", // TODO: add priority field to Prisma
    dependencies: JSON.parse(m.acceptanceCriteria || "[]"),
    attempts: state.attempts || 0,
    maxAttempts: 3,
    cooldownUntil: state.cooldownUntil || null,
    checkpointHash: state.checkpointHash || null,
    agentState: m.agentState,
    currentStep: m.currentStep || 0,
    totalSteps: 0,
    startedAt: m.status === "running" ? m.updatedAt?.getTime() : null,
    completedAt: m.status === "done" ? m.updatedAt?.getTime() : null,
    lastError: state.lastError || null,
    escalation: "none",
    createdAt: m.createdAt?.getTime() || Date.now(),
    updatedAt: m.updatedAt?.getTime() || Date.now(),
  }
}
