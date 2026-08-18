// Plan-tracker Anchors — injects the active plan state before each LLM call.
// Inspired by SmallCode: prevents the model from forgetting the overall task
// by showing ✓/→/pending status of each step every iteration.

export interface PlanStep {
  description: string
  status: "done" | "current" | "pending"
}

export interface PlanTracker {
  steps: PlanStep[]
  currentIndex: number
}

// Parse a plan from the model's first response (or from the goal)
export function parsePlan(text: string): PlanTracker | null {
  // Look for numbered steps in the text
  const lines = text.split("\n")
  const steps: PlanStep[] = []
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)[.):]\s+(.+)/)
    if (match) {
      steps.push({
        description: match[2].trim().slice(0, 100),
        status: "pending",
      })
    }
  }
  if (steps.length === 0) return null
  return { steps, currentIndex: 0 }
}

// Update the plan: mark a step as done, advance to next
export function advancePlan(tracker: PlanTracker): PlanTracker {
  const steps = [...tracker.steps]
  if (tracker.currentIndex < steps.length) {
    steps[tracker.currentIndex] = { ...steps[tracker.currentIndex], status: "done" }
  }
  const nextIndex = tracker.currentIndex + 1
  if (nextIndex < steps.length) {
    steps[nextIndex] = { ...steps[nextIndex], status: "current" }
  }
  return { steps, currentIndex: nextIndex }
}

// Format the plan for injection before each LLM call
export function formatPlanAnchor(tracker: PlanTracker): string {
  if (tracker.steps.length === 0) return ""

  const lines = tracker.steps.map((step, i) => {
    const marker =
      step.status === "done" ? "✓"
      : step.status === "current" ? "→"
      : " "
    return `${marker} ${i + 1}. ${step.description}`
  })

  const progress = `${tracker.currentIndex}/${tracker.steps.length}`
  return `\n\n## 📋 الخطة النشطة (الخطوة ${progress}):\n${lines.join("\n")}\n_(ابقَ مركّزاً على الخطة — لا تنحرف)_`
}

// Detect plan from the conversation's first assistant message
export function detectPlanFromConversation(
  messages: { role: string; content: string }[]
): PlanTracker | null {
  // Find the first assistant message that looks like a plan
  for (const msg of messages) {
    if (msg.role === "assistant") {
      const plan = parsePlan(msg.content)
      if (plan && plan.steps.length >= 2) return plan
    }
  }
  return null
}

// Count completed steps
export function getPlanProgress(tracker: PlanTracker): { done: number; total: number; pct: number } {
  const done = tracker.steps.filter((s) => s.status === "done").length
  const total = tracker.steps.length
  return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 }
}
