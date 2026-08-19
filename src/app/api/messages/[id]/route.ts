import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface Params { params: Promise<{ id: string }> }

// Edit a message — updates content and marks as edited
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const content = String(body.content || "").trim()
    if (!content) return NextResponse.json({ error: "Content required" }, { status: 400 })

    const updated = await db.message.update({
      where: { id },
      data: { content, isEdited: true },
    })
    return NextResponse.json({ message: updated })
  } catch (e) {
    return NextResponse.json({ error: "Edit failed" }, { status: 500 })
  }
}

// Delete a message and all messages after it (for regenerate)
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const msg = await db.message.findUnique({ where: { id } })
    if (!msg) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Delete this message and all messages after it in the conversation
    await db.message.deleteMany({
      where: {
        conversationId: msg.conversationId,
        createdAt: { gte: msg.createdAt },
      },
    })
    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json({ error: "Delete failed" }, { status: 500 })
  }
}
