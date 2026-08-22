// /api/automation — POST (all actions) + GET (list workflows/runs/schedules/webhooks)
import { NextRequest, NextResponse } from "next/server"
import {
  workflowCreate, workflowList, workflowGet, workflowRun, workflowRunList, workflowRunGet,
  triggerAdd, triggerList, scheduleCreate, scheduleList, scheduleCheckDue,
  webhookCreate, webhookList, automationSnapshot,
} from "@/lib/automation/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      case "workflow_create": return wrap(await workflowCreate(body))
      case "workflow_get": return wrap(await workflowGet(body.id))
      case "workflow_run": return wrap(await workflowRun({ workflowId: body.workflowId, trigger: body.trigger }))
      case "trigger_add": return wrap(await triggerAdd(body.workflowId, body.trigger))
      case "schedule_create": return wrap(await scheduleCreate(body))
      case "schedule_check_due": return wrap(await scheduleCheckDue())
      case "webhook_create": return wrap(await webhookCreate(body))
      default: return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const mode = sp.get("mode") ?? "workflows"
    switch (mode) {
      case "workflows": return wrap(await workflowList({ status: sp.get("status") as never, limit: sp.get("limit") ? Number(sp.get("limit")) : undefined }))
      case "runs": return wrap(await workflowRunList({ workflowId: sp.get("workflowId") ?? undefined, status: sp.get("status") as never, limit: sp.get("limit") ? Number(sp.get("limit")) : undefined }))
      case "schedules": return wrap(await scheduleList({ status: sp.get("status") ?? undefined, limit: sp.get("limit") ? Number(sp.get("limit")) : undefined }))
      case "webhooks": return wrap(await webhookList({ workflowId: sp.get("workflowId") ?? undefined, limit: sp.get("limit") ? Number(sp.get("limit")) : undefined }))
      case "snapshot": return wrap(await automationSnapshot())
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
