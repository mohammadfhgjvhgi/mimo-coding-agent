// Context Engineering — the complete Context OS.
// 14 operations: Budgeting, Adaptive Budget, Progressive Disclosure, Paging,
// Compression, Deduplication, Delta Context, Caching, Prefix Caching,
// Invalidation, File Ranking, Token Accounting, Spill-to-Disk, Inspector, Provenance.
// All deterministic — 0 LLM calls.

import { estimateTokens, compressConversation, formatCompressionStats } from "@/lib/context-os"
import { db } from "@/lib/db"
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"

type LLMMessage = { role: "system" | "user" | "assistant"; content: string }

export type { LLMMessage }

// ============ 1. CONTEXT BUDGETING ============
export interface ContextBudget {
  total: number
  used: number
  remaining: number
  percentage: number
  reserved: number // for output
}

export function calculateBudget(
  messages: LLMMessage[],
  provider: string,
  maxOutputTokens: number = 2048
): ContextBudget {
  const providerLimits: Record<string, number> = {
    ollama: 6000,    // conservative for 7B local
    dual: 8000,      // split across CPU+GPU
    zai: 28000,      // cloud — generous
  }
  const total = providerLimits[provider] || 8000
  const used = messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0)
  const reserved = maxOutputTokens
  const remaining = total - used - reserved
  return {
    total,
    used,
    remaining,
    percentage: Math.round((used / total) * 100),
    reserved,
  }
}

// ============ 2. ADAPTIVE CONTEXT BUDGET ============
export function adaptiveBudget(
  messages: LLMMessage[],
  provider: string,
  taskComplexity: "simple" | "medium" | "complex"
): ContextBudget {
  const base = calculateBudget(messages, provider)
  // Simple tasks need less output → more context available
  const outputReserve = taskComplexity === "simple" ? 1024 : taskComplexity === "medium" ? 2048 : 4096
  return calculateBudget(messages, provider, outputReserve)
}

// ============ 3. PROGRESSIVE DISCLOSURE ============
// Only include what's needed for the current step, not everything at once.
export function progressiveDisclosure(
  allMessages: LLMMessage[],
  currentStep: number,
  maxPerStep: number = 5
): LLMMessage[] {
  // Always keep system prompt (index 0)
  const system = allMessages[0]
  // Keep the last N messages (most recent context)
  const recent = allMessages.slice(-maxPerStep)
  // If early in conversation, show more
  if (currentStep <= 2) {
    return [system, ...allMessages.slice(1, maxPerStep + 1)]
  }
  return [system, ...recent]
}

// ============ 4. CONTEXT PAGING ============
// Split context into pages — only load the active page.
export function paginateContext(
  messages: LLMMessage[],
  pageSize: number = 10
): { pages: LLMMessage[][]; activePage: number; totalPages: number } {
  const pages: LLMMessage[][] = []
  // Always keep system prompt on every page
  const system = messages[0]
  const rest = messages.slice(1)

  for (let i = 0; i < rest.length; i += pageSize) {
    pages.push([system, ...rest.slice(i, i + pageSize)])
  }

  if (pages.length === 0) pages.push([system])

  return {
    pages,
    activePage: pages.length - 1, // last page is active
    totalPages: pages.length,
  }
}

// ============ 5. CONTEXT COMPRESSION ============
// Uses existing compressConversation from context-os.ts
export { compressConversation, formatCompressionStats }

// ============ 6. CONTEXT DEDUPLICATION ============
export function deduplicateContext(messages: LLMMessage[]): LLMMessage[] {
  const seen = new Set<string>()
  const result: LLMMessage[] = []

  for (const msg of messages) {
    // Hash content (first 200 chars to catch near-duplicates)
    const hash = createHash("sha256")
      .update(msg.content.slice(0, 200))
      .digest("hex")

    // Keep system messages always
    if (msg.role === "system") {
      result.push(msg)
      continue
    }

    // Check for duplicate content
    if (!seen.has(hash)) {
      seen.add(hash)
      result.push(msg)
    }
  }

  return result
}

// ============ 7. DELTA CONTEXT ============
// Only send what changed since last call (diff-based).
export function computeDelta(
  previousMessages: LLMMessage[],
  currentMessages: LLMMessage[]
): LLMMessage[] {
  if (previousMessages.length === 0) return currentMessages

  // Find where messages diverge
  let divergencePoint = 0
  for (let i = 0; i < Math.min(previousMessages.length, currentMessages.length); i++) {
    if (previousMessages[i].content !== currentMessages[i].content) {
      divergencePoint = i
      break
    }
    divergencePoint = i + 1
  }

  // Return only new messages + system prompt
  const system = currentMessages[0]
  const newMessages = currentMessages.slice(divergencePoint)
  return [system, ...newMessages]
}

// ============ 8. CONTEXT CACHING ============
interface CacheEntry {
  key: string
  messages: LLMMessage[]
  tokens: number
  createdAt: number
  hits: number
}

const contextCache = new Map<string, CacheEntry>()
const MAX_CACHE_SIZE = 20

export function cacheContext(key: string, messages: LLMMessage[]): void {
  const tokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  contextCache.set(key, { key, messages, tokens, createdAt: Date.now(), hits: 0 })

  // LRU eviction
  if (contextCache.size > MAX_CACHE_SIZE) {
    const oldest = [...contextCache.values()].sort((a, b) => a.createdAt - b.createdAt)[0]
    if (oldest) contextCache.delete(oldest.key)
  }
}

export function getCachedContext(key: string): LLMMessage[] | null {
  const entry = contextCache.get(key)
  if (entry) {
    entry.hits++
    entry.createdAt = Date.now() // update LRU
    return entry.messages
  }
  return null
}

export function getCacheStats(): { size: number; totalTokens: number; totalHits: number } {
  let totalTokens = 0
  let totalHits = 0
  for (const entry of contextCache.values()) {
    totalTokens += entry.tokens
    totalHits += entry.hits
  }
  return { size: contextCache.size, totalTokens, totalHits }
}

// ============ 9. PREFIX CACHING ============
// Cache the system prompt + early messages (the "prefix") separately.
// When only the user message changes, reuse the cached prefix.
const prefixCache = new Map<string, { content: string; tokens: number }>()

export function cachePrefix(conversationId: string, messages: LLMMessage[]): number {
  // The prefix = system prompt + all messages except the last user message
  const prefixMessages = messages.slice(0, -1)
  const prefixContent = prefixMessages.map(m => m.content).join("\n")
  const hash = createHash("sha256").update(prefixContent).digest("hex")
  const tokens = estimateTokens(prefixContent)

  prefixCache.set(conversationId, { content: hash, tokens })
  return tokens
}

export function getPrefixTokens(conversationId: string): number {
  return prefixCache.get(conversationId)?.tokens || 0
}

// ============ 10. CONTEXT INVALIDATION ============
// When a file is modified, invalidate any cached context that references it.
export function invalidateContext(filePath: string): { invalidated: number } {
  let invalidated = 0

  // Check context cache
  for (const [key, entry] of contextCache.entries()) {
    if (entry.messages.some(m => m.content.includes(filePath))) {
      contextCache.delete(key)
      invalidated++
    }
  }

  // Check prefix cache
  for (const [key, entry] of prefixCache.entries()) {
    // We only store the hash, so we invalidate all if file changed
    // (conservative — better to over-invalidate than miss)
    prefixCache.delete(key)
    invalidated++
  }

  return { invalidated }
}

// ============ 11. RELEVANT FILE RANKING ============
// Rank files by relevance to the current task/query.
export function rankFiles(
  files: { path: string; content?: string; name: string }[],
  query: string,
  options: {
    maxResults?: number
    includeContent?: boolean
  } = {}
): { path: string; score: number; reason: string }[] {
  const maxResults = options.maxResults || 10
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  const scored: { path: string; score: number; reason: string }[] = []

  for (const file of files) {
    let score = 0
    const reasons: string[] = []
    const pathLower = file.path.toLowerCase()
    const nameLower = file.name.toLowerCase()

    // Path match (high weight)
    for (const kw of keywords) {
      if (pathLower.includes(kw)) { score += 3; reasons.push(`path:${kw}`) }
      if (nameLower.includes(kw)) { score += 5; reasons.push(`name:${kw}`) }
    }

    // Content match (if available)
    if (options.includeContent && file.content) {
      const contentLower = file.content.toLowerCase().slice(0, 5000)
      for (const kw of keywords) {
        const count = (contentLower.match(new RegExp(kw, "g")) || []).length
        if (count > 0) { score += count; reasons.push(`content:${kw}×${count}`) }
      }
    }

    if (score > 0) {
      scored.push({ path: file.path, score, reason: reasons.join(", ") })
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, maxResults)
}

// ============ 12. TOKEN ACCOUNTING ============
export interface TokenAccount {
  input: number
  output: number
  total: number
  cost: number // estimated
  breakdown: {
    system: number
    evidence: number
    memory: number
    knowledge: number
    skills: number
    repoMap: number
    history: number
  }
}

export function accountTokens(
  systemPrompt: string,
  evidenceBlock: string,
  memoryBlock: string,
  knowledgeBlock: string,
  skillsBlock: string,
  repoMap: string,
  historyMessages: LLMMessage[],
  outputTokens: number = 0
): TokenAccount {
  const breakdown = {
    system: estimateTokens(systemPrompt),
    evidence: estimateTokens(evidenceBlock),
    memory: estimateTokens(memoryBlock),
    knowledge: estimateTokens(knowledgeBlock),
    skills: estimateTokens(skillsBlock),
    repoMap: estimateTokens(repoMap),
    history: historyMessages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0),
  }

  const input = Object.values(breakdown).reduce((sum, v) => sum + v, 0)
  const total = input + outputTokens

  // Cost estimate (local = free, Z.ai = $0.002/1K tokens)
  const costPer1K = 0.002
  const cost = (total / 1000) * costPer1K

  return { input, output: outputTokens, total, cost, breakdown }
}

// ============ 13. CONTEXT SPILL-TO-DISK ============
// When context is too large, spill overflow to disk and reference it.
export function spillToDisk(
  messages: LLMMessage[],
  conversationId: string,
  threshold: number = 4000
): { spilled: boolean; filePath: string | null; tokenCount: number } {
  const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)

  if (totalTokens <= threshold) {
    return { spilled: false, filePath: null, tokenCount: totalTokens }
  }

  // Spill older messages to disk
  const spillDir = path.join(path.resolve(WORKSPACE_ROOT), ".mimo", "spills")
  mkdirSync(spillDir, { recursive: true })

  const spillFile = path.join(spillDir, `context-${conversationId}-${Date.now()}.json`)
  const olderMessages = messages.slice(0, Math.floor(messages.length / 2))

  writeFileSync(spillFile, JSON.stringify({
    conversationId,
    spilledAt: new Date().toISOString(),
    messageCount: olderMessages.length,
    tokens: olderMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0),
    messages: olderMessages,
  }, null, 2))

  return { spilled: true, filePath: spillFile, tokenCount: totalTokens }
}

export function loadSpill(filePath: string): LLMMessage[] | null {
  try {
    if (!existsSync(filePath)) return null
    const data = JSON.parse(readFileSync(filePath, "utf8"))
    return data.messages || null
  } catch {
    return null
  }
}

// ============ 14. CONTEXT INSPECTOR ============
export interface ContextInspection {
  totalMessages: number
  totalTokens: number
  budget: ContextBudget | null
  cacheStats: { size: number; totalTokens: number; totalHits: number }
  prefixTokens: number
  breakdown: {
    system: number
    evidence: number
    memory: number
    knowledge: number
    skills: number
    repoMap: number
    history: number
  } | null
  duplicates: number
  recommendations: string[]
}

export function inspectContext(
  messages: LLMMessage[],
  provider?: string,
  account?: TokenAccount | null
): ContextInspection {
  const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  const budget = provider ? calculateBudget(messages, provider) : null
  const cacheStats = getCacheStats()

  // Count potential duplicates
  const seen = new Set<string>()
  let duplicates = 0
  for (const msg of messages) {
    const hash = createHash("sha256").update(msg.content.slice(0, 100)).digest("hex")
    if (seen.has(hash)) duplicates++
    else seen.add(hash)
  }

  // Generate recommendations
  const recommendations: string[] = []
  if (budget && budget.percentage > 80) {
    recommendations.push("⚠️ السياق قرب الميزانية — فعّل الضغط أو التقسيم")
  }
  if (duplicates > 0) {
    recommendations.push(`🔄 ${duplicates} رسالة مكررة — استخدم deduplicateContext`)
  }
  if (cacheStats.size === 0) {
    recommendations.push("💾 لا cache — استخدم cacheContext لتسريع التكرار")
  }
  if (totalTokens > 10000 && !provider) {
    recommendations.push("📀 السياق كبير — استخدم spillToDisk أو progressiveDisclosure")
  }
  if (recommendations.length === 0) {
    recommendations.push("✅ السياق صحي — لا إجراءات مطلوبة")
  }

  return {
    totalMessages: messages.length,
    totalTokens,
    budget,
    cacheStats,
    prefixTokens: 0,
    breakdown: account?.breakdown || null,
    duplicates,
    recommendations,
  }
}

// ============ 15. CONTEXT PROVENANCE ============
export interface ProvenanceEntry {
  source: string
  type: "system" | "evidence" | "memory" | "knowledge" | "skills" | "repoMap" | "history" | "tool_result" | "user_input"
  tokens: number
  percentage: number
  includedAt: string
  reason: string
}

export function trackProvenance(
  parts: { source: string; type: ProvenanceEntry["type"]; content: string; reason: string }[]
): ProvenanceEntry[] {
  const totalTokens = parts.reduce((sum, p) => sum + estimateTokens(p.content), 0)
  return parts.map(p => ({
    source: p.source,
    type: p.type,
    tokens: estimateTokens(p.content),
    percentage: totalTokens > 0 ? Math.round((estimateTokens(p.content) / totalTokens) * 100) : 0,
    includedAt: new Date().toISOString(),
    reason: p.reason,
  }))
}
