// Memory Tiers — tiered memory storage with BM25 ranking + decay.
// 5 tiers: working (current task) → episodic (recent) → project (persistent)
// → failure (lessons learned) → skill (domain knowledge).
// BM25 ranking for recall (no embeddings, no LLM — pure algorithm).

import { db } from "@/lib/db"

export type MemoryTier = "working" | "episodic" | "project" | "failure" | "skill"

export interface TieredMemory {
  id: string
  key: string
  value: string
  tier: MemoryTier
  category: string
  confidence: number // 0-1, decays over time
  accessCount: number
  lastAccessedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

// BM25 ranking — classic information retrieval algorithm.
// Scores documents by term frequency + inverse document frequency.
// No embeddings, no LLM — pure deterministic scoring.
export class BM25Ranker {
  private k1: number
  private b: number
  private docs: { id: string; content: string; terms: Map<string, number> }[]
  private avgDocLength: number
  private df: Map<string, number> // document frequency per term
  private N: number // total documents

  constructor(k1 = 1.5, b = 0.75) {
    this.k1 = k1
    this.b = b
    this.docs = []
    this.avgDocLength = 0
    this.df = new Map()
    this.N = 0
  }

  // Add a document to the index.
  index(id: string, content: string): void {
    const terms = this.tokenize(content)
    const termFreq = new Map<string, number>()
    for (const term of terms) {
      termFreq.set(term, (termFreq.get(term) || 0) + 1)
    }
    this.docs.push({ id, content, terms: termFreq })
    for (const term of new Set(terms)) {
      this.df.set(term, (this.df.get(term) || 0) + 1)
    }
    this.N = this.docs.length
    this.avgDocLength = this.docs.reduce((sum, d) => sum + d.terms.size, 0) / this.N
  }

  // Search and rank documents by relevance to the query.
  search(query: string, limit = 10): { id: string; score: number; content: string }[] {
    const queryTerms = this.tokenize(query)
    const scores: { id: string; score: number; content: string }[] = []

    for (const doc of this.docs) {
      let score = 0
      for (const term of queryTerms) {
        const tf = doc.terms.get(term) || 0
        if (tf === 0) continue
        const df = this.df.get(term) || 0
        const idf = Math.log(1 + (this.N - df + 0.5) / (df + 0.5))
        const docLength = doc.terms.size
        const tfNorm = (tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * (docLength / this.avgDocLength)))
        score += idf * tfNorm
      }
      if (score > 0) {
        scores.push({ id: doc.id, score, content: doc.content })
      }
    }

    return scores.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  // Tokenize: lowercase, split on non-alphanumeric, filter short words.
  private tokenize(text: string): string[] {
    return text.toLowerCase()
      .split(/[^a-zA-Z0-9أ-ي]/)
      .filter((w) => w.length > 2)
  }
}

// Save a memory to a specific tier.
export async function saveToTier(
  key: string,
  value: string,
  tier: MemoryTier,
  category?: string
): Promise<void> {
  try {
    const existing = await db.memory.findUnique({ where: { key } })
    if (existing) {
      await db.memory.update({
        where: { key },
        data: {
          value,
          category: category || existing.category,
          source: tier, // use source field to store the tier
          updatedAt: new Date(),
        },
      })
    } else {
      await db.memory.create({
        data: {
          key,
          value,
          category: category || "general",
          source: tier,
        },
      })
    }

    // Auto-build graph edges
    try {
      const { autoBuildEdges } = await import("@/lib/memory/graph")
      const mem = await db.memory.findUnique({ where: { key } })
      if (mem) {
        await autoBuildEdges(mem.id, mem.value)
      }
    } catch { /* best-effort */ }
  } catch (e) {
    console.error("[Memory Tiers] save error:", e)
  }
}

// Recall memories using BM25 ranking + tier priority.
export async function recallWithBM25(
  query: string,
  limit = 10,
  tierFilter?: MemoryTier
): Promise<TieredMemory[]> {
  try {
    // Fetch all memories (or filter by tier)
    const memories = await db.memory.findMany({
      where: tierFilter ? { source: tierFilter } : undefined,
      orderBy: { updatedAt: "desc" },
      take: 100,
    })

    if (memories.length === 0) return []

    // Build BM25 index
    const ranker = new BM25Ranker()
    for (const m of memories) {
      ranker.index(m.id, `${m.key} ${m.value}`)
    }

    // Search
    const results = ranker.search(query, limit * 2)

    // Map back to TieredMemory with tier-based confidence decay
    const tiered: TieredMemory[] = results.map((r) => {
      const mem = memories.find((m) => m.id === r.id)!
      const tier = (mem.source as MemoryTier) || "project"
      const ageDays = (Date.now() - mem.updatedAt.getTime()) / 86400000
      const decayRate = tier === "working" ? 0.01 : tier === "episodic" ? 0.005 : 0.001
      const confidence = Math.max(0.1, 1 - ageDays * decayRate)

      return {
        id: mem.id,
        key: mem.key,
        value: mem.value,
        tier,
        category: mem.category,
        confidence,
        accessCount: 0,
        lastAccessedAt: mem.updatedAt,
        createdAt: mem.createdAt,
        updatedAt: mem.updatedAt,
      }
    })

    return tiered.slice(0, limit)
  } catch (e) {
    console.error("[Memory Tiers] recall error:", e)
    return []
  }
}

// Record a failure pattern (lesson learned).
export async function recordFailure(
  task: string,
  error: string,
  approach: string
): Promise<void> {
  const key = `failure_${task.slice(0, 30).replace(/\s+/g, "_")}`
  const value = `المهمة: ${task}\nالخطأ: ${error}\nالنهج الفاشل: ${approach}\nالدرس: تجنب تكرار هذا النهج`
  await saveToTier(key, value, "failure", "failure")
}

// Get tier statistics.
export async function getTierStats(): Promise<Record<MemoryTier, number>> {
  try {
    const all = await db.memory.findMany({ select: { source: true } })
    const stats: Record<MemoryTier, number> = {
      working: 0,
      episodic: 0,
      project: 0,
      failure: 0,
      skill: 0,
    }
    for (const m of all) {
      const tier = (m.source as MemoryTier) || "project"
      if (tier in stats) stats[tier]++
    }
    return stats
  } catch {
    return { working: 0, episodic: 0, project: 0, failure: 0, skill: 0 }
  }
}
