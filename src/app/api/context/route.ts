import { NextRequest, NextResponse } from "next/server"
import {
  calculateBudget, inspectContext, getCacheStats, rankFiles,
  type LLMMessage,
} from "@/lib/context/context-os-v2"
import { db } from "@/lib/db"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/context — inspect context for a conversation
export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") || "inspect"
  const conversationId = req.nextUrl.searchParams.get("conversationId")
  const provider = req.nextUrl.searchParams.get("provider") || "zai"
  const query = req.nextUrl.searchParams.get("q") || ""

  if (action === "cache") {
    const stats = getCacheStats()
    return NextResponse.json(stats)
  }

  if (action === "rank" && query) {
    // Rank files by relevance to query
    const root = path.resolve(WORKSPACE_ROOT)
    const files: { path: string; content?: string; name: string }[] = []

    function walk(dir: string, rel: string) {
      try {
        const entries = readdirSync(dir, { withFileTypes: true })
        for (const e of entries) {
          const name = String(e.name)
          if (["node_modules", ".git", ".next", ".cache", "dist", "build", "out", "upload", "skills"].includes(name)) continue
          if (name.startsWith(".")) continue
          const abs = path.join(dir, name)
          const r = rel ? `${rel}/${name}` : name
          if (e.isDirectory()) walk(abs, r)
          else if (/\.(ts|tsx|js|jsx|py|md)$/.test(name)) {
            try {
              const content = readFileSync(abs, "utf8").slice(0, 5000)
              files.push({ path: r, content, name })
            } catch { files.push({ path: r, name }) }
          }
        }
      } catch {}
    }
    walk(root, "")

    const ranked = rankFiles(files, query, { maxResults: 10, includeContent: true })
    return NextResponse.json({ ranked, total: files.length })
  }

  // Default: inspect context for a conversation
  let messages: LLMMessage[] = []
  if (conversationId) {
    const msgs = await db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      take: 30,
    })
    messages = msgs.map(m => ({ role: m.role as any, content: m.content }))
  }

  const inspection = inspectContext(messages, provider)
  return NextResponse.json(inspection)
}
