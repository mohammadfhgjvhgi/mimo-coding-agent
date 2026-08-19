import { NextRequest, NextResponse } from "next/server"
import { scanRepository, buildRepoMap } from "@/lib/code-intel/graphs/repo-scanner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

// GET /api/repo-map — Aider-style compact repo map for LLM context
export async function GET(req: NextRequest) {
  try {
    const maxTokens = Number(req.nextUrl.searchParams.get("tokens")) || 2000
    const scan = await scanRepository()
    const repoMap = buildRepoMap(scan.files, scan.symbols, maxTokens)
    return NextResponse.json({
      repoMap,
      stats: scan.stats,
      hotspots: scan.hotspots.slice(0, 5),
    })
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
