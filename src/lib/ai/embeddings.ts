// MiMo AI — Embeddings Service
// Uses @huggingface/transformers (local, offline) with all-MiniLM-L6-v2 (384 dims).
// Falls back to hash-based TF vectorizer if model can't load.


const EMBED_DIM = 384

// ============ Hash-based fallback embedder ============

function hashEmbed(text: string, dim: number = EMBED_DIM): Float32Array {
  const vec = new Float32Array(dim)
  const tokens = text.toLowerCase().split(/\s+|[^\w\u0600-\u06FF]+/).filter(t => t.length > 1)

  for (const token of tokens) {
    // Simple djb2 hash
    let hash = 5381
    for (let i = 0; i < token.length; i++) {
      hash = ((hash << 5) + hash + token.charCodeAt(i)) | 0
    }
    const idx = Math.abs(hash) % dim
    // Use a second hash for sign
    let hash2 = 0
    for (let i = 0; i < token.length; i++) {
      hash2 = ((hash2 << 7) + hash2 + token.charCodeAt(i)) | 0
    }
    vec[idx] += (hash2 & 1 ? 1 : -1) * (1 + Math.log(token.length))
  }

  // L2 normalize
  let norm = 0
  for (let i = 0; i < dim; i++) norm += vec[i] * vec[i]
  norm = Math.sqrt(norm)
  if (norm > 0) {
    for (let i = 0; i < dim; i++) vec[i] /= norm
  }

  return vec
}

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot // already normalized
}

// ============ Transformers.js embedder ============

let _pipeline: any = null
let _useFallback = false

async function getPipeline(): Promise<any> {
  if (_useFallback) return null
  if (_pipeline) return _pipeline

  try {
    const { pipeline } = await import('@huggingface/transformers')
    _pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
    })
    logger.info('Transformers.js pipeline loaded', { model: 'all-MiniLM-L6-v2' })
    return _pipeline
  } catch (err) {
    logger.warn('Transformers.js failed, using hash fallback', { error: String(err) })
    _useFallback = true
    return null
  }
}

// ============ Public API ============

export async function embed(text: string): Promise<Float32Array> {
  const pipe = await getPipeline()
  if (pipe) {
    try {
      const output = await pipe(text, { pooling: 'mean', normalize: true })
      return new Float32Array(output.data)
    } catch (err) {
      logger.warn('embed via transformers failed, using hash', { error: String(err) })
      return hashEmbed(text)
    }
  }
  return hashEmbed(text)
}

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const results: Float32Array[] = []
  for (const text of texts) {
    results.push(await embed(text))
  }
  return results
}

export function similarity(a: Float32Array, b: Float32Array): number {
  return cosineSim(a, b)
}

export function embeddingToBuffer(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength)
}

export function bufferToEmbedding(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
}

export { EMBED_DIM }
