// Context OS — token budget management + compression for resource-aware agents.
// Keeps the conversation within a safe token window for small local models
// (Qwen 4B/7B on i7-3770) by compressing old tool results.

import { TOOL_OPEN, TOOL_CLOSE, RESULT_OPEN, RESULT_CLOSE } from "@/lib/agent/prompt"

// Rough token estimate: ~3.5 chars per token for mixed Arabic/English/code.
// Slightly more conservative than the classic 4 chars/token heuristic.
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 3.5)
}

export function estimateMessagesTokens(
  messages: { role: string; content: string }[]
): number {
  let total = 0
  for (const m of messages) {
    // role + formatting overhead ~ 4 tokens per message
    total += 4 + estimateTokens(m.content)
  }
  return total
}

// Provider-aware token budgets. Local models get a conservative budget so the
// agent never blows the context window; cloud models can afford much more.
export function tokenBudgetForProvider(provider: string): number {
  if (provider === "ollama") return 6000
  return 28000 // zai (cloud) — generous
}

interface CompressionStats {
  originalTokens: number
  compressedTokens: number
  messagesCompressed: number
  budget: number
}

// Compress a conversation in-place to fit within a token budget.
// Strategy:
//   - Never touch: the system prompt (index 0), the last 3 messages, and the
//     very last user request.
//   - For older messages whose content contains a ⟦RESULT⟧ block, replace the
//     inner payload with a short notice like "[تم ضغط نتيجة read_file — 842 محرف]".
//   - Also compress very long assistant thoughts (> 400 chars) that are old.
export function compressConversation(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  budget: number
): { messages: typeof messages; stats: CompressionStats } {
  const originalTokens = estimateMessagesTokens(messages)
  if (originalTokens <= budget) {
    return {
      messages,
      stats: {
        originalTokens,
        compressedTokens: originalTokens,
        messagesCompressed: 0,
        budget,
      },
    }
  }

  const result = messages.map((m) => ({ ...m }))
  const protectedCount = 3 // keep the last N messages untouched
  let compressed = 0

  // Iterate from oldest to newest, skipping the system prompt (index 0) and
  // the last `protectedCount` messages.
  for (let i = 1; i < result.length - protectedCount; i++) {
    if (originalTokens - compressed * 200 <= budget) break // good enough
    const msg = result[i]
    const before = estimateTokens(msg.content)

    // Compress ⟦RESULT⟧ blocks (tool outputs)
    if (msg.content.includes(RESULT_OPEN)) {
      msg.content = compressResultBlocks(msg.content)
    } else if (msg.role === "assistant" && before > 300) {
      // Compress long assistant thoughts (keep first + last sentence)
      const trimmed = msg.content.trim()
      const firstNl = trimmed.indexOf("\n")
      const head = firstNl > 0 ? trimmed.slice(0, firstNl) : trimmed.slice(0, 80)
      msg.content =
        head +
        `\n[…تم ضغط تفكير سابق — ${before} توكن…]`
      compressed++
    }
  }

  const compressedTokens = estimateMessagesTokens(result)
  const messagesCompressed = result.filter(
    (m, i) => m.content !== messages[i].content
  ).length

  return {
    messages: result,
    stats: {
      originalTokens,
      compressedTokens,
      messagesCompressed,
      budget,
    },
  }
}

// Replace the payload inside each ⟦RESULT⟧...⟦/RESULT⟧ with a short notice.
function compressResultBlocks(content: string): string {
  let out = content
  let replaced = true
  while (replaced) {
    replaced = false
    const start = out.indexOf(RESULT_OPEN)
    if (start < 0) break
    const end = out.indexOf(RESULT_CLOSE, start + RESULT_OPEN.length)
    if (end < 0) break
    const inner = out.slice(start + RESULT_OPEN.length, end)
    const innerTokens = estimateTokens(inner)
    // Extract a hint: first line / tool name
    const firstLine = inner.split("\n")[0].slice(0, 60)
    const placeholder = `[تم ضغط نتيجة أداة — ${innerTokens} توكن — ${firstLine}…]`
    out =
      out.slice(0, start + RESULT_OPEN.length) +
      placeholder +
      out.slice(end)
    replaced = true
  }
  return out
}

// Format compression stats for logging / UI display
export function formatCompressionStats(stats: CompressionStats): string {
  const saved = stats.originalTokens - stats.compressedTokens
  const pct = stats.originalTokens > 0 ? Math.round((saved / stats.originalTokens) * 100) : 0
  return `Context OS: ${stats.originalTokens}→${stats.compressedTokens} tokens (−${saved}, −${pct}%), ${stats.messagesCompressed} messages compressed, budget ${stats.budget}`
}

// silence unused import
void TOOL_OPEN
void TOOL_CLOSE

// ---------------------------------------------------------------------------
// MERGED FROM mimo-life-os/src/lib/ai/context.ts
// Adds: assembleContext — a pure helper that prepares a system prompt +
// messages array for an LLM call by combining history + memory + skills.
// The DB-coupled Knowledge Base lookup is intentionally omitted.
// ---------------------------------------------------------------------------

import { retrieveMemories } from "@/lib/tools/memory"

export interface AssembleContextInput {
  conversationId?: string
  userMessage: string
  history?: { role: "system" | "user" | "assistant"; content: string }[]
  extraSystem?: string
  /** Optional cap on the number of history messages to include. */
  maxHistoryMessages?: number
}

export interface AssembledContext {
  system: string
  messages: { role: "system" | "user" | "assistant"; content: string }[]
  memories: Array<{ key: string; value: string; category: string }>
  tokenEstimate: number
  historyTrimmed: boolean
}

const DEFAULT_HISTORY_MESSAGES = 20

/**
 * Assemble a system prompt + message list for an LLM call.
 *
 * Combines:
 *   1. Optional conversation history (capped to maxHistoryMessages)
 *   2. Relevant memories retrieved via the local memory tool
 *   3. Caller-supplied extra system text
 *
 * Memory retrieval failures are non-fatal — the call proceeds without memories.
 */
export async function assembleContext(input: AssembleContextInput): Promise<AssembledContext> {
  const { conversationId, userMessage, history, extraSystem, maxHistoryMessages } = input

  let trimmedHistory = (history ?? []).slice(-Math.max(1, maxHistoryMessages ?? DEFAULT_HISTORY_MESSAGES))
  const historyTrimmed = (history?.length ?? 0) > trimmedHistory.length

  // Retrieve relevant memories (best-effort, never fails the call)
  let memories: AssembledContext["memories"] = []
  try {
    const recalled = await retrieveMemories({
      query: userMessage,
      limit: 5,
      conversationId,
    })
    memories = (recalled as Array<{ key: string; value: string; category: string }>).map((m) => ({
      key: m.key,
      value: m.value,
      category: m.category,
    }))
  } catch {
    // memory retrieval failure is non-fatal
  }

  const systemParts: string[] = []
  if (memories.length > 0) {
    systemParts.push(
      "\n\n## Relevant Memories\n" +
        memories
          .map((m) => `- [${m.category}] ${m.key}: ${m.value.slice(0, 200)}`)
          .join("\n")
    )
  }
  if (extraSystem) {
    systemParts.push("\n\n" + extraSystem)
  }
  const system = systemParts.join("")

  const messages: AssembledContext["messages"] = [
    ...trimmedHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ]

  // Token estimate (~3.5 chars/token — matches estimateTokens above)
  const totalChars = system.length + messages.reduce((s, m) => s + m.content.length, 0)
  const tokenEstimate = Math.ceil(totalChars / 3.5)

  // Auto-compress if we exceed the budget (uses the existing compressConversation)
  const budget = tokenBudgetForProvider("ollama")
  let finalMessages = messages
  if (tokenEstimate > budget) {
    const compressed = compressConversation(
      [{ role: "system", content: system }, ...messages] as { role: "system" | "user" | "assistant"; content: string }[],
      budget
    )
    finalMessages = compressed.messages.filter((m) => m.role !== "system")
  }

  void trimmedHistory // quiet unused-var when history was undefined

  return {
    system,
    messages: finalMessages,
    memories,
    tokenEstimate,
    historyTrimmed,
  }
}
