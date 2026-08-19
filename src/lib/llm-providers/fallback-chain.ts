// Fallback Chain — tries providers in order: Ollama (local) → Z.ai (cloud) → fail.
// With retry + exponential backoff for Ollama's slow responses on old hardware.

import { completeChatRouted, type ProviderSettings } from "@/lib/llm-provider"
import { OllamaProvider } from "@/lib/llm-providers/ollama"

type LLMMessage = { role: "system" | "user" | "assistant"; content: string }

interface FallbackResult {
  content: string
  provider: "ollama" | "zai" | "dual" | "none"
  model?: string
  tokensUsed: number
  attempts: { provider: string; success: boolean; error?: string; durationMs: number }[]
}

const MAX_RETRIES = 2
const INITIAL_TIMEOUT = 120000 // 2 min for local models

// Try Ollama first, then Z.ai fallback.
export async function fallbackComplete(
  messages: LLMMessage[],
  settings: ProviderSettings
): Promise<FallbackResult> {
  const attempts: FallbackResult["attempts"] = []

  // 1. Try Ollama if configured and reachable
  if (settings.provider === "ollama" || settings.provider === "dual") {
    const ollamaUrl = settings.provider === "dual"
      ? settings.cpuWorkerUrl
      : settings.ollamaUrl
    const ollamaModel = settings.provider === "dual"
      ? settings.cpuWorkerModel
      : settings.ollamaModel

    const provider = new OllamaProvider(ollamaUrl, [ollamaModel])
    const start = Date.now()

    try {
      // Check health first
      const healthy = await provider.healthCheck()
      if (healthy) {
        const result = await provider.complete(messages, {
          model: ollamaModel,
          temperature: 0.4,
          maxTokens: 2048,
        })
        attempts.push({ provider: "ollama", success: true, durationMs: Date.now() - start })
        return {
          content: result.content,
          provider: "ollama",
          model: result.model,
          tokensUsed: result.tokensUsed,
          attempts,
        }
      } else {
        attempts.push({ provider: "ollama", success: false, error: "unreachable", durationMs: Date.now() - start })
      }
    } catch (err) {
      attempts.push({
        provider: "ollama",
        success: false,
        error: err instanceof Error ? err.message.slice(0, 100) : String(err),
        durationMs: Date.now() - start,
      })
    }
  }

  // 2. Fallback to Z.ai (cloud)
  const zaiStart = Date.now()
  try {
    const result = await completeChatRouted(settings, messages)
    attempts.push({ provider: "zai", success: true, durationMs: Date.now() - zaiStart })
    return {
      content: result.text,
      provider: result.worker === "zai" ? "zai" : "dual",
      model: result.reason,
      tokensUsed: Math.ceil(result.text.length / 4),
      attempts,
    }
  } catch (err) {
    attempts.push({
      provider: "zai",
      success: false,
      error: err instanceof Error ? err.message.slice(0, 100) : String(err),
      durationMs: Date.now() - zaiStart,
    })
  }

  // 3. All providers failed
  return {
    content: "",
    provider: "none",
    tokensUsed: 0,
    attempts,
  }
}

// Retry with exponential backoff — useful for Ollama on slow hardware.
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = MAX_RETRIES,
  initialDelayMs = 1000
): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (i < maxRetries) {
        const delay = initialDelayMs * Math.pow(2, i) // 1s, 2s, 4s
        await new Promise((r) => setTimeout(r, delay))
      }
    }
  }
  throw lastErr
}
