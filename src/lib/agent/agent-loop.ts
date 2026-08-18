// The Agent Loop: orchestrates LLM ↔ tool execution until a final answer.

import { completeChatRouted, type ProviderSettings } from "@/lib/llm-provider"
import {
  dispatchTool,
  WORKSPACE_ROOT,
  type ToolCall,
  type ToolResult,
  type ToolContext,
} from "@/lib/tools"
import { getProjectMemoryBlock } from "@/lib/tools/memory"
import {
  compressConversation,
  tokenBudgetForProvider,
  formatCompressionStats,
} from "@/lib/context-os"
import {
  buildAgentSystemPrompt,
  parseResponse,
  buildToolResultMessage,
} from "./prompt"

export interface AgentMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface AgentEvents {
  onThought?: (text: string) => void
  onToolCall?: (call: ToolCall) => void
  onToolResult?: (result: ToolResult) => void
  onFinalDelta?: (chunk: string) => void
  onError?: (error: string) => void
  onContextCompressed?: (stats: string) => void
  onRouterDecision?: (worker: string, reason: string) => void
}

export interface AgentRunResult {
  finalText: string
  toolResults: ToolResult[]
  iterations: number
  stopped: "complete" | "max_iterations" | "error"
}

export const MAX_ITERATIONS = 12

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 6)}`
}

function chunkText(text: string, size = 40): string[] {
  if (!text) return []
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size))
  }
  return chunks
}

export async function runAgentLoop(opts: {
  messages: AgentMessage[] // history + the new user message (NO system prompt)
  settings: ProviderSettings
  ctx?: Partial<ToolContext>
  events?: AgentEvents
  signal?: AbortSignal
}): Promise<AgentRunResult> {
  const { messages, settings, events, signal } = opts
  const ctx: ToolContext = {
    workspaceRoot: opts.ctx?.workspaceRoot || WORKSPACE_ROOT,
    allowedExtensions: opts.ctx?.allowedExtensions ?? null,
  }

  // Build the system prompt with project memory injected (Memory OS)
  const basePrompt = buildAgentSystemPrompt()
  const memoryBlock = await getProjectMemoryBlock()
  const systemPrompt = basePrompt + memoryBlock

  const conversation: AgentMessage[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ]

  const tokenBudget = tokenBudgetForProvider(settings.provider)

  const toolResults: ToolResult[] = []
  let iterations = 0
  let stopped: AgentRunResult["stopped"] = "complete"

  while (iterations < MAX_ITERATIONS) {
    if (signal?.aborted) {
      stopped = "error"
      break
    }
    iterations++

    // Context OS: compress old tool results to fit the token budget
    const { messages: compressed, stats } = compressConversation(
      conversation,
      tokenBudget
    )
    if (stats.messagesCompressed > 0) {
      events?.onContextCompressed?.(formatCompressionStats(stats))
    }

    let raw: string
    try {
      const result = await completeChatRouted(settings, compressed)
      raw = result.text
      events?.onRouterDecision?.(result.worker, result.reason)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      events?.onError?.(msg)
      stopped = "error"
      return { finalText: "", toolResults, iterations, stopped }
    }

    const parsed = parseResponse(raw)

    // Emit any reasoning text that preceded the tool call (or the whole
    // text if there was no tool call — handled below).
    if (parsed.hasToolCall && parsed.thought) {
      events?.onThought?.(parsed.thought + "\n\n")
    }

    if (!parsed.hasToolCall || !parsed.toolCall) {
      // This is the final answer. Emit it as deltas (simulated streaming).
      const finalText = raw.trim()
      for (const chunk of chunkText(finalText)) {
        events?.onFinalDelta?.(chunk)
        if (signal?.aborted) break
      }
      return { finalText, toolResults, iterations, stopped: "complete" }
    }

    // Execute the tool call
    const call: ToolCall = {
      id: newId(parsed.toolCall.name),
      name: parsed.toolCall.name,
      args: parsed.toolCall.args,
    }
    events?.onToolCall?.(call)

    const result = await dispatchTool(call, ctx)
    toolResults.push(result)
    events?.onToolResult?.(result)

    // Append the assistant turn (thought + tool call) + the tool result to
    // the running conversation so the model sees the outcome.
    const assistantTurn =
      (parsed.thought ? parsed.thought + "\n\n" : "") +
      `⟦TOOL⟧${JSON.stringify({
        name: call.name,
        args: call.args,
      })}⟦/TOOL⟧`
    conversation.push({ role: "assistant", content: assistantTurn })
    conversation.push({ role: "user", content: buildToolResultMessage(result) })
  }

  if (iterations >= MAX_ITERATIONS) {
    stopped = "max_iterations"
    events?.onError?.(`وصل الوكيل للحد الأقصى من التكرارات (${MAX_ITERATIONS}) دون إجابة نهائية.`)
  }

  return { finalText: "", toolResults, iterations, stopped }
}
