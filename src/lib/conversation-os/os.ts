// Conversation OS — turn conversations into a workspace.
// 15 operations, deterministic, bilingual (Arabic + English).
// Builds on existing Conversation model (folder, tags, pinned already exist).
//
// 15 operations:
//   1.  chatSearch            — full-text search across all conversations + messages
//   2.  chatFolders           — list/create/rename/delete folders
//   3.  chatTags               — add/remove/list tags
//   4.  chatPins               — pin/unpin conversations
//   5.  chatBranch             — branch a conversation at a specific message
//   6.  chatFork               — fork a conversation (copy to new)
//   7.  chatArchive            — archive/unarchive conversations
//   8.  chatExport              — export conversation (markdown/json)
//   9.  chatImport             — import conversation (from markdown/json)
//   10. chatSummary             — generate a summary (deterministic: first user msg + last assistant msg + msg count)
//   11. chatMemory              — extract + save key facts from conversation to memory
//   12. conversationToTask     — convert conversation to a task (DAG)
//   13. conversationToProject  — convert conversation to a project
//   14. conversationToArtifact — convert conversation to an artifact
//   15. conversationToKnowledge — convert conversation to a knowledge chunk

import { db } from "@/lib/db"
import { createHash } from "node:crypto"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchResult {
  conversationId: string
  title: string
  snippet: string
  matchedIn: "title" | "message"
  messageId?: string
  score: number
}

export interface FolderInfo {
  name: string
  conversationCount: number
  lastUpdated: string
}

export interface ChatSummary {
  conversationId: string
  title: string
  messageCount: number
  userMessages: number
  assistantMessages: number
  toolCalls: number
  firstMessage: string
  lastMessage: string
  summary: string
  topics: string[]
}

export interface ChatBranchResult {
  newConversationId: string
  branchedAt: string
  messageCount: number
}

export interface ChatForkResult {
  newConversationId: string
  sourceConversationId: string
  messageCount: number
}

export type ConversationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try { return JSON.parse(s) as T } catch { return fallback }
}

// ---------------------------------------------------------------------------
// 1. Chat Search — full-text across conversations + messages
// ---------------------------------------------------------------------------

export async function chatSearch(query: string, opts: { limit?: number; folder?: string } = {}): Promise<ConversationResult<SearchResult[]>> {
  try {
    if (!query || !query.trim()) return { ok: true, data: [] }
    const q = query.toLowerCase()
    const results: SearchResult[] = []

    // Search in conversation titles
    const convs = await db.conversation.findMany({
      where: opts.folder ? { folder: opts.folder } : undefined,
      include: { messages: { select: { id: true, content: true, role: true, createdAt: true } } },
      take: 200,
    })

    for (const conv of convs) {
      // Title match
      if (conv.title.toLowerCase().includes(q)) {
        results.push({
          conversationId: conv.id,
          title: conv.title,
          snippet: conv.title,
          matchedIn: "title",
          score: 100,
        })
      }
      // Message match
      for (const msg of conv.messages) {
        if (msg.content && msg.content.toLowerCase().includes(q)) {
          const idx = msg.content.toLowerCase().indexOf(q)
          const start = Math.max(0, idx - 50)
          const end = Math.min(msg.content.length, idx + q.length + 100)
          results.push({
            conversationId: conv.id,
            title: conv.title,
            snippet: (start > 0 ? "…" : "") + msg.content.slice(start, end) + (end < msg.content.length ? "…" : ""),
            matchedIn: "message",
            messageId: msg.id,
            score: 50,
          })
        }
      }
    }

    // Sort by score desc, dedupe by conversationId
    const seen = new Set<string>()
    results.sort((a, b) => b.score - a.score)
    const deduped = results.filter(r => {
      if (seen.has(r.conversationId) && r.matchedIn === "message") return false
      seen.add(r.conversationId)
      return true
    })

    return { ok: true, data: deduped.slice(0, opts.limit ?? 20) }
  } catch (e) {
    return { ok: false, error: "search_failed", message: `❌ فشل البحث: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 2. Chat Folders — list/create/rename/delete
// ---------------------------------------------------------------------------

export async function chatFolders(): Promise<ConversationResult<FolderInfo[]>> {
  try {
    const convs = await db.conversation.findMany({ select: { folder: true, updatedAt: true } })
    const folderMap = new Map<string, FolderInfo>()
    for (const c of convs) {
      if (!c.folder) continue
      const existing = folderMap.get(c.folder) ?? { name: c.folder, conversationCount: 0, lastUpdated: c.updatedAt.toISOString() }
      existing.conversationCount++
      if (c.updatedAt > new Date(existing.lastUpdated)) existing.lastUpdated = c.updatedAt.toISOString()
      folderMap.set(c.folder, existing)
    }
    return { ok: true, data: Array.from(folderMap.values()).sort((a, b) => b.conversationCount - a.conversationCount) }
  } catch (e) {
    return { ok: false, error: "folders_failed", message: `❌ فشل المجلدات: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function chatMoveToFolder(conversationId: string, folder: string | null): Promise<ConversationResult<{ conversationId: string; folder: string | null }>> {
  try {
    await db.conversation.update({ where: { id: conversationId }, data: { folder } })
    return { ok: true, data: { conversationId, folder } }
  } catch (e) {
    return { ok: false, error: "move_failed", message: `❌ فشل النقل: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 3. Chat Tags — add/remove/list
// ---------------------------------------------------------------------------

export async function chatTags(conversationId: string): Promise<ConversationResult<string[]>> {
  try {
    const conv = await db.conversation.findUnique({ where: { id: conversationId }, select: { tags: true } })
    if (!conv) return { ok: false, error: "not_found", message: `❌ المحادثة غير موجودة` }
    return { ok: true, data: safeParse<string[]>(conv.tags, []) }
  } catch (e) {
    return { ok: false, error: "tags_failed", message: `❌ فشل العلامات: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function chatTagAdd(conversationId: string, tag: string): Promise<ConversationResult<string[]>> {
  try {
    const conv = await db.conversation.findUnique({ where: { id: conversationId }, select: { tags: true } })
    if (!conv) return { ok: false, error: "not_found", message: `❌ المحادثة غير موجودة` }
    const tags = safeParse<string[]>(conv.tags, [])
    if (!tags.includes(tag)) tags.push(tag)
    await db.conversation.update({ where: { id: conversationId }, data: { tags: JSON.stringify(tags) } })
    return { ok: true, data: tags }
  } catch (e) {
    return { ok: false, error: "tag_failed", message: `❌ فشل الإضافة: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function chatTagRemove(conversationId: string, tag: string): Promise<ConversationResult<string[]>> {
  try {
    const conv = await db.conversation.findUnique({ where: { id: conversationId }, select: { tags: true } })
    if (!conv) return { ok: false, error: "not_found", message: `❌ المحادثة غير موجودة` }
    const tags = safeParse<string[]>(conv.tags, []).filter(t => t !== tag)
    await db.conversation.update({ where: { id: conversationId }, data: { tags: JSON.stringify(tags) } })
    return { ok: true, data: tags }
  } catch (e) {
    return { ok: false, error: "tag_failed", message: `❌ فشل الحذف: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 4. Chat Pins — pin/unpin (already exists in model, add helpers)
// ---------------------------------------------------------------------------

export async function chatPin(conversationId: string, pinned: boolean): Promise<ConversationResult<{ conversationId: string; pinned: boolean }>> {
  try {
    await db.conversation.update({ where: { id: conversationId }, data: { pinned } })
    return { ok: true, data: { conversationId, pinned } }
  } catch (e) {
    return { ok: false, error: "pin_failed", message: `❌ فشل التثبيت: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 5. Chat Branch — branch at a specific message
// ---------------------------------------------------------------------------

export async function chatBranch(conversationId: string, branchAtMessageId: string, newTitle?: string): Promise<ConversationResult<ChatBranchResult>> {
  try {
    const conv = await db.conversation.findUnique({
      where: { id: conversationId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    })
    if (!conv) return { ok: false, error: "not_found", message: `❌ المحادثة غير موجودة` }

    const branchIdx = conv.messages.findIndex(m => m.id === branchAtMessageId)
    if (branchIdx === -1) return { ok: false, error: "message_not_found", message: `❌ الرسالة غير موجودة` }

    const branchedMessages = conv.messages.slice(0, branchIdx + 1)

    // Create new conversation
    const newConv = await db.conversation.create({
      data: {
        title: newTitle ?? `${conv.title} (فرع) / (branch)`,
        model: conv.model,
        systemPrompt: conv.systemPrompt,
        modelSettings: conv.modelSettings,
      },
    })

    // Copy messages
    for (const msg of branchedMessages) {
      await db.message.create({
        data: {
          conversationId: newConv.id,
          role: msg.role,
          content: msg.content,
          model: msg.model,
          toolCalls: msg.toolCalls,
          tokens: msg.tokens,
          thinking: msg.thinking,
        },
      })
    }

    return {
      ok: true,
      data: {
        newConversationId: newConv.id,
        branchedAt: branchAtMessageId,
        messageCount: branchedMessages.length,
      },
    }
  } catch (e) {
    return { ok: false, error: "branch_failed", message: `❌ فشل التفريع: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 6. Chat Fork — full copy of conversation
// ---------------------------------------------------------------------------

export async function chatFork(conversationId: string, newTitle?: string): Promise<ConversationResult<ChatForkResult>> {
  try {
    const conv = await db.conversation.findUnique({
      where: { id: conversationId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    })
    if (!conv) return { ok: false, error: "not_found", message: `❌ المحادثة غير موجودة` }

    const newConv = await db.conversation.create({
      data: {
        title: newTitle ?? `${conv.title} (نسخة) / (fork)`,
        model: conv.model,
        systemPrompt: conv.systemPrompt,
        modelSettings: conv.modelSettings,
        folder: conv.folder,
        tags: conv.tags,
      },
    })

    for (const msg of conv.messages) {
      await db.message.create({
        data: {
          conversationId: newConv.id,
          role: msg.role,
          content: msg.content,
          model: msg.model,
          toolCalls: msg.toolCalls,
          tokens: msg.tokens,
          thinking: msg.thinking,
        },
      })
    }

    return {
      ok: true,
      data: {
        newConversationId: newConv.id,
        sourceConversationId: conversationId,
        messageCount: conv.messages.length,
      },
    }
  } catch (e) {
    return { ok: false, error: "fork_failed", message: `❌ فشل النسخ: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 7. Chat Archive — archive/unarchive (uses tags: "archived")
// ---------------------------------------------------------------------------

export async function chatArchive(conversationId: string, archive: boolean): Promise<ConversationResult<{ conversationId: string; archived: boolean }>> {
  try {
    const conv = await db.conversation.findUnique({ where: { id: conversationId }, select: { tags: true } })
    if (!conv) return { ok: false, error: "not_found", message: `❌ المحادثة غير موجودة` }
    let tags = safeParse<string[]>(conv.tags, [])
    if (archive) {
      if (!tags.includes("archived")) tags.push("archived")
    } else {
      tags = tags.filter(t => t !== "archived")
    }
    await db.conversation.update({ where: { id: conversationId }, data: { tags: JSON.stringify(tags) } })
    return { ok: true, data: { conversationId, archived: archive } }
  } catch (e) {
    return { ok: false, error: "archive_failed", message: `❌ فشل الأرشفة: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 8. Chat Export — markdown or JSON
// ---------------------------------------------------------------------------

export async function chatExport(conversationId: string, format: "markdown" | "json" = "markdown"): Promise<ConversationResult<{ content: string; format: string; sizeBytes: number }>> {
  try {
    const conv = await db.conversation.findUnique({
      where: { id: conversationId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    })
    if (!conv) return { ok: false, error: "not_found", message: `❌ المحادثة غير موجودة` }

    if (format === "json") {
      const content = JSON.stringify({
        id: conv.id,
        title: conv.title,
        model: conv.model,
        createdAt: conv.createdAt,
        messages: conv.messages.map(m => ({
          role: m.role,
          content: m.content,
          model: m.model,
          createdAt: m.createdAt,
          toolCalls: m.toolCalls ? JSON.parse(m.toolCalls) : null,
        })),
      }, null, 2)
      return { ok: true, data: { content, format, sizeBytes: Buffer.byteLength(content, "utf8") } }
    }

    // Markdown
    let md = `# ${conv.title}\n\n`
    md += `> **Model:** ${conv.model} | **Created:** ${conv.createdAt.toISOString()}\n\n`
    md += `---\n\n`
    for (const msg of conv.messages) {
      const role = msg.role === "user" ? "👤 **User**" : msg.role === "assistant" ? "🤖 **Assistant**" : `**${msg.role}**`
      md += `### ${role}\n\n${msg.content ?? "(empty)"}\n\n`
      if (msg.toolCalls) {
        try {
          const calls = JSON.parse(msg.toolCalls)
          md += `*Tools: ${calls.map((c: { name?: string }) => c.name).join(", ")}*\n\n`
        } catch { /* skip */ }
      }
    }
    return { ok: true, data: { content: md, format, sizeBytes: Buffer.byteLength(md, "utf8") } }
  } catch (e) {
    return { ok: false, error: "export_failed", message: `❌ فشل التصدير: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 9. Chat Import — from markdown or JSON
// ---------------------------------------------------------------------------

export async function chatImport(content: string, format: "markdown" | "json" = "markdown", title?: string): Promise<ConversationResult<{ conversationId: string; messageCount: number }>> {
  try {
    if (format === "json") {
      const data = JSON.parse(content) as { title?: string; messages?: Array<{ role: string; content: string }> }
      const conv = await db.conversation.create({
        data: { title: title ?? data.title ?? "مستوردة / imported" },
      })
      for (const msg of data.messages ?? []) {
        await db.message.create({
          data: { conversationId: conv.id, role: msg.role, content: msg.content },
        })
      }
      return { ok: true, data: { conversationId: conv.id, messageCount: data.messages?.length ?? 0 } }
    }

    // Markdown: parse ### 👤 **User** / ### 🤖 **Assistant** sections
    const conv = await db.conversation.create({ data: { title: title ?? "مستوردة / imported" } })
    const sections = content.split(/^### /m).filter(s => s.trim())
    let count = 0
    for (const section of sections) {
      const roleMatch = section.match(/\*\*(User|Assistant|System)\*\*/)
      if (!roleMatch) continue
      const role = roleMatch[1].toLowerCase()
      const msgContent = section.replace(/^.*?\*\*.*?\*\*\s*/, "").trim()
      if (msgContent) {
        await db.message.create({ data: { conversationId: conv.id, role, content: msgContent } })
        count++
      }
    }
    return { ok: true, data: { conversationId: conv.id, messageCount: count } }
  } catch (e) {
    return { ok: false, error: "import_failed", message: `❌ فشل الاستيراد: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 10. Chat Summary — deterministic (no LLM)
// ---------------------------------------------------------------------------

export async function chatSummary(conversationId: string): Promise<ConversationResult<ChatSummary>> {
  try {
    const conv = await db.conversation.findUnique({
      where: { id: conversationId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    })
    if (!conv) return { ok: false, error: "not_found", message: `❌ المحادثة غير موجودة` }

    const messages = conv.messages
    const userMsgs = messages.filter(m => m.role === "user")
    const assistantMsgs = messages.filter(m => m.role === "assistant")
    let toolCallCount = 0
    for (const m of messages) {
      if (m.toolCalls) {
        try { toolCallCount += JSON.parse(m.toolCalls).length } catch { /* skip */ }
      }
    }

    // Topics: extract from user message first lines
    const topics: string[] = []
    for (const m of userMsgs.slice(0, 5)) {
      const firstLine = (m.content ?? "").split("\n")[0].slice(0, 80)
      if (firstLine) topics.push(firstLine)
    }

    const summary = `${messages.length} رسالة / messages | ${userMsgs.length} user, ${assistantMsgs.length} assistant, ${toolCallCount} tool calls | Topics: ${topics.slice(0, 3).join("; ")}`

    return {
      ok: true,
      data: {
        conversationId,
        title: conv.title,
        messageCount: messages.length,
        userMessages: userMsgs.length,
        assistantMessages: assistantMsgs.length,
        toolCalls: toolCallCount,
        firstMessage: (messages[0]?.content ?? "").slice(0, 200),
        lastMessage: (messages[messages.length - 1]?.content ?? "").slice(0, 200),
        summary,
        topics,
      },
    }
  } catch (e) {
    return { ok: false, error: "summary_failed", message: `❌ فشل التلخيص: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 11. Chat Memory — extract + save key facts to Memory OS
// ---------------------------------------------------------------------------

export async function chatMemory(conversationId: string): Promise<ConversationResult<{ savedCount: number; memories: Array<{ key: string; value: string }> }>> {
  try {
    const conv = await db.conversation.findUnique({
      where: { id: conversationId },
      include: { messages: { where: { role: "assistant" }, orderBy: { createdAt: "asc" } } },
    })
    if (!conv) return { ok: false, error: "not_found", message: `❌ المحادثة غير موجودة` }

    const memories: Array<{ key: string; value: string }> = []
    // Extract: bold terms (**term**: definition) + code blocks info
    for (const msg of conv.messages) {
      if (!msg.content) continue
      // Bold terms
      const boldRe = /\*\*([^*]+)\*\*:?\s+([^\n*]{10,200})/g
      let m: RegExpExecArray | null
      while ((m = boldRe.exec(msg.content)) !== null) {
        const key = `conv_${conv.id.slice(-6)}_${m[1].trim().slice(0, 30)}`
        const value = m[2].trim().slice(0, 500)
        const existing = await db.memory.findUnique({ where: { key } })
        if (!existing) {
          await db.memory.create({
            data: {
              key,
              value,
              category: "conversation",
              source: `conv:${conv.id}`,
            },
          })
          memories.push({ key, value })
        }
      }
    }

    return { ok: true, data: { savedCount: memories.length, memories } }
  } catch (e) {
    return { ok: false, error: "memory_failed", message: `❌ فشل الذاكرة: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 12. Conversation to Task
// ---------------------------------------------------------------------------

export async function conversationToTask(conversationId: string): Promise<ConversationResult<{ taskId: string; title: string }>> {
  try {
    const conv = await db.conversation.findUnique({ where: { id: conversationId } })
    if (!conv) return { ok: false, error: "not_found", message: `❌ المحادثة غير موجودة` }
    const task = await db.task.create({
      data: {
        goal: conv.title,
        status: "pending",
        steps: JSON.stringify([{ id: "step1", description: `From conversation: ${conv.id}`, done: false }]),
      },
    })
    return { ok: true, data: { taskId: task.id, title: task.goal } }
  } catch (e) {
    return { ok: false, error: "convert_failed", message: `❌ فشل التحويل: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 13. Conversation to Project
// ---------------------------------------------------------------------------

export async function conversationToProject(conversationId: string): Promise<ConversationResult<{ projectId: string; name: string }>> {
  try {
    const conv = await db.conversation.findUnique({ where: { id: conversationId } })
    if (!conv) return { ok: false, error: "not_found", message: `❌ المحادثة غير موجودة` }
    const project = await db.project.create({
      data: { name: conv.title, status: "active", description: `From conversation: ${conv.id}` },
    })
    return { ok: true, data: { projectId: project.id, name: project.name } }
  } catch (e) {
    return { ok: false, error: "convert_failed", message: `❌ فشل التحويل: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 14. Conversation to Artifact
// ---------------------------------------------------------------------------

export async function conversationToArtifact(conversationId: string): Promise<ConversationResult<{ artifactId: string; title: string }>> {
  try {
    const conv = await db.conversation.findUnique({
      where: { id: conversationId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    })
    if (!conv) return { ok: false, error: "not_found", message: `❌ المحادثة غير موجودة` }
    // Use the conversation content as a markdown artifact
    const content = conv.messages.map(m => `## ${m.role}\n\n${m.content ?? ""}`).join("\n\n")
    const cs = createHash("sha256").update(content).digest("hex")
    const artifact = await db.artifact.create({
      data: {
        title: conv.title,
        type: "markdown",
        content,
        checksum: cs,
        version: 1,
        conversationId: conv.id,
        visibility: "private",
      },
    })
    return { ok: true, data: { artifactId: artifact.id, title: artifact.title } }
  } catch (e) {
    return { ok: false, error: "convert_failed", message: `❌ فشل التحويل: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 15. Conversation to Knowledge
// ---------------------------------------------------------------------------

export async function conversationToKnowledge(conversationId: string): Promise<ConversationResult<{ chunkId: string; tokens: number }>> {
  try {
    const conv = await db.conversation.findUnique({
      where: { id: conversationId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    })
    if (!conv) return { ok: false, error: "not_found", message: `❌ المحادثة غير موجودة` }
    const content = conv.messages.map(m => `${m.role}: ${m.content ?? ""}`).join("\n\n")
    const tokens = Math.ceil(content.length / 4)
    const chunk = await db.knowledgeChunk.create({
      data: {
        source: `conversation:${conv.id}`,
        sourceType: "note",
        content: content.slice(0, 10000),
        embedding: "[]", // No embedding (deterministic — no LLM)
        chunkIndex: 0,
        tokens,
      },
    })
    return { ok: true, data: { chunkId: chunk.id, tokens } }
  } catch (e) {
    return { ok: false, error: "convert_failed", message: `❌ فشل التحويل: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface ConversationSnapshot {
  totalConversations: number
  pinnedCount: number
  archivedCount: number
  folderCount: number
  totalTags: number
  totalMessages: number
}

export async function conversationSnapshot(): Promise<ConversationResult<ConversationSnapshot>> {
  try {
    const convs = await db.conversation.findMany({ select: { id: true, pinned: true, tags: true, folder: true } })
    const msgCount = await db.message.count()
    const folders = new Set(convs.filter(c => c.folder).map(c => c.folder))
    const allTags = new Set<string>()
    for (const c of convs) {
      const tags = safeParse<string[]>(c.tags, [])
      tags.forEach(t => allTags.add(t))
    }
    return {
      ok: true,
      data: {
        totalConversations: convs.length,
        pinnedCount: convs.filter(c => c.pinned).length,
        archivedCount: convs.filter(c => safeParse<string[]>(c.tags, []).includes("archived")).length,
        folderCount: folders.size,
        totalTags: allTags.size,
        totalMessages: msgCount,
      },
    }
  } catch (e) {
    return { ok: false, error: "snapshot_failed", message: `❌ فشل اللقطة: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

export function formatConversationResult<T>(result: ConversationResult<T>): string {
  if (!result.ok) return `${result.message}\n[error: ${result.error}]`
  const data = result.data as unknown
  if (data === null || data === undefined) return "✅ OK"
  if (typeof data === "string") return data
  if (typeof data === "number" || typeof data === "boolean") return String(data)
  try { return JSON.stringify(data, null, 2) } catch { return String(data) }
}
