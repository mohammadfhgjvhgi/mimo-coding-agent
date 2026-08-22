// Conversation-to-Everything OS — 10 operations (spec section 35, features 465-474).
//
// "المحادثة ليست المكان الذي تنتهي فيه الأعمال؛ هي نقطة انطلاق الأعمال."
//
// 10 operations:
//   1. chatToTask (465) — extract action items from conversation → create tasks
//   2. chatToProject (466) — detect project scope → create project with milestones
//   3. chatToResearch (467) — extract research questions → create research workspace
//   4. chatToKnowledge (468) — extract facts → save to knowledge base
//   5. chatToAutomation (469) — extract scheduled actions → create automation
//   6. chatToAgentRun (470) — convert conversation into agent execution plan
//   7. chatToArtifact (471) — generate artifact (HTML/React/Mermaid) from conversation
//   8. chatToCode (472) — extract code blocks → save as files
//   9. chatToChecklist (473) — generate checklist from conversation
//   10. chatToDecision (474) — extract decisions → save to decision journal

import { db } from "@/lib/db"

export interface C2XResult<T> {
  ok: boolean
  data: T
  error?: string
  message?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract conversation messages as text */
async function getConversationText(conversationId: string): Promise<string> {
  const messages = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  })
  return messages.map(m => `${m.role === "user" ? "👤" : "🤖"}: ${m.content ?? ""}`).join("\n\n")
}

/** Extract action items from text (lines starting with verbs) */
function extractActionItems(text: string): string[] {
  const items: string[] = []
  const lines = text.split("\n")
  const actionVerbs = /^(create|fix|update|add|remove|delete|implement|build|test|deploy|write|refactor|install|configure|setup|run|check|review|optimize|migrate|document|design|plan|schedule)/i

  for (const line of lines) {
    const trimmed = line.trim().replace(/^[-*•\d.]+\s*/, "")
    if (actionVerbs.test(trimmed) && trimmed.length > 5 && trimmed.length < 200) {
      items.push(trimmed)
    }
  }

  // Also check for "should", "need to", "must", "TODO"
  const needPatterns = /\b(should|need to|must|have to|todo|action item|next step|follow up)\b/i
  for (const line of lines) {
    const trimmed = line.trim()
    if (needPatterns.test(trimmed) && trimmed.length > 10 && trimmed.length < 200 && !items.includes(trimmed)) {
      items.push(trimmed.replace(/^(should|need to|must|have to)\s*/i, ""))
    }
  }

  return items.slice(0, 20) // cap at 20
}

/** Extract code blocks from text */
function extractCodeBlocks(text: string): Array<{ language: string; code: string; filename?: string }> {
  const blocks: Array<{ language: string; code: string; filename?: string }> = []
  const regex = /```(\w+)?\n([\s\S]*?)```/g
  let match
  while ((match = regex.exec(text)) !== null) {
    const language = match[1] ?? "text"
    const code = match[2].trim()
    // Try to detect filename from first line comment
    const firstLine = code.split("\n")[0]
    const filenameMatch = firstLine.match(/(?:\/\/|#|\/\*|<!--)\s*(?:file|filename|path):\s*(.+)/i)
    blocks.push({ language, code, filename: filenameMatch?.[1]?.trim() })
  }
  return blocks
}

/** Extract facts/decisions from text */
function extractFacts(text: string): Array<{ type: string; content: string }> {
  const facts: Array<{ type: string; content: string }> = []
  const lines = text.split("\n")

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length < 10 || trimmed.length > 300) continue

    // Decision patterns
    if (/\b(decided|decision|we will|let's|chose|selected|going with|approved|rejected)\b/i.test(trimmed)) {
      facts.push({ type: "decision", content: trimmed })
    }
    // Fact patterns
    else if (/\b(is|are|was|were|means|equals|consists of|defined as|represents)\b/i.test(trimmed) && /\b[A-Z]/.test(trimmed)) {
      facts.push({ type: "fact", content: trimmed })
    }
  }

  return facts.slice(0, 20)
}

// ---------------------------------------------------------------------------
// 1. Chat → Task (465)
// ---------------------------------------------------------------------------

export async function chatToTask(conversationId: string): Promise<C2XResult<{
  created: number
  tasks: Array<{ id: string; title: string; priority: string }>
}>> {
  try {
    const text = await getConversationText(conversationId)
    const actionItems = extractActionItems(text)

    if (actionItems.length === 0) {
      return { ok: true, data: { created: 0, tasks: [] } }
    }

    const tasks: Array<{ id: string; title: string; priority: string }> = []
    for (const item of actionItems) {
      const task = await db.pTask.create({
        data: {
          title: item.slice(0, 200),
          status: "todo",
          priority: item.toLowerCase().includes("urgent") || item.toLowerCase().includes("critical") ? "urgent" : "medium",
        },
      })
      tasks.push({ id: task.id, title: task.title, priority: task.priority })
    }

    return { ok: true, data: { created: tasks.length, tasks } }
  } catch (e) {
    return { ok: false, data: null as any, error: "chat_to_task_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 2. Chat → Project (466)
// ---------------------------------------------------------------------------

export async function chatToProject(conversationId: string): Promise<C2XResult<{
  id: string
  name: string
  milestones: string[]
}>> {
  try {
    const conv = await db.conversation.findUnique({ where: { id: conversationId } })
    const text = await getConversationText(conversationId)

    // Extract project name from first user message or conversation title
    const projectName = conv?.title ?? "مشروع جديد / New Project"

    // Extract milestones (phases, steps, stages)
    const milestonePatterns = /\b(phase|stage|step|milestone|version|sprint)\s*\d*[:\-\s]+(.+)/gi
    const milestones: string[] = []
    let match
    while ((match = milestonePatterns.exec(text)) !== null) {
      milestones.push(match[2].trim().slice(0, 100))
    }

    // If no milestones detected, create generic ones
    if (milestones.length === 0) {
      milestones.push("Planning", "Implementation", "Testing", "Deployment")
    }

    const project = await db.project.create({
      data: {
        name: projectName.slice(0, 100),
        description: `Created from conversation: ${conv?.title ?? conversationId}`,
        status: "active",
        milestones: JSON.stringify(milestones.slice(0, 10)),
      },
    })

    return { ok: true, data: { id: project.id, name: project.name, milestones } }
  } catch (e) {
    return { ok: false, data: null as any, error: "chat_to_project_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 3. Chat → Research (467)
// ---------------------------------------------------------------------------

export async function chatToResearch(conversationId: string): Promise<C2XResult<{
  queries: string[]
  sources: string[]
  reason: string
}>> {
  try {
    const text = await getConversationText(conversationId)

    // Extract research questions (lines ending with ?)
    const queries: string[] = []
    const questionPattern = /(?:^|\n)(.+?\?)/g
    let match
    while ((match = questionPattern.exec(text)) !== null) {
      const q = match[1].trim()
      if (q.length > 10 && q.length < 200) queries.push(q)
    }

    // Extract URLs
    const urlPattern = /https?:\/\/[^\s<>"']+/g
    const sources = text.match(urlPattern) ?? []

    return {
      ok: true,
      data: {
        queries: queries.slice(0, 10),
        sources: sources.slice(0, 10),
        reason: `تم استخراج ${queries.length} أسئلة بحث و ${sources.length} مصادر`,
      },
    }
  } catch (e) {
    return { ok: false, data: null as any, error: "chat_to_research_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 4. Chat → Knowledge (468)
// ---------------------------------------------------------------------------

export async function chatToKnowledge(conversationId: string): Promise<C2XResult<{
  saved: number
  items: Array<{ type: string; title: string }>
}>> {
  try {
    const text = await getConversationText(conversationId)
    const facts = extractFacts(text)

    if (facts.length === 0) {
      return { ok: true, data: { saved: 0, items: [] } }
    }

    const items: Array<{ type: string; title: string }> = []
    for (const fact of facts) {
      // Save to SharedKnowledge
      try {
        const knowledge = await (db as any).collabSharedKnowledge?.create({
          data: {
            title: fact.content.slice(0, 80),
            content: fact.content,
            source: `conversation:${conversationId}`,
            tags: JSON.stringify([fact.type]),
            visibility: "public",
            accessList: JSON.stringify([]),
            createdBy: "local",
          },
        })
        if (knowledge) items.push({ type: fact.type, title: knowledge.title })
      } catch {}
    }

    return { ok: true, data: { saved: items.length, items } }
  } catch (e) {
    return { ok: false, data: null as any, error: "chat_to_knowledge_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 5. Chat → Automation (469)
// ---------------------------------------------------------------------------

export async function chatToAutomation(conversationId: string): Promise<C2XResult<{
  created: number
  automations: Array<{ id: string; name: string; trigger: string }>
}>> {
  try {
    const text = await getConversationText(conversationId)

    // Extract scheduled actions (every, daily, weekly, when, on)
    const schedulePatterns: Array<{ pattern: RegExp; trigger: string }> = [
      { pattern: /\b(every\s+day|daily)\b/i, trigger: "daily" },
      { pattern: /\b(every\s+week|weekly)\b/i, trigger: "weekly" },
      { pattern: /\b(every\s+hour|hourly)\b/i, trigger: "hourly" },
      { pattern: /\b(when|on\s+commit|on\s+push|on\s+merge)\b/i, trigger: "event" },
    ]

    const automations: Array<{ id: string; name: string; trigger: string }> = []
    const lines = text.split("\n")

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.length < 10) continue

      for (const { pattern, trigger } of schedulePatterns) {
        if (pattern.test(trimmed)) {
          const task = await db.scheduledTask.create({ data: { name: trimmed.slice(0, 100), schedule: "daily", goal: "auto", enabled: false, payload: JSON.stringify({ conversationId, text: trimmed }) } as any })
          automations.push({ id: task.id, name: task.name, trigger })
          break
        }
      }
    }

    return { ok: true, data: { created: automations.length, automations } }
  } catch (e) {
    return { ok: false, data: null as any, error: "chat_to_automation_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 6. Chat → Agent Run (470)
// ---------------------------------------------------------------------------

export async function chatToAgentRun(conversationId: string): Promise<C2XResult<{
  plan: Array<{ step: number; role: string; task: string }>
  reason: string
}>> {
  try {
    const text = await getConversationText(conversationId)
    const actionItems = extractActionItems(text)

    // Map action items to agent roles
    const roleMap: Array<{ keywords: string[]; role: string }> = [
      { keywords: ["test", "test"], role: "tester" },
      { keywords: ["review", "check", "audit"], role: "reviewer" },
      { keywords: ["debug", "fix", "bug"], role: "debugger" },
      { keywords: ["design", "architect", "plan"], role: "architect" },
      { keywords: ["write", "document", "docs"], role: "writer" },
      { keywords: ["deploy", "release", "publish"], role: "deployer" },
    ]

    const plan: Array<{ step: number; role: string; task: string }> = []
    actionItems.forEach((item, i) => {
      const role = roleMap.find(r => r.keywords.some(k => item.toLowerCase().includes(k)))?.role ?? "generalist"
      plan.push({ step: i + 1, role, task: item })
    })

    return {
      ok: true,
      data: {
        plan,
        reason: `خطة تنفيذ بـ ${plan.length} خطوات — المحادثة → تنفيذ وكيل`,
      },
    }
  } catch (e) {
    return { ok: false, data: null as any, error: "chat_to_agent_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 7. Chat → Artifact (471)
// ---------------------------------------------------------------------------

export async function chatToArtifact(conversationId: string): Promise<C2XResult<{
  artifacts: Array<{ type: string; title: string; content: string }>
  reason: string
}>> {
  try {
    const text = await getConversationText(conversationId)
    const codeBlocks = extractCodeBlocks(text)

    const artifacts: Array<{ type: string; title: string; content: string }> = []

    for (const block of codeBlocks) {
      // Save as shared artifact
      try {
        const artifact = await (db as any).collabSharedArtifact?.create({
          data: {
            title: `Code: ${block.language} (${block.code.split("\n").length} lines)`,
            artifactType: block.language === "html" ? "html" : block.language === "mermaid" ? "mermaid" : "code",
            content: block.code,
            metadata: JSON.stringify({ language: block.language, filename: block.filename }),
            tags: JSON.stringify(["from-conversation"]),
            visibility: "public",
            createdBy: "local",
          },
        })
        if (artifact) artifacts.push({ type: block.language, title: artifact.title, content: block.code.slice(0, 100) })
      } catch {}
    }

    // Also check for mermaid diagrams
    const mermaidPattern = /```mermaid\n([\s\S]*?)```/g
    let m
    while ((m = mermaidPattern.exec(text)) !== null) {
      if (!artifacts.find(a => a.type === "mermaid" && a.content.includes(m[1].slice(0, 50)))) {
        artifacts.push({ type: "mermaid", title: "Diagram from conversation", content: m[1].slice(0, 100) })
      }
    }

    return {
      ok: true,
      data: {
        artifacts,
        reason: `تم استخراج ${artifacts.length} artifacts من المحادثة`,
      },
    }
  } catch (e) {
    return { ok: false, data: null as any, error: "chat_to_artifact_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 8. Chat → Code (472)
// ---------------------------------------------------------------------------

export async function chatToCode(conversationId: string, targetDir?: string): Promise<C2XResult<{
  extracted: number
  files: Array<{ filename: string; language: string; lines: number }>
}>> {
  try {
    const text = await getConversationText(conversationId)
    const codeBlocks = extractCodeBlocks(text)

    const files: Array<{ filename: string; language: string; lines: number }> = []

    for (let i = 0; i < codeBlocks.length; i++) {
      const block = codeBlocks[i]
      const filename = block.filename ?? `snippet_${i + 1}.${block.language === "typescript" ? "ts" : block.language === "javascript" ? "js" : block.language === "python" ? "py" : "txt"}`
      files.push({
        filename,
        language: block.language,
        lines: block.code.split("\n").length,
      })
    }

    return {
      ok: true,
      data: {
        extracted: files.length,
        files,
      },
    }
  } catch (e) {
    return { ok: false, data: null as any, error: "chat_to_code_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 9. Chat → Checklist (473)
// ---------------------------------------------------------------------------

export async function chatToChecklist(conversationId: string): Promise<C2XResult<{
  checklist: Array<{ text: string; checked: boolean }>
  reason: string
}>> {
  try {
    const text = await getConversationText(conversationId)
    const actionItems = extractActionItems(text)

    // Also extract bullet points
    const bulletPattern = /(?:^|\n)\s*[-*•]\s+(.+)/g
    let match
    const bullets: string[] = []
    while ((match = bulletPattern.exec(text)) !== null) {
      const b = match[1].trim()
      if (b.length > 5 && b.length < 200 && !actionItems.includes(b)) {
        bullets.push(b)
      }
    }

    const allItems = [...actionItems, ...bullets].slice(0, 20)
    const checklist = allItems.map(item => ({ text: item, checked: false }))

    return {
      ok: true,
      data: {
        checklist,
        reason: `تم إنشاء قائمة تحقق بـ ${checklist.length} بنود`,
      },
    }
  } catch (e) {
    return { ok: false, data: null as any, error: "chat_to_checklist_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 10. Chat → Decision (474)
// ---------------------------------------------------------------------------

export async function chatToDecision(conversationId: string): Promise<C2XResult<{
  saved: number
  decisions: Array<{ id: string; content: string }>
}>> {
  try {
    const text = await getConversationText(conversationId)
    const facts = extractFacts(text)
    const decisions = facts.filter(f => f.type === "decision")

    if (decisions.length === 0) {
      return { ok: true, data: { saved: 0, decisions: [] } }
    }

    const saved: Array<{ id: string; content: string }> = []
    for (const decision of decisions) {
      // Save as memory with category "decision"
      const memory = await db.memory.create({
        data: {
          key: `decision_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          value: decision.content,
          category: "decision",
          source: `conversation:${conversationId}`,
        },
      })
      saved.push({ id: memory.id, content: decision.content })
    }

    return { ok: true, data: { saved: saved.length, decisions: saved } }
  } catch (e) {
    return { ok: false, data: null as any, error: "chat_to_decision_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// Snapshot — convert ALL
// ---------------------------------------------------------------------------

export async function chatToEverything(conversationId: string): Promise<C2XResult<{
  tasks: number
  project: string | null
  researchQueries: number
  knowledgeItems: number
  automations: number
  agentPlan: number
  artifacts: number
  codeFiles: number
  checklistItems: number
  decisions: number
  reason: string
}>> {
  try {
    const [tasks, project, research, knowledge, automation, agent, artifacts, code, checklist, decisions] = await Promise.all([
      chatToTask(conversationId),
      chatToProject(conversationId),
      chatToResearch(conversationId),
      chatToKnowledge(conversationId),
      chatToAutomation(conversationId),
      chatToAgentRun(conversationId),
      chatToArtifact(conversationId),
      chatToCode(conversationId),
      chatToChecklist(conversationId),
      chatToDecision(conversationId),
    ])

    return {
      ok: true,
      data: {
        tasks: tasks.ok ? tasks.data.created : 0,
        project: project.ok ? project.data.name : null,
        researchQueries: research.ok ? research.data.queries.length : 0,
        knowledgeItems: knowledge.ok ? knowledge.data.saved : 0,
        automations: automation.ok ? automation.data.created : 0,
        agentPlan: agent.ok ? agent.data.plan.length : 0,
        artifacts: artifacts.ok ? artifacts.data.artifacts.length : 0,
        codeFiles: code.ok ? code.data.extracted : 0,
        checklistItems: checklist.ok ? checklist.data.checklist.length : 0,
        decisions: decisions.ok ? decisions.data.saved : 0,
        reason: "✅ تم تحويل المحادثة إلى كل شيء — المهام، المشروع، المعرفة، القرارات، والأكثر",
      },
    }
  } catch (e) {
    return { ok: false, data: null as any, error: "everything_failed", message: String(e) }
  }
}
