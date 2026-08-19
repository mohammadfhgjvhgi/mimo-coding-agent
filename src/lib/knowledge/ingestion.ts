// MiMo AI — Knowledge Ingestion
// Pipeline: source → text → chunks → embeddings → Prisma.
// Emits `knowledge:ingested` event on success.



// ============ Internal: embedding ↔ storage ============

/**
 * Copy a Float32Array embedding into a fresh Uint8Array view backed by a
 * real ArrayBuffer. Prisma's `Bytes` column type wants `Uint8Array<ArrayBuffer>`,
 * but `embeddingToBuffer` returns `Buffer<ArrayBufferLike>` which TS rejects.
 * Mirrors the workaround in src/lib/memory/store.ts.
 */
function embeddingToBytes(vec: Float32Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(vec.byteLength)
  out.set(new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength))
  return out as Uint8Array<ArrayBuffer>
}

// ============ Helpers ============

function toKnowledgeDoc(row: {
  id: string
  source: string
  sourceType: string
  title: string
  content: string
  chunkCount: number
}): KnowledgeDoc {
  return {
    id: row.id,
    source: row.source,
    sourceType: row.sourceType as 'file' | 'url' | 'manual',
    title: row.title,
    content: row.content,
    chunkCount: row.chunkCount,
  }
}

/** Very small HTML→text stripper. Avoids adding a heavy dep. */
function stripHtml(html: string): string {
  return html
    // Drop scripts/styles entirely
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    // Turn block-level tags into newlines so chunking sees paragraph breaks
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Strip the rest of the tags
    .replace(/<[^>]+>/g, '')
    // Decode the few entities we care about
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Collapse whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ============ Public API ============

/**
 * Core ingestion entrypoint. Creates the KnowledgeDoc row, chunks the content,
 * embeds each chunk (batched), persists Chunk rows with embeddings, and emits
 * `knowledge:ingested`.
 *
 * Embedding failures are graceful: the chunk is still stored without an
 * embedding so the keyword side of retrieval keeps working.
 */
export async function ingestDocument(
  source: string,
  sourceType: 'file' | 'url' | 'manual',
  title: string,
  content: string,
): Promise<KnowledgeDoc> {
  const trimmed = content.trim()
  if (!trimmed) {
    throw new Error(`ingestDocument: empty content for "${title}" (${source})`)
  }

  const doc = await db.knowledgeDoc.create({
    data: {
      source,
      sourceType,
      title,
      content: trimmed,
      chunkCount: 0,
    },
  })

  const chunks = chunkText(trimmed)
  logger.info('Ingesting document', {
    docId: doc.id,
    title,
    sourceType,
    chars: trimmed.length,
    chunks: chunks.length,
  })

  // Embed all chunks (batched). embedBatch already iterates and tolerates
  // per-text fallbacks inside the embedder; if a chunk still throws we record
  // it with no embedding and keep going.
  let embeddings: Float32Array[] = []
  try {
    embeddings = await embedBatch(chunks)
  } catch (err) {
    logger.warn('embedBatch failed; chunks will be stored without embeddings', {
      docId: doc.id,
      error: String(err),
    })
    embeddings = chunks.map(() => new Float32Array(0))
  }

  // Persist chunks. We do this in one transaction for atomicity.
  const chunkRows = chunks.map((content, i) => {
    const emb = embeddings[i]
    const hasEmb = emb && emb.length > 0
    return {
      docId: doc.id,
      content,
      embedding: hasEmb ? embeddingToBytes(emb) : null,
      metadata: JSON.stringify({
        index: i,
        charStart: 0, // chunkText doesn't track offsets; cheap placeholder
        charLen: content.length,
        hasEmbedding: hasEmb,
      }),
    }
  })

  await db.$transaction(async (tx) => {
    await tx.chunk.createMany({ data: chunkRows })
    await tx.knowledgeDoc.update({
      where: { id: doc.id },
      data: { chunkCount: chunkRows.length },
    })
  })

  const finalDoc = await db.knowledgeDoc.findUnique({ where: { id: doc.id } })
  if (!finalDoc) {
    throw new Error(`Ingested doc vanished: ${doc.id}`)
  }

  await emit('knowledge:ingested', {
    docId: finalDoc.id,
    title: finalDoc.title,
    source: finalDoc.source,
    sourceType: finalDoc.sourceType,
    chunkCount: finalDoc.chunkCount,
  })

  logger.info('Document ingested', {
    docId: finalDoc.id,
    chunkCount: finalDoc.chunkCount,
  })

  return toKnowledgeDoc(finalDoc)
}

/**
 * Read a file from disk and ingest it. .txt/.md are read as UTF-8 text
 * directly; any other extension is also read as text (best-effort).
 */
export async function ingestFile(filePath: string): Promise<KnowledgeDoc> {
  const abs = path.resolve(filePath)
  const base = path.basename(abs)
  const ext = path.extname(abs).toLowerCase()

  let content: string
  try {
    content = await fs.readFile(abs, 'utf-8')
  } catch (err) {
    logger.error('Failed to read file for ingestion', { path: abs, error: String(err) })
    throw err
  }

  // Markdown: strip frontmatter for cleaner chunking.
  if (ext === '.md') {
    content = content.replace(/^---[\s\S]*?---\n?/, '').trim()
  }

  return ingestDocument(abs, 'file', base, content)
}

/**
 * Fetch a URL via the Z.ai page_reader function and ingest its text content.
 */
export async function ingestUrl(url: string): Promise<KnowledgeDoc> {
  logger.info('Ingesting URL', { url })

  const zai = await ZAI.create()
  const result = await zai.functions.invoke('page_reader', { url }) as {
    data?: { title?: string; html?: string; url?: string }
  }

  const data = result?.data ?? {}
  const title = data.title?.trim() || url
  const html = data.html ?? ''
  const text = stripHtml(html)

  if (!text) {
    throw new Error(`ingestUrl: page_reader returned no usable text for ${url}`)
  }

  return ingestDocument(url, 'url', title, text)
}

export default ingestDocument
