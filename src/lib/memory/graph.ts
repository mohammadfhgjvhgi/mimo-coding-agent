// Memory Graph — adapted from Quaesitor.
// Entity-relation storage for semantic memory connections.
// Each memory = node. Edges = supports/contradicts/related/causes.
// BFS traversal for recall expansion. 0 LLM calls (keyword overlap scoring).

import { db } from "@/lib/db"
import { randomUUID } from "node:crypto"

export type RelationType = "supports" | "contradicts" | "related" | "causes"

export interface MemoryEdge {
  id: string
  sourceMemoryId: string
  targetMemoryId: string
  relationType: RelationType
  weight: number // 0-1 similarity
  createdAt: string
}

export interface MemoryNode {
  id: string
  content: string
  type: string
  createdAt: string
}

export interface GraphData {
  nodes: MemoryNode[]
  edges: MemoryEdge[]
}

// Ensure the memory_edges table exists (Prisma raw SQL).
async function ensureEdgesTable(): Promise<void> {
  try {
    await db.$executeRaw`
      CREATE TABLE IF NOT EXISTS memory_edges (
        id TEXT PRIMARY KEY,
        source_memory_id TEXT NOT NULL,
        target_memory_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        weight REAL NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `
    await db.$executeRaw`CREATE INDEX IF NOT EXISTS idx_memory_edges_source ON memory_edges(source_memory_id)`
    await db.$executeRaw`CREATE INDEX IF NOT EXISTS idx_memory_edges_target ON memory_edges(target_memory_id)`
  } catch {
    // best-effort — graph features silently degrade
  }
}

// Extract relations between a new memory and existing memories.
// Uses keyword overlap + negation detection. 0 LLM calls.
export function extractRelations(
  newMemory: { id: string; content: string },
  existingMemories: Array<{ id: string; content: string }>,
  maxRelations = 5
): Omit<MemoryEdge, "id" | "createdAt">[] {
  if (existingMemories.length === 0) return []
  const relations: Omit<MemoryEdge, "id" | "createdAt">[] = []
  const newWords = new Set(
    newMemory.content.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
  )
  if (newWords.size === 0) return []

  for (const existing of existingMemories) {
    const existingWords = new Set(
      existing.content.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
    )
    if (existingWords.size === 0) continue
    const overlap = [...newWords].filter((w) => existingWords.has(w))
    const similarity = overlap.length / Math.max(newWords.size, existingWords.size, 1)

    if (similarity > 0.15) {
      let relationType: RelationType = "related"
      const negationWords = ["not", "never", "no", "don't", "doesn't", "isn't", "لا", "ليس", "غير"]
      const hasNegation = negationWords.some((nw) =>
        existing.content.toLowerCase().includes(nw) &&
        overlap.some((ow) => existing.content.toLowerCase().includes(`${nw} ${ow}`))
      )
      if (hasNegation) relationType = "contradicts"
      else if (similarity > 0.5) relationType = "supports"

      relations.push({
        sourceMemoryId: newMemory.id,
        targetMemoryId: existing.id,
        relationType,
        weight: similarity,
      })
    }
  }

  return relations.sort((a, b) => b.weight - a.weight).slice(0, maxRelations)
}

// Store edges in the database.
export async function storeMemoryEdges(edges: Omit<MemoryEdge, "id" | "createdAt">[]): Promise<void> {
  if (edges.length === 0) return
  try {
    await ensureEdgesTable()
    for (const edge of edges) {
      await db.$executeRaw`
        INSERT OR REPLACE INTO memory_edges (id, source_memory_id, target_memory_id, relation_type, weight, created_at)
        VALUES (${randomUUID()}, ${edge.sourceMemoryId}, ${edge.targetMemoryId}, ${edge.relationType}, ${edge.weight}, datetime('now'))
      `
    }
  } catch {
    // Non-fatal — graph edges are nice-to-have
  }
}

// Get graph data for visualization.
export async function getMemoryGraph(limit = 50): Promise<GraphData> {
  try {
    await ensureEdgesTable()
    const nodes = await db.memory.findMany({
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { id: true, value: true, category: true, updatedAt: true },
    })

    const memoryNodes: MemoryNode[] = nodes.map((n) => ({
      id: n.id,
      content: n.value,
      type: n.category,
      createdAt: n.updatedAt.toISOString(),
    }))

    if (memoryNodes.length === 0) return { nodes: [], edges: [] }

    const nodeIds = memoryNodes.map((n) => n.id)
    const edges: MemoryEdge[] = []

    for (const nodeId of nodeIds) {
      const outEdges = await db.$queryRaw<MemoryEdge[]>`
        SELECT id, source_memory_id as "sourceMemoryId", target_memory_id as "targetMemoryId",
               relation_type as "relationType", weight,
               created_at as "createdAt"
        FROM memory_edges
        WHERE source_memory_id = ${nodeId} OR target_memory_id = ${nodeId}
        LIMIT 5
      `
      edges.push(...outEdges)
    }

    // Dedupe edges
    const seen = new Set<string>()
    const deduped = edges.filter((e) => {
      if (seen.has(e.id)) return false
      seen.add(e.id)
      return true
    })

    return { nodes: memoryNodes, edges: deduped }
  } catch {
    return { nodes: [], edges: [] }
  }
}

// BFS traversal from a starting set of memories.
// Returns the union of start IDs plus every memory reachable within `depth` hops.
export async function recallWithGraph(
  startMemoryIds: string[],
  depth = 2
): Promise<string[]> {
  if (startMemoryIds.length === 0) return []

  const visited = new Set<string>(startMemoryIds)
  const queue = [...startMemoryIds]
  const result = [...startMemoryIds]

  try {
    await ensureEdgesTable()

    for (let d = 0; d < depth && queue.length > 0; d++) {
      const currentBatch = queue.splice(0)
      for (const memId of currentBatch) {
        const edges = await db.$queryRaw<{ id: string }[]>`
          SELECT target_memory_id as id FROM memory_edges WHERE source_memory_id = ${memId}
          UNION
          SELECT source_memory_id as id FROM memory_edges WHERE target_memory_id = ${memId}
        `

        for (const edge of edges) {
          if (!visited.has(edge.id)) {
            visited.add(edge.id)
            result.push(edge.id)
            queue.push(edge.id)
          }
        }
      }
    }
  } catch {
    // return just the start set
  }

  return result
}

// Auto-build edges when a new memory is saved.
export async function autoBuildEdges(
  newMemoryId: string,
  newMemoryContent: string
): Promise<void> {
  try {
    const existing = await db.memory.findMany({
      where: { id: { not: newMemoryId } },
      select: { id: true, value: true },
      take: 50,
      orderBy: { updatedAt: "desc" },
    })

    const edges = extractRelations(
      { id: newMemoryId, content: newMemoryContent },
      existing.map((m) => ({ id: m.id, content: m.value }))
    )

    if (edges.length > 0) {
      await storeMemoryEdges(edges)
    }
  } catch {
    // best-effort
  }
}
