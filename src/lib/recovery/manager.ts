// Recovery Manager — handles agent failures by rolling back to git checkpoints
// and retrying with adjusted context. Implements the "self-healing" principle.

import { exec } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import { db } from "@/lib/db"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"

const execAsync = promisify(exec)

export interface RecoveryAction {
  type: "rollback" | "retry" | "abort"
  checkpoint?: string // git hash rolled back to
  reason: string
  failureMemory?: string // key to save the failure in memory
}

// Get the last git checkpoint hash
export async function getLastCheckpoint(): Promise<string | null> {
  try {
    const root = path.resolve(WORKSPACE_ROOT)
    const { stdout } = await execAsync("git rev-parse --short HEAD 2>/dev/null", {
      cwd: root,
      timeout: 5000,
    })
    return stdout.trim() || null
  } catch {
    return null
  }
}

// Rollback to a git checkpoint (hard reset)
export async function rollbackToCheckpoint(hash: string): Promise<boolean> {
  try {
    const root = path.resolve(WORKSPACE_ROOT)
    await execAsync(`git reset --hard ${hash} 2>/dev/null`, {
      cwd: root,
      timeout: 10000,
    })
    return true
  } catch {
    return false
  }
}

// Save a failure to the Memory OS so the agent learns from it
export async function saveFailureMemory(
  task: string,
  error: string,
  checkpoint: string | null
): Promise<void> {
  try {
    const key = `failure_${Date.now()}`
    const value = `المهمة: ${task}\nالخطأ: ${error}\nنقطة الاسترجاع: ${checkpoint || "none"}\nالدرس: تجنب تكرار هذا النهج`

    const existing = await db.memory.findUnique({ where: { key: `failure_${task.slice(0, 30)}` } })
    if (existing) {
      await db.memory.update({
        where: { key: existing.key },
        data: { value, updatedAt: new Date() },
      })
    } else {
      await db.memory.create({
        data: {
          key: `failure_${task.slice(0, 30)}`.replace(/\s+/g, "_"),
          value,
          category: "failure",
          source: "recovery",
        },
      })
    }
  } catch {
    // best-effort
  }
}

// Main entry: decide what to do when a task fails
export async function handleFailure(opts: {
  task: string
  error: string
  conversationId?: string
}): Promise<RecoveryAction> {
  const checkpoint = await getLastCheckpoint()

  if (!checkpoint) {
    return {
      type: "abort",
      reason: "لا توجد نقطة استرجاع — لا يمكن التراجع",
      failureMemory: opts.error,
    }
  }

  // Save the failure to memory
  await saveFailureMemory(opts.task, opts.error, checkpoint)

  // Rollback to the last checkpoint
  const rolledBack = await rollbackToCheckpoint(checkpoint)

  if (rolledBack) {
    return {
      type: "rollback",
      checkpoint,
      reason: `تم التراجع إلى ${checkpoint}. الفشل محفوظ في الذاكرة. أعد المحاولة بنهج مختلف.`,
      failureMemory: opts.error,
    }
  }

  return {
    type: "abort",
    checkpoint,
    reason: "فشل التراجع — لا يمكن الاستمرار بأمان",
    failureMemory: opts.error,
  }
}

// Check if the agent is in a loop (repeated failures)
export async function detectLoop(
  conversationId: string
): Promise<boolean> {
  try {
    // Check if the last 3 assistant messages had tool calls that all failed
    const recentMessages = await db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: 6,
    })

    let failures = 0
    for (const msg of recentMessages) {
      if (msg.toolCalls) {
        try {
          const calls = JSON.parse(msg.toolCalls) as Array<{ status?: string }>
          failures += calls.filter((c) => c.status === "error").length
        } catch {
          /* ignore */
        }
      }
    }

    return failures >= 3
  } catch {
    return false
  }
}
