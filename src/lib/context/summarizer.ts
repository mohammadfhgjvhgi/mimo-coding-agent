// Conversation Summarizer — compresses long conversations into summaries.
// When a conversation exceeds a threshold, older messages are replaced
// with a compact summary, preserving context while saving tokens.

import { db } from "@/lib/db"
import { completeChatRouted, type ProviderSettings } from "@/lib/llm-provider"

const SUMMARIZE_THRESHOLD = 20 // messages before auto-summarization
const KEEP_RECENT = 6 // keep the last N messages, summarize the rest

interface SummaryResult {
  summary: string
  summarizedCount: number
  tokensSaved: number
}

// Summarize older messages in a conversation.
export async function summarizeConversation(
  conversationId: string,
  settings: ProviderSettings
): Promise<SummaryResult | null> {
  try {
    const messages = await db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
    })

    if (messages.length < SUMMARIZE_THRESHOLD) return null

    // Split: older messages to summarize + recent to keep
    const toSummarize = messages.slice(0, messages.length - KEEP_RECENT)
    const toKeep = messages.slice(messages.length - KEEP_RECENT)

    // Build a summary prompt
    const conversationText = toSummarize.map(m =>
      `${m.role === "user" ? "المستخدم" : "المساعد"}: ${m.content.slice(0, 500)}`
    ).join("\n\n")

    const summaryPrompt = [
      { role: "system" as const, content: "أنت مساعد تلخيص. لخّص المحادثة التالية في نقاط رئيسية موجزة بالعربية. احتفظ بالمعلومات المهمة: القرارات، الأكواد، الملفات، الأخطاء." },
      { role: "user" as const, content: `لخّص هذه المحادثة:\n\n${conversationText}` },
    ]

    const result = await completeChatRouted(settings, summaryPrompt)
    const summary = result.text

    // Calculate tokens saved (rough estimate)
    const oldTokens = toSummarize.reduce((sum, m) => sum + Math.ceil(m.content.length / 3.5), 0)
    const newTokens = Math.ceil(summary.length / 3.5)
    const tokensSaved = oldTokens - newTokens

    // Create a summary message (role: system, marked as summary)
    await db.message.create({
      data: {
        conversationId,
        role: "system",
        content: `📋 ملخص المحادثة السابقة (${toSummarize.length} رسالة):\n\n${summary}`,
        model: "summarizer",
        tokens: newTokens,
      },
    })

    // Delete the old messages (they've been summarized)
    await db.message.deleteMany({
      where: {
        id: { in: toSummarize.map(m => m.id) },
      },
    })

    return { summary, summarizedCount: toSummarize.length, tokensSaved }
  } catch (e) {
    console.error("[Summarizer] error:", e)
    return null
  }
}

// Check if a conversation needs summarization.
export async function needsSummarization(conversationId: string): Promise<boolean> {
  try {
    const count = await db.message.count({ where: { conversationId } })
    return count >= SUMMARIZE_THRESHOLD
  } catch {
    return false
  }
}

// Get conversation stats.
export async function getConversationStats(conversationId: string) {
  try {
    const messages = await db.message.findMany({
      where: { conversationId },
      select: { content: true, role: true, tokens: true, createdAt: true },
    })
    const totalTokens = messages.reduce((sum, m) => sum + (m.tokens || Math.ceil(m.content.length / 3.5)), 0)
    const userMessages = messages.filter(m => m.role === "user").length
    const assistantMessages = messages.filter(m => m.role === "assistant").length
    return {
      totalMessages: messages.length,
      userMessages,
      assistantMessages,
      totalTokens,
      needsSummarization: messages.length >= SUMMARIZE_THRESHOLD,
    }
  } catch {
    return { totalMessages: 0, userMessages: 0, assistantMessages: 0, totalTokens: 0, needsSummarization: false }
  }
}
