// Anthropic Claude Adapter — converts OpenAI-style messages to Anthropic Messages API.
// Key differences:
//   1. `system` is a top-level param (not a role in the messages array)
//   2. `max_tokens` is required
//   3. Auth via x-api-key header (not Bearer)
//   4. Response: content blocks array (text, tool_use)
//   5. Streaming: content_block_delta SSE events
//
// Endpoint: POST https://api.anthropic.com/v1/messages
// Headers: x-api-key, anthropic-version: 2023-06-01

import type { ProviderModel } from "./registry"

type LLMMessage = { role: "system" | "user" | "assistant"; content: string }

export interface AnthropicCompleteOptions {
  apiKey: string
  model: string
  messages: LLMMessage[]
  systemPrompt?: string
  maxTokens?: number
  temperature?: number
  baseURL?: string
}

export interface AnthropicCompleteResult {
  content: string
  model: string
  tokensUsed: number
  inputTokens: number
  outputTokens: number
}

const ANTHROPIC_VERSION = "2023-06-01"
const DEFAULT_BASE_URL = "https://api.anthropic.com/v1"
const DEFAULT_MAX_TOKENS = 4096

// Convert OpenAI messages → Anthropic format (system extracted to top-level)
function convertMessages(messages: LLMMessage[]): {
  system: string | undefined
  messages: Array<{ role: "user" | "assistant"; content: string }>
} {
  let system: string | undefined
  const converted: Array<{ role: "user" | "assistant"; content: string }> = []

  for (const msg of messages) {
    if (msg.role === "system") {
      system = (system ? system + "\n\n" : "") + msg.content
    } else {
      converted.push({ role: msg.role, content: msg.content })
    }
  }

  // Anthropic requires alternating user/assistant — merge consecutive same-role
  const merged: Array<{ role: "user" | "assistant"; content: string }> = []
  for (const m of converted) {
    const last = merged[merged.length - 1]
    if (last && last.role === m.role) {
      last.content += "\n\n" + m.content
    } else {
      merged.push({ ...m })
    }
  }
  // Must start with user
  if (merged.length > 0 && merged[0].role !== "user") {
    merged.unshift({ role: "user", content: "(begin)" })
  }

  return { system, messages: merged }
}

// Non-streaming completion
export async function anthropicComplete(opts: AnthropicCompleteOptions): Promise<AnthropicCompleteResult> {
  const { apiKey, model, messages, systemPrompt, maxTokens, temperature, baseURL } = opts
  if (!apiKey) throw new Error("Anthropic API key required")

  const { system, messages: converted } = convertMessages(messages)
  const finalSystem = systemPrompt || system

  const body: Record<string, unknown> = {
    model,
    messages: converted,
    max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
  }
  if (finalSystem) body.system = finalSystem
  if (temperature !== undefined) body.temperature = temperature

  const res = await fetch(`${baseURL ?? DEFAULT_BASE_URL}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Anthropic API error (${res.status}): ${errText.slice(0, 200)}`)
  }

  const data = await res.json()
  const content = (data.content || [])
    .filter((block: { type: string }) => block.type === "text")
    .map((block: { text: string }) => block.text)
    .join("")

  return {
    content,
    model: data.model || model,
    tokensUsed: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    inputTokens: data.usage?.input_tokens || 0,
    outputTokens: data.usage?.output_tokens || 0,
  }
}

// Streaming completion — emits SSE content_block_delta events
export async function* anthropicStream(
  opts: AnthropicCompleteOptions
): AsyncGenerator<{ type: "delta" | "done" | "error"; content?: string; error?: string }> {
  const { apiKey, model, messages, systemPrompt, maxTokens, temperature, baseURL } = opts
  if (!apiKey) {
    yield { type: "error", error: "Anthropic API key required" }
    return
  }

  const { system, messages: converted } = convertMessages(messages)
  const finalSystem = systemPrompt || system

  const body: Record<string, unknown> = {
    model,
    messages: converted,
    max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
    stream: true,
  }
  if (finalSystem) body.system = finalSystem
  if (temperature !== undefined) body.temperature = temperature

  const res = await fetch(`${baseURL ?? DEFAULT_BASE_URL}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  })

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "unknown")
    yield { type: "error", error: `Anthropic API error (${res.status}): ${errText.slice(0, 200)}` }
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue
        const jsonStr = line.slice(6).trim()
        if (!jsonStr) continue
        try {
          const event = JSON.parse(jsonStr)
          if (event.type === "content_block_delta" && event.delta?.text) {
            yield { type: "delta", content: event.delta.text }
          } else if (event.type === "message_stop") {
            yield { type: "done" }
            return
          } else if (event.type === "error") {
            yield { type: "error", error: event.error?.message || "streaming error" }
            return
          }
        } catch {
          /* skip malformed */
        }
      }
    }
    yield { type: "done" }
  } finally {
    reader.releaseLock()
  }
}

// Test connection — lightweight call to verify API key
export async function anthropicTestConnection(apiKey: string, baseURL?: string): Promise<{
  ok: boolean
  model?: string
  error?: string
}> {
  try {
    const result = await anthropicComplete({
      apiKey,
      model: "claude-3-5-haiku-20241022",
      messages: [{ role: "user", content: "Hi" }],
      maxTokens: 10,
      baseURL,
    })
    return { ok: true, model: result.model }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
