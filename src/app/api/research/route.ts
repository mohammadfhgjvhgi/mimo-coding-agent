import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { runResearchPipeline } from "@/lib/research/pipeline"
import { getSettings } from "@/lib/llm-provider"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

// GET — list research jobs
export async function GET() {
  try {
    const jobs = await db.researchJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, query: true, status: true, depth: true, createdAt: true, tokenUsage: true },
    })
    return NextResponse.json({ jobs })
  } catch {
    return NextResponse.json({ jobs: [] })
  }
}

// POST — start a new research job
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const query = String(body.query || "").trim()
    const depth = String(body.depth || "standard")

    if (!query) return NextResponse.json({ error: "query required" }, { status: 400 })

    const settings = getSettings()
    const result = await runResearchPipeline(query, settings, depth)

    return NextResponse.json(result)
  } catch (e) {
    console.error("[POST /api/research]", e)
    return NextResponse.json({ error: "Research failed" }, { status: 500 })
  }
}
