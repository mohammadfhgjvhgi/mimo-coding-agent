import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface Params { params: Promise<{ id: string }> }

// Branch from a specific message — creates a new conversation with messages up to that point
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const fromMessageId = String(body.fromMessageId || "")

    const original = await db.conversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    })
    if (!original) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Find the branch point
    let messagesToCopy = original.messages
    if (fromMessageId) {
      const idx = original.messages.findIndex(m => m.id === fromMessageId)
      if (idx >= 0) messagesToCopy = original.messages.slice(0, idx + 1)
    }

    // Create branched conversation
    const branched = await db.conversation.create({
      data: {
        title: `${original.title} (فرع)`,
        model: original.model,
        folder: original.folder,
        systemPrompt: original.systemPrompt,
      },
    })

    // Copy messages
    for (const msg of messagesToCopy) {
      await db.message.create({
        data: {
          conversationId: branched.id,
          role: msg.role,
          content: msg.content,
          model: msg.model,
          toolCalls: msg.toolCalls,
          tokens: msg.tokens,
          thinking: msg.thinking,
        },
      })
    }

    return NextResponse.json({ conversation: branched, copiedMessages: messagesToCopy.length })
  } catch (e) {
    return NextResponse.json({ error: "Branch failed" }, { status: 500 })
  }
}
