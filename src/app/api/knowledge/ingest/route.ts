import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { readFileSync } from "node:fs"
import path from "node:path"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const source = String(body.source || "")
    const content = String(body.content || "")
    
    if (!source || !content) {
      return NextResponse.json({ error: "source and content required" }, { status: 400 })
    }

    // Simple chunking (512 chars, 50 overlap)
    const chunks: string[] = []
    const size = 512
    const overlap = 50
    for (let i = 0; i < content.length; i += size - overlap) {
      chunks.push(content.slice(i, i + size))
      if (i + size >= content.length) break
    }

    // Save chunks (without embeddings for now — embeddings need @huggingface/transformers)
    let saved = 0
    for (let i = 0; i < chunks.length; i++) {
      await db.knowledgeChunk.create({
        data: {
          source,
          content: chunks[i],
          embedding: "[]", // placeholder until embeddings module is active
          chunkIndex: i,
        },
      })
      saved++
    }

    return NextResponse.json({ source, chunks: saved })
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
