import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Import conversation from JSON
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const data = body.conversation || body
    if (!data || !data.messages) {
      return NextResponse.json({ error: "Invalid format" }, { status: 400 })
    }

    const conv = await db.conversation.create({
      data: {
        title: data.title || "محادثة مستوردة",
        model: data.model || "default",
        systemPrompt: data.systemPrompt || null,
        folder: data.folder || null,
        tags: JSON.stringify(data.tags || []),
      },
    })

    for (const msg of data.messages) {
      await db.message.create({
        data: {
          conversationId: conv.id,
          role: msg.role,
          content: msg.content,
          model: msg.model || null,
          tokens: msg.tokens || 0,
          thinking: msg.thinking || null,
          toolCalls: msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
        },
      })
    }

    return NextResponse.json({ conversation: conv, imported: data.messages.length })
  } catch (e) {
    return NextResponse.json({ error: "Import failed" }, { status: 500 })
  }
}
