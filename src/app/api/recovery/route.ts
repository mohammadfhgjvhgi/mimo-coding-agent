// /api/recovery — POST (all actions) + GET (checkpoints list)
import { NextRequest, NextResponse } from "next/server"
import {
  classifyFailure, localizeError, planRepair,
  saveCheckpoint, restoreCheckpoint, listCheckpoints,
  rollbackNow, runSelfRepairLoop, formatSelfRepairResult,
} from "@/lib/recovery/self-repair"
import {
  getLastCheckpoint, rollbackToCheckpoint, saveFailureMemory, handleFailure,
} from "@/lib/recovery/manager"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET() {
  try {
    const checkpoints = await listCheckpoints()
    const lastCheckpoint = await getLastCheckpoint()
    return NextResponse.json({ checkpoints, lastCheckpoint, total: checkpoints.length })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      case "save_checkpoint": {
        const res = await saveCheckpoint(String(body.description || "manual checkpoint"))
        return NextResponse.json({ checkpoint: res })
      }
      case "restore_checkpoint": {
        const res = await restoreCheckpoint(body.id)
        return NextResponse.json({ checkpoint: res })
      }
      case "list_checkpoints": {
        const res = await listCheckpoints()
        return NextResponse.json({ checkpoints: res })
      }
      case "rollback_now": {
        const res = await rollbackNow(String(body.reason || "manual rollback"))
        return NextResponse.json({ success: res })
      }
      case "rollback_to": {
        const res = await rollbackToCheckpoint(String(body.hash))
        return NextResponse.json({ success: res })
      }
      case "save_failure_memory": {
        const res = await saveFailureMemory(String(body.task || ""), String(body.error || ""), body.checkpoint || null)
        return NextResponse.json({ success: res })
      }
      case "classify_failure": {
        const res = classifyFailure(body.verificationResult)
        return NextResponse.json({ class: res })
      }
      case "localize_error": {
        const res = localizeError(body.verificationResult)
        return NextResponse.json(res)
      }
      case "plan_repair": {
        const res = planRepair(body.verificationResult, body.failureClass || "unknown", body.localizedError || null)
        return NextResponse.json(res)
      }
      case "run_self_repair": {
        const res = await runSelfRepairLoop(body.opts || {})
        return NextResponse.json({ result: res, formatted: formatSelfRepairResult(res) })
      }
      case "handle_failure": {
        const res = await handleFailure({ task: String(body.task || ""), error: String(body.error || ""), conversationId: body.conversationId })
        return NextResponse.json(res)
      }
      default:
        return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
