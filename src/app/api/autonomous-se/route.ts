// /api/autonomous-se — POST (all actions) + GET (backlog/scans/snapshot)
import { NextRequest, NextResponse } from "next/server"
import {
  repositoryHealthScan, architectureScan,
  deadCodeDetection, duplicateLogicDetection, couplingAnalysis,
  importCycleDetection, missingTestDetection,
  securityDebtScan, technicalDebtScan, hotspotDetection,
  backlogGenerate, backlogDeduplicate, backlogPrioritize,
  backlogCooldown, taskSupersede, taskDAG,
  sequentialExecute, parallelDeterministicWork,
  continuousHealthLoop, autonomousMaintenance,
  autonomousSnapshot, listBacklog, listHealthScans,
} from "@/lib/autonomous-se/os"
import { scanFiles, indexSymbols, buildImportGraph, buildCallGraph } from "@/lib/code-intel/graphs/repo-scanner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      // 1. Repository Health Scan (351)
      case "health_scan": return wrap(await repositoryHealthScan())

      // 2. Architecture Scan (352)
      case "architecture_scan": return wrap(await architectureScan())

      // 3. Dead Code Detection (353)
      case "dead_code": return wrap(await deadCodeDetection())

      // 4. Duplicate Logic Detection (354)
      case "duplicate_logic": {
        const files = scanFiles()
        return wrap(duplicateLogicDetection(files))
      }

      // 5. Coupling Analysis (355)
      case "coupling": {
        const files = scanFiles()
        const symbols = indexSymbols(files)
        const imports = buildImportGraph(files, symbols)
        const calls = buildCallGraph(symbols)
        return wrap(couplingAnalysis(imports, calls))
      }

      // 6. Import Cycle Detection (356)
      case "import_cycle": {
        const files = scanFiles()
        const symbols = indexSymbols(files)
        const imports = buildImportGraph(files, symbols)
        return wrap(importCycleDetection(imports))
      }

      // 7. Missing Test Detection (357)
      case "missing_test": {
        const files = scanFiles()
        const symbols = indexSymbols(files)
        return wrap(missingTestDetection(files, symbols))
      }

      // 8. Security Debt Scan (358)
      case "security_debt": {
        const files = scanFiles()
        return wrap(securityDebtScan(files))
      }

      // 9. Technical Debt Scan (359)
      case "tech_debt": {
        const files = scanFiles()
        return wrap(technicalDebtScan(files))
      }

      // 10. Hotspot Detection (360)
      case "hotspot": return wrap(await hotspotDetection())

      // 11. Backlog Generate (361)
      case "backlog_generate": return wrap(await backlogGenerate())

      // 12. Backlog Deduplicate (362)
      case "backlog_dedup": return wrap(await backlogDeduplicate())

      // 13. Backlog Prioritize (363)
      case "backlog_prioritize": return wrap(await backlogPrioritize())

      // 14. Backlog Cooldown (364)
      case "backlog_cooldown": return wrap(await backlogCooldown(body.itemIds, body.hoursAhead))

      // 15. Task Supersede (365)
      case "task_supersede": return wrap(await taskSupersede(body.oldId, body.newId))

      // 16. Task DAG (366)
      case "task_dag": return wrap(await taskDAG())

      // 17. Sequential Execute (367)
      case "sequential_execute": return wrap(await sequentialExecute(body.itemIds ?? []))

      // 18. Parallel Deterministic Work (368)
      case "parallel_work": return wrap(await parallelDeterministicWork())

      // 19. Continuous Health Loop (369)
      case "continuous_health": return wrap(await continuousHealthLoop())

      // 20. Autonomous Maintenance (370)
      case "autonomous_maintenance": return wrap(await autonomousMaintenance())

      default: return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const mode = sp.get("mode") ?? "snapshot"
    switch (mode) {
      case "backlog":   return wrap(await listBacklog(sp.get("status") ?? undefined, parseInt(sp.get("limit") ?? "50")))
      case "scans":     return wrap(await listHealthScans(parseInt(sp.get("limit") ?? "10")))
      case "snapshot":  return wrap(await autonomousSnapshot())
      default: return NextResponse.json({ error: `unknown mode: ${mode}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

function wrap<T>(result: { ok: true; data: T } | { ok: false; error: string; message: string }) {
  if (result.ok) return NextResponse.json(result.data)
  return NextResponse.json({ error: result.error, message: result.message }, { status: 400 })
}
