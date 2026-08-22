// /api/reliability-os — POST (all actions) + GET (failures/checkpoints/snapshot/loops)
import { NextRequest, NextResponse } from "next/server"
import {
  loopGuard, resetLoopGuard,
  malformedToolRecovery, wrongToolRecovery, argumentRepair, proseToToolRecovery,
  timeoutRecovery, oomRecovery, crashRecovery, unknownStateReconcile,
  createCheckpoint, checkpointRollback, listCheckpoints,
  failureClassify, failureMemoryLookup, negativeLearning,
  listFailures, markRecovered, reliabilitySnapshot,
} from "@/lib/reliability/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      // 1. Loop Guard (338)
      case "loop_guard":   return wrap(await loopGuard({
        conversationId: body.conversationId,
        toolName: body.toolName,
        args: body.args ?? {},
      }))
      case "loop_reset":  return wrap(await resetLoopGuard(body.conversationId).then(() => ({ ok: true, data: { reset: true } })))

      // 2. Malformed Tool Recovery (339)
      case "malformed_recover": return wrap(malformedToolRecovery(body.rawToolCall ?? ""))

      // 3. Wrong Tool Recovery (340)
      case "wrong_tool_recover": return wrap(wrongToolRecovery(body.toolName ?? ""))

      // 4. Argument Repair (341)
      case "argument_repair": return wrap(argumentRepair(body.toolName ?? "", body.args ?? {}))

      // 5. Prose-to-Tool Recovery (342)
      case "prose_to_tool": return wrap(proseToToolRecovery(body.prose ?? ""))

      // 6. Timeout Recovery (343)
      case "timeout_recover": return wrap(await timeoutRecovery({
        toolName: body.toolName,
        args: body.args,
        attempt: body.attempt ?? 1,
        maxAttempts: body.maxAttempts,
        baseDelayMs: body.baseDelayMs,
      }))

      // 7. OOM Recovery (344)
      case "oom_recover": return wrap(await oomRecovery({
        currentMemoryMB: body.currentMemoryMB ?? 0,
        thresholdMB: body.thresholdMB,
        contextSize: body.contextSize,
      }))

      // 8. Crash Recovery (345)
      case "crash_recover": return wrap(await crashRecovery(body.conversationId))

      // 9. Unknown-State Reconciliation (346)
      case "unknown_state_reconcile": return wrap(unknownStateReconcile(body.state ?? {}))

      // 10. Checkpoint Rollback (347)
      case "checkpoint_create": return wrap(await createCheckpoint({
        conversationId: body.conversationId,
        state: body.state ?? {},
        kind: body.kind,
        label: body.label,
        gitHash: body.gitHash,
        tokens: body.tokens,
      }))
      case "checkpoint_rollback": return wrap(await checkpointRollback(body.id))

      // 11. Failure Classify (348)
      case "failure_classify": return wrap(await failureClassify({
        task: body.task,
        error: body.error,
        category: body.category,
        severity: body.severity,
        context: body.context,
      }))

      // 12. Failure Memory Lookup (349)
      case "failure_memory_lookup": return wrap(await failureMemoryLookup(body.task, body.error))

      // 13. Negative Learning (350)
      case "negative_learning": return wrap(await negativeLearning({
        task: body.task,
        error: body.error,
        lesson: body.lesson,
        category: body.category,
      }))

      case "failure_mark_recovered": return wrap(await markRecovered(body.id, body.lesson))

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
      case "failures":    return wrap(await listFailures(parseInt(sp.get("limit") ?? "50")))
      case "checkpoints": return wrap(await listCheckpoints(sp.get("conversationId") ?? undefined, parseInt(sp.get("limit") ?? "20")))
      case "snapshot":    return wrap(await reliabilitySnapshot())
      default: return NextResponse.json({ error: `unknown mode: ${mode}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

function wrap<T>(result: { ok: boolean; data?: T; error?: string; message?: string }) {
  if (result.ok) return NextResponse.json(result.data)
  return NextResponse.json({ error: result.error, message: result.message }, { status: 400 })
}
