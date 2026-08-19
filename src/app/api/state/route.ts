import { NextResponse } from "next/server"
import { db } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const [conversations, tasks, memories, scheduledTasks, symbols] = await Promise.all([
      db.conversation.count(),
      db.task.count(),
      db.memory.count(),
      db.scheduledTask.count(),
      db.symbol.count(),
    ])

    return NextResponse.json({
      counts: { conversations, tasks, memories, scheduledTasks, symbols },
      server: { status: "ok", time: new Date().toISOString() },
    })
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
