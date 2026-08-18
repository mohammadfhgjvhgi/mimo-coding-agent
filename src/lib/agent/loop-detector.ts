// Loop-detection — detects when the agent is stuck repeating the same tool calls.
// Uses SHA-256 signatures of (tool_name + args) to detect repetition.
// Inspired by ForgeAI's loop-detection.

import { createHash } from "node:crypto"

export interface ToolSignature {
  hash: string
  toolName: string
  argsSummary: string
  timestamp: number
}

// Sign a tool call for comparison
export function signToolCall(toolName: string, args: Record<string, unknown>): ToolSignature {
  // Create a stable string representation of the args
  const argsStr = stableStringify(args)
  const combined = `${toolName}:${argsStr}`
  const hash = createHash("sha256").update(combined).digest("hex").slice(0, 16)

  return {
    hash,
    toolName,
    argsSummary: argsStr.slice(0, 80),
    timestamp: Date.now(),
  }
}

// Detect if the agent is in a loop (repeating the same tool calls)
export function detectLoop(
  history: ToolSignature[],
  windowSize = 6
): { inLoop: boolean; repeatedHash?: string; count: number } {
  if (history.length < windowSize) return { inLoop: false, count: 0 }

  // Look at the last `windowSize` signatures
  const recent = history.slice(-windowSize)

  // Count occurrences of each hash
  const counts: Record<string, number> = {}
  for (const sig of recent) {
    counts[sig.hash] = (counts[sig.hash] || 0) + 1
  }

  // If any hash appears 3+ times in the window, it's a loop
  for (const [hash, count] of Object.entries(counts)) {
    if (count >= 3) {
      return { inLoop: true, repeatedHash: hash, count }
    }
  }

  // Also check for A-B-A-B patterns (alternating loop)
  if (recent.length >= 4) {
    const a = recent[0].hash
    const b = recent[1].hash
    if (
      recent[2].hash === a &&
      recent[3].hash === b &&
      a !== b
    ) {
      return { inLoop: true, repeatedHash: `${a}↔${b}`, count: 2 }
    }
  }

  return { inLoop: false, count: 0 }
}

// Generate a "break the loop" prompt injection
export function getLoopBreakerPrompt(repeatedHash?: string): string {
  return [
    "",
    "## ⚠️ تنبيه: كشف تكرار حلقي (Loop Detected)",
    "يبدو أنك تكرر نفس الاستدعاء للنموسج. هذا يشير إلى أنك عالق في حلقة.",
    "جرّب نهجاً مختلفاً تماماً:",
    "- إذا كنت تكرر read_file لنفس الملف، جرّب edit_file بدلاً منه.",
    "- إذا كنت تكرر edit_file دون نجاح، اقرأ الخطأ بعناية أكبر.",
    "- إذا كنت تكرر run_terminal_command، جرّب أمراً مختلفاً.",
    "- لا تكرر نفس الخطوة — فكّر بطريقة بديلة لتحقيق الهدف.",
  ].join("\n")
}

// Stable stringification (sorted keys)
function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return "null"
  if (typeof obj !== "object") return String(obj)
  if (Array.isArray(obj)) {
    return "[" + obj.map(stableStringify).join(",") + "]"
  }
  const entries = Object.entries(obj as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
  return "{" + entries.map(([k, v]) => `"${k}":${stableStringify(v)}`).join(",") + "}"
}
