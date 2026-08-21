// Cost / Resource Intelligence — track + optimize resource usage.
// 8 metrics + resource-aware routing. No Prisma — pure computation layer.
// Uses Model OS for model profiles + os module for system stats.
//
// 8 metrics:
//   1. tokenCost       — tokens used × cost per token (0 for local, >0 for cloud)
//   2. timeCost         — wall-clock time spent on a task
//   3. toolCost         — number of tool calls + their cumulative duration
//   4. ramCost          — estimated RAM consumed (MB) by loaded model
//   5. vramCost         — estimated VRAM consumed (MB) by loaded model
//   6. cpuCost          — CPU time (user + system) consumed
//   7. contextWaste     — tokens wasted on context that wasn't useful (repeated/duplicate)
//   8. modelEfficiency   — useful output tokens / total tokens consumed
//
// Resource-Aware Routing:
//   - If a task can be solved by AST/regex/file-read → don't use a model at all
//   - If a task is simple (search, list) → use smallest model
//   - If a task needs reasoning → use medium model
//   - If a task needs vision/code-gen → use capable model

import { modelProfileGet, modelRoute } from "@/lib/model-os/os"
import { exec } from "node:child_process"
import { promisify } from "node:util"
import os from "node:os"

const execAsync = promisify(exec)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CostBreakdown {
  tokenCost: number        // USD or 0 for local
  timeCostMs: number       // wall-clock time
  toolCalls: number        // number of tool calls
  toolDurationMs: number   // total tool call duration
  ramCostMb: number        // estimated RAM used
  vramCostMb: number       // estimated VRAM used
  cpuCostMs: number        // CPU time (user + system)
  contextWasteTokens: number // tokens that were redundant
  modelEfficiency: number  // output_tokens / total_tokens (0-1)
  totalCostScore: number   // weighted aggregate (0-100, lower = cheaper)
}

export interface ResourceRouteResult {
  strategy: "no_model" | "smallest" | "medium" | "capable" | "cloud"
  modelId: string | null
  reason: string
  estimatedCost: Partial<CostBreakdown>
  alternativesAvoided: string[]
}

export interface CostRecord {
  taskId: string
  modelId: string
  breakdown: CostBreakdown
  timestamp: string
}

export type CostResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string }

// ---------------------------------------------------------------------------
// In-memory cost ledger (per session)
// ---------------------------------------------------------------------------

const costLedger: CostRecord[] = []

// ---------------------------------------------------------------------------
// 1. Token Cost
// ---------------------------------------------------------------------------

export function tokenCost(inputTokens: number, outputTokens: number, modelId: string): number {
  // Local models (Ollama) = 0 cost
  if (modelId.startsWith("ollama:")) return 0
  // Z.ai models — estimate (very cheap, ~$0.001 per 1K tokens)
  if (modelId.startsWith("zai:")) {
    return ((inputTokens + outputTokens) / 1000) * 0.001
  }
  // Cloud models — rough estimates
  if (modelId.includes("gpt-4")) return ((inputTokens * 0.03) + (outputTokens * 0.06)) / 1000
  if (modelId.includes("claude")) return ((inputTokens * 0.015) + (outputTokens * 0.075)) / 1000
  // Default: assume cheap
  return ((inputTokens + outputTokens) / 1000) * 0.002
}

// ---------------------------------------------------------------------------
// 2. Time Cost
// ---------------------------------------------------------------------------

export function timeCost(startMs: number, endMs: number = Date.now()): number {
  return Math.max(0, endMs - startMs)
}

// ---------------------------------------------------------------------------
// 3. Tool Cost
// ---------------------------------------------------------------------------

export interface ToolCallMetric {
  name: string
  durationMs: number
}

export function toolCost(calls: ToolCallMetric[]): { toolCalls: number; toolDurationMs: number } {
  return {
    toolCalls: calls.length,
    toolDurationMs: calls.reduce((sum, c) => sum + c.durationMs, 0),
  }
}

// ---------------------------------------------------------------------------
// 4-5. RAM + VRAM Cost
// ---------------------------------------------------------------------------

export async function ramCost(modelId: string): Promise<number> {
  const profile = await modelProfileGet(modelId)
  return profile.ok ? profile.data.ramEstimateMb : 0
}

export async function vramCost(modelId: string): Promise<number> {
  const profile = await modelProfileGet(modelId)
  return profile.ok ? profile.data.vramEstimateMb : 0
}

// ---------------------------------------------------------------------------
// 6. CPU Cost
// ---------------------------------------------------------------------------

export async function cpuCost(startMs: number): Promise<number> {
  try {
    // Use process.cpuUsage (microseconds → ms)
    const usage = process.cpuUsage()
    return Math.round((usage.user + usage.system) / 1000)
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// 7. Context Waste
// ---------------------------------------------------------------------------

export function contextWaste(messages: Array<{ role: string; content: string }>): number {
  // Count tokens that are duplicate or near-duplicate
  let wasteTokens = 0
  const seenContent: string[] = []
  for (const msg of messages) {
    const content = msg.content.toLowerCase()
    // Check if this message is >70% similar to a previous one
    for (const seen of seenContent) {
      const overlap = jaccardSimilarity(content, seen)
      if (overlap > 0.7) {
        // This message is largely a duplicate
        wasteTokens += Math.ceil(content.length / 4)
        break
      }
    }
    seenContent.push(content)
  }
  return wasteTokens
}

function jaccardSimilarity(s1: string, s2: string): number {
  const words1 = new Set(s1.split(/\s+/).filter(w => w.length > 3))
  const words2 = new Set(s2.split(/\s+/).filter(w => w.length > 3))
  if (words1.size === 0 || words2.size === 0) return 0
  let intersection = 0
  for (const w of words1) if (words2.has(w)) intersection++
  return intersection / (words1.size + words2.size - intersection)
}

// ---------------------------------------------------------------------------
// 8. Model Efficiency
// ---------------------------------------------------------------------------

export function modelEfficiency(inputTokens: number, outputTokens: number, usefulTokens: number): number {
  const total = inputTokens + outputTokens
  if (total === 0) return 0
  return Math.min(1, usefulTokens / total)
}

// ---------------------------------------------------------------------------
// Full Cost Breakdown
// ---------------------------------------------------------------------------

export async function computeCostBreakdown(opts: {
  modelId: string
  inputTokens: number
  outputTokens: number
  usefulTokens?: number
  startMs: number
  endMs?: number
  toolCalls?: ToolCallMetric[]
  messages?: Array<{ role: string; content: string }>
}): Promise<CostResult<CostBreakdown>> {
  try {
    const endMs = opts.endMs ?? Date.now()
    const tools = toolCost(opts.toolCalls ?? [])
    const ram = await ramCost(opts.modelId)
    const vram = await vramCost(opts.modelId)
    const cpu = await cpuCost(opts.startMs)
    const waste = opts.messages ? contextWaste(opts.messages) : 0
    const efficiency = modelEfficiency(opts.inputTokens, opts.outputTokens, opts.usefulTokens ?? opts.outputTokens)
    const tCost = tokenCost(opts.inputTokens, opts.outputTokens, opts.modelId)
    const tTime = timeCost(opts.startMs, endMs)

    // Aggregate score (0-100, lower = cheaper)
    // Weighted: token cost (30) + time (20) + tools (10) + RAM (15) + VRAM (10) + waste (10) + efficiency penalty (5)
    const tokenScore = Math.min(30, tCost * 1000) // $0.03 → 30
    const timeScore = Math.min(20, tTime / 500) // 10s → 20
    const toolScore = Math.min(10, tools.toolCalls * 2) // 5 calls → 10
    const ramScore = Math.min(15, ram / 500) // 7.5GB → 15
    const vramScore = Math.min(10, vram / 500)
    const wasteScore = Math.min(10, waste / 100) // 1000 waste tokens → 10
    const efficiencyPenalty = (1 - efficiency) * 5

    const totalCostScore = tokenScore + timeScore + toolScore + ramScore + vramScore + wasteScore + efficiencyPenalty

    return {
      ok: true,
      data: {
        tokenCost: tCost,
        timeCostMs: tTime,
        toolCalls: tools.toolCalls,
        toolDurationMs: tools.toolDurationMs,
        ramCostMb: ram,
        vramCostMb: vram,
        cpuCostMs: cpu,
        contextWasteTokens: waste,
        modelEfficiency: efficiency,
        totalCostScore: Math.round(totalCostScore * 10) / 10,
      },
    }
  } catch (e) {
    return { ok: false, error: "compute_failed", message: `❌ فشل الحساب: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// Resource-Aware Routing
// ---------------------------------------------------------------------------

export async function resourceAwareRoute(opts: {
  task: string
  availableTools?: string[]
}): Promise<CostResult<ResourceRouteResult>> {
  try {
    const task = opts.task.toLowerCase()
    const alternatives: string[] = []

    // 1. Can this be solved WITHOUT a model? (AST, regex, file read)
    const noModelPatterns: Array<{ pattern: RegExp; tool: string; reason: string }> = [
      { pattern: /\b(find|search|locate)\s+(symbol|function|class|variable|definition)\b/i, tool: "find_symbol", reason: "AST search can find symbols — no model needed" },
      { pattern: /\b(references?|usages?|who\s+calls)\b/i, tool: "get_references", reason: "Reference graph can answer — no model needed" },
      { pattern: /\b(list|show|display)\s+(files?|structure|tree|directory)\b/i, tool: "list_files", reason: "File listing is a tool call — no model needed" },
      { pattern: /\b(git\s+status|git\s+log|git\s+diff|git\s+blame)\b/i, tool: "run_terminal_command", reason: "Git commands are deterministic — no model needed" },
      { pattern: /\b(lint|typecheck|eslint|tsc)\b/i, tool: "run_terminal_command", reason: "Lint/typecheck is deterministic — no model needed" },
      { pattern: /\b(verify|check)\s+(syntax|build|compile)\b/i, tool: "run_terminal_command", reason: "Verification is deterministic — no model needed" },
    ]

    for (const p of noModelPatterns) {
      if (p.pattern.test(task)) {
        alternatives.push(p.tool)
        return {
          ok: true,
          data: {
            strategy: "no_model",
            modelId: null,
            reason: `${p.reason} / ${p.reason}`,
            estimatedCost: { tokenCost: 0, timeCostMs: 100, toolCalls: 1, ramCostMb: 0, vramCostMb: 0, contextWasteTokens: 0, modelEfficiency: 1 },
            alternativesAvoided: alternatives,
          },
        }
      }
    }

    // 2. Simple tasks → smallest model
    const simplePatterns = /\b(search|list|count|read|show|what\s+is|define|explain\s+briefly)\b/i
    if (simplePatterns.test(task) && task.length < 100) {
      const route = await modelRoute({ role: "fast" })
      if (route.ok) {
        return {
          ok: true,
          data: {
            strategy: "smallest",
            modelId: route.data.modelId,
            reason: `مهمة بسيطة → أصغر نموذج سريع / simple task → fast small model`,
            estimatedCost: { tokenCost: 0, ramCostMb: 1200, vramCostMb: 1200, modelEfficiency: 0.8 },
            alternativesAvoided: alternatives,
          },
        }
      }
    }

    // 3. Coding tasks → medium model
    const codingPatterns = /\b(write|code|implement|debug|fix|refactor|edit)\b/i
    if (codingPatterns.test(task)) {
      const route = await modelRoute({ role: "coding" })
      if (route.ok) {
        return {
          ok: true,
          data: {
            strategy: "medium",
            modelId: route.data.modelId,
            reason: `مهمة برمجية → نموذج برمجي متوسط / coding task → medium coding model`,
            estimatedCost: { tokenCost: 0, ramCostMb: 2800, vramCostMb: 2800, modelEfficiency: 0.6 },
            alternativesAvoided: alternatives,
          },
        }
      }
    }

    // 4. Reasoning/design tasks → capable model
    const reasoningPatterns = /\b(design|architect|plan|analyze|compare|evaluate|strategy)\b/i
    if (reasoningPatterns.test(task)) {
      const route = await modelRoute({ role: "reasoning" })
      if (route.ok) {
        return {
          ok: true,
          data: {
            strategy: "capable",
            modelId: route.data.modelId,
            reason: `مهمة تحليلية → نموذج قوي / reasoning task → capable model`,
            estimatedCost: { tokenCost: 0, ramCostMb: 4500, vramCostMb: 4500, modelEfficiency: 0.5 },
            alternativesAvoided: alternatives,
          },
        }
      }
    }

    // 5. Vision tasks → capable + vision model
    if (/\b(image|screenshot|diagram|chart|visual|vision)\b/i.test(task)) {
      const route = await modelRoute({ role: "vision", requireCapability: "vision" })
      if (route.ok) {
        return {
          ok: true,
          data: {
            strategy: "capable",
            modelId: route.data.modelId,
            reason: `مهمة بصرية → نموذج رؤية / vision task → vision-capable model`,
            estimatedCost: { tokenCost: 0, ramCostMb: 0, vramCostMb: 0, modelEfficiency: 0.5 },
            alternativesAvoided: alternatives,
          },
        }
      }
    }

    // 6. Default → medium model
    const route = await modelRoute({})
    return {
      ok: true,
      data: {
        strategy: "medium",
        modelId: route.ok ? route.data.modelId : null,
        reason: `افتراضي → نموذج متوسط / default → medium model`,
        estimatedCost: { tokenCost: 0, ramCostMb: 2800, vramCostMb: 2800 },
        alternativesAvoided: alternatives,
      },
    }
  } catch (e) {
    return { ok: false, error: "route_failed", message: `❌ فشل التوجيه: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// System resource snapshot (real-time)
// ---------------------------------------------------------------------------

export interface SystemResources {
  totalRamMb: number
  freeRamMb: number
  usedRamMb: number
  ramUsagePct: number
  cpuCount: number
  cpuLoadAvg: number[]
  uptimeSec: number
  processMemoryMb: number
}

export function systemResources(): SystemResources {
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem
  const processMem = process.memoryUsage()
  return {
    totalRamMb: Math.round(totalMem / 1024 / 1024),
    freeRamMb: Math.round(freeMem / 1024 / 1024),
    usedRamMb: Math.round(usedMem / 1024 / 1024),
    ramUsagePct: Math.round((usedMem / totalMem) * 100),
    cpuCount: os.cpus().length,
    cpuLoadAvg: os.loadavg(),
    uptimeSec: Math.round(os.uptime()),
    processMemoryMb: Math.round(processMem.rss / 1024 / 1024),
  }
}

// ---------------------------------------------------------------------------
// Cost ledger — record + query
// ---------------------------------------------------------------------------

export function recordCost(record: CostRecord): void {
  costLedger.push(record)
  if (costLedger.length > 1000) costLedger.shift()
}

export function getCostHistory(limit: number = 50): CostRecord[] {
  return costLedger.slice(-limit)
}

export function getCostSummary(): {
  totalTasks: number
  totalTokenCost: number
  totalTimeMs: number
  totalToolCalls: number
  avgCostScore: number
  avgEfficiency: number
} {
  if (costLedger.length === 0) {
    return { totalTasks: 0, totalTokenCost: 0, totalTimeMs: 0, totalToolCalls: 0, avgCostScore: 0, avgEfficiency: 0 }
  }
  const totalTokenCost = costLedger.reduce((s, r) => s + r.breakdown.tokenCost, 0)
  const totalTimeMs = costLedger.reduce((s, r) => s + r.breakdown.timeCostMs, 0)
  const totalToolCalls = costLedger.reduce((s, r) => s + r.breakdown.toolCalls, 0)
  const avgCostScore = costLedger.reduce((s, r) => s + r.breakdown.totalCostScore, 0) / costLedger.length
  const avgEfficiency = costLedger.reduce((s, r) => s + r.breakdown.modelEfficiency, 0) / costLedger.length
  return {
    totalTasks: costLedger.length,
    totalTokenCost,
    totalTimeMs,
    totalToolCalls,
    avgCostScore: Math.round(avgCostScore * 10) / 10,
    avgEfficiency: Math.round(avgEfficiency * 100) / 100,
  }
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

export function formatCostResult<T>(result: CostResult<T>): string {
  if (!result.ok) return `${result.message}\n[error: ${result.error}]`
  const data = result.data as unknown
  if (data === null || data === undefined) return "✅ OK"
  if (typeof data === "string") return data
  if (typeof data === "number" || typeof data === "boolean") return String(data)
  try { return JSON.stringify(data, null, 2) } catch { return String(data) }
}
