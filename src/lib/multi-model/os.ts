// Multi-Model Intelligence — debate, voting, critic, router, fast-draft-strong-verify.
// 5 operations, selective (not default), bilingual (Arabic + English).
// No Prisma — pure orchestration over Model OS + existing LLM providers.
//
// Design:
//   • Uses Model OS for model selection + fallback
//   • Uses existing llm-provider.ts (Ollama + Z.ai) for actual LLM calls
//   • All operations accept a callLLM function (injected — for testability)
//   • On i7-3770: use SELECTIVELY (fast models for draft, strong for verify)
//
// 5 operations:
//   1. modelDebate         — two models answer same question → compare
//   2. modelVoting          — N models answer → pick most consistent
//   3. modelCritic          — model A answers → model B critiques
//   4. modelRouter          — pick best model for task (delegates to Model OS)
//   5. fastDraftStrongVerify — fast model drafts → strong model verifies

import { modelRoute, modelFallback } from "@/lib/model-os/os"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelResponse {
  modelId: string
  response: string
  durationMs: number
  error?: string
}

export interface DebateResult {
  question: string
  responses: ModelResponse[]
  agreement: number // 0-1, how similar the responses are
  differences: string[]
  summary: string
}

export interface VotingResult {
  question: string
  responses: ModelResponse[]
  winner: ModelResponse
  voteCount: number
  reason: string
}

export interface CriticResult {
  originalResponse: ModelResponse
  critique: ModelResponse
  issuesFound: string[]
  severity: "none" | "minor" | "major" | "critical"
  improvedResponse?: string
}

export interface RouterResult {
  modelId: string
  reason: string
  fallbackChain: string[]
}

export interface FastDraftResult {
  draft: ModelResponse
  verification: ModelResponse
  verified: boolean
  finalResponse: string
  totalDurationMs: number
}

export type MultiModelResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string }

// LLM caller function type — injected for testability
export type CallLLM = (modelId: string, systemPrompt: string, userMessage: string) => Promise<string>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function similarity(s1: string, s2: string): number {
  // Simple word-overlap similarity (Jaccard on words)
  const words1 = new Set(s1.toLowerCase().split(/\s+/).filter(w => w.length > 3))
  const words2 = new Set(s2.toLowerCase().split(/\s+/).filter(w => w.length > 3))
  if (words1.size === 0 || words2.size === 0) return 0
  let intersection = 0
  for (const w of words1) if (words2.has(w)) intersection++
  const union = words1.size + words2.size - intersection
  return intersection / union
}

function extractKeyPoints(text: string): string[] {
  // Extract sentences that look like key points
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.length > 20 && s.length < 300)
  return sentences.slice(0, 5)
}

// ---------------------------------------------------------------------------
// 1. Model Debate — two models answer same question → compare
// ---------------------------------------------------------------------------

export async function modelDebate(opts: {
  question: string
  modelA: string
  modelB: string
  callLLM: CallLLM
  systemPrompt?: string
}): Promise<MultiModelResult<DebateResult>> {
  const start = Date.now()
  try {
    if (!opts.question || !opts.modelA || !opts.modelB) {
      return { ok: false, error: "no_input", message: "❌ question + modelA + modelB required" }
    }
    const sysPrompt = opts.systemPrompt ?? "You are a helpful assistant. Answer the question clearly and concisely."

    // Call both models in parallel
    const [resA, resB] = await Promise.allSettled([
      opts.callLLM(opts.modelA, sysPrompt, opts.question),
      opts.callLLM(opts.modelB, sysPrompt, opts.question),
    ])

    const responses: ModelResponse[] = []
    // Model A
    const startA = Date.now()
    if (resA.status === "fulfilled") {
      responses.push({ modelId: opts.modelA, response: resA.value, durationMs: Date.now() - startA })
    } else {
      responses.push({ modelId: opts.modelA, response: "", durationMs: Date.now() - startA, error: String(resA.reason) })
    }
    // Model B
    const startB = Date.now()
    if (resB.status === "fulfilled") {
      responses.push({ modelId: opts.modelB, response: resB.value, durationMs: Date.now() - startB })
    } else {
      responses.push({ modelId: opts.modelB, response: "", durationMs: Date.now() - startB, error: String(resB.reason) })
    }

    // Compute agreement
    const agree = responses[0].response && responses[1].response
      ? similarity(responses[0].response, responses[1].response)
      : 0

    // Find differences (key points unique to each)
    const pointsA = extractKeyPoints(responses[0].response)
    const pointsB = extractKeyPoints(responses[1].response)
    const setA = new Set(pointsA.map(p => p.toLowerCase().slice(0, 50)))
    const differences = [
      ...pointsA.filter(p => !setA.has(p.toLowerCase().slice(0, 50))).map(p => `${opts.modelA}: ${p.slice(0, 100)}`),
      ...pointsB.filter(p => !setA.has(p.toLowerCase().slice(0, 50))).map(p => `${opts.modelB}: ${p.slice(0, 100)}`),
    ].slice(0, 10)

    const summary = agree > 0.5
      ? `✅ النموذجان متفقان بنسبة ${(agree * 100).toFixed(0)}%. / Models agree ${(agree * 100).toFixed(0)}%.`
      : `⚠️ النموذجان مختلفان (تطابق ${(agree * 100).toFixed(0)}%). / Models differ (${(agree * 100).toFixed(0)}% match).`

    return {
      ok: true,
      data: {
        question: opts.question,
        responses,
        agreement: agree,
        differences,
        summary,
      },
    }
  } catch (e) {
    return { ok: false, error: "debate_failed", message: `❌ فشل المناظرة: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 2. Model Voting — N models answer → pick most consistent
// ---------------------------------------------------------------------------

export async function modelVoting(opts: {
  question: string
  models: string[]
  callLLM: CallLLM
  systemPrompt?: string
}): Promise<MultiModelResult<VotingResult>> {
  try {
    if (!opts.question || !opts.models || opts.models.length < 2) {
      return { ok: false, error: "no_input", message: "❌ question + at least 2 models required" }
    }
    const sysPrompt = opts.systemPrompt ?? "You are a helpful assistant. Answer the question clearly and concisely."

    // Call all models in parallel
    const results = await Promise.allSettled(
      opts.models.map(m => opts.callLLM(m, sysPrompt, opts.question))
    )

    const responses: ModelResponse[] = results.map((r, i) => ({
      modelId: opts.models[i],
      response: r.status === "fulfilled" ? r.value : "",
      durationMs: 0,
      error: r.status === "rejected" ? String(r.reason) : undefined,
    }))

    // Vote: for each response, compute average similarity to all others
    const validResponses = responses.filter(r => r.response && !r.error)
    if (validResponses.length === 0) {
      return { ok: false, error: "all_failed", message: "❌ كل النماذج فشلت / all models failed" }
    }

    let winner = validResponses[0]
    let bestScore = -1
    for (const r of validResponses) {
      let score = 0
      for (const other of validResponses) {
        if (r.modelId !== other.modelId) {
          score += similarity(r.response, other.response)
        }
      }
      if (score > bestScore) {
        bestScore = score
        winner = r
      }
    }

    return {
      ok: true,
      data: {
        question: opts.question,
        responses,
        winner,
        voteCount: validResponses.length,
        reason: `الفائز: ${winner.modelId} (أعلى توافق مع باقي النماذج). / Winner: ${winner.modelId} (highest agreement with others).`,
      },
    }
  } catch (e) {
    return { ok: false, error: "voting_failed", message: `❌ فشل التصويت: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 3. Model Critic — model A answers → model B critiques
// ---------------------------------------------------------------------------

export async function modelCritic(opts: {
  question: string
  workerModel: string
  criticModel: string
  callLLM: CallLLM
}): Promise<MultiModelResult<CriticResult>> {
  try {
    if (!opts.question || !opts.workerModel || !opts.criticModel) {
      return { ok: false, error: "no_input", message: "❌ question + workerModel + criticModel required" }
    }

    // Step 1: Worker answers
    const startW = Date.now()
    const workerResponse = await opts.callLLM(
      opts.workerModel,
      "You are a helpful assistant. Answer the question clearly and concisely.",
      opts.question
    )
    const originalResponse: ModelResponse = {
      modelId: opts.workerModel,
      response: workerResponse,
      durationMs: Date.now() - startW,
    }

    // Step 2: Critic critiques
    const startC = Date.now()
    const critiquePrompt = `You are a critical reviewer. Analyze the following answer to the question and identify any issues.

Question: ${opts.question}

Answer to review:
${workerResponse}

Identify:
1. Factual errors (if any)
2. Missing important information
3. Logical fallacies
4. Quality issues (clarity, completeness, accuracy)

Rate the severity: none, minor, major, or critical.
If the answer is good, say "no issues found" and severity "none".
Respond in this format:
ISSUES:
- issue 1
- issue 2
SEVERITY: [none/minor/major/critical]
IMPROVED: [improved answer if needed, or "N/A"]`

    const critiqueResponse = await opts.callLLM(
      opts.criticModel,
      "You are a critical reviewer. Be fair but thorough.",
      critiquePrompt
    )
    const critique: ModelResponse = {
      modelId: opts.criticModel,
      response: critiqueResponse,
      durationMs: Date.now() - startC,
    }

    // Parse issues + severity from critique
    const issuesMatch = critiqueResponse.match(/ISSUES:\s*\n([\s\S]*?)(?=\nSEVERITY:)/i)
    const severityMatch = critiqueResponse.match(/SEVERITY:\s*(none|minor|major|critical)/i)
    const improvedMatch = critiqueResponse.match(/IMPROVED:\s*\n([\s\S]*?)$/i)

    const issuesFound = issuesMatch
      ? issuesMatch[1].split("\n").map(l => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean)
      : []
    const severity = (severityMatch?.[1]?.toLowerCase() ?? "minor") as "none" | "minor" | "major" | "critical"
    const improvedResponse = improvedMatch?.[1]?.trim() !== "N/A" ? improvedMatch?.[1]?.trim() : undefined

    return {
      ok: true,
      data: {
        originalResponse,
        critique,
        issuesFound,
        severity,
        improvedResponse,
      },
    }
  } catch (e) {
    return { ok: false, error: "critic_failed", message: `❌ فشل النقد: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 4. Model Router — pick best model for task (delegates to Model OS)
// ---------------------------------------------------------------------------

export async function modelRouter(opts: {
  role?: import("@/lib/model-os/os").ModelRole
  preferProvider?: import("@/lib/model-os/os").ModelProvider
  requireCapability?: import("@/lib/model-os/os").ModelCapability
}): Promise<MultiModelResult<RouterResult>> {
  try {
    const routeRes = await modelRoute(opts)
    if (!routeRes.ok) return routeRes as unknown as MultiModelResult<RouterResult>
    return {
      ok: true,
      data: {
        modelId: routeRes.data.modelId,
        reason: routeRes.data.reason,
        fallbackChain: routeRes.data.fallbackChain,
      },
    }
  } catch (e) {
    return { ok: false, error: "router_failed", message: `❌ فشل التوجيه: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 5. Fast Draft → Strong Verify
// ---------------------------------------------------------------------------

export async function fastDraftStrongVerify(opts: {
  question: string
  fastModel: string
  strongModel: string
  callLLM: CallLLM
}): Promise<MultiModelResult<FastDraftResult>> {
  const startTotal = Date.now()
  try {
    if (!opts.question || !opts.fastModel || !opts.strongModel) {
      return { ok: false, error: "no_input", message: "❌ question + fastModel + strongModel required" }
    }

    // Step 1: Fast model drafts
    const startDraft = Date.now()
    const draftResponse = await opts.callLLM(
      opts.fastModel,
      "You are a fast assistant. Provide a quick draft answer.",
      opts.question
    )
    const draft: ModelResponse = {
      modelId: opts.fastModel,
      response: draftResponse,
      durationMs: Date.now() - startDraft,
    }

    // Step 2: Strong model verifies
    const startVerify = Date.now()
    const verifyPrompt = `You are a verifier. Review the following draft answer for correctness.

Question: ${opts.question}

Draft answer:
${draftResponse}

Check for:
1. Factual accuracy
2. Completeness
3. Correctness

If the draft is correct, respond: "VERIFIED: [the draft answer]"
If the draft has issues, respond: "CORRECTED: [your corrected answer]"
Keep your response focused on the answer, not on explaining your review process.`

    const verifyResponse = await opts.callLLM(
      opts.strongModel,
      "You are a verification expert. Be precise.",
      verifyPrompt
    )
    const verification: ModelResponse = {
      modelId: opts.strongModel,
      response: verifyResponse,
      durationMs: Date.now() - startVerify,
    }

    // Parse result
    const verified = verifyResponse.startsWith("VERIFIED:")
    const finalResponse = verified
      ? verifyResponse.replace(/^VERIFIED:\s*/i, "").trim()
      : verifyResponse.replace(/^CORRECTED:\s*/i, "").trim()

    return {
      ok: true,
      data: {
        draft,
        verification,
        verified,
        finalResponse,
        totalDurationMs: Date.now() - startTotal,
      },
    }
  } catch (e) {
    return { ok: false, error: "verify_failed", message: `❌ فشل التحقق: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface MultiModelSnapshot {
  totalOperations: number
  availableModels: number
  strategies: string[]
}

export async function multiModelSnapshot(): Promise<MultiModelResult<MultiModelSnapshot>> {
  try {
    const { modelList } = await import("@/lib/model-os/os")
    const models = await modelList({ active: true })
    return {
      ok: true,
      data: {
        totalOperations: 5,
        availableModels: models.ok ? models.data.length : 0,
        strategies: ["debate", "voting", "critic", "router", "fast-draft-strong-verify"],
      },
    }
  } catch (e) {
    return { ok: false, error: "snapshot_failed", message: `❌ فشل اللقطة: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

export function formatMultiModelResult<T>(result: MultiModelResult<T>): string {
  if (!result.ok) return `${result.message}\n[error: ${result.error}]`
  const data = result.data as unknown
  if (data === null || data === undefined) return "✅ OK"
  if (typeof data === "string") return data
  if (typeof data === "number" || typeof data === "boolean") return String(data)
  try { return JSON.stringify(data, null, 2) } catch { return String(data) }
}
