// /api/self-improvement — POST (all actions) + GET (hypotheses/metrics/snapshot)
import { NextRequest, NextResponse } from "next/server"
import {
  agentMetrics, bottleneckDetection, failurePatternMining,
  toolFailureAnalytics, contextWasteAnalysis, modelRoutingAnalytics,
  improvementHypothesis, autoGenerateHypotheses,
  abAgentComparison, improvementBenchmark, promotionRejection,
  siSnapshot, listHypotheses, listMetrics,
} from "@/lib/self-improvement/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      // 1. Agent Metrics (371)
      case "agent_metrics": return wrap(await agentMetrics())

      // 2. Bottleneck Detection (372)
      case "bottleneck": return wrap(await bottleneckDetection())

      // 3. Failure Pattern Mining (373)
      case "failure_patterns": return wrap(await failurePatternMining())

      // 4. Tool Failure Analytics (374)
      case "tool_analytics": return wrap(await toolFailureAnalytics())

      // 5. Context Waste Analysis (375)
      case "context_waste": return wrap(await contextWasteAnalysis())

      // 6. Model Routing Analytics (376)
      case "model_routing": return wrap(await modelRoutingAnalytics())

      // 7. Improvement Hypothesis (377)
      case "hypothesis_create": return wrap(await improvementHypothesis({
        description: body.description,
        expectedImprovement: body.expectedImprovement,
      }))
      case "hypothesis_auto": return wrap(await autoGenerateHypotheses())

      // 8. A/B Agent Comparison (378)
      case "ab_compare": return wrap(await abAgentComparison({
        hypothesisId: body.hypothesisId,
        approachA: body.approachA,
        approachB: body.approachB,
        resultsA: body.resultsA,
        resultsB: body.resultsB,
      }))

      // 9. Improvement Benchmark (379)
      case "benchmark": return wrap(await improvementBenchmark(body.hypothesisId))

      // 10. Promotion / Rejection (380)
      case "promote_reject": return wrap(await promotionRejection({
        hypothesisId: body.hypothesisId,
        decision: body.decision,
        note: body.note,
      }))

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
      case "hypotheses": return wrap(await listHypotheses(parseInt(sp.get("limit") ?? "50")))
      case "metrics":    return wrap(await listMetrics(parseInt(sp.get("limit") ?? "20")))
      case "snapshot":   return wrap(await siSnapshot())
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
