import { NextRequest, NextResponse } from "next/server"
import {
  buildEvidencePackage, formatEvidencePackage, trackEvidenceProvenance,
  collectFileEvidence, collectSymbolEvidence, collectMemoryEvidence,
  type EvidenceItem,
} from "@/lib/evidence/evidence-system"
import { db } from "@/lib/db"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/evidence — build an evidence package for a query
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const query = String(body.query || "")
    const budget = Number(body.budget) || 2000
    const filePaths: string[] = body.files || []
    const symbolNames: string[] = body.symbols || []

    const items: EvidenceItem[] = []

    // Collect file evidence
    for (const fp of filePaths.slice(0, 5)) {
      try {
        const abs = path.isAbsolute(fp) ? fp : path.join(path.resolve(WORKSPACE_ROOT), fp)
        if (existsSync(abs)) {
          const content = readFileSync(abs, "utf8").slice(0, 3000)
          items.push(collectFileEvidence(fp, content, "user-specified file"))
        }
      } catch {}
    }

    // Collect symbol evidence
    for (const sym of symbolNames.slice(0, 5)) {
      const result = await db.symbol.findMany({ where: { name: sym }, take: 1 })
      if (result.length > 0) {
        items.push(collectSymbolEvidence(sym, result[0].filePath, result[0].signature || "", "symbol referenced by user"))
      }
    }

    // Collect memory evidence
    const memories = await db.memory.findMany({ take: 5, orderBy: { updatedAt: "desc" } })
    for (const m of memories) {
      const ageDays = (Date.now() - m.updatedAt.getTime()) / 86400000
      items.push(collectMemoryEvidence(m.key, m.value, m.confidence || 0.8, ageDays, m.source || "semantic"))
    }

    // Build package
    const pkg = buildEvidencePackage(items, { budget, query, deduplicate: true, rank: true })
    const formatted = formatEvidencePackage(pkg)
    const provenance = trackEvidenceProvenance(pkg)

    return NextResponse.json({
      package: pkg,
      formatted,
      provenance,
    })
  } catch (e) {
    console.error("[POST /api/evidence]", e)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

// GET /api/evidence — test with default collection
export async function GET() {
  const items: EvidenceItem[] = []
  const memories = await db.memory.findMany({ take: 3, orderBy: { updatedAt: "desc" } })
  for (const m of memories) {
    const ageDays = (Date.now() - m.updatedAt.getTime()) / 86400000
    items.push(collectMemoryEvidence(m.key, m.value, m.confidence || 0.8, ageDays, m.source || "semantic"))
  }

  const pkg = buildEvidencePackage(items, { budget: 2000, query: "", deduplicate: true, rank: true })
  const provenance = trackEvidenceProvenance(pkg)

  return NextResponse.json({
    summary: pkg.summary,
    sources: pkg.sources,
    totalTokens: pkg.totalTokens,
    items: pkg.items.map(i => ({
      source: i.source,
      path: i.path,
      confidence: Math.round(i.confidence * 100) + "%",
      freshness: Math.round(i.freshness * 100) + "%",
      tokens: i.tokenCost,
      reason: i.reason,
    })),
    provenance,
    recommendations: pkg.recommendations,
  })
}
