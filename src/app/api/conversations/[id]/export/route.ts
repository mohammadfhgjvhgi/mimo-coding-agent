import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface Params { params: Promise<{ id: string }> }

// Export conversation as JSON
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const conv = await db.conversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    })
    if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      conversation: {
        title: conv.title,
        model: conv.model,
        systemPrompt: conv.systemPrompt,
        folder: conv.folder,
        tags: JSON.parse(conv.tags || "[]"),
        messages: conv.messages.map(m => ({
          role: m.role,
          content: m.content,
          model: m.model,
          tokens: m.tokens,
          thinking: m.thinking,
          toolCalls: m.toolCalls ? JSON.parse(m.toolCalls) : null,
          createdAt: m.createdAt.toISOString(),
        })),
      },
    }

    return NextResponse.json(exportData)
  } catch (e) {
    return NextResponse.json({ error: "Export failed" }, { status: 500 })
  }
}
