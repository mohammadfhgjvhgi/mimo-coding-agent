// Evidence System — the complete Evidence Package system.
// Every piece of information the model sees is tracked with:
// Source, Path, Symbol, Reason, Confidence, Freshness, TokenCost, DependencyRelation.
// Then: Ranking, Deduplication, Freshness check, Invalidation.
// All deterministic — 0 LLM calls.

import { createHash } from "node:crypto"
import { statSync, existsSync } from "node:fs"
import path from "node:path"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"
import { estimateTokens } from "@/lib/context-os"

// ============ EVIDENCE ITEM (enhanced) ============
export interface EvidenceItem {
  id: string
  source: string              // "git" | "symbols" | "memory" | "tasks" | "file" | "diagnostics" | "repoMap" | "knowledge" | "skills"
  path?: string               // file path if applicable
  symbol?: string            // symbol name if applicable
  content: string            // the actual evidence text
  reason: string             // why this was included
  confidence: number        // 0-1 — how reliable is this evidence
  freshness: number         // 0-1 — 1 = just now, 0 = stale
  tokenCost: number         // estimated tokens this evidence costs
  dependencyRelation?: string  // "imports" | "calls" | "extends" | "related" — relation to current task
  timestamp: number         // when collected (epoch ms)
  hash: string              // content hash for dedup
}

export interface EvidencePackage {
  items: EvidenceItem[]
  totalTokens: number
  budget: number
  sources: string[]          // provenance: which sources contributed
  summary: string           // one-line summary
  recommendations: string[] // system recommendations
}

// ============ COLLECTORS ============

// Collect evidence from a specific file (with freshness + dependency info)
export function collectFileEvidence(
  filePath: string,
  content: string,
  reason: string = "relevant to task",
  dependencyRelation?: string
): EvidenceItem {
  let freshness = 0.5
  let confidence = 0.8

  try {
    const abs = path.isAbsolute(filePath)
      ? filePath
      : path.join(path.resolve(WORKSPACE_ROOT), filePath)
    if (existsSync(abs)) {
      const stat = statSync(abs)
      const ageHours = (Date.now() - stat.mtime.getTime()) / 3600000
      freshness = Math.max(0.1, Math.exp(-ageHours / 168)) // 1 week half-life
      confidence = 0.9 // file exists = high confidence
    }
  } catch { /* defaults */ }

  const hash = createHash("sha256").update(content.slice(0, 500)).digest("hex").slice(0, 16)

  return {
    id: `ev_file_${hash}`,
    source: "file",
    path: filePath,
    content,
    reason,
    confidence,
    freshness,
    tokenCost: estimateTokens(content),
    dependencyRelation,
    timestamp: Date.now(),
    hash,
  }
}

// Collect evidence from a symbol (AST-extracted)
export function collectSymbolEvidence(
  symbolName: string,
  symbolPath: string,
  signature: string,
  reason: string = "symbol relevant to query"
): EvidenceItem {
  const content = `${symbolName} in ${symbolPath}: ${signature}`
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 16)

  return {
    id: `ev_sym_${hash}`,
    source: "symbols",
    path: symbolPath,
    symbol: symbolName,
    content,
    reason,
    confidence: 0.95, // AST-extracted = very reliable
    freshness: 0.8,   // symbols don't change often unless file is edited
    tokenCost: estimateTokens(content),
    timestamp: Date.now(),
    hash,
  }
}

// Collect evidence from memory (with confidence + freshness from memory metadata)
export function collectMemoryEvidence(
  key: string,
  value: string,
  confidence: number = 0.8,
  ageDays: number = 0,
  tier: string = "semantic"
): EvidenceItem {
  const freshness = Math.max(0.1, Math.exp(-ageDays / 365))
  const content = `${key}: ${value}`
  const hash = createHash("sha256").update(content.slice(0, 200)).digest("hex").slice(0, 16)

  return {
    id: `ev_mem_${hash}`,
    source: "memory",
    content,
    reason: `memory tier: ${tier} — recalled by relevance`,
    confidence,
    freshness,
    tokenCost: estimateTokens(content),
    timestamp: Date.now(),
    hash,
  }
}

// Collect evidence from git status
export function collectGitEvidence(status: string, log: string): EvidenceItem {
  const content = `Git Status:\n${status}\n\nRecent commits:\n${log}`
  const hash = createHash("sha256").update(content.slice(0, 200)).digest("hex").slice(0, 16)

  return {
    id: `ev_git_${hash}`,
    source: "git",
    content,
    reason: "workspace state — modified files + recent history",
    confidence: 1.0, // git is ground truth
    freshness: 1.0,  // just collected
    tokenCost: estimateTokens(content),
    timestamp: Date.now(),
    hash,
  }
}

// Collect evidence from diagnostics (lint/typecheck results)
export function collectDiagnosticsEvidence(results: string): EvidenceItem {
  const hash = createHash("sha256").update(results.slice(0, 200)).digest("hex").slice(0, 16)

  return {
    id: `ev_diag_${hash}`,
    source: "diagnostics",
    content: results,
    reason: "current code health — lint/typecheck results",
    confidence: 1.0,
    freshness: 1.0,
    tokenCost: estimateTokens(results),
    timestamp: Date.now(),
    hash,
  }
}

// Collect evidence from repo map (Aider-style)
export function collectRepoMapEvidence(repoMap: string): EvidenceItem {
  const hash = createHash("sha256").update(repoMap.slice(0, 200)).digest("hex").slice(0, 16)

  return {
    id: `ev_map_${hash}`,
    source: "repoMap",
    content: repoMap,
    reason: "project structure overview — for navigation",
    confidence: 0.9,
    freshness: 0.7,
    tokenCost: estimateTokens(repoMap),
    timestamp: Date.now(),
    hash,
  }
}

// ============ 1. EVIDENCE RANKING ============
// Rank evidence by combined score: confidence × freshness × relevance ÷ tokenCost
export function rankEvidence(
  items: EvidenceItem[],
  query?: string
): EvidenceItem[] {
  const keywords = query?.toLowerCase().split(/\s+/).filter(w => w.length > 2) || []

  return items
    .map(item => {
      // Relevance score (keyword match)
      let relevance = 0.5 // default
      if (keywords.length > 0) {
        const contentLower = item.content.toLowerCase()
        const matches = keywords.filter(kw => contentLower.includes(kw)).length
        relevance = matches / keywords.length
      }

      // Combined score: confidence × freshness × relevance, penalize high token cost
      const tokenPenalty = Math.max(0.3, 1 - (item.tokenCost / 5000))
      const combinedScore = item.confidence * item.freshness * relevance * tokenPenalty

      return { ...item, _score: combinedScore }
    })
    .sort((a, b) => (b as any)._score - (a as any)._score)
}

// ============ 2. EVIDENCE DEDUPLICATION ============
export function deduplicateEvidence(items: EvidenceItem[]): EvidenceItem[] {
  const seen = new Map<string, EvidenceItem>()

  for (const item of items) {
    const existing = seen.get(item.hash)
    if (!existing) {
      seen.set(item.hash, item)
    } else {
      // Keep the one with higher confidence
      if (item.confidence > existing.confidence) {
        seen.set(item.hash, item)
      }
    }
  }

  return [...seen.values()]
}

// ============ 3. EVIDENCE FRESHNESS ============
// Check freshness and mark stale evidence.
export function checkFreshness(items: EvidenceItem[], maxAgeMs: number = 3600000): {
  fresh: EvidenceItem[]
  stale: EvidenceItem[]
} {
  const now = Date.now()
  const fresh: EvidenceItem[] = []
  const stale: EvidenceItem[] = []

  for (const item of items) {
    const age = now - item.timestamp
    if (age > maxAgeMs) {
      stale.push({ ...item, freshness: Math.max(0.1, item.freshness * 0.5) })
    } else {
      fresh.push(item)
    }
  }

  return { fresh, stale }
}

// ============ 4. EVIDENCE INVALIDATION ============
// When a file is modified or deleted, invalidate evidence that references it.
export function invalidateEvidence(
  items: EvidenceItem[],
  changedFiles: string[]
): { valid: EvidenceItem[]; invalidated: number } {
  const changedSet = new Set(changedFiles.map(f => path.normalize(f)))
  const valid: EvidenceItem[] = []
  let invalidated = 0

  for (const item of items) {
    if (item.path && changedSet.has(path.normalize(item.path))) {
      // File changed — this evidence is no longer valid
      invalidated++
      continue
    }
    // Also check if content references a changed file
    const referencesChanged = changedFiles.some(f => item.content.includes(f))
    if (referencesChanged && item.source !== "git" && item.source !== "memory") {
      invalidated++
      continue
    }
    valid.push(item)
  }

  return { valid, invalidated }
}

// ============ EVIDENCE PACKAGE BUILDER ============
// Builds a complete evidence package from all sources.
export function buildEvidencePackage(
  items: EvidenceItem[],
  options: {
    budget?: number
    query?: string
    deduplicate?: boolean
    rank?: boolean
    maxItems?: number
  } = {}
): EvidencePackage {
  const budget = options.budget || 2000
  const maxItems = options.maxItems || 15
  let processed = [...items]

  // 1. Deduplicate
  if (options.deduplicate !== false) {
    processed = deduplicateEvidence(processed)
  }

  // 2. Rank
  if (options.rank !== false) {
    processed = rankEvidence(processed, options.query)
  }

  // 3. Fit within budget
  let totalTokens = 0
  const selected: EvidenceItem[] = []
  const sources: string[] = []

  for (const item of processed) {
    if (selected.length >= maxItems) break
    if (totalTokens + item.tokenCost > budget) {
      // Skip if it would exceed budget, but allow if it's the first item
      if (selected.length === 0) {
        selected.push(item)
        totalTokens += item.tokenCost
      }
      continue
    }
    selected.push(item)
    totalTokens += item.tokenCost
    if (!sources.includes(item.source)) sources.push(item.source)
  }

  // 4. Recommendations
  const recommendations: string[] = []
  if (totalTokens > budget * 0.8) {
    recommendations.push("⚠️ الأدلة تستهلك 80%+ من الميزانية — فكّر في تقليل المصادر")
  }
  if (processed.length > selected.length) {
    recommendations.push(`ℹ️ تم استبعاد ${processed.length - selected.length} عنصر للالتزام بالميزانية`)
  }
  if (selected.length === 0) {
    recommendations.push("❌ لا أدلة متاحة — اجمع أدلة أولاً")
  }
  if (recommendations.length === 0) {
    recommendations.push("✅ حزمة الأدلة متوازنة")
  }

  const summary = `${selected.length} أدلة من ${sources.length} مصادر (${totalTokens} توكن)`

  return {
    items: selected,
    totalTokens,
    budget,
    sources,
    summary,
    recommendations,
  }
}

// ============ FORMAT FOR PROMPT ============
export function formatEvidencePackage(pkg: EvidencePackage): string {
  if (pkg.items.length === 0) return ""

  const sections = pkg.items.map(item => {
    const meta = [
      `[${item.source}]`,
      item.path ? `path: ${item.path}` : "",
      item.symbol ? `symbol: ${item.symbol}` : "",
      `confidence: ${Math.round(item.confidence * 100)}%`,
      `freshness: ${Math.round(item.freshness * 100)}%`,
      `${item.tokenCost} tok`,
      item.dependencyRelation ? `relation: ${item.dependencyRelation}` : "",
    ].filter(Boolean).join(" | ")

    return `### ${meta}\nReason: ${item.reason}\n${item.content}`
  })

  return `\n\n## 📊 Evidence Package (${pkg.totalTokens}/${pkg.budget} tokens)\nSources: ${pkg.sources.join(", ")}\n${sections.join("\n\n")}`
}

// ============ PROVENANCE TRACKER ============
// Tracks what evidence was included, why, and its contribution.
export function trackEvidenceProvenance(pkg: EvidencePackage): {
  source: string
  itemCount: number
  tokens: number
  percentage: number
  avgConfidence: number
  avgFreshness: number
}[] {
  const bySource: Record<string, { items: EvidenceItem[]; tokens: number }> = {}

  for (const item of pkg.items) {
    if (!bySource[item.source]) bySource[item.source] = { items: [], tokens: 0 }
    bySource[item.source].items.push(item)
    bySource[item.source].tokens += item.tokenCost
  }

  return Object.entries(bySource).map(([source, data]) => ({
    source,
    itemCount: data.items.length,
    tokens: data.tokens,
    percentage: pkg.totalTokens > 0 ? Math.round((data.tokens / pkg.totalTokens) * 100) : 0,
    avgConfidence: data.items.reduce((sum, i) => sum + i.confidence, 0) / data.items.length,
    avgFreshness: data.items.reduce((sum, i) => sum + i.freshness, 0) / data.items.length,
  }))
}
