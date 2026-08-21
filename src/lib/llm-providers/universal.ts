// Universal OpenAI-compatible client — handles any provider that speaks
// the OpenAI Chat Completions API (OpenAI, DeepSeek, Gemini compat, Groq,
// Mistral, OpenRouter, Ollama /v1).
//
// Just pass a different baseURL + apiKey per provider.

type LLMMessage = { role: "system" | "user" | "assistant"; content: string }

export interface UniversalCompleteOptions {
  apiKey?: string
  baseURL: string
  model: string
  messages: LLMMessage[]
  maxTokens?: number
  temperature?: number
  /** Optional: send extra headers (e.g., OpenRouter's HTTP-Referer) */
  extraHeaders?: Record<string, string>
}

export interface UniversalCompleteResult {
  content: string
  model: string
  tokensUsed: number
  inputTokens: number
  outputTokens: number
  /** Some providers (DeepSeek-R1) return a separate reasoning_content */
  reasoningContent?: string
}

// Non-streaming completion
export async function universalComplete(opts: UniversalCompleteOptions): Promise<UniversalCompleteResult> {
  const { apiKey, baseURL, model, messages, maxTokens, temperature, extraHeaders } = opts

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(extraHeaders || {}),
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const body: Record<string, unknown> = {
    model,
    messages,
  }
  if (maxTokens !== undefined) body.max_tokens = maxTokens
  if (temperature !== undefined) body.temperature = temperature

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`API error (${res.status}): ${errText.slice(0, 200)}`)
  }

  const data = await res.json()
  const choice = data.choices?.[0]
  const content = choice?.message?.content || ""
  const reasoningContent = choice?.message?.reasoning_content // DeepSeek-R1

  return {
    content,
    model: data.model || model,
    tokensUsed: (data.usage?.prompt_tokens || 0) + (data.usage?.completion_tokens || 0),
    inputTokens: data.usage?.prompt_tokens || 0,
    outputTokens: data.usage?.completion_tokens || 0,
    reasoningContent,
  }
}

// Streaming completion — yields deltas
export async function* universalStream(
  opts: UniversalCompleteOptions
): AsyncGenerator<{ type: "delta" | "reasoning" | "done" | "error"; content?: string; error?: string }> {
  const { apiKey, baseURL, model, messages, maxTokens, temperature, extraHeaders } = opts

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(extraHeaders || {}),
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
  }
  if (maxTokens !== undefined) body.max_tokens = maxTokens
  if (temperature !== undefined) body.temperature = temperature

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  })

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "unknown")
    yield { type: "error", error: `API error (${res.status}): ${errText.slice(0, 200)}` }
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
        if (jsonStr === "[DONE]") {
          yield { type: "done" }
          return
        }
        if (!jsonStr) continue
        try {
          const event = JSON.parse(jsonStr)
          const delta = event.choices?.[0]?.delta
          if (delta?.content) {
            yield { type: "delta", content: delta.content }
          }
          if (delta?.reasoning_content) {
            yield { type: "reasoning", content: delta.reasoning_content }
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

// Test connection — verify API key works with a minimal call
export async function universalTestConnection(opts: {
  apiKey?: string
  baseURL: string
  model: string
  extraHeaders?: Record<string, string>
}): Promise<{ ok: boolean; model?: string; error?: string }> {
  try {
    const result = await universalComplete({
      ...opts,
      messages: [{ role: "user", content: "Hi" }],
      maxTokens: 5,
    })
    return { ok: true, model: result.model }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
