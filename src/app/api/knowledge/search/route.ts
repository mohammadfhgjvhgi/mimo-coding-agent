import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get("q") || ""
    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 10, 50)
    
    if (!q) {
      return NextResponse.json({ results: [] })
    }

    // Simple text search (BM25-like: count keyword matches)
    const keywords = q.toLowerCase().split(/\s+/).filter(w => w.length > 2)
    const chunks = await db.knowledgeChunk.findMany({ take: 200 })
    
    const results = chunks.map(chunk => {
      const content = chunk.content.toLowerCase()
      let score = 0
      for (const kw of keywords) {
        const count = (content.match(new RegExp(kw, "g")) || []).length
        score += count
      }
      return { id: chunk.id, source: chunk.source, content: chunk.content.slice(0, 200), score }
    }).filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit)

    return NextResponse.json({ results })
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
