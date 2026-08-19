// Knowledge Ingestion — pipeline: file/text/URL → parse → chunk → embed → DB.
// Also handles: metadata extraction, collection assignment, incremental sync.

import { db } from "@/lib/db"
import { parseDocument, parseTextContent, detectSourceType } from "./parser"
import { hashEmbed } from "./search-engine"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

// Ingest a file from the filesystem.
export async function ingestFile(
  filePath: string,
  collectionId?: string
): Promise<{ source: string; chunks: number; sourceType: string }> {
  const parsed = parseDocument(filePath)
  if (!parsed) throw new Error(`Failed to parse: ${filePath}`)

  // Delete existing chunks for this source
  await db.knowledgeChunk.deleteMany({ where: { source: filePath } })

  // Hash-embed each chunk
  for (let i = 0; i < parsed.chunks.length; i++) {
    const chunk = parsed.chunks[i]
    const embedding = hashEmbed(chunk)
    const tokens = Math.ceil(chunk.length / 3.5)

    await db.knowledgeChunk.create({
      data: {
        collectionId: collectionId || null,
        source: filePath,
        sourceType: parsed.metadata.sourceType,
        content: chunk,
        embedding: JSON.stringify(Array.from(embedding)),
        chunkIndex: i,
        tokens,
        metadata: JSON.stringify(parsed.metadata),
      },
    })
  }

  return {
    source: filePath,
    chunks: parsed.chunks.length,
    sourceType: parsed.metadata.sourceType,
  }
}

// Ingest text content (pasted text, URL content, notes).
export async function ingestText(
  text: string,
  source: string,
  sourceType: string = "text",
  collectionId?: string
): Promise<{ source: string; chunks: number }> {
  const parsed = parseTextContent(text, source, sourceType)

  // Delete existing chunks for this source
  await db.knowledgeChunk.deleteMany({ where: { source } })

  for (let i = 0; i < parsed.chunks.length; i++) {
    const chunk = parsed.chunks[i]
    const embedding = hashEmbed(chunk)
    const tokens = Math.ceil(chunk.length / 3.5)

    await db.knowledgeChunk.create({
      data: {
        collectionId: collectionId || null,
        source,
        sourceType,
        content: chunk,
        embedding: JSON.stringify(Array.from(embedding)),
        chunkIndex: i,
        tokens,
        metadata: JSON.stringify(parsed.metadata),
      },
    })
  }

  return { source, chunks: parsed.chunks.length }
}

// Folder sync — recursively ingest all text files in a folder.
export async function syncFolder(
  folderPath: string,
  collectionId?: string
): Promise<{ files: number; chunks: number; errors: string[] }> {
  const errors: string[] = []
  let totalFiles = 0
  let totalChunks = 0

  async function walk(dir: string) {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const name = String(entry.name)
      if (name.startsWith(".") || name === "node_modules" || name === ".git") continue
      const fullPath = path.join(dir, name)

      if (entry.isDirectory()) {
        await walk(fullPath)
      } else {
        const ext = path.extname(name).toLowerCase()
        // Only ingest text-based files
        if ([".txt", ".md", ".js", ".ts", ".tsx", ".jsx", ".py", ".json", ".csv", ".html", ".yaml", ".yml"].includes(ext)) {
          try {
            const result = await ingestFile(fullPath, collectionId)
            totalFiles++
            totalChunks += result.chunks
          } catch (e) {
            errors.push(`${fullPath}: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
      }
    }
  }

  await walk(folderPath)
  return { files: totalFiles, chunks: totalChunks, errors }
}

// Incremental sync — only ingest files that changed since last sync.
export async function incrementalSync(
  folderPath: string,
  collectionId?: string
): Promise<{ new: number; updated: number; unchanged: number; errors: string[] }> {
  const errors: string[] = []
  let newCount = 0
  let updatedCount = 0
  let unchangedCount = 0

  // Get existing sources with their latest chunk timestamps
  const existing = await db.knowledgeChunk.findMany({
    where: { source: { startsWith: folderPath } },
    select: { source: true, createdAt: true },
    distinct: ["source"],
  })
  const existingMap = new Map(existing.map(e => [e.source, e.createdAt]))

  async function walk(dir: string) {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }

    for (const entry of entries) {
      const name = String(entry.name)
      if (name.startsWith(".") || name === "node_modules" || name === ".git") continue
      const fullPath = path.join(dir, name)

      if (entry.isDirectory()) {
        await walk(fullPath)
      } else {
        const ext = path.extname(name).toLowerCase()
        if (![".txt", ".md", ".js", ".ts", ".tsx", ".jsx", ".py", ".json", ".csv", ".html", ".yaml", ".yml"].includes(ext)) continue

        try {
          const stat = statSync(fullPath)
          const fileTime = stat.mtime
          const existingTime = existingMap.get(fullPath)

          if (!existingTime) {
            // New file
            await ingestFile(fullPath, collectionId)
            newCount++
          } else if (fileTime > existingTime) {
            // Updated file
            await ingestFile(fullPath, collectionId)
            updatedCount++
          } else {
            unchangedCount++
          }
        } catch (e) {
          errors.push(`${fullPath}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
  }

  await walk(folderPath)
  return { new: newCount, updated: updatedCount, unchanged: unchangedCount, errors }
}

// Delete all chunks for a source.
export async function deleteSource(source: string): Promise<number> {
  const result = await db.knowledgeChunk.deleteMany({ where: { source } })
  return result.count
}

// Get knowledge stats.
export async function getKnowledgeStats() {
  const [totalChunks, totalSources, totalCollections] = await Promise.all([
    db.knowledgeChunk.count(),
    db.knowledgeChunk.groupBy({ by: ["source"], _count: true }),
    db.knowledgeCollection.count(),
  ])

  const byType = await db.knowledgeChunk.groupBy({ by: ["sourceType"], _count: true })
  const typeStats: Record<string, number> = {}
  for (const t of byType) typeStats[t.sourceType] = t._count

  return {
    totalChunks,
    totalSources: totalSources.length,
    totalCollections,
    byType: typeStats,
    sources: totalSources.map(s => ({ source: s.source, chunks: s._count })),
  }
}
