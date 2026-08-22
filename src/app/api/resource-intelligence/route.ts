// /api/resource-intelligence — POST + GET
import { NextRequest, NextResponse } from "next/server"
import {
  adaptiveThreads, adaptiveContext, ramPressureDetection, vramPressureDetection,
  processManager, idleProcessKiller, backgroundWorkThrottling,
  indexingScheduler, memoryPressureModes, resourceIntelligenceSnapshot,
} from "@/lib/resource-intelligence/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      case "adaptive_threads": return wrap(adaptiveThreads())
      case "adaptive_context": return wrap(adaptiveContext(body.defaultContextLimit))
      case "ram_pressure": return wrap(ramPressureDetection())
      case "vram_pressure": return wrap(await vramPressureDetection())
      case "process_manager": return wrap(processManager())
      case "idle_killer": return wrap(idleProcessKiller(body.idleThresholdMs))
      case "bg_throttle": return wrap(backgroundWorkThrottling())
      case "indexing_schedule": return wrap(indexingScheduler("schedule", { type: body.type, delayMs: body.delayMs }))
      case "indexing_list": return wrap(indexingScheduler("list"))
      case "indexing_run_due": return wrap(indexingScheduler("runDue"))
      case "indexing_cancel": return wrap(indexingScheduler("cancel", { id: body.id }))
      case "pressure_modes": return wrap(memoryPressureModes())
      default: return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 })
    }
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const mode = sp.get("mode") ?? "snapshot"
    switch (mode) {
      case "snapshot": return wrap(await resourceIntelligenceSnapshot())
      case "ram_pressure": return wrap(ramPressureDetection())
      case "process_manager": return wrap(processManager())
      default: return NextResponse.json({ error: `unknown mode: ${mode}` }, { status: 400 })
    }
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}

function wrap<T>(result: { ok: boolean; data?: T; error?: string; message?: string }) {
  if (result.ok) return NextResponse.json(result.data)
  return NextResponse.json({ error: result.error, message: result.message }, { status: 400 })
}
