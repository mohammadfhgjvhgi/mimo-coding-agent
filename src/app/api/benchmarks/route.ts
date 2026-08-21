// /api/benchmarks — POST (record run) + GET (stats)
// Fulfills encyclopedia chapters 72 (Benchmarks) + 92 (Self-Improvement).
// Records every agent task's outcome: time, tokens, success, tool calls.
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST — record a benchmark run
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      taskType, model, taskDescription,
      durationMs, inputTokens, outputTokens,
      toolCalls, toolSuccesses, toolFailures,
      success, errorType, conversationId,
    } = body

    if (!taskType || !model) {
      return NextResponse.json({ error: "taskType + model required" }, { status: 400 })
    }

    // Store as a SystemState entry (key-value) since no dedicated Benchmark model.
    const key = `benchmark_${Date.now()}`
    const value = JSON.stringify({
      taskType, model, taskDescription: String(taskDescription || "").slice(0, 200),
      durationMs: Number(durationMs) || 0,
      inputTokens: Number(inputTokens) || 0,
      outputTokens: Number(outputTokens) || 0,
      toolCalls: Number(toolCalls) || 0,
      toolSuccesses: Number(toolSuccesses) || 0,
      toolFailures: Number(toolFailures) || 0,
      success: Boolean(success),
      errorType: String(errorType || ""),
      conversationId: conversationId || null,
      createdAt: new Date().toISOString(),
    })

    const entry = await db.systemState.create({
      data: { key, value },
    })

    return NextResponse.json({ id: key, recorded: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// GET — aggregate benchmark stats
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const model = sp.get("model")
    const taskType = sp.get("taskType")
    const limit = Math.min(Number(sp.get("limit")) || 100, 500)

    // Fetch benchmark entries from SystemState
    const entries = await db.systemState.findMany({
      where: { key: { startsWith: "benchmark_" } },
      orderBy: { updatedAt: "desc" },
      take: limit,
    })

    const runs = entries.map(e => {
      try { return JSON.parse(e.value) } catch { return null }
    }).filter(Boolean) as Array<{
      taskType: string; model: string; durationMs: number;
      inputTokens: number; outputTokens: number;
      toolCalls: number; toolSuccesses: number; toolFailures: number;
      success: boolean; errorType: string; createdAt: string;
    }>

    // Filter
    const filtered = runs.filter(r =>
      (!model || r.model === model) &&
      (!taskType || r.taskType === taskType)
    )

    if (filtered.length === 0) {
      return NextResponse.json({
        total: 0, successRate: 0, avgDurationMs: 0,
        avgTokens: 0, avgToolCalls: 0, toolSuccessRate: 0,
        byModel: {}, byTaskType: {},
        message: "no benchmark runs recorded yet",
      })
    }

    // Aggregate
    const successes = filtered.filter(r => r.success)
    const successRate = successes.length / filtered.length
    const avgDurationMs = filtered.reduce((s, r) => s + r.durationMs, 0) / filtered.length
    const avgTokens = filtered.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0) / filtered.length
    const avgToolCalls = filtered.reduce((s, r) => s + r.toolCalls, 0) / filtered.length
    const totalToolCalls = filtered.reduce((s, r) => s + r.toolCalls, 0)
    const totalToolSuccesses = filtered.reduce((s, r) => s + r.toolSuccesses, 0)
    const toolSuccessRate = totalToolCalls > 0 ? totalToolSuccesses / totalToolCalls : 0

    // By model
    const byModel: Record<string, { count: number; successRate: number; avgDurationMs: number }> = {}
    for (const r of filtered) {
      if (!byModel[r.model]) byModel[r.model] = { count: 0, successRate: 0, avgDurationMs: 0 }
      byModel[r.model].count++
    }
    for (const m of Object.keys(byModel)) {
      const modelRuns = filtered.filter(r => r.model === m)
      byModel[m].successRate = modelRuns.filter(r => r.success).length / modelRuns.length
      byModel[m].avgDurationMs = modelRuns.reduce((s, r) => s + r.durationMs, 0) / modelRuns.length
    }

    // By task type
    const byTaskType: Record<string, { count: number; successRate: number }> = {}
    for (const r of filtered) {
      if (!byTaskType[r.taskType]) byTaskType[r.taskType] = { count: 0, successRate: 0 }
      byTaskType[r.taskType].count++
    }
    for (const t of Object.keys(byTaskType)) {
      const taskRuns = filtered.filter(r => r.taskType === t)
      byTaskType[t].successRate = taskRuns.filter(r => r.success).length / taskRuns.length
    }

    // Tok/s calculation
    const totalOutputTokens = filtered.reduce((s, r) => s + r.outputTokens, 0)
    const totalDurationSec = filtered.reduce((s, r) => s + r.durationMs, 0) / 1000
    const tokPerSec = totalDurationSec > 0 ? totalOutputTokens / totalDurationSec : 0

    return NextResponse.json({
      total: filtered.length,
      successRate: Math.round(successRate * 100) / 100,
      avgDurationMs: Math.round(avgDurationMs),
      avgTokens: Math.round(avgTokens),
      avgToolCalls: Math.round(avgToolCalls * 100) / 100,
      toolSuccessRate: Math.round(toolSuccessRate * 100) / 100,
      tokPerSec: Math.round(tokPerSec * 100) / 100,
      byModel,
      byTaskType,
      recentRuns: filtered.slice(0, 10),
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
