import { NextRequest, NextResponse } from "next/server"
import { scanRepository, analyzeChangeImpact, buildRepoMap } from "@/lib/code-intel/graphs/repo-scanner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

// GET /api/repo-scan — full repository scan
export async function GET(req: NextRequest) {
  try {
    const action = req.nextUrl.searchParams.get("action") || "scan"
    const filePath = req.nextUrl.searchParams.get("file")

    if (action === "impact" && filePath) {
      // Change impact analysis for a specific file
      const scan = await scanRepository()
      const impact = analyzeChangeImpact(filePath, scan.dependencies)
      return NextResponse.json(impact)
    }

    if (action === "map") {
      // Aider-style compact repo map
      const scan = await scanRepository()
      const repoMap = buildRepoMap(scan.files, scan.symbols, 2000)
      return NextResponse.json({ repoMap, stats: scan.stats })
    }

    // Default: full scan
    const result = await scanRepository()
    return NextResponse.json({
      stats: result.stats,
      hotspots: result.hotspots.slice(0, 10),
      importCount: result.imports.length,
      callCount: result.calls.length,
      dependencyCount: result.dependencies.length,
      scanDurationMs: result.scanDurationMs,
    })
  } catch (e) {
    console.error("[GET /api/repo-scan]", e)
    return NextResponse.json({ error: "Scan failed" }, { status: 500 })
  }
}
