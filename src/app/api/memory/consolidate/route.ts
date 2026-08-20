import { NextResponse } from "next/server"
import { consolidate, deduplicate, detectConflicts } from "@/lib/memory/engine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST() {
  try {
    const result = await consolidate()
    const deduped = await deduplicate()
    const conflicts = await detectConflicts()
    return NextResponse.json({
      ...result,
      deduplicated: deduped,
      conflicts: conflicts.conflicts.length,
    })
  } catch {
    return NextResponse.json({ error: "Consolidation failed" }, { status: 500 })
  }
}
