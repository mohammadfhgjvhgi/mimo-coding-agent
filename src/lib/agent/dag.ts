// DAG Task Decomposition — splits large goals into ordered sub-tasks.
// Uses a simple topological sort to order tasks by dependencies.

export interface DagTask {
  id: string
  description: string
  dependencies: string[] // IDs of tasks that must complete first
  status: "pending" | "running" | "done" | "failed"
}

export interface DagPlan {
  tasks: DagTask[]
  executionOrder: string[] // topologically sorted task IDs
}

// Parse a plan text (from the LLM) into a DAG
// Expected format: lines like "1. Task description [after: 2,3]"
export function parseDagPlan(planText: string): DagPlan {
  const lines = planText.split("\n").filter((l) => l.trim())
  const tasks: DagTask[] = []

  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\.\s*(.+?)(?:\s*\[after:\s*([\d,\s]+)\])?$/)
    if (match) {
      const id = match[1]
      const description = match[2].trim()
      const deps = match[3]
        ? match[3].split(",").map((d) => d.trim()).filter(Boolean)
        : []
      tasks.push({
        id,
        description,
        dependencies: deps,
        status: "pending",
      })
    }
  }

  // If no structured plan found, create a single task
  if (tasks.length === 0) {
    tasks.push({
      id: "1",
      description: planText.slice(0, 200),
      dependencies: [],
      status: "pending",
    })
  }

  // Topological sort (Kahn's algorithm)
  const executionOrder = topologicalSort(tasks)

  return { tasks, executionOrder }
}

// Kahn's algorithm for topological sort
function topologicalSort(tasks: DagTask[]): string[] {
  const inDegree: Record<string, number> = {}
  const graph: Record<string, string[]> = {}

  // Initialize
  for (const t of tasks) {
    inDegree[t.id] = 0
    graph[t.id] = []
  }

  // Build graph
  for (const t of tasks) {
    for (const dep of t.dependencies) {
      if (graph[dep]) {
        graph[dep].push(t.id)
        inDegree[t.id] = (inDegree[t.id] || 0) + 1
      }
    }
  }

  // Find nodes with no dependencies
  const queue: string[] = []
  for (const t of tasks) {
    if (inDegree[t.id] === 0) {
      queue.push(t.id)
    }
  }

  const result: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    result.push(id)
    for (const neighbor of graph[id]) {
      inDegree[neighbor]--
      if (inDegree[neighbor] === 0) {
        queue.push(neighbor)
      }
    }
  }

  // If there's a cycle, just return the original order
  return result.length === tasks.length ? result : tasks.map((t) => t.id)
}

// Format the DAG plan for display/injection
export function formatDagPlan(plan: DagPlan): string {
  const lines = plan.tasks.map((t) => {
    const deps = t.dependencies.length > 0 ? ` [بعد: ${t.dependencies.join(", ")}]` : ""
    const status = t.status === "done" ? " ✅" : t.status === "running" ? " 🔄" : t.status === "failed" ? " ❌" : ""
    return `${t.id}. ${t.description}${deps}${status}`
  })
  return `📋 خطة التنفيذ (${plan.tasks.length} مهام، ترتيب: ${plan.executionOrder.join("→")}):\n${lines.join("\n")}`
}

// Update a task's status in the plan
export function updateTaskStatus(
  plan: DagPlan,
  taskId: string,
  status: DagTask["status"]
): DagPlan {
  return {
    ...plan,
    tasks: plan.tasks.map((t) =>
      t.id === taskId ? { ...t, status } : t
    ),
  }
}

// Get the next runnable task (pending with all deps done)
export function getNextTask(plan: DagPlan): DagTask | null {
  for (const id of plan.executionOrder) {
    const task = plan.tasks.find((t) => t.id === id)
    if (!task || task.status !== "pending") continue
    const depsDone = task.dependencies.every((dep) => {
      const depTask = plan.tasks.find((t) => t.id === dep)
      return depTask?.status === "done"
    })
    if (depsDone) return task
  }
  return null
}

// Check if all tasks are done
export function isPlanComplete(plan: DagPlan): boolean {
  return plan.tasks.every((t) => t.status === "done")
}

// ---------------------------------------------------------------------------
// MERGED FROM mimo-life-os/src/lib/ai/task-graph.ts
// Adds: graph validation (missing deps, self-deps, duplicate edges, cycles)
// using white-gray-black DFS, plus a richer status state machine.
// ---------------------------------------------------------------------------

export type DagNodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "done"
  | "failed"
  | "blocked"

export interface DagValidationResult {
  valid: boolean
  errors: string[]
}

// White-gray-black coloring constants for DFS-based cycle detection.
const WHITE = 0
const GRAY = 1
const BLACK = 2

/**
 * Detect cycles in a DagPlan using white-gray-black DFS.
 * Returns an array of human-readable cycle descriptions (empty if acyclic).
 *
 * White (unvisited) → Gray (in progress) → Black (done).
 * Encountering a Gray node during DFS = cycle.
 */
export function detectCycles(plan: DagPlan): string[] {
  const errors: string[] = []
  const color = new Map<string, number>()
  for (const t of plan.tasks) color.set(t.id, WHITE)

  for (const start of plan.tasks) {
    if (color.get(start.id) === WHITE) {
      const path: string[] = []
      dfsDetectCycle(plan, start.id, color, path, errors)
    }
  }
  return errors
}

function dfsDetectCycle(
  plan: DagPlan,
  nodeId: string,
  color: Map<string, number>,
  path: string[],
  errors: string[]
): void {
  color.set(nodeId, GRAY)
  path.push(nodeId)

  const node = plan.tasks.find((t) => t.id === nodeId)
  if (!node) {
    path.pop()
    color.set(nodeId, BLACK)
    return
  }

  for (const depId of node.dependencies) {
    const depColor = color.get(depId)

    if (depColor === GRAY) {
      const cycleStart = path.indexOf(depId)
      const cyclePath = path.slice(cycleStart).concat(depId)
      errors.push(`Circular dependency: ${cyclePath.join(" → ")}`)
    } else if (depColor === WHITE) {
      dfsDetectCycle(plan, depId, color, path, errors)
    }
  }

  path.pop()
  color.set(nodeId, BLACK)
}

/**
 * Validate a DagPlan structure.
 * Checks for:
 *  1. Missing dependencies (an ID not present in the plan)
 *  2. Self-dependencies (a task depends on itself)
 *  3. Duplicate edges (same dep listed twice)
 *  4. Cycles (via white-gray-black DFS)
 */
export function validateDag(plan: DagPlan): DagValidationResult {
  const errors: string[] = []
  const ids = new Set(plan.tasks.map((t) => t.id))

  for (const t of plan.tasks) {
    for (const depId of t.dependencies) {
      if (!ids.has(depId)) {
        errors.push(`Task "${t.id}" depends on missing task "${depId}"`)
      }
    }
    if (t.dependencies.includes(t.id)) {
      errors.push(`Task "${t.id}" depends on itself`)
    }
    const seen = new Set<string>()
    for (const depId of t.dependencies) {
      if (seen.has(depId)) {
        errors.push(`Task "${t.id}" has duplicate dependency on "${depId}"`)
      }
      seen.add(depId)
    }
  }

  errors.push(...detectCycles(plan))

  return { valid: errors.length === 0, errors }
}

/**
 * Returns the IDs of tasks whose status is "pending" AND whose dependencies
 * are all "done". These are eligible to be picked up by the next execution slot.
 */
export function getReadyTasks(plan: DagPlan): string[] {
  return plan.tasks
    .filter((t) => t.status === "pending")
    .filter((t) => t.dependencies.every((d) => plan.tasks.find((x) => x.id === d)?.status === "done"))
    .map((t) => t.id)
}

/**
 * Returns the IDs of tasks whose status is "pending" AND any dependency has
 * "failed". These are blocked and cannot proceed until the failure is resolved.
 */
export function getBlockedTasks(plan: DagPlan): string[] {
  return plan.tasks
    .filter((t) => t.status === "pending")
    .filter((t) => t.dependencies.some((d) => plan.tasks.find((x) => x.id === d)?.status === "failed"))
    .map((t) => t.id)
}

/** Counts of each task status — useful for the UI / observability. */
export interface DagState {
  total: number
  pending: number
  ready: number
  running: number
  done: number
  failed: number
  blocked: number
}

export function getDagState(plan: DagPlan): DagState {
  const state: DagState = {
    total: plan.tasks.length,
    pending: 0,
    ready: 0,
    running: 0,
    done: 0,
    failed: 0,
    blocked: 0,
  }
  const ready = new Set(getReadyTasks(plan))
  const blocked = new Set(getBlockedTasks(plan))
  for (const t of plan.tasks) {
    if (t.status === "pending") {
      if (ready.has(t.id)) state.ready++
      else if (blocked.has(t.id)) state.blocked++
      else state.pending++
    } else if (t.status === "running") state.running++
    else if (t.status === "done") state.done++
    else if (t.status === "failed") state.failed++
  }
  return state
}
