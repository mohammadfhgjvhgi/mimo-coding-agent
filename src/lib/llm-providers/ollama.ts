// Ollama Provider — adapted from Quaesitor.
// Local, free, open-source models on localhost:11434.
// Supports streaming, health check, and multi-model fallback.

import { ollamaIsReachable } from "@/lib/llm-provider"

export interface OllamaModel {
  name: string
  size?: number
  family?: string
}

export const DEFAULT_OLLAMA_MODELS = [
  "qwen2.5-coder:7b",
  "qwen2.5-coder:7b-instruct",
  "qwen3:4b",
  "qwen3:1.7b",
  "llama3.1:8b",
  "llama3.2",
]

export class OllamaProvider {
  name = "ollama" as const
  baseUrl: string
  models: string[]
  costPer1MTokens = { input: 0, output: 0 }

  constructor(url = "http://localhost:11434", models?: string[]) {
    this.baseUrl = url.replace(/\/$/, "")
    this.models = models || DEFAULT_OLLAMA_MODELS
  }

  // Async health check — used by the Model Router to detect if Ollama is running.
  async healthCheck(): Promise<boolean> {
    return ollamaIsReachable(this.baseUrl)
  }

  // List available models from the Ollama server.
  async listModels(): Promise<OllamaModel[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      })
      if (!res.ok) return []
      const data = await res.json() as { models?: OllamaModel[] }
      return data.models || []
    } catch {
      return []
    }
  }

  // Complete a chat — tries models in order until one succeeds.
  async complete(
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    opts?: {
      model?: string
      temperature?: number
      maxTokens?: number
      stream?: boolean
      onToken?: (token: string) => void
    }
  ): Promise<{ content: string; tokensUsed: number; model: string }> {
    const model = opts?.model || this.models[0]
    const temperature = opts?.temperature ?? 0.4
    const maxTokens = opts?.maxTokens ?? 2048
    const stream = opts?.stream ?? false

    const body: Record<string, unknown> = {
      model,
      messages,
      stream,
      options: { temperature, num_predict: maxTokens },
    }

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000), // 2 min timeout for local models
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`Ollama error (${res.status}): ${text.slice(0, 300)}`)
    }

    if (stream && res.body) {
      let fullContent = ""
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const chunk = JSON.parse(line) as { message?: { content?: string }; done?: boolean }
            const token = chunk.message?.content
            if (token) {
              fullContent += token
              opts?.onToken?.(token)
            }
          } catch { /* skip */ }
        }
      }
      const tokens = Math.ceil(fullContent.length / 4)
      return { content: fullContent, tokensUsed: tokens, model }
    }

    // Non-streaming: Ollama returns NDJSON.
    const text = await res.text()
    const lines = text.trim().split("\n").filter(Boolean)
    let content = ""
    let evalCount = 0
    for (const line of lines) {
      try {
        const data = JSON.parse(line) as { message?: { content?: string }; eval_count?: number; done?: boolean }
        if (data.message?.content) content += data.message.content
        if (data.eval_count) evalCount = data.eval_count
      } catch { /* skip */ }
    }
    return {
      content,
      tokensUsed: evalCount || Math.ceil(content.length / 4),
      model,
    }
  }

  // Try all models in order — returns the first that succeeds.
  async smart(
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    opts?: Parameters<OllamaProvider["complete"]>[1]
  ): Promise<{ content: string; tokensUsed: number; model: string }> {
    let lastErr: unknown
    for (const model of this.models) {
      try {
        return await this.complete(messages, { ...opts, model })
      } catch (err) {
        lastErr = err
        console.warn(`[Ollama] Model "${model}" failed:`, err instanceof Error ? err.message.slice(0, 100) : String(err))
      }
    }
    throw new Error(`All Ollama models failed. Last: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
  }

  // Fast model — uses the smallest model for quick tasks.
  async fast(
    messages: { role: "system" | "user" | "assistant"; content: string }[]
  ): Promise<{ content: string; tokensUsed: number; model: string }> {
    const fastModel = this.models[this.models.length - 1] || "qwen3:1.7b"
    return this.complete(messages, { model: fastModel, temperature: 0.3, maxTokens: 512 })
  }
}
