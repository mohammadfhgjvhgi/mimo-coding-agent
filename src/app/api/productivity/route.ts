// /api/productivity — POST (all actions) + GET (list with modes)
import { NextRequest, NextResponse } from "next/server"
import {
  dailyDashboard,
  taskCreate, taskUpdate, taskList, taskDelete,
  projectCreate, projectList, projectGet,
  goalCreate, goalList, goalUpdateProgress,
  habitCreate, habitLog, habitList,
  calendarIntegration,
  reminderCreate, remindersCheckDue, reminderSnooze, reminderDismiss,
  noteCreate, noteUpdate, noteList,
  dailyReview, weeklyReview, reviewGet,
  planningAssistant,
} from "@/lib/productivity/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      case "dashboard": return wrap(await dailyDashboard(body.date ? new Date(body.date) : undefined))
      case "task_create": return wrap(await taskCreate(body))
      case "task_update": return wrap(await taskUpdate(body.id, body.patch ?? body))
      case "task_delete": return wrap(await taskDelete(body.id))
      case "project_create": return wrap(await projectCreate(body))
      case "goal_create": return wrap(await goalCreate(body))
      case "goal_update_progress": return wrap(await goalUpdateProgress(body.id, body.keyResultIndex, body.newCurrent))
      case "habit_create": return wrap(await habitCreate(body))
      case "habit_log": return wrap(await habitLog(body.habitId, { date: body.date ? new Date(body.date) : undefined, status: body.status, note: body.note }))
      case "calendar": return wrap(await calendarIntegration({ startDate: new Date(body.startDate), endDate: new Date(body.endDate) }))
      case "reminder_create": return wrap(await reminderCreate(body))
      case "reminder_check_due": return wrap(await remindersCheckDue(body.before ? { before: new Date(body.before) } : {}))
      case "reminder_snooze": return wrap(await reminderSnooze(body.id, new Date(body.snoozeUntil)))
      case "reminder_dismiss": return wrap(await reminderDismiss(body.id))
      case "note_create": return wrap(await noteCreate(body))
      case "note_update": return wrap(await noteUpdate(body.id, body.patch ?? body))
      case "daily_review": return wrap(await dailyReview({ ...body, date: new Date(body.date) }))
      case "weekly_review": return wrap(await weeklyReview({ ...body, date: new Date(body.date) }))
      case "planning_assistant": return wrap(await planningAssistant({ date: body.date ? new Date(body.date) : undefined }))
      default: return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const mode = sp.get("mode") ?? "tasks"
    switch (mode) {
      case "tasks": return wrap(await taskList({ status: sp.get("status") as never, priority: sp.get("priority") as never, projectId: sp.get("projectId") ?? undefined, limit: sp.get("limit") ? Number(sp.get("limit")) : undefined }))
      case "projects": return wrap(await projectList({ status: sp.get("status") as never, limit: sp.get("limit") ? Number(sp.get("limit")) : undefined }))
      case "goals": return wrap(await goalList({ status: sp.get("status") as never, type: sp.get("type") as never, limit: sp.get("limit") ? Number(sp.get("limit")) : undefined }))
      case "habits": return wrap(await habitList({ active: sp.get("active") === "true" ? true : sp.get("active") === "false" ? false : undefined, limit: sp.get("limit") ? Number(sp.get("limit")) : undefined }))
      case "notes": return wrap(await noteList({ type: sp.get("type") as never, projectId: sp.get("projectId") ?? undefined, pinned: sp.get("pinned") === "true" ? true : sp.get("pinned") === "false" ? false : undefined, limit: sp.get("limit") ? Number(sp.get("limit")) : undefined }))
      case "reviews": return wrap(await reviewGet({ type: sp.get("type") as never, date: sp.get("date") ? new Date(sp.get("date")!) : undefined, limit: sp.get("limit") ? Number(sp.get("limit")) : undefined }))
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
