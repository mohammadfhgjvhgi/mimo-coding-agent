// MiMo AI — Hybrid Knowledge Retrieval
// Brute-force in-memory fusion of vector cosine similarity + BM25-ish keyword
// score. Personal scale (<50k chunks) keeps this well under 100ms.
//
// Fuse weights: 0.5 vector + 0.5 keyword (RRF-style normalization would also
// work; we use min-max normalized scores here for interpretability).


export interface RetrieveOptions {
  limit?: number
  docId?: string
  vectorWeight?: number // default 0.5
  keywordWeight?: number // default 0.5
  minScore?: number // default 0 (no cutoff)
}

// ============ Tokenization (shared by query & chunks for keyword score) ============

const STOP = new Set([
  'a','an','the','and','or','but','if','then','else','for','of','to','in','on',
  'at','by','with','from','as','is','are','was','were','be','been','being',
  'this','that','these','those','it','its','i','you','he','she','we','they',
  'do','does','did','have','has','had','will','would','can','could','should',
  'not','no','yes','so','than','too','very','just','about','into','over',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u0600-\u06FF]+/)
    .filter(t => t.length > 1 && !STOP.has(t))
}

// ============ Keyword scoring (BM25-ish) ============

interface ChunkIndexEntry {
  id: string
  docId: string
  content: string
  tokens: string[]
  tf: Map<string, number>
}

function bm25Score(
  queryTokens: string[],
  entry: ChunkIndexEntry,
  avgDl: number,
  df: Map<string, number>,
  N: number,
  k1 = 1.5,
  b = 0.75,
): number {
  if (queryTokens.length === 0) return 0
  let score = 0
  const dl = entry.tokens.length || 1
  const seen = new Set<string>()
  for (const term of queryTokens) {
    if (seen.has(term)) continue
    seen.add(term)
    const tf = entry.tf.get(term) ?? 0
    if (tf === 0) continue
    const dfVal = df.get(term) ?? 0
    // IDF with smoothing
    const idf = Math.log(1 + (N - dfVal + 0.5) / (dfVal + 0.5))
    const denom = tf + k1 * (1 - b + b * (dl / (avgDl || 1)))
    score += idf * ((tf * (k1 + 1)) / denom)
  }
  return score
}

function minMaxNorm(values: number[]): number[] {
  if (values.length === 0) return []
  const max = Math.max(...values)
  const min = Math.min(...values)
  if (max === min) return values.map(() => max > 0 ? 1 : 0)
  const range = max - min
  return values.map(v => (v - min) / range)
}

// ============ Loading chunks ============

async function loadChunks(docId?: string): Promise<{
  entries: ChunkIndexEntry[]
  embeddings: Float32Array[]
  avgDl: number
  df: Map<string, number>
}> {
  const rows = await db.chunk.findMany({
    where: docId ? { docId } : undefined,
    select: {
      id: true,
      docId: true,
      content: true,
      embedding: true,
    },
  })

  const entries: ChunkIndexEntry[] = []
  const embeddings: Float32Array[] = []
  const df = new Map<string, number>()
  let totalTokens = 0

  for (const r of rows) {
    const tokens = tokenize(r.content)
    const tf = new Map<string, number>()
    for (const t of tokens) {
      tf.set(t, (tf.get(t) ?? 0) + 1)
    }
    for (const term of tf.keys()) {
      df.set(term, (df.get(term) ?? 0) + 1)
    }
    entries.push({ id: r.id, docId: r.docId, content: r.content, tokens, tf })
    totalTokens += tokens.length

    if (r.embedding) {
      try {
        // Prisma returns Bytes as Uint8Array; bufferToEmbedding wants Buffer.
        // They're structurally identical at runtime — widen through unknown.
        embeddings.push(bufferToEmbedding(r.embedding as unknown as Buffer))
      } catch {
        embeddings.push(new Float32Array(0))
      }
    } else {
      embeddings.push(new Float32Array(0))
    }
  }

  const avgDl = entries.length ? totalTokens / entries.length : 0
  return { entries, embeddings, avgDl, df }
}

// ============ Public API ============

export async function retrieveKnowledge(
  query: string,
  options?: RetrieveOptions,
): Promise<RetrievalResult[]> {
  const limit = options?.limit ?? 8
  const vectorWeight = options?.vectorWeight ?? 0.5
  const keywordWeight = options?.keywordWeight ?? 0.5
  const minScore = options?.minScore ?? 0

  if (!query.trim()) return []

  const { entries, embeddings, avgDl, df } = await loadChunks(options?.docId)
  if (entries.length === 0) {
    logger.debug('retrieveKnowledge: no chunks in index')
    return []
  }

  const N = entries.length
  const queryTokens = tokenize(query)

  // --- Keyword scores ---
  const kwRaw = entries.map(e => bm25Score(queryTokens, e, avgDl, df, N))
  const kwNorm = minMaxNorm(kwRaw)

  // --- Vector scores ---
  let vecNorm: number[]
  let queryEmb: Float32Array | null = null
  try {
    queryEmb = await embed(query)
  } catch (err) {
    logger.warn('retrieveKnowledge: query embed failed, keyword-only', {
      error: String(err),
    })
  }

  if (queryEmb && queryEmb.length > 0) {
    const vecRaw = embeddings.map(e =>
      e && e.length > 0 ? similarity(queryEmb, e) : 0,
    )
    vecNorm = minMaxNorm(vecRaw)
  } else {
    vecNorm = entries.map(() => 0)
  }

  // --- Fuse ---
  const fused = entries.map((e, i) => ({
    entry: e,
    score: vectorWeight * vecNorm[i] + keywordWeight * kwNorm[i],
  }))

  fused.sort((a, b) => b.score - a.score)

  // Load doc titles in one pass for top results.
  const top = fused.slice(0, limit)
  const docIds = Array.from(new Set(top.map(t => t.entry.docId)))
  const docs = await db.knowledgeDoc.findMany({
    where: { id: { in: docIds } },
    select: { id: true, source: true, title: true },
  })
  const docMap = new Map(docs.map(d => [d.id, d]))

  const results: RetrievalResult[] = top
    .filter(t => t.score >= minScore)
    .map(t => {
      const doc = docMap.get(t.entry.docId)
      const chunk: KnowledgeChunk = {
        id: t.entry.id,
        docId: t.entry.docId,
        content: t.entry.content,
      }
      return {
        chunk,
        score: t.score,
        source: doc?.source ?? '',
        docTitle: doc?.title ?? '',
      }
    })

  await emit('knowledge:retrieved', {
    query,
    docId: options?.docId,
    limit,
    returned: results.length,
    topScore: results[0]?.score ?? 0,
  })

  return results
}

/** Convenience wrapper: returns Evidence objects for context injection. */
export async function retrieveEvidence(
  query: string,
  limit: number = 5,
): Promise<Evidence[]> {
  const results = await retrieveKnowledge(query, { limit })
  return results.map(r => ({
    content: r.chunk.content,
    source: r.source || r.docTitle,
    score: r.score,
  }))
}

export default retrieveKnowledge
