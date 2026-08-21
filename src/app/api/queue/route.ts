import { NextRequest, NextResponse } from "next/server"
import {
  enqueueTask, getNextTask, getDAGOrder, deduplicateTasks,
  pauseTask, cancelTask, escalateTask, getTaskHistory,
  resumeAfterRestart, checkResources,
} from "@/lib/agent/autonomous"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET — queue status, DAG order, history, resources
export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") || "status"

  if (action === "dag") {
    const dag = await getDAGOrder()
    return NextResponse.json({ tasks: dag, count: dag.length })
  }

  if (action === "history") {
    const limit = Number(req.nextUrl.searchParams.get("limit")) || 50
    const history = await getTaskHistory(limit)
    return NextResponse.json({ history, count: history.length })
  }

  if (action === "next") {
    const next = await getNextTask()
    return NextResponse.json({ nextTask: next })
  }

  if (action === "resources") {
    const resources = checkResources()
    return NextResponse.json(resources)
  }

  if (action === "recover") {
    const result = await resumeAfterRestart()
    return NextResponse.json(result)
  }

  // Default: status
  const dag = await getDAGOrder()
  const resources = checkResources()
  const pending = dag.filter(t => t.status === "pending").length
  const running = dag.filter(t => t.status === "running").length
  const paused = dag.filter(t => t.status === "paused").length

  return NextResponse.json({
    queueSize: dag.length,
    pending, running, paused,
    resources,
    tasks: dag.slice(0, 10),
  })
}

// POST — enqueue, dedup, recover
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || "enqueue")

  if (action === "enqueue") {
    const task = await enqueueTask(body.goal, {
      priority: body.priority,
      dependencies: body.dependencies,
    })
    return NextResponse.json({ task })
  }

  if (action === "dedup") {
    const deleted = await deduplicateTasks()
    return NextResponse.json({ deduplicated: deleted })
  }

  if (action === "recover") {
    const result = await resumeAfterRestart()
    return NextResponse.json(result)
  }

  if (action === "pause") {
    await pauseTask(body.taskId)
    return NextResponse.json({ success: true })
  }

  if (action === "cancel") {
    await cancelTask(body.taskId, body.reason)
    return NextResponse.json({ success: true })
  }

  if (action === "escalate") {
    await escalateTask(body.taskId, body.level, body.reason)
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}
