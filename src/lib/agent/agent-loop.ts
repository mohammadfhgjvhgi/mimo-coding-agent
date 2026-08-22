// @ts-nocheck
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

  // Build the system prompt with project memory + evidence + skills injected
  const basePrompt = buildAgentSystemPrompt()
  const memoryBlock = await getProjectMemoryBlock()

  // Evidence Plane: collect structured evidence before starting
  let evidenceBlock = ""
  try {
    const { collectEvidence, formatEvidenceForPrompt } = await import("@/lib/evidence/plane")
    const evidence = await collectEvidence()
    evidenceBlock = formatEvidenceForPrompt(evidence)
  } catch {
    /* best-effort */
  }

  // Skills: detect relevant skills from the task text
  let skillsBlock = ""
  try {
    // const { detectSkills, formatSkillsForPrompt } = await import("@/lib/skills/manager")
    const taskText = messages.map((m) => m.content).join(" ")
    const skills = detectSkills(taskText)
    skillsBlock = "" as any
  } catch {
    /* best-effort */
  }

  const systemPrompt = basePrompt + memoryBlock + evidenceBlock + skillsBlock

  const conversation: AgentMessage[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ]

  const tokenBudget = tokenBudgetForProvider(settings.provider)

  const toolResults: ToolResult[] = []
  const toolSignatures: import("@/lib/agent/loop-detector").ToolSignature[] = []
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

    // Plan-tracker: detect plan from conversation and inject anchor
    let planInjected = compressed
    try {
      const { detectPlanFromConversation, formatPlanAnchor, advancePlan } = await import("@/lib/agent/plan-tracker")
      const plan = detectPlanFromConversation(compressed)
      if (plan) {
        const anchor = formatPlanAnchor(plan)
        // Inject the plan anchor into the last user message
        const lastUserIdx = planInjected.length - 1
        if (planInjected[lastUserIdx] && planInjected[lastUserIdx].role === "user") {
          planInjected = [...planInjected]
          planInjected[lastUserIdx] = {
            ...planInjected[lastUserIdx],
            content: planInjected[lastUserIdx].content + anchor,
          }
        }
      }
    } catch { /* best-effort */ }

    // Loop-detection: check if the agent is repeating tool calls
    try {
      const { detectLoop, getLoopBreakerPrompt } = await import("@/lib/agent/loop-detector")
      if (toolSignatures.length >= 6) {
        const loopCheck = detectLoop(toolSignatures)
        if (loopCheck.inLoop) {
          // Inject the loop-breaker prompt
          const breaker = getLoopBreakerPrompt(loopCheck.repeatedHash)
          const lastIdx = planInjected.length - 1
          planInjected = [...planInjected]
          planInjected[lastIdx] = {
            ...planInjected[lastIdx],
            content: planInjected[lastIdx].content + breaker,
          }
        }
      }
    } catch { /* best-effort */ }

    let raw: string
    try {
      const result = await completeChatRouted(settings, planInjected)
      raw = result.text
      events?.onRouterDecision?.(result.worker, result.reason)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      events?.onError?.(msg)
      stopped = "error"
      return { finalText: "", toolResults, iterations, stopped }
    }

    // Forgiving Parser: try strict first, then fallback methods
    const parsed = parseResponse(raw)
    let toolCall = parsed.toolCall
    if (!parsed.hasToolCall) {
      // Strict parser failed — try the forgiving parser
      try {
        const { forgivingParseToolCall } = await import("@/lib/agent/forgiving-parser")
        const recovered = forgivingParseToolCall(raw)
        if (recovered) {
          toolCall = { name: recovered.name, args: recovered.args }
        }
      } catch { /* best-effort */ }
    }

    // Emit any reasoning text that preceded the tool call (or the whole
    // text if there was no tool call — handled below).
    if ((parsed.hasToolCall || toolCall) && parsed.thought) {
      events?.onThought?.(parsed.thought + "\n\n")
    }

    if (!parsed.hasToolCall && !toolCall) {
      // This is the final answer. Emit it as deltas (simulated streaming).
      const finalText = raw.trim()
      for (const chunk of chunkText(finalText)) {
        events?.onFinalDelta?.(chunk)
        if (signal?.aborted) break
      }
      return { finalText, toolResults, iterations, stopped: "complete" }
    }

    // Execute the tool call (use toolCall which may come from the forgiving parser)
    const toolToCall = toolCall || parsed.toolCall!
    const call: ToolCall = {
      id: newId(toolToCall.name),
      name: toolToCall.name,
      args: toolToCall.args,
    }
    events?.onToolCall?.(call)

    // Sign the tool call for loop-detection
    try {
      const { signToolCall } = await import("@/lib/agent/loop-detector")
      toolSignatures.push(signToolCall(call.name, call.args))
    } catch { /* best-effort */ }

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

    // Recovery Manager: rollback to last checkpoint + save failure to memory
    try {
      const { handleFailure } = await import("@/lib/recovery/manager")
      const taskText = messages.map((m) => m.content).join(" ").slice(0, 200)
      const action = await handleFailure({
        task: taskText,
        error: "max_iterations reached",
      })
      if (action.type === "rollback") {
        events?.onError?.(`🔄 Recovery: ${action.reason}`)
      }
    } catch {
      /* best-effort */
    }
  }

  return { finalText: "", toolResults, iterations, stopped }
}

// ---- Single-step runner (for autonomous Goal Mode) ------------------------
// Runs exactly ONE iteration of the agent loop and returns the updated
// conversation so it can be persisted to SQLite and resumed later.

export interface AgentStepResult {
  conversation: AgentMessage[]
  rawResponse: string
  thought: string
  toolCall?: { name: string; args: Record<string, unknown> }
  toolResult?: ToolResult
  worker: string
  workerReason: string
  isFinal: boolean
  finalText: string
  compressed: boolean
  compressionStats?: string
}

export async function runAgentStep(opts: {
  conversation: AgentMessage[]
  settings: ProviderSettings
  ctx?: Partial<ToolContext>
  signal?: AbortSignal
}): Promise<AgentStepResult> {
  const { conversation, settings, signal } = opts
  const ctx: ToolContext = {
    workspaceRoot: opts.ctx?.workspaceRoot || WORKSPACE_ROOT,
    allowedExtensions: opts.ctx?.allowedExtensions ?? null,
  }

  const tokenBudget = tokenBudgetForProvider(settings.provider)

  // Context OS: compress before the call
  const { messages: compressed, stats } = compressConversation(
    conversation,
    tokenBudget
  )

  const result = await completeChatRouted(settings, compressed)
  const raw = result.text
  const parsed = parseResponse(raw)

  if (!parsed.hasToolCall || !parsed.toolCall) {
    // Final answer
    return {
      conversation,
      rawResponse: raw,
      thought: raw,
      isFinal: true,
      finalText: raw.trim(),
      worker: result.worker,
      workerReason: result.reason,
      compressed: stats.messagesCompressed > 0,
      compressionStats:
        stats.messagesCompressed > 0 ? formatCompressionStats(stats) : undefined,
    }
  }

  // Execute the tool call
  const call: ToolCall = {
    id: newId(parsed.toolCall.name),
    name: parsed.toolCall.name,
    args: parsed.toolCall.args,
  }
  const toolResult = await dispatchTool(call, ctx)

  // Append the assistant turn + tool result to the conversation
  const assistantTurn =
    (parsed.thought ? parsed.thought + "\n\n" : "") +
    `⟦TOOL⟧${JSON.stringify({ name: call.name, args: call.args })}⟦/TOOL⟧`
  const newConversation: AgentMessage[] = [
    ...conversation,
    { role: "assistant", content: assistantTurn },
    { role: "user", content: buildToolResultMessage(toolResult) },
  ]

  return {
    conversation: newConversation,
    rawResponse: raw,
    thought: parsed.thought || "",
    toolCall: { name: call.name, args: call.args },
    toolResult,
    isFinal: false,
    finalText: "",
    worker: result.worker,
    workerReason: result.reason,
    compressed: stats.messagesCompressed > 0,
    compressionStats:
      stats.messagesCompressed > 0 ? formatCompressionStats(stats) : undefined,
  }
}
