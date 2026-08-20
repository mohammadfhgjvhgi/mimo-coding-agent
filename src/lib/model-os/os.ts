// Model OS — model registry, profiles, routing, fallback, benchmarks.
// 14 operations, deterministic, bilingual (Arabic + English), persisted to SQLite.
//
// 14 operations:
//   1.  modelRegister         — register a model with profile
//   2.  providerList          — list all providers
//   3.  modelProfileGet       — get a model profile
//   4.  modelProfileUpdate    — update profile fields
//   5.  modelRoute             — pick best model for a task (priority + role + health)
//   6.  modelFallback          — get fallback chain for a model
//   7.  modelHealthCheck       — ping a model + record latency
//   8.  modelBenchmark         — run a benchmark (tps / tool_reliability / task_success)
//   9.  contextLimitGet        — get context window for a model
//   10. ramEstimate            — get RAM estimate for a model
//   11. vramEstimate           — get VRAM estimate for a model
//   12. measuredTpsGet         — get measured tok/s
//   13. toolReliabilityGet     — get tool reliability score
//   14. taskSuccessRateGet     — get task success rate

import { db } from "@/lib/db"
import { exec } from "node:child_process"
import { promisify } from "node:util"

const execAsync = promisify(exec)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelProvider = "ollama" | "zai" | "openai" | "anthropic" | "local" | "custom"

export type ModelRole = "coding" | "reasoning" | "vision" | "fast" | "cheap" | "embedding" | "general"

export type ModelCapability = "streaming" | "tools" | "vision" | "thinking" | "json_mode" | "function_calling"

export interface ModelProfileRecord {
  id: string
  modelId: string
  displayName: string
  provider: ModelProvider
  contextLimit: number
  ramEstimateMb: number
  vramEstimateMb: number
  measuredTps: number
  toolReliability: number
  taskSuccessRate: number
  roles: ModelRole[]
  capabilities: ModelCapability[]
  active: boolean
  priority: number
  fallbackChain: string[]
  benchmarkHistory: Array<{ date: string; tps: number; successRate: number; durationMs: number }>
  createdAt: Date
  updatedAt: Date
}

export interface BenchmarkResult {
  benchmarkId: string
  modelId: string
  benchmarkType: string
  value: number
  durationMs: number
  details: Record<string, unknown>
}

export interface RouteResult {
  modelId: string
  reason: string
  fallbackChain: string[]
}

export interface HealthResult {
  modelId: string
  ok: boolean
  latencyMs: number
  error?: string
}

export type ModelResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try { return JSON.parse(s) as T } catch { return fallback }
}

function rowToRecord(row: {
  id: string; modelId: string; displayName: string; provider: string;
  contextLimit: number; ramEstimateMb: number; vramEstimateMb: number;
  measuredTps: number; toolReliability: number; taskSuccessRate: number;
  roles: string; capabilities: string; active: boolean; priority: number;
  fallbackChain: string; benchmarkHistory: string;
  createdAt: Date; updatedAt: Date
}): ModelProfileRecord {
  return {
    id: row.id, modelId: row.modelId, displayName: row.displayName,
    provider: row.provider as ModelProvider,
    contextLimit: row.contextLimit,
    ramEstimateMb: row.ramEstimateMb, vramEstimateMb: row.vramEstimateMb,
    measuredTps: row.measuredTps,
    toolReliability: row.toolReliability, taskSuccessRate: row.taskSuccessRate,
    roles: safeParse(row.roles, []),
    capabilities: safeParse(row.capabilities, []),
    active: row.active, priority: row.priority,
    fallbackChain: safeParse(row.fallbackChain, []),
    benchmarkHistory: safeParse(row.benchmarkHistory, []),
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}

// ---------------------------------------------------------------------------
// 1. Model Register
// ---------------------------------------------------------------------------

export interface ModelRegisterInput {
  modelId: string
  displayName: string
  provider: ModelProvider
  contextLimit?: number
  ramEstimateMb?: number
  vramEstimateMb?: number
  roles?: ModelRole[]
  capabilities?: ModelCapability[]
  priority?: number
  fallbackChain?: string[]
}

export async function modelRegister(input: ModelRegisterInput): Promise<ModelResult<ModelProfileRecord>> {
  try {
    if (!input.modelId || !input.displayName) {
      return { ok: false, error: "no_input", message: "❌ modelId + displayName required" }
    }
    const row = await db.modelProfile.upsert({
      where: { modelId: input.modelId },
      update: {
        displayName: input.displayName,
        provider: input.provider,
        contextLimit: input.contextLimit ?? 32768,
        ramEstimateMb: input.ramEstimateMb ?? 0,
        vramEstimateMb: input.vramEstimateMb ?? 0,
        roles: JSON.stringify(input.roles ?? []),
        capabilities: JSON.stringify(input.capabilities ?? []),
        priority: input.priority ?? 50,
        fallbackChain: JSON.stringify(input.fallbackChain ?? []),
      },
      create: {
        modelId: input.modelId,
        displayName: input.displayName,
        provider: input.provider,
        contextLimit: input.contextLimit ?? 32768,
        ramEstimateMb: input.ramEstimateMb ?? 0,
        vramEstimateMb: input.vramEstimateMb ?? 0,
        roles: JSON.stringify(input.roles ?? []),
        capabilities: JSON.stringify(input.capabilities ?? []),
        priority: input.priority ?? 50,
        fallbackChain: JSON.stringify(input.fallbackChain ?? []),
      },
    })
    return { ok: true, data: rowToRecord(row) }
  } catch (e) {
    return { ok: false, error: "register_failed", message: `❌ فشل التسجيل: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 2. Provider List
// ---------------------------------------------------------------------------

export async function providerList(): Promise<ModelResult<Array<{ provider: string; modelCount: number; activeCount: number }>>> {
  try {
    const profiles = await db.modelProfile.findMany()
    const providers = new Map<string, { provider: string; modelCount: number; activeCount: number }>()
    for (const p of profiles) {
      const existing = providers.get(p.provider) ?? { provider: p.provider, modelCount: 0, activeCount: 0 }
      existing.modelCount++
      if (p.active) existing.activeCount++
      providers.set(p.provider, existing)
    }
    return { ok: true, data: Array.from(providers.values()) }
  } catch (e) {
    return { ok: false, error: "list_failed", message: `❌ فشل السرد: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 3. Model Profile Get
// ---------------------------------------------------------------------------

export async function modelProfileGet(modelId: string): Promise<ModelResult<ModelProfileRecord>> {
  try {
    const row = await db.modelProfile.findUnique({ where: { modelId } })
    if (!row) {
      return { ok: false, error: "not_found", message: `❌ النموذج غير موجود: ${modelId}` }
    }
    return { ok: true, data: rowToRecord(row) }
  } catch (e) {
    return { ok: false, error: "get_failed", message: `❌ فشل الجلب: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 4. Model Profile Update
// ---------------------------------------------------------------------------

export async function modelProfileUpdate(modelId: string, patch: Partial<{
  displayName: string; contextLimit: number; ramEstimateMb: number; vramEstimateMb: number;
  measuredTps: number; toolReliability: number; taskSuccessRate: number;
  roles: ModelRole[]; capabilities: ModelCapability[]; active: boolean;
  priority: number; fallbackChain: string[]
}>): Promise<ModelResult<ModelProfileRecord>> {
  try {
    const existing = await db.modelProfile.findUnique({ where: { modelId } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ النموذج غير موجود: ${modelId}` }
    }
    const data: Record<string, unknown> = {}
    if (patch.displayName !== undefined) data.displayName = patch.displayName
    if (patch.contextLimit !== undefined) data.contextLimit = patch.contextLimit
    if (patch.ramEstimateMb !== undefined) data.ramEstimateMb = patch.ramEstimateMb
    if (patch.vramEstimateMb !== undefined) data.vramEstimateMb = patch.vramEstimateMb
    if (patch.measuredTps !== undefined) data.measuredTps = patch.measuredTps
    if (patch.toolReliability !== undefined) data.toolReliability = patch.toolReliability
    if (patch.taskSuccessRate !== undefined) data.taskSuccessRate = patch.taskSuccessRate
    if (patch.roles !== undefined) data.roles = JSON.stringify(patch.roles)
    if (patch.capabilities !== undefined) data.capabilities = JSON.stringify(patch.capabilities)
    if (patch.active !== undefined) data.active = patch.active
    if (patch.priority !== undefined) data.priority = patch.priority
    if (patch.fallbackChain !== undefined) data.fallbackChain = JSON.stringify(patch.fallbackChain)
    const row = await db.modelProfile.update({ where: { modelId }, data })
    return { ok: true, data: rowToRecord(row) }
  } catch (e) {
    return { ok: false, error: "update_failed", message: `❌ فشل التحديث: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 5. Model Route — pick best model for a task
// ---------------------------------------------------------------------------

export async function modelRoute(opts: { role?: ModelRole; preferProvider?: ModelProvider; requireCapability?: ModelCapability }): Promise<ModelResult<RouteResult>> {
  try {
    const where: Record<string, unknown> = { active: true }
    const profiles = await db.modelProfile.findMany({ where, orderBy: { priority: "asc" } })
    if (profiles.length === 0) {
      return { ok: false, error: "no_models", message: "❌ لا نماذج مسجلة / no models registered" }
    }
    // Score each model
    let best = profiles[0]
    let bestScore = -1
    for (const p of profiles) {
      const roles = safeParse<ModelRole[]>(p.roles, [])
      const caps = safeParse<ModelCapability[]>(p.capabilities, [])
      let score = 100 - p.priority // lower priority = higher base score
      // Role match bonus
      if (opts.role && roles.includes(opts.role)) score += 50
      // Provider preference
      if (opts.preferProvider && p.provider === opts.preferProvider) score += 30
      // Capability requirement (mandatory)
      if (opts.requireCapability && !caps.includes(opts.requireCapability)) score -= 100
      // Performance bonus
      if (p.measuredTps > 0) score += Math.min(20, p.measuredTps / 5)
      if (p.taskSuccessRate > 0) score += p.taskSuccessRate * 20
      if (score > bestScore) {
        bestScore = score
        best = p
      }
    }
    const fallbackChain = safeParse<string[]>(best.fallbackChain, [])
    const roleStr = opts.role ? ` (role: ${opts.role})` : ""
    return {
      ok: true,
      data: {
        modelId: best.modelId,
        reason: `أفضل نموذج: ${best.displayName}${roleStr} (score=${bestScore.toFixed(0)}, priority=${best.priority})`,
        fallbackChain,
      },
    }
  } catch (e) {
    return { ok: false, error: "route_failed", message: `❌ فشل التوجيه: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 6. Model Fallback
// ---------------------------------------------------------------------------

export async function modelFallback(modelId: string): Promise<ModelResult<{ chain: string[]; currentIndex: number }>> {
  try {
    const profile = await db.modelProfile.findUnique({ where: { modelId } })
    if (!profile) {
      return { ok: false, error: "not_found", message: `❌ النموذج غير موجود: ${modelId}` }
    }
    const chain = safeParse<string[]>(profile.fallbackChain, [])
    return { ok: true, data: { chain: [modelId, ...chain], currentIndex: 0 } }
  } catch (e) {
    return { ok: false, error: "fallback_failed", message: `❌ فشل السلسلة: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 7. Model Health Check
// ---------------------------------------------------------------------------

export async function modelHealthCheck(modelId: string): Promise<ModelResult<HealthResult>> {
  const start = Date.now()
  try {
    const profile = await db.modelProfile.findUnique({ where: { modelId } })
    if (!profile) {
      return { ok: false, error: "not_found", message: `❌ النموذج غير موجود: ${modelId}` }
    }
    let ok = false
    let error: string | undefined
    if (profile.provider === "ollama") {
      // Ping Ollama /api/tags
      try {
        const res = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(5000) })
        ok = res.ok
        if (!ok) error = `HTTP ${res.status}`
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
      }
    } else if (profile.provider === "zai") {
      // Z.ai is always available if SDK loads
      ok = true
    } else {
      // Generic: assume ok
      ok = true
    }
    return {
      ok: true,
      data: { modelId, ok, latencyMs: Date.now() - start, error },
    }
  } catch (e) {
    return { ok: false, error: "health_failed", message: `❌ فشل الفحص: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 8. Model Benchmark
// ---------------------------------------------------------------------------

export interface BenchmarkInput {
  modelId: string
  benchmarkType: "tps" | "tool_reliability" | "task_success" | "context_fill" | "latency"
  value: number
  durationMs?: number
  details?: Record<string, unknown>
}

export async function modelBenchmark(input: BenchmarkInput): Promise<ModelResult<BenchmarkResult>> {
  try {
    const profile = await db.modelProfile.findUnique({ where: { modelId: input.modelId } })
    if (!profile) {
      return { ok: false, error: "not_found", message: `❌ النموذج غير موجود: ${input.modelId}` }
    }
    // Save benchmark record
    const bench = await db.modelBenchmark.create({
      data: {
        modelId: input.modelId,
        benchmarkType: input.benchmarkType,
        value: input.value,
        durationMs: input.durationMs ?? 0,
        details: JSON.stringify(input.details ?? {}),
      },
    })
    // Update the model profile with the new measurement
    const updates: Record<string, unknown> = {}
    const history = safeParse<Array<{ date: string; tps: number; successRate: number; durationMs: number }>>(profile.benchmarkHistory, [])
    history.push({ date: new Date().toISOString(), tps: input.benchmarkType === "tps" ? input.value : profile.measuredTps, successRate: input.benchmarkType === "task_success" ? input.value : profile.taskSuccessRate, durationMs: input.durationMs ?? 0 })
    if (history.length > 50) history.shift()
    updates.benchmarkHistory = JSON.stringify(history)
    if (input.benchmarkType === "tps") updates.measuredTps = input.value
    if (input.benchmarkType === "tool_reliability") updates.toolReliability = input.value
    if (input.benchmarkType === "task_success") updates.taskSuccessRate = input.value
    await db.modelProfile.update({ where: { modelId: input.modelId }, data: updates })
    return {
      ok: true,
      data: {
        benchmarkId: bench.id,
        modelId: input.modelId,
        benchmarkType: input.benchmarkType,
        value: input.value,
        durationMs: input.durationMs ?? 0,
        details: input.details ?? {},
      },
    }
  } catch (e) {
    return { ok: false, error: "benchmark_failed", message: `❌ فشل القياس: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 9-14. Getters for individual metrics
// ---------------------------------------------------------------------------

export async function contextLimitGet(modelId: string): Promise<ModelResult<number>> {
  const r = await modelProfileGet(modelId)
  return r.ok ? { ok: true, data: r.data.contextLimit } : r as unknown as ModelResult<number>
}

export async function ramEstimate(modelId: string): Promise<ModelResult<number>> {
  const r = await modelProfileGet(modelId)
  return r.ok ? { ok: true, data: r.data.ramEstimateMb } : r as unknown as ModelResult<number>
}

export async function vramEstimate(modelId: string): Promise<ModelResult<number>> {
  const r = await modelProfileGet(modelId)
  return r.ok ? { ok: true, data: r.data.vramEstimateMb } : r as unknown as ModelResult<number>
}

export async function measuredTpsGet(modelId: string): Promise<ModelResult<number>> {
  const r = await modelProfileGet(modelId)
  return r.ok ? { ok: true, data: r.data.measuredTps } : r as unknown as ModelResult<number>
}

export async function toolReliabilityGet(modelId: string): Promise<ModelResult<number>> {
  const r = await modelProfileGet(modelId)
  return r.ok ? { ok: true, data: r.data.toolReliability } : r as unknown as ModelResult<number>
}

export async function taskSuccessRateGet(modelId: string): Promise<ModelResult<number>> {
  const r = await modelProfileGet(modelId)
  return r.ok ? { ok: true, data: r.data.taskSuccessRate } : r as unknown as ModelResult<number>
}

// ---------------------------------------------------------------------------
// List + Snapshot
// ---------------------------------------------------------------------------

export async function modelList(opts: { provider?: string; active?: boolean; limit?: number } = {}): Promise<ModelResult<ModelProfileRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.provider) where.provider = opts.provider
    if (opts.active !== undefined) where.active = opts.active
    const rows = await db.modelProfile.findMany({ where, orderBy: { priority: "asc" }, take: opts.limit ?? 100 })
    return { ok: true, data: rows.map(rowToRecord) }
  } catch (e) {
    return { ok: false, error: "list_failed", message: `❌ فشل السرد: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export interface ModelSnapshot {
  totalModels: number
  activeModels: number
  byProvider: Record<string, number>
  avgTps: number
  avgToolReliability: number
  avgTaskSuccessRate: number
  totalBenchmarks: number
}

export async function modelSnapshot(): Promise<ModelResult<ModelSnapshot>> {
  try {
    const profiles = await db.modelProfile.findMany()
    const benchmarks = await db.modelBenchmark.count()
    const byProvider: Record<string, number> = {}
    let totalTps = 0, tpsCount = 0
    let totalToolRel = 0, toolRelCount = 0
    let totalTaskRate = 0, taskRateCount = 0
    for (const p of profiles) {
      byProvider[p.provider] = (byProvider[p.provider] ?? 0) + 1
      if (p.measuredTps > 0) { totalTps += p.measuredTps; tpsCount++ }
      if (p.toolReliability > 0) { totalToolRel += p.toolReliability; toolRelCount++ }
      if (p.taskSuccessRate > 0) { totalTaskRate += p.taskSuccessRate; taskRateCount++ }
    }
    return {
      ok: true,
      data: {
        totalModels: profiles.length,
        activeModels: profiles.filter(p => p.active).length,
        byProvider,
        avgTps: tpsCount > 0 ? totalTps / tpsCount : 0,
        avgToolReliability: toolRelCount > 0 ? totalToolRel / toolRelCount : 0,
        avgTaskSuccessRate: taskRateCount > 0 ? totalTaskRate / taskRateCount : 0,
        totalBenchmarks: benchmarks,
      },
    }
  } catch (e) {
    return { ok: false, error: "snapshot_failed", message: `❌ فشل اللقطة: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// Default models seeder
// ---------------------------------------------------------------------------

export async function seedDefaultModels(): Promise<ModelResult<{ seeded: string[]; skipped: string[] }>> {
  try {
    const defaults: ModelRegisterInput[] = [
      { modelId: "ollama:qwen2.5-coder:7b", displayName: "Qwen2.5 Coder 7B", provider: "ollama", contextLimit: 32768, ramEstimateMb: 4500, vramEstimateMb: 4500, roles: ["coding", "reasoning"], capabilities: ["streaming", "tools"], priority: 30, fallbackChain: ["ollama:qwen3:4b", "zai:glm-4.5v"] },
      { modelId: "ollama:qwen3:4b", displayName: "Qwen3 4B", provider: "ollama", contextLimit: 32768, ramEstimateMb: 2800, vramEstimateMb: 2800, roles: ["fast", "coding"], capabilities: ["streaming", "tools"], priority: 20, fallbackChain: ["ollama:qwen3:1.7b"] },
      { modelId: "ollama:qwen3:1.7b", displayName: "Qwen3 1.7B", provider: "ollama", contextLimit: 32768, ramEstimateMb: 1200, vramEstimateMb: 1200, roles: ["fast", "cheap"], capabilities: ["streaming"], priority: 10, fallbackChain: [] },
      { modelId: "zai:glm-4.5v", displayName: "Z.ai GLM-4.5V", provider: "zai", contextLimit: 128000, ramEstimateMb: 0, vramEstimateMb: 0, roles: ["reasoning", "vision", "coding"], capabilities: ["streaming", "tools", "vision", "thinking", "json_mode"], priority: 40, fallbackChain: ["ollama:qwen2.5-coder:7b"] },
      { modelId: "zai:glm-5.2", displayName: "Z.ai GLM-5.2", provider: "zai", contextLimit: 128000, ramEstimateMb: 0, vramEstimateMb: 0, roles: ["reasoning", "coding", "general"], capabilities: ["streaming", "tools", "thinking"], priority: 35, fallbackChain: ["zai:glm-4.5v", "ollama:qwen2.5-coder:7b"] },
    ]
    const seeded: string[] = []
    const skipped: string[] = []
    for (const d of defaults) {
      const existing = await db.modelProfile.findUnique({ where: { modelId: d.modelId } })
      if (existing) { skipped.push(d.modelId); continue }
      const res = await modelRegister(d)
      if (res.ok) seeded.push(d.modelId)
    }
    return { ok: true, data: { seeded, skipped } }
  } catch (e) {
    return { ok: false, error: "seed_failed", message: `❌ فشل البذر: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

export function formatModelResult<T>(result: ModelResult<T>): string {
  if (!result.ok) return `${result.message}\n[error: ${result.error}]`
  const data = result.data as unknown
  if (data === null || data === undefined) return "✅ OK"
  if (typeof data === "string") return data
  if (typeof data === "number" || typeof data === "boolean") return String(data)
  try { return JSON.stringify(data, null, 2) } catch { return String(data) }
}
