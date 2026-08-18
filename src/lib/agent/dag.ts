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
