import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface Params { params: Promise<{ id: string }> }

// POST /api/conversations/[id]/rewind — delete all messages after a given message
// This "rewinds" the conversation to a previous point.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const toMessageId = String(body.toMessageId || "")

    if (!toMessageId) {
      return NextResponse.json({ error: "toMessageId required" }, { status: 400 })
    }

    // Find the target message
    const target = await db.message.findUnique({ where: { id: toMessageId } })
    if (!target || target.conversationId !== id) {
      return NextResponse.json({ error: "Message not found in this conversation" }, { status: 404 })
    }

    // Delete all messages AFTER the target message
    const deleted = await db.message.deleteMany({
      where: {
        conversationId: id,
        createdAt: { gt: target.createdAt },
      },
    })

    return NextResponse.json({
      success: true,
      rewoundTo: toMessageId,
      deletedCount: deleted.count,
      message: `تم الرجوع إلى نقطة سابقة — حُذفت ${deleted.count} رسالة`,
    })
  } catch (e) {
    return NextResponse.json({ error: "Rewind failed" }, { status: 500 })
  }
}
