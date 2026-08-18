// LLM provider abstraction: supports local Ollama + Z.ai cloud fallback.
// Used server-side only.

import ZAI from "z-ai-web-dev-sdk";

export type ProviderKind = "ollama" | "zai";

export interface ProviderSettings {
  provider: ProviderKind;
  ollamaUrl: string; // e.g. http://localhost:11434
  ollamaModel: string; // e.g. llama3.2, qwen2.5:3b
  zaiThinking: boolean;
}

export const DEFAULT_SETTINGS: ProviderSettings = {
  provider: "zai", // Z.ai works out-of-the-box in this sandbox; user can switch to Ollama
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "llama3.2",
  zaiThinking: false,
};

// In-memory settings cache (per-process). The UI persists to localStorage on
// the client and sends the chosen settings with each /api/chat request, so this
// cache is only used as a server-side default.
let cached: ProviderSettings = { ...DEFAULT_SETTINGS };

export function getSettings(): ProviderSettings {
  return { ...cached };
}

export function setSettings(s: Partial<ProviderSettings>) {
  cached = { ...cached, ...s };
  return cached;
}

// ---- Ollama helpers -------------------------------------------------------

export async function ollamaIsReachable(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${url.replace(/\/$/, "")}/api/tags`, {
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

export async function listOllamaModels(
  url: string
): Promise<{ name: string; size?: number; family?: string }[]> {
  const res = await fetch(`${url.replace(/\/$/, "")}/api/tags`);
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = (await res.json()) as {
    models?: { name: string; size?: number; details?: { family?: string } }[];
  };
  return (data.models || []).map((m) => ({
    name: m.name,
    size: m.size,
    family: m.details?.family,
  }));
}

// Async generator that streams text deltas from Ollama's /api/chat endpoint.
async function* streamOllama(
  url: string,
  model: string,
  messages: { role: "system" | "user" | "assistant"; content: string }[]
): AsyncGenerator<string> {
  const res = await fetch(`${url.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Ollama stream failed: HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const json = JSON.parse(line);
        const delta = json?.message?.content;
        if (delta) yield delta as string;
        if (json?.done) return;
      } catch {
        /* ignore partial line */
      }
    }
  }
}

// ---- Z.ai helper ----------------------------------------------------------

async function* streamZai(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  thinking: boolean
): AsyncGenerator<string> {
  const zai = await ZAI.create();
  const response = (await zai.chat.completions.create({
    messages,
    stream: true,
    thinking: { type: thinking ? "enabled" : "disabled" },
  } as {
    messages: typeof messages;
    stream: boolean;
    thinking: { type: "enabled" | "disabled" };
  })) as ReadableStream<Uint8Array> | { choices: Array<{ message?: { content?: string } }> };

  if (response instanceof ReadableStream) {
    const reader = response.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const json = JSON.parse(payload);
          const delta = json?.choices?.[0]?.delta?.content;
          if (delta) yield delta as string;
        } catch {
          /* ignore */
        }
      }
    }
  } else if (response && typeof response === "object" && Array.isArray(response.choices)) {
    const text = response.choices?.[0]?.message?.content || "";
    if (text) yield text;
  } else {
    throw new Error("Unexpected Z.ai response shape");
  }
}

// ---- Public API -----------------------------------------------------------

export async function streamChat(
  settings: ProviderSettings,
  messages: { role: "system" | "user" | "assistant"; content: string }[]
): Promise<AsyncGenerator<string>> {
  if (settings.provider === "ollama") {
    const reachable = await ollamaIsReachable(settings.ollamaUrl);
    if (!reachable) {
      throw new Error(
        `تعذر الوصول إلى Ollama على ${settings.ollamaUrl}. تأكد من تشغيله محلياً (ollama serve).`
      );
    }
    return streamOllama(settings.ollamaUrl, settings.ollamaModel, messages);
  }
  return streamZai(messages, settings.zaiThinking);
}
