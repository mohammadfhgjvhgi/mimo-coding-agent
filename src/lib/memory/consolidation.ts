// MiMo AI — Memory Consolidation
// Lifecycle: promote short-term → long-term, compress episodic into semantic,
// forget expired, resolve conflicts between contradicting memories.


// ============ Tunables ============

const PROMOTION_IMPORTANCE_THRESHOLD = 0.6
const PROMOTION_ACCESS_THRESHOLD = 3     // accessed >= 3 times → promote
const EPISODIC_COMPRESSION_BATCH = 10    // group episodic memories to compress together

// ============ Helpers ============

type MemoryRow = Awaited<ReturnType<typeof db.memory.findFirst>>

function rowToRecordSafe(row: NonNullable<MemoryRow>): MemoryRecord {
  return _rowToRecord(row)
}

// ============ Public API ============

/**
 * Promote short_term memories to long_term (if importance ≥ threshold
 * or accessed frequently). Compress episodic memories into a single
 * semantic summary.
 */
export async function consolidateShortTerm(sessionId: string): Promise<void> {
  logger.info('Consolidating short-term memories', { sessionId })

  // 1. Promote short_term → long_term
  const shortTermRows = await db.memory.findMany({
    where: { sessionId, type: 'short_term' },
  })

  let promoted = 0
  for (const row of shortTermRows) {
    const shouldPromote =
      row.importance >= PROMOTION_IMPORTANCE_THRESHOLD ||
      row.accessCount >= PROMOTION_ACCESS_THRESHOLD

    if (shouldPromote) {
      await db.memory.update({
        where: { id: row.id },
        data: { type: 'long_term' },
      })
      promoted++
      await emit('memory:written', {
        memoryId: row.id,
        type: 'long_term',
        promotedFrom: 'short_term',
      })
    }
  }
  logger.info('Promoted short-term → long-term', { sessionId, count: promoted })

  // 2. Compress episodic memories into semantic summaries
  const episodicRows = await db.memory.findMany({
    where: { sessionId, type: 'episodic' },
    orderBy: { createdAt: 'asc' },
  })

  if (episodicRows.length >= EPISODIC_COMPRESSION_BATCH) {
    // Process in batches
    for (let i = 0; i < episodicRows.length; i += EPISODIC_COMPRESSION_BATCH) {
      const batch = episodicRows.slice(i, i + EPISODIC_COMPRESSION_BATCH)
      const records = batch.map(rowToRecordSafe)
      try {
        const summary = await compressMemories(records)
        // Store as a new semantic memory
        await writeMemory({
          type: 'semantic',
          content: summary,
          summary,
          sessionId,
          metadata: {
            consolidatedFrom: records.map((r) => r.id),
            consolidatedAt: new Date().toISOString(),
            sourceType: 'episodic_compression',
          },
          provenance: { source: 'consolidation', taskId: undefined },
          confidence: 0.75,
          importance: 0.7,
        })

        // Archive the original episodic memories: lower importance so they
        // get pruned by future forgetting passes (don't delete outright —
        // preserve for audit/replay).
        await Promise.all(
          batch.map((r) =>
            db.memory.update({
              where: { id: r.id },
              data: {
                importance: 0.1,
                metadata: JSON.stringify({
                  ...(r.metadata ? safeParse(r.metadata) : {}),
                  archivedBy: 'episodic_compression',
                  archivedAt: new Date().toISOString(),
                }),
              },
            })
          )
        )
        logger.info('Compressed episodic batch → semantic', {
          sessionId,
          batchSize: batch.length,
        })
      } catch (err) {
        logger.warn('Episodic compression failed for batch', {
          sessionId,
          batchStart: i,
          error: String(err),
        })
      }
    }
  }

  // 3. Forget expired memories opportunistically
  const forgotten = await forgetExpired()
  if (forgotten > 0) {
    logger.info('Forgot expired memories during consolidation', { sessionId, count: forgotten })
  }
}

/**
 * Compress multiple memories into a single semantic summary string.
 * Uses the Model Gateway (GLM-5.2) to summarise.
 */
export async function compressMemories(memories: MemoryRecord[]): Promise<string> {
  if (memories.length === 0) return ''
  if (memories.length === 1) return memories[0].summary ?? memories[0].content

  const gateway = await getModelGateway()

  const memoryText = memories
    .map((m, i) => {
      const body = m.summary ?? m.content
      const meta = m.metadata ? ` [meta: ${JSON.stringify(m.metadata)}]` : ''
      return `(${i + 1}) [${m.type}] ${body}${meta}`
    })
    .join('\n')

  const system = `You are MiMo's memory consolidation module. Your job is to compress multiple episodic / short-term memory fragments into a single, dense, semantic summary.

Rules:
- Capture all distinct facts, preferences, events, entities, and causal relationships.
- Resolve duplicates; merge related items.
- Preserve concrete details (names, dates, numbers, code identifiers) verbatim where relevant.
- Drop transient noise (greetings, filler, navigation actions).
- Output a single paragraph (or short bullet list) of distilled knowledge, no preamble.`

  const response = await gateway.chat({
    system,
    messages: [
      {
        role: 'user',
        content: `Compress the following ${memories.length} memory fragments into a single semantic summary:\n\n${memoryText}`,
      },
    ],
    temperature: 0.2,
    maxTokens: 800,
  })

  return response.content.trim()
}

/**
 * Delete memories past their expiresAt. Returns the count deleted.
 */
export async function forgetExpired(): Promise<number> {
  const now = new Date()
  const result = await db.memory.deleteMany({
    where: {
      expiresAt: { not: null, lt: now },
    },
  })
  if (result.count > 0) {
    logger.info('Forgot expired memories', { count: result.count })
  }
  return result.count
}

/**
 * Resolve conflicts between a new memory and existing memories.
 * Uses the gateway to detect whether the new memory contradicts each
 * existing one. If contradiction found, keeps the higher-confidence one
 * and archives the other (importance = 0, metadata.conflictWith = winnerId).
 *
 * Returns the newMemory (possibly with archived metadata if it lost).
 */
export async function resolveConflicts(
  newMemory: MemoryRecord,
  existing: MemoryRecord[]
): Promise<MemoryRecord> {
  if (existing.length === 0) return newMemory

  const gateway = await getModelGateway()

  // Only consider existing memories of the same type (or long_term/semantic
  // for cross-type contradiction checks) — otherwise the prompt is noisy.
  const candidates = existing.filter(
    (m) => m.type === newMemory.type ||
           m.type === 'long_term' ||
           m.type === 'semantic' ||
           m.type === 'preference'
  )
  if (candidates.length === 0) return newMemory

  const system = `You are MiMo's conflict-resolution module. Given a NEW statement and an EXISTING statement, decide whether they directly contradict each other.

Respond with ONLY valid JSON:
{"contradicts": true|false, "reason": "<short explanation>"}

"contradicts" is true ONLY if the two statements cannot both be true at the same time. Mere differences in detail, perspective, or specificity should be false.`

  let updated = newMemory

  for (const ex of candidates) {
    if (ex.id === newMemory.id) continue
    try {
      const response = await gateway.chat({
        system,
        messages: [
          {
            role: 'user',
            content: `NEW: ${newMemory.content}\n\nEXISTING: ${ex.content}`,
          },
        ],
        temperature: 0,
        maxTokens: 200,
      })

      // Parse JSON robustly
      const match = response.content.match(/\{[\s\S]*\}/)
      if (!match) continue
      const parsed = JSON.parse(match[0]) as { contradicts?: boolean; reason?: string }
      if (!parsed.contradicts) continue

      logger.info('Memory conflict detected', {
        newId: newMemory.id,
        existingId: ex.id,
        reason: parsed.reason,
      })

      // Decide winner: higher confidence wins; tie-break on importance, then recency.
      const newScore = newMemory.confidence * 0.6 + newMemory.importance * 0.4
      const exScore = ex.confidence * 0.6 + ex.importance * 0.4
      const newWins = newScore >= exScore ||
                      (newScore === exScore && newMemory.createdAt >= ex.createdAt)

      if (newWins) {
        // Archive the existing memory
        await updateMemory(ex.id, {
          importance: 0,
          metadata: {
            ...(ex.metadata ?? {}),
            conflictWith: newMemory.id,
            conflictReason: parsed.reason,
            archivedAt: new Date().toISOString(),
          },
        })
      } else {
        // Archive the new memory
        updated = await updateMemory(newMemory.id, {
          importance: 0,
          metadata: {
            ...(newMemory.metadata ?? {}),
            conflictWith: ex.id,
            conflictReason: parsed.reason,
            archivedAt: new Date().toISOString(),
          },
        })
        // New memory lost — stop checking, it's archived
        break
      }
    } catch (err) {
      logger.warn('Conflict check failed', {
        newId: newMemory.id,
        existingId: ex.id,
        error: String(err),
      })
    }
  }

  return updated
}

// ============ Internal ============

function safeParse(s: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return undefined
  }
}

// Re-export for callers that want a typed view
export type { MemoryType }
