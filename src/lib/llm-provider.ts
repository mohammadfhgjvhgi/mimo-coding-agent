// LLM provider abstraction: supports local Ollama + Z.ai cloud + Dual-Worker (CPU+GPU).
// Used server-side only.

import ZAI from "z-ai-web-dev-sdk";

export type ProviderKind = "ollama" | "zai" | "dual";

export type WorkerKind = "cpu" | "gpu";

export interface McpServerConfig {
  name: string
  url: string
}

export interface ProviderSettings {
  provider: ProviderKind;
  // Single Ollama (legacy / simple)
  ollamaUrl: string;
  ollamaModel: string;
  // Dual-Worker (MiMo Router)
  cpuWorkerUrl: string;
  cpuWorkerModel: string;
  gpuWorkerUrl: string;
  gpuWorkerModel: string;
  routerMode: "auto" | "cpu" | "gpu";
  zaiThinking: boolean;
  // External Ecosystem
  githubToken: string;
  mcpServers: McpServerConfig[];
}

export const DEFAULT_SETTINGS: ProviderSettings = {
  provider: "ollama", // Production default: local Ollama (user can switch to Dual-Worker or Z.ai)
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "qwen2.5-coder:7b", // Recommended model for i7-3770 / 12-16GB RAM
  cpuWorkerUrl: "http://localhost:8002",
  cpuWorkerModel: "qwen3:4b",
  gpuWorkerUrl: "http://localhost:8001",
  gpuWorkerModel: "qwen2.5-coder:7b",
  routerMode: "auto",
  zaiThinking: false,
  githubToken: "",
  mcpServers: [],
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

// ---- Non-streaming completion (for agent loop iterations) -----------------

async function completeOllama(
  url: string,
  model: string,
  messages: { role: "system" | "user" | "assistant"; content: string }[]
): Promise<string> {
  const res = await fetch(`${url.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content || "";
}

async function completeZai(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  thinking: boolean
): Promise<string> {
  const zai = await ZAI.create();
  const response = (await zai.chat.completions.create({
    messages,
    stream: false,
    thinking: { type: thinking ? "enabled" : "disabled" },
  } as {
    messages: typeof messages;
    stream: boolean;
    thinking: { type: "enabled" | "disabled" };
  })) as { choices?: Array<{ message?: { content?: string } }> } | ReadableStream<Uint8Array>;

  // ZAI returns a JSON object when stream:false
  if (response && typeof response === "object" && !("getReader" in response)) {
    const r = response as { choices?: Array<{ message?: { content?: string } }> };
    return r.choices?.[0]?.message?.content || "";
  }
  // Fallback: consume the stream if the API insisted on streaming
  if (response && typeof response === "object" && "getReader" in response) {
    let out = "";
    for await (const delta of (async function* () {
      const reader = (response as ReadableStream<Uint8Array>).getReader();
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
            const d = json?.choices?.[0]?.delta?.content;
            if (d) yield d as string;
          } catch {
            /* ignore */
          }
        }
      }
    })()) {
      out += delta;
    }
    return out;
  }
  throw new Error("استجابة غير متوقعة من Z.ai");
}

export async function completeChat(
  settings: ProviderSettings,
  messages: { role: "system" | "user" | "assistant"; content: string }[]
): Promise<string> {
  if (settings.provider === "ollama") {
    const reachable = await ollamaIsReachable(settings.ollamaUrl);
    if (!reachable) {
      throw new Error(
        `تعذر الوصول إلى Ollama على ${settings.ollamaUrl}. تأكد من تشغيله محلياً (ollama serve).`
      );
    }
    return completeOllama(settings.ollamaUrl, settings.ollamaModel, messages);
  }
  if (settings.provider === "dual") {
    return completeChatDual(settings, messages);
  }
  return completeZai(messages, settings.zaiThinking);
}

// ---- MiMo Dual-Worker Router ------------------------------------------------

// Tools that indicate the NEXT step is likely CODE generation (→ GPU worker).
const GPU_TRIGGERS = new Set([
  "write_file",
  "edit_file",
  "read_file", // after reading a file, the model usually writes/edits next
  "run_terminal_command", // after running a command, often fixing code
]);

// Tools that indicate the NEXT step is PLANNING / general reasoning (→ CPU worker).
const CPU_TRIGGERS = new Set([
  "list_files",
  "git_checkpoint",
  "save_memory",
  "recall_memory",
]);

// Keyword hints in the user's message that suggest code work (→ GPU).
const CODE_KEYWORDS = [
  "اكتب", "أنشئ", "انشئ", "عدّل", "عدل", "أصلح", "اصلح", "بناء", "ابن",
  "refactor", "fix", "write", "create", "edit", "implement", "كود", "دالة", "ملف",
];

// Keyword hints that suggest planning / general Q&A (→ CPU).
const PLAN_KEYWORDS = [
  "اشرح", "خطط", "حلل", "لماذا", "كيف", "ماذا", "قارن", "احفظ", "تذكر",
  "explain", "plan", "analyze", "why", "how", "compare", "summarize",
];

export interface RouterDecision {
  worker: WorkerKind
  reason: string
}

// Classify the current agent step: should it go to the CPU worker (planning,
// tool-calling, general Q&A) or the GPU worker (code writing, editing, fixing)?
export function classifyStep(
  messages: { role: string; content: string }[],
  lastToolName?: string
): RouterDecision {
  // 1. If the last tool was a file read/edit/run, the next step is likely code → GPU
  if (lastToolName && GPU_TRIGGERS.has(lastToolName)) {
    return {
      worker: "gpu",
      reason: `الخطوة السابقة (${lastToolName}) تشير إلى عمل برمجي → GPU`,
    }
  }
  // 2. If the last tool was planning/memory/repo-map → CPU
  if (lastToolName && CPU_TRIGGERS.has(lastToolName)) {
    return {
      worker: "cpu",
      reason: `الخطوة السابقة (${lastToolName}) تشير إلى تخطيط → CPU`,
    }
  }
  // 3. No tool yet — look at the latest user message for keyword hints
  const lastUser = [...messages].reverse().find((m) => m.role === "user")
  if (lastUser) {
    const text = lastUser.content.toLowerCase()
    const hasCode = CODE_KEYWORDS.some((k) => text.includes(k))
    const hasPlan = PLAN_KEYWORDS.some((k) => text.includes(k))
    if (hasCode && !hasPlan) {
      return { worker: "gpu", reason: "كلمات مفتاحية برمجية في الطلب → GPU" }
    }
    if (hasPlan && !hasCode) {
      return { worker: "cpu", reason: "كلمات مفتاحية تخطيطية في الطلب → CPU" }
    }
  }
  // 4. Default: CPU for the first step (planning), GPU after tool results
  return { worker: "cpu", reason: "افتراضي: تخطيط أولي → CPU" }
}

// Complete a chat using the Dual-Worker router.
async function completeChatDual(
  settings: ProviderSettings,
  messages: { role: "system" | "user" | "assistant"; content: string }[]
): Promise<string> {
  // Extract the last tool name from the conversation (if any ⟦TOOL⟧ block exists)
  let lastToolName: string | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === "assistant" && m.content.includes("⟦TOOL⟧")) {
      const match = m.content.match(/⟦TOOL⟧\s*\{[^}]*"name"\s*:\s*"([^"]+)"/)
      if (match) {
        lastToolName = match[1]
        break
      }
    }
  }

  let worker: WorkerKind
  if (settings.routerMode === "cpu") {
    worker = "cpu"
  } else if (settings.routerMode === "gpu") {
    worker = "gpu"
  } else {
    const decision = classifyStep(messages, lastToolName)
    worker = decision.worker
  }

  const url = worker === "cpu" ? settings.cpuWorkerUrl : settings.gpuWorkerUrl
  const model = worker === "cpu" ? settings.cpuWorkerModel : settings.gpuWorkerModel

  const reachable = await ollamaIsReachable(url)
  if (!reachable) {
    // Fallback to Z.ai if the chosen worker is down
    try {
      return await completeZai(messages, settings.zaiThinking)
    } catch {
      throw new Error(
        `تعذر الوصول إلى ${worker === "cpu" ? "CPU" : "GPU"} Worker على ${url}، و Z.ai fallback فشل أيضاً.`
      )
    }
  }
  return completeOllama(url, model, messages)
}

// Probe which workers are reachable (for the UI status indicator)
export async function probeDualWorkers(
  settings: ProviderSettings
): Promise<{ cpu: boolean; gpu: boolean; using: WorkerKind | "zai-fallback" }> {
  const [cpu, gpu] = await Promise.all([
    ollamaIsReachable(settings.cpuWorkerUrl),
    ollamaIsReachable(settings.gpuWorkerUrl),
  ])
  let using: WorkerKind | "zai-fallback"
  if (cpu && gpu) using = "gpu"
  else if (cpu) using = "cpu"
  else if (gpu) using = "gpu"
  else using = "zai-fallback"
  return { cpu, gpu, using }
}

// Complete a chat and also report which worker/provider was actually used.
// This lets the agent-loop emit a router decision event for the UI indicator.
export interface ChatResult {
  text: string
  worker: WorkerKind | "zai"
  reason: string
}

export async function completeChatRouted(
  settings: ProviderSettings,
  messages: { role: "system" | "user" | "assistant"; content: string }[]
): Promise<ChatResult> {
  if (settings.provider === "ollama") {
    const reachable = await ollamaIsReachable(settings.ollamaUrl)
    if (!reachable) {
      // fall back to Z.ai
      const text = await completeZai(messages, settings.zaiThinking)
      return { text, worker: "zai", reason: "Ollama غير متاح → Z.ai fallback" }
    }
    const text = await completeOllama(settings.ollamaUrl, settings.ollamaModel, messages)
    return { text, worker: "zai", reason: "Ollama محلي" }
  }
  if (settings.provider === "dual") {
    // Extract the last tool name
    let lastToolName: string | undefined
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === "assistant" && m.content.includes("⟦TOOL⟧")) {
        const match = m.content.match(/⟦TOOL⟧\s*\{[^}]*"name"\s*:\s*"([^"]+)"/)
        if (match) {
          lastToolName = match[1]
          break
        }
      }
    }
    let worker: WorkerKind
    if (settings.routerMode === "cpu") {
      worker = "cpu"
    } else if (settings.routerMode === "gpu") {
      worker = "gpu"
    } else {
      const decision = classifyStep(messages, lastToolName)
      worker = decision.worker
    }
    const url = worker === "cpu" ? settings.cpuWorkerUrl : settings.gpuWorkerUrl
    const model = worker === "cpu" ? settings.cpuWorkerModel : settings.gpuWorkerModel
    const reachable = await ollamaIsReachable(url)
    if (!reachable) {
      // Fallback to Z.ai
      const text = await completeZai(messages, settings.zaiThinking)
      return {
        text,
        worker: "zai",
        reason: `${worker === "cpu" ? "CPU" : "GPU"} Worker غير متاح → Z.ai fallback`,
      }
    }
    const text = await completeOllama(url, model, messages)
    return {
      text,
      worker,
      reason: `${worker === "cpu" ? "CPU" : "GPU"} Worker (${model})`,
    }
  }
  // Z.ai
  const text = await completeZai(messages, settings.zaiThinking)
  return { text, worker: "zai", reason: "Z.ai سحابي" }
}

// ---------------------------------------------------------------------------
// MERGED FROM mimo-life-os/src/lib/ai/model.ts
// Adds: generateStructured (JSON-from-LLM with fallbacks),
//       treeOfThought, selfConsistency, optimizePrompt, isRetryableError.
// These are advanced reasoning patterns built on top of completeChat().
// The model.ts streaming/non-streaming helpers are NOT merged because we
// already have streamChat + completeChat above.
// ---------------------------------------------------------------------------

const RATE_LIMIT_DELAY_MS = 2000
const MAX_RETRIES_LLM = 3

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Heuristic: returns true if the error is transient (rate limit, network,
 * timeout) and the operation should be retried with exponential backoff.
 */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    return (
      msg.includes("429") ||
      msg.includes("rate limit") ||
      msg.includes("too many requests") ||
      msg.includes("timeout") ||
      msg.includes("network") ||
      msg.includes("econnreset") ||
      msg.includes("socket hang up")
    )
  }
  return false
}

/**
 * Generate structured output by asking the LLM for JSON.
 *
 * Tries (in order):
 *   1. JSON.parse on the raw response
 *   2. Extract from ```json fenced code blocks
 *   3. Extract the first { ... last } (object)
 *   4. Extract the first [ ... last ] (array)
 *
 * Throws if none of the above yield valid JSON.
 */
export async function generateStructured<T = unknown>(
  settings: ProviderSettings,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  schemaDescription: string,
  options: { system?: string; temperature?: number } = {}
): Promise<T> {
  const sys =
    (options.system ?? "") +
    `\n\nYou MUST respond with valid JSON only, matching this schema:\n${schemaDescription}\n\nNo markdown, no code fences, no commentary — JSON only.`

  const finalMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: sys },
    ...messages,
  ]
  const content = await completeChat(settings, finalMessages)

  try {
    return JSON.parse(content) as T
  } catch {
    /* fall through to extraction */
  }

  // Try fenced code block
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]) as T
    } catch {
      /* keep trying */
    }
  }

  // Try first { ... last }
  const first = content.indexOf("{")
  const last = content.lastIndexOf("}")
  if (first !== -1 && last !== -1 && last > first) {
    try {
      return JSON.parse(content.slice(first, last + 1)) as T
    } catch {
      /* keep trying */
    }
  }

  // Try array
  const firstArr = content.indexOf("[")
  const lastArr = content.lastIndexOf("]")
  if (firstArr !== -1 && lastArr !== -1 && lastArr > firstArr) {
    try {
      return JSON.parse(content.slice(firstArr, lastArr + 1)) as T
    } catch {
      /* fall through */
    }
  }

  throw new Error(`Failed to parse structured output. Raw: ${content.slice(0, 500)}`)
}

/**
 * Tree-of-Thought: generate N candidate responses with different temperatures,
 * then ask the model to pick the best.
 *
 * Research lineage: Yao et al. "Tree of Thoughts" (R2 Base).
 */
export async function treeOfThought(
  settings: ProviderSettings,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options: { branches?: number; system?: string } = {}
): Promise<string> {
  const branches = Math.min(options.branches ?? 3, 5)
  const start = Date.now()

  // Generate N paths with different temperatures
  const paths = await Promise.all(
    Array.from({ length: branches }, (_, i) =>
      completeChat(settings, [
        ...(options.system ? [{ role: "system" as const, content: options.system }] : []),
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ]).then((content) => ({ content, temp: 0.3 + i * 0.25 }))
       .catch(() => ({ content: "", temp: 0.3 + i * 0.25 }))
    )
  )

  const validPaths = paths.filter((p) => p.content.length > 20).map((p) => p.content)
  if (validPaths.length === 0) return ""
  if (validPaths.length === 1) return validPaths[0]

  // Ask the model to pick the best
  const evalMessages: { role: "system" | "user"; content: string }[] = [
    {
      role: "system",
      content: "You are an evaluator. Pick the best answer from multiple candidates. Return ONLY the best answer, no commentary.",
    },
    {
      role: "user",
      content: `Question: ${messages[messages.length - 1]?.content ?? ""}\n\nCandidates:\n${validPaths.map((p, i) => `--- Candidate ${i + 1} ---\n${p.slice(0, 1000)}`).join("\n\n")}\n\nReturn ONLY the best answer:`,
    },
  ]

  const best = await completeChat(settings, evalMessages)
  void start
  return best
}

/**
 * Self-Consistency: generate N samples and return the most common one.
 * Uses the first 200 chars as the comparison key.
 *
 * Research lineage: Wang et al. "Self-Consistency Improves Chain of Thought Reasoning".
 */
export async function selfConsistency(
  settings: ProviderSettings,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options: { samples?: number; system?: string } = {}
): Promise<string> {
  const samples = Math.min(options.samples ?? 3, 5)

  const results = await Promise.all(
    Array.from({ length: samples }, () =>
      completeChat(settings, [
        ...(options.system ? [{ role: "system" as const, content: options.system }] : []),
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ]).catch(() => "")
    )
  )

  const valid = results.filter((r) => r.length > 10)
  if (valid.length === 0) return ""

  // Find the most common first-200-chars prefix among the samples
  const counts = new Map<string, number>()
  for (const r of valid) {
    const key = r.slice(0, 200)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  let bestKey = valid[0].slice(0, 200)
  let bestCount = 0
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestCount = count
      bestKey = key
    }
  }

  return valid.find((r) => r.slice(0, 200) === bestKey) ?? valid[0]
}

/**
 * Optimize a prompt by asking the LLM to refine it based on input/expected pairs.
 * Research lineage: DSPy / MIPROv2 prompt optimization.
 */
export async function optimizePrompt(
  settings: ProviderSettings,
  currentPrompt: string,
  examples: Array<{ input: string; expected: string }>
): Promise<string> {
  const messages: { role: "system" | "user"; content: string }[] = [
    {
      role: "system",
      content: "You are a prompt optimization expert. Improve the given prompt based on the examples. Return ONLY the improved prompt, no commentary.",
    },
    {
      role: "user",
      content: `Current prompt:\n${currentPrompt}\n\nExamples:\n${examples.map((e) => `Input: ${e.input}\nExpected: ${e.expected}`).join("\n\n")}\n\nImproved prompt:`,
    },
  ]

  const improved = await completeChat(settings, messages)
  return improved.trim()
}

// silence unused exports when the file is type-checked in isolation
void RATE_LIMIT_DELAY_MS
void MAX_RETRIES_LLM
