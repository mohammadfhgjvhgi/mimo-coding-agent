// Memory OS — Full Deterministic Memory Engine
// 15 tiers + 16 operations. All deterministic (0-LLM for core operations).
// LLM only used for optional consolidation/compression.

import { db } from "@/lib/db"
import { createHash } from "node:crypto"

// ============ 15 MEMORY TIERS ============
export type MemoryTier =
  | "working"        // current task context (cleared on task end)
  | "session"        // current session (cleared on logout)
  | "task"           // task-specific memory
  | "project"        // project-level decisions
  | "personal"       // personal preferences about the user
  | "semantic"       // consolidated facts (promoted from episodic)
  | "episodic"       // recent events/experiences
  | "failure"        // what went wrong (lessons learned)
  | "negative"      // what NOT to do (anti-patterns)
  | "decision"       // important decisions with reasoning
  | "preference"     // user preferences (code style, language, etc.)
  | "skill"          // learned skills/patterns
  | "research"       // research findings
  | "conversation"   // conversation summaries
  | "knowledge"      // knowledge base entries

export const TIER_LABELS: Record<MemoryTier, string> = {
  working: "عمل",
  session: "جلسة",
  task: "مهمة",
  project: "مشروع",
  personal: "شخصي",
  semantic: "دلالي",
  episodic: "حدثي",
  failure: "أخطاء",
  negative: "ممنوعات",
  decision: "قرارات",
  preference: "تفضيلات",
  skill: "مهارات",
  research: "أبحاث",
  conversation: "محادثات",
  knowledge: "معرفة",
}

export const TIER_COLORS: Record<MemoryTier, string> = {
  working: "bg-blue-500/15 text-blue-600",
  session: "bg-cyan-500/15 text-cyan-600",
  task: "bg-indigo-500/15 text-indigo-600",
  project: "bg-purple-500/15 text-purple-600",
  personal: "bg-pink-500/15 text-pink-600",
  semantic: "bg-emerald-500/15 text-emerald-600",
  episodic: "bg-amber-500/15 text-amber-600",
  failure: "bg-red-500/15 text-red-600",
  negative: "bg-orange-500/15 text-orange-600",
  decision: "bg-teal-500/15 text-teal-600",
  preference: "bg-violet-500/15 text-violet-600",
  skill: "bg-lime-500/15 text-lime-600",
  research: "bg-sky-500/15 text-sky-600",
  conversation: "bg-fuchsia-500/15 text-fuchsia-600",
  knowledge: "bg-stone-500/15 text-stone-600",
}

// ============ TYPES ============
export interface MemoryRecord {
  id: string
  key: string
  value: string
  tier: MemoryTier
  category: string
  source: string
  confidence: number
  decayRate: number
  accessCount: number
  lastAccessedAt: string
  failureHash: string | null
  createdAt: string
  updatedAt: string
}

export interface MemoryCaptureOptions {
  tier?: MemoryTier
  category?: string
  confidence?: number
  decayRate?: number
  source?: string
  failureHash?: string
}

// ============ 1. MEMORY CAPTURE ============
export async function capture(
  key: string,
  value: string,
  options: MemoryCaptureOptions = {}
): Promise<MemoryRecord> {
  const tier = options.tier || "semantic"
  const category = options.category || "general"
  const confidence = options.confidence ?? 0.8
  const decayRate = options.decayRate ?? getDecayRate(tier)
  const source = options.source || "agent"
  const failureHash = options.failureHash || (tier === "failure" ? hashString(value) : null)

  const existing = await db.memory.findUnique({ where: { key } })

  if (existing) {
    // Update: merge values if different
    const updated = await db.memory.update({
      where: { key },
      data: {
        value: value !== existing.value ? value : existing.value,
        tier: tier !== existing.source ? tier : (existing.source as MemoryTier),
        category,
        confidence: Math.max(confidence, existing.confidence || 0.8),
        decayRate,
        source,
        failureHash,
        updatedAt: new Date(),
        accessCount: { increment: 1 } as any,
      },
    })
    return dbToRecord(updated)
  }

  const created = await db.memory.create({
    data: {
      key,
      value,
      category,
      source: tier, // store tier in source field
      confidence,
      decayRate,
      failureHash,
    },
  })
  return dbToRecord(created)
}

// ============ 2. MEMORY RETRIEVAL ============
export async function retrieve(
  query: string,
  options: {
    tier?: MemoryTier
    limit?: number
    minConfidence?: number
    includeExpired?: boolean
  } = {}
): Promise<MemoryRecord[]> {
  const limit = options.limit || 10
  const minConfidence = options.minConfidence ?? 0.05

  let memories = await db.memory.findMany({
    where: options.tier ? { source: options.tier } : {},
    orderBy: { updatedAt: "desc" },
    take: 200,
  })

  // Score by BM25-like keyword matching
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  const scored = memories
    .map(m => {
      const text = `${m.key} ${m.value}`.toLowerCase()
      let score = 0
      for (const kw of keywords) {
        const count = (text.match(new RegExp(kw, "g")) || []).length
        score += count
      }
      // Apply confidence + decay
      const age = (Date.now() - m.updatedAt.getTime()) / 86400000
      const decayScore = Math.exp(-age / (m.decayRate || 365))
      const finalScore = score * (m.confidence || 0.8) * decayScore
      return { ...m, _score: finalScore }
    })
    .filter(m => m._score > 0 || (!query && true))
    .filter(m => (m.confidence || 0.8) >= minConfidence)
    .sort((a, b) => (b as any)._score - (a as any)._score)
    .slice(0, limit)

  // Update access count for retrieved memories
  for (const m of scored) {
    await db.memory.update({
      where: { id: m.id },
      data: {
        accessCount: { increment: 1 },
        lastAccessedAt: new Date(),
      },
    })
  }

  return scored.map(dbToRecord)
}

// ============ 3. MEMORY CONSOLIDATION ============
export async function consolidate(): Promise<{
  promoted: number
  compressed: number
  forgotten: number
}> {
  let promoted = 0
  let compressed = 0
  let forgotten = 0

  // Promote: episodic → semantic (access >= 3, confidence > 0.6)
  const episodic = await db.memory.findMany({
    where: { source: "episodic" },
  })
  for (const m of episodic) {
    if ((m.accessCount || 0) >= 3 && (m.confidence || 0.8) > 0.6) {
      await db.memory.update({
        where: { id: m.id },
        data: { source: "semantic", confidence: Math.min(1, (m.confidence || 0.8) + 0.1) },
      })
      promoted++
    }
  }

  // Compress: group episodic memories by category, merge
  const byCategory: Record<string, typeof episodic> = {}
  for (const m of episodic) {
    if (!byCategory[m.category]) byCategory[m.category] = []
    byCategory[m.category].push(m)
  }
  for (const [cat, mems] of Object.entries(byCategory)) {
    if (mems.length >= 10) {
      // Merge into a single semantic memory
      const mergedValue = mems.map(m => `- ${m.value.slice(0, 100)}`).join("\n")
      await db.memory.create({
        data: {
          key: `consolidated_${cat}_${Date.now()}`,
          value: `ملخص ${mems.length} ذاكرة ${cat}:\n${mergedValue}`,
          category: cat,
          source: "semantic",
          confidence: 0.7,
          decayRate: 365,
        },
      })
      // Delete originals
      await db.memory.deleteMany({ where: { id: { in: mems.map(m => m.id) } } })
      compressed += mems.length
    }
  }

  // Forget: decay < 0.05
  const all = await db.memory.findMany()
  for (const m of all) {
    const age = (Date.now() - m.updatedAt.getTime()) / 86400000
    const decayScore = Math.exp(-age / (m.decayRate || 365))
    if (decayScore < 0.05) {
      await db.memory.delete({ where: { id: m.id } })
      forgotten++
    }
  }

  return { promoted, compressed, forgotten }
}

// ============ 4. MEMORY DEDUPLICATION ============
export async function deduplicate(): Promise<number> {
  const all = await db.memory.findMany()
  const seen = new Map<string, string>() // hash → id
  let deleted = 0

  for (const m of all) {
    const hash = hashString(`${m.key}:${m.value}`)
    if (seen.has(hash)) {
      await db.memory.delete({ where: { id: m.id } })
      deleted++
    } else {
      seen.set(hash, m.id)
    }
  }

  return deleted
}

// ============ 5. MEMORY IMPORTANCE SCORING ============
export function scoreImportance(record: MemoryRecord): number {
  let score = record.confidence

  // Boost by access count
  score += Math.log(record.accessCount + 1) * 0.1

  // Boost by tier importance
  const tierBoosts: Partial<Record<MemoryTier, number>> = {
    decision: 0.3,
    failure: 0.25,
    semantic: 0.2,
    project: 0.15,
    preference: 0.15,
    skill: 0.1,
  }
  score += tierBoosts[record.tier] || 0

  // Apply decay
  const age = (Date.now() - new Date(record.updatedAt).getTime()) / 86400000
  const decayScore = Math.exp(-age / (record.decayRate || 365))
  score *= decayScore

  return Math.min(1, score)
}

// ============ 6. MEMORY CONFLICT DETECTION ============
export async function detectConflicts(): Promise<{
  conflicts: { key: string; memories: MemoryRecord[] }[]
}> {
  const all = await db.memory.findMany()
  const byKey: Record<string, typeof all> = {}

  for (const m of all) {
    if (!byKey[m.key]) byKey[m.key] = []
    byKey[m.key].push(m)
  }

  const conflicts: { key: string; memories: MemoryRecord[] }[] = []
  for (const [key, mems] of Object.entries(byKey)) {
    if (mems.length < 2) continue
    // Check if values are different
    const values = new Set(mems.map(m => m.value))
    if (values.size > 1) {
      // Check for negation
      const hasNegation = mems.some(m =>
        /\b(not|never|false|لا|ليس|كذب|خطأ|غير صحيح)\b/i.test(m.value)
      )
      if (hasNegation) {
        conflicts.push({ key, memories: mems.map(dbToRecord) })
      }
    }
  }

  return { conflicts }
}

// ============ 7. MEMORY CORRECTION ============
export async function correct(id: string, newValue: string): Promise<MemoryRecord> {
  const updated = await db.memory.update({
    where: { id },
    data: { value: newValue, updatedAt: new Date() },
  })
  return dbToRecord(updated)
}

// ============ 8. MEMORY MERGE ============
export async function merge(ids: string[], newKey: string): Promise<MemoryRecord> {
  const memories = await db.memory.findMany({ where: { id: { in: ids } } })
  if (memories.length === 0) throw new Error("No memories to merge")

  const mergedValue = memories.map(m => `- ${m.value}`).join("\n")
  const highestConfidence = Math.max(...memories.map(m => m.confidence || 0.8))

  const created = await db.memory.create({
    data: {
      key: newKey,
      value: `ذكريات مدموجة:\n${mergedValue}`,
      category: memories[0].category,
      source: "semantic",
      confidence: Math.min(1, highestConfidence + 0.05),
      decayRate: 365,
    },
  })

  // Delete originals
  await db.memory.deleteMany({ where: { id: { in: ids } } })

  return dbToRecord(created)
}

// ============ 9. MEMORY SEARCH ============
export async function searchMemories(query: string, tier?: MemoryTier): Promise<MemoryRecord[]> {
  return retrieve(query, { tier, limit: 20 })
}

// ============ 10. MEMORY TIMELINE ============
export async function getTimeline(limit: number = 50): Promise<MemoryRecord[]> {
  const memories = await db.memory.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  })
  return memories.map(dbToRecord)
}

// ============ 11. MEMORY EXPORT ============
export async function exportMemories(): Promise<{
  version: number
  exportedAt: string
  memories: MemoryRecord[]
}> {
  const memories = await db.memory.findMany({ orderBy: { createdAt: "desc" } })
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    memories: memories.map(dbToRecord),
  }
}

// ============ 12. MEMORY DELETE ============
export async function deleteMemory(id: string): Promise<void> {
  await db.memory.delete({ where: { id } })
}

// ============ 13. MEMORY PROVENANCE ============
export function getProvenance(record: MemoryRecord): {
  source: string
  tier: MemoryTier
  age: number
  accessCount: number
  importance: number
  decayScore: number
} {
  const age = (Date.now() - new Date(record.updatedAt).getTime()) / 86400000
  const decayScore = Math.exp(-age / (record.decayRate || 365))
  return {
    source: record.source,
    tier: record.tier,
    age: Math.round(age),
    accessCount: record.accessCount,
    importance: scoreImportance(record),
    decayScore: Math.round(decayScore * 100) / 100,
  }
}

// ============ HELPERS ============
function getDecayRate(tier: MemoryTier): number {
  const rates: Partial<Record<MemoryTier, number>> = {
    working: 1,        // 1 day
    session: 7,        // 1 week
    task: 30,          // 1 month
    episodic: 90,      // 3 months
    conversation: 30,  // 1 month
    failure: 365 * 5,  // 5 years (never forget failures)
    negative: 365 * 5, // 5 years (never forget anti-patterns)
    decision: 365 * 5, // 5 years (never forget decisions)
    preference: 365,   // 1 year
    skill: 365,        // 1 year
    research: 180,     // 6 months
    project: 365,      // 1 year
    personal: 365,     // 1 year
    semantic: 365 * 2, // 2 years (consolidated = stable)
    knowledge: 365 * 3,// 3 years
  }
  return rates[tier] || 365
}

function hashString(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16)
}

function dbToRecord(m: any): MemoryRecord {
  return {
    id: m.id,
    key: m.key,
    value: m.value,
    tier: (m.source as MemoryTier) || "semantic",
    category: m.category,
    source: m.source,
    confidence: m.confidence ?? 0.8,
    decayRate: m.decayRate ?? 365,
    accessCount: (m as any).accessCount || 0,
    lastAccessedAt: ((m as any).lastAccessedAt || m.updatedAt).toISOString(),
    failureHash: m.failureHash || null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  }
}

// ============ AUTO-CAPTURE (for agent-loop) ============
export async function autoCapture(task: string, result: string, success: boolean): Promise<void> {
  if (success) {
    // Save successful patterns as skill memory
    await capture(`pattern_${hashString(task)}`, `المهمة: ${task}\nالنتيجة: ${result.slice(0, 200)}`, {
      tier: "skill",
      category: "success_pattern",
      confidence: 0.7,
      source: "auto",
    })
  } else {
    // Save failures as failure memory
    await capture(`failure_${hashString(task)}`, `المهمة: ${task}\nالخطأ: ${result.slice(0, 200)}`, {
      tier: "failure",
      category: "failure",
      confidence: 0.9,
      source: "auto",
      failureHash: hashString(result),
    })
  }
}

// ============ GET STATS ============
export async function getMemoryStats(): Promise<Record<MemoryTier, number>> {
  const all = await db.memory.findMany({ select: { source: true } })
  const stats = {} as Record<MemoryTier, number>
  for (const tier of Object.keys(TIER_LABELS) as MemoryTier[]) {
    stats[tier] = all.filter(m => m.source === tier).length
  }
  return stats
}
