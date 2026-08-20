import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { summarizeConversation, getConversationStats } from "@/lib/context/summarizer"
import { getSettings } from "@/lib/llm-provider"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface Params { params: Promise<{ id: string }> }

// GET /api/conversations/[id]/summarize — get stats (needs summarization?)
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const stats = await getConversationStats(id)
    return NextResponse.json(stats)
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

// POST /api/conversations/[id]/summarize — trigger summarization
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const settings = getSettings()
    const result = await summarizeConversation(id, settings)

    if (!result) {
      return NextResponse.json({ message: "المحادثة قصيرة — لا حاجة للتلخيص", summarized: false })
    }

    return NextResponse.json({
      summarized: true,
      ...result,
      message: `تم ضغط ${result.summarizedCount} رسالة — وفّر ${result.tokensSaved} توكن`,
    })
  } catch (e) {
    return NextResponse.json({ error: "Summarize failed" }, { status: 500 })
  }
}
