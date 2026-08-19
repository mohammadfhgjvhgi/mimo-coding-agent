// Hybrid Search Engine — combines BM25 + semantic (hash-embedding) + reranking.
// 3-stage pipeline: BM25 (fast keyword match) → semantic (embedding cosine) → rerank (combined score).
// This replaces the simple text search with a proper RAG retrieval pipeline.

import { db } from "@/lib/db"

export interface SearchHit {
  id: string
  source: string
  sourceType: string
  content: string
  score: number
  bm25Score: number
  semanticScore: number
  finalScore: number
  collectionId?: string | null
}

// BM25 implementation (inline — no external dependency).
class BM25 {
  private k1: number
  private b: number
  private docs: { id: string; content: string; terms: Map<string, number>; length: number }[]
  private avgDocLength: number
  private df: Map<string, number>
  private N: number

  constructor(k1 = 1.5, b = 0.75) {
    this.k1 = k1
    this.b = b
    this.docs = []
    this.avgDocLength = 0
    this.df = new Map()
    this.N = 0
  }

  addDoc(id: string, content: string): void {
    const terms = this.tokenize(content)
    const tf = new Map<string, number>()
    for (const term of terms) tf.set(term, (tf.get(term) || 0) + 1)
    this.docs.push({ id, content, terms: tf, length: terms.length })
    for (const term of new Set(terms)) this.df.set(term, (this.df.get(term) || 0) + 1)
    this.N = this.docs.length
    this.avgDocLength = this.docs.reduce((s, d) => s + d.length, 0) / this.N
  }

  search(query: string): { id: string; score: number }[] {
    const queryTerms = this.tokenize(query)
    const results: { id: string; score: number }[] = []

    for (const doc of this.docs) {
      let score = 0
      for (const term of queryTerms) {
        const tf = doc.terms.get(term) || 0
        if (tf === 0) continue
        const df = this.df.get(term) || 0
        const idf = Math.log(1 + (this.N - df + 0.5) / (df + 0.5))
        const tfNorm = (tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * (doc.length / this.avgDocLength)))
        score += idf * tfNorm
      }
      if (score > 0) results.push({ id: doc.id, score })
    }
    return results.sort((a, b) => b.score - a.score)
  }

  private tokenize(text: string): string[] {
    return text.toLowerCase().split(/[^a-zA-Z0-9أ-ي]/).filter(w => w.length > 2)
  }
}

// Hash-based embedding (fallback — no external model needed).
export function hashEmbed(text: string, dim = 128): Float32Array {
  const vec = new Float32Array(dim)
  const tokens = text.toLowerCase().split(/[^a-zA-Z0-9أ-ي]+/).filter(t => t.length > 1)
  for (const token of tokens) {
    let hash = 5381
    for (let i = 0; i < token.length; i++) hash = ((hash << 5) + hash + token.charCodeAt(i)) | 0
    vec[Math.abs(hash) % dim] += 1
    let hash2 = 0
    for (let i = 0; i < token.length; i++) hash2 = ((hash2 << 7) + hash2 + token.charCodeAt(i)) | 0
    vec[Math.abs(hash2) % dim] += (hash2 & 1 ? 1 : -1)
  }
  // L2 normalize
  let norm = 0
  for (let i = 0; i < dim; i++) norm += vec[i] * vec[i]
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < dim; i++) vec[i] /= norm
  return vec
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) dot += a[i] * b[i]
  return dot
}

// Parse stored embedding from DB.
function parseEmbedding(embeddingStr: string): Float32Array | null {
  try {
    const arr = JSON.parse(embeddingStr)
    if (Array.isArray(arr) && arr.length > 0) return new Float32Array(arr)
  } catch {}
  return null
}

// Main: hybrid search across knowledge chunks.
export async function hybridSearch(
  query: string,
  options: {
    collectionId?: string
    limit?: number
    bm25Weight?: number
    semanticWeight?: number
  } = {}
): Promise<SearchHit[]> {
  const limit = options.limit || 10
  const bm25Weight = options.bm25Weight ?? 0.6
  const semanticWeight = options.semanticWeight ?? 0.4

  // Fetch chunks from DB
  const where = options.collectionId ? { collectionId: options.collectionId } : {}
  const chunks = await db.knowledgeChunk.findMany({ where, take: 500 })

  if (chunks.length === 0) return []

  // Stage 1: BM25 search
  const bm25 = new BM25()
  const chunkMap = new Map<string, { content: string; source: string; sourceType: string; collectionId: string | null; embedding: string }>()
  for (const chunk of chunks) {
    bm25.addDoc(chunk.id, `${chunk.content}`)
    chunkMap.set(chunk.id, {
      content: chunk.content,
      source: chunk.source,
      sourceType: chunk.sourceType,
      collectionId: chunk.collectionId,
      embedding: chunk.embedding,
    })
  }
  const bm25Results = bm25.search(query)
  const bm25Map = new Map<string, number>()
  const maxBm25 = bm25Results[0]?.score || 1
  for (const r of bm25Results) bm25Map.set(r.id, r.score / maxBm25) // normalize 0-1

  // Stage 2: Semantic search (hash embedding cosine)
  const queryEmbedding = hashEmbed(query)
  const semanticResults: { id: string; score: number }[] = []
  for (const chunk of chunks) {
    const storedEmbedding = parseEmbedding(chunk.embedding)
    if (storedEmbedding) {
      const sim = cosineSimilarity(queryEmbedding, storedEmbedding)
      semanticResults.push({ id: chunk.id, score: sim })
    }
  }
  semanticResults.sort((a, b) => b.score - a.score)
  const semanticMap = new Map<string, number>()
  const maxSemantic = semanticResults[0]?.score || 1
  for (const r of semanticResults) semanticMap.set(r.id, r.score / maxSemantic)

  // Stage 3: Rerank — combine BM25 + semantic scores
  const allIds = new Set([...bm25Map.keys(), ...semanticMap.keys()])
  const hits: SearchHit[] = []

  for (const id of allIds) {
    const chunk = chunkMap.get(id)
    if (!chunk) continue
    const bm25Score = bm25Map.get(id) || 0
    const semanticScore = semanticMap.get(id) || 0
    const finalScore = (bm25Score * bm25Weight) + (semanticScore * semanticWeight)

    hits.push({
      id,
      source: chunk.source,
      sourceType: chunk.sourceType,
      content: chunk.content.slice(0, 500),
      score: finalScore,
      bm25Score,
      semanticScore,
      finalScore,
      collectionId: chunk.collectionId,
    })
  }

  return hits.sort((a, b) => b.finalScore - a.finalScore).slice(0, limit)
}

// Agentic Retrieval — LLM decides what to retrieve.
// Instead of simple keyword search, the agent formulates search queries
// based on the conversation context.
export async function agenticRetrieval(
  context: string,
  query: string,
  limit = 5
): Promise<SearchHit[]> {
  // For now: run multiple search variants and merge
  const variants = [
    query, // original query
    query.split(/\s+/).filter(w => w.length > 3).slice(0, 5).join(" "), // keywords only
    context.slice(-200), // last 200 chars of context as query
  ].filter(Boolean)

  const allHits: SearchHit[] = []
  const seenIds = new Set<string>()

  for (const variant of variants) {
    const hits = await hybridSearch(variant, { limit: limit * 2 })
    for (const hit of hits) {
      if (!seenIds.has(hit.id)) {
        seenIds.add(hit.id)
        allHits.push(hit)
      }
    }
  }

  return allHits.sort((a, b) => b.finalScore - a.finalScore).slice(0, limit)
}

// Full-context mode — return the entire document, not chunks.
export async function fullContextSearch(query: string, collectionId?: string): Promise<{
  source: string
  fullText: string
  sourceType: string
}[]> {
  const hits = await hybridSearch(query, { collectionId, limit: 3 })

  // For each hit, fetch all chunks from the same source
  const sources = new Set(hits.map(h => h.source))
  const results: { source: string; fullText: string; sourceType: string }[] = []

  for (const source of sources) {
    const chunks = await db.knowledgeChunk.findMany({
      where: { source },
      orderBy: { chunkIndex: "asc" },
    })
    if (chunks.length > 0) {
      results.push({
        source,
        fullText: chunks.map(c => c.content).join("\n\n"),
        sourceType: chunks[0].sourceType,
      })
    }
  }

  return results
}
