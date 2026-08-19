import { NextRequest, NextResponse } from "next/server"
import {
  getIndexStats,
  getRepoMap,
  reindexWorkspace,
  findSymbol,
} from "@/lib/code-intel/symbol-index"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/symbols -> index stats + repo map (for the Symbols UI panel)
export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action")
  const query = req.nextUrl.searchParams.get("q")

  if (action === "search" && query) {
    const symbols = await findSymbol(query)
    return NextResponse.json({ symbols })
  }

  if (action === "map") {
    const map = await getRepoMap()
    return NextResponse.json({ map })
  }

  // Default: stats + map
  const [stats, map] = await Promise.all([getIndexStats(), getRepoMap()])
  return NextResponse.json({ stats, map })
}

// POST /api/symbols -> trigger a full reindex
export async function POST() {
  try {
    const result = await reindexWorkspace()
    return NextResponse.json(result)
  } catch (error) {
    console.error("[POST /api/symbols]", error)
    return NextResponse.json({ error: "فشل إعادة الفهرسة" }, { status: 500 })
  }
}
