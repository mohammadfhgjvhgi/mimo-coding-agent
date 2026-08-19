import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { ingestText, ingestFile, syncFolder, incrementalSync, deleteSource, getKnowledgeStats } from "@/lib/knowledge/ingestion"
import { hybridSearch, agenticRetrieval, fullContextSearch } from "@/lib/knowledge/search-engine"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"
import path from "node:path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET — search or stats
export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") || "search"
  const query = req.nextUrl.searchParams.get("q") || ""
  const collectionId = req.nextUrl.searchParams.get("collectionId") || undefined
  const limit = Number(req.nextUrl.searchParams.get("limit")) || 10

  if (action === "stats") {
    const stats = await getKnowledgeStats()
    return NextResponse.json(stats)
  }

  if (action === "agentic") {
    const context = req.nextUrl.searchParams.get("context") || ""
    const hits = await agenticRetrieval(context, query, limit)
    return NextResponse.json({ results: hits })
  }

  if (action === "full") {
    const results = await fullContextSearch(query, collectionId || undefined)
    return NextResponse.json({ results })
  }

  if (action === "collections") {
    const collections = await db.knowledgeCollection.findMany({ orderBy: { updatedAt: "desc" } })
    return NextResponse.json({ collections })
  }

  // Default: hybrid search
  const hits = await hybridSearch(query, { collectionId: collectionId || undefined, limit })
  return NextResponse.json({ results: hits })
}

// POST — ingest text/file/folder, or create collection
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const action = String(body.action || "ingest_text")

    if (action === "create_collection") {
      const collection = await db.knowledgeCollection.create({
        data: {
          name: String(body.name || "مجموعة جديدة"),
          description: body.description || null,
          scope: String(body.scope || "personal"),
          color: body.color || null,
        },
      })
      return NextResponse.json({ collection })
    }

    if (action === "ingest_text") {
      const result = await ingestText(
        String(body.text || ""),
        String(body.source || "pasted_text"),
        String(body.sourceType || "text"),
        body.collectionId
      )
      return NextResponse.json(result)
    }

    if (action === "ingest_file") {
      const filePath = String(body.path || "")
      // Resolve relative to workspace
      const resolved = path.isAbsolute(filePath) ? filePath : path.join(path.resolve(WORKSPACE_ROOT), filePath)
      const result = await ingestFile(resolved, body.collectionId)
      return NextResponse.json(result)
    }

    if (action === "sync_folder") {
      const folderPath = String(body.path || ".")
      const resolved = path.isAbsolute(folderPath) ? folderPath : path.join(path.resolve(WORKSPACE_ROOT), folderPath)
      const incremental = body.incremental === true
      const result = incremental
        ? await incrementalSync(resolved, body.collectionId)
        : await syncFolder(resolved, body.collectionId)
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (e) {
    console.error("[POST /api/knowledge]", e)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

// DELETE — delete source or collection
export async function DELETE(req: NextRequest) {
  try {
    const source = req.nextUrl.searchParams.get("source")
    const collectionId = req.nextUrl.searchParams.get("collectionId")

    if (source) {
      const deleted = await deleteSource(source)
      return NextResponse.json({ deleted })
    }

    if (collectionId) {
      await db.knowledgeChunk.deleteMany({ where: { collectionId } })
      await db.knowledgeCollection.delete({ where: { id: collectionId } })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: "source or collectionId required" }, { status: 400 })
  } catch {
    return NextResponse.json({ error: "Delete failed" }, { status: 500 })
  }
}
