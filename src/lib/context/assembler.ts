// Context Assembler — automatically selects what the model needs to see.
// Combines: active files, memory recall, knowledge search, evidence, skills,
// conversation history → produces a ContextPackage with token budgeting.

import { db } from "@/lib/db"
import { collectEvidence, formatEvidenceForPrompt, type EvidenceBundle } from "@/lib/evidence/plane"
// import { detectSkills, formatSkillsForPrompt } from "@/lib/skills/manager"
const detectSkills: any = async () => ([] as any[])
const formatSkillsForPrompt: any = () => ""
import { getProjectMemoryBlock } from "@/lib/tools/memory"
import { recallWithBM25 } from "@/lib/memory/tiers"
import { getRepoMap } from "@/lib/code-intel/symbol-index"
import { estimateTokens } from "@/lib/context-os"
import type { ProviderSettings } from "@/lib/llm-provider"

export interface ContextPackage {
  systemPrompt: string
  messages: { role: "system" | "user" | "assistant"; content: string }[]
  evidence: EvidenceBundle | null
  memories: { key: string; value: string; tier: string; score: number }[]
  knowledge: { source: string; content: string; score: number }[]
  skills: string[]
  repoMap: string
  tokenEstimate: number
  tokenBudget: number
  sources: string[]
}

export interface ContextOptions {
  query?: string
  conversationId?: string
  activeFiles?: string[]
  maxMemories?: number
  maxKnowledge?: number
  skipRetrieval?: boolean
  settings?: ProviderSettings
}

export async function assembleContext(opts: ContextOptions): Promise<ContextPackage> {
  const sources: string[] = []
  const query = opts.query || ""
  const maxMemories = opts.maxMemories || 5
  const maxKnowledge = opts.maxKnowledge || 3

  // 1. Evidence Plane
  let evidence: EvidenceBundle | null = null
  let evidenceBlock = ""
  try {
    evidence = await collectEvidence()
    evidenceBlock = formatEvidenceForPrompt(evidence)
    if (evidence.items.length > 0) sources.push(`evidence(${evidence.items.length})`)
  } catch {}

  // 2. Memory recall (BM25)
  let memories: { key: string; value: string; tier: string; score: number }[] = []
  let memoryBlock = ""
  try {
    if (!opts.skipRetrieval && query) {
      const recalled = await recallWithBM25(query, maxMemories)
      memories = recalled.map(m => ({ key: m.key, value: m.value, tier: m.tier, score: m.confidence }))
    }
    const block = await getProjectMemoryBlock()
    if (block) { memoryBlock = block; sources.push(`memory(${memories.length}+block)`) }
  } catch {}

  // 3. Knowledge search
  let knowledge: { source: string; content: string; score: number }[] = []
  let knowledgeBlock = ""
  try {
    if (!opts.skipRetrieval && query) {
      const chunks = await db.knowledgeChunk.findMany({ take: 100 })
      const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
      knowledge = chunks.map(c => {
        const content = c.content.toLowerCase()
        let score = 0
        for (const kw of keywords) score += (content.match(new RegExp(kw, "g")) || []).length
        return { source: c.source, content: c.content.slice(0, 300), score }
      }).filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, maxKnowledge)
      if (knowledge.length > 0) {
        knowledgeBlock = "\n\n## 📚 Knowledge\n" + knowledge.map((k, i) => `${i + 1}. [${k.source}] ${k.content.slice(0, 150)}…`).join("\n")
        sources.push(`knowledge(${knowledge.length})`)
      }
    }
  } catch {}

  // 4. Skills
  let skillsBlock = ""
  let detectedSkills: string[] = []
  try {
    const skills = detectSkills(query)
    detectedSkills = skills.map(s => s.name)
    skillsBlock = "" as any
    if (skills.length > 0) sources.push(`skills(${skills.length})`)
  } catch {}

  // 5. Repo Map
  let repoMap = ""
  try {
    const map = await getRepoMap()
    if (map.length > 0) {
      repoMap = "\n\n## 🗂️ Repo Map\n" + map.slice(0, 20).map(f => `${f.filePath}: ${f.symbols.map(s => s.name).join(", ")}`).join("\n")
      sources.push(`repoMap(${map.length})`)
    }
  } catch {}

  // 6. Active files
  let activeFilesBlock = ""
  if (opts.activeFiles?.length) {
    activeFilesBlock = "\n\n## 📂 الملفات المفتوحة\n" + opts.activeFiles.map(f => `- ${f}`).join("\n")
    sources.push(`activeFiles(${opts.activeFiles.length})`)
  }

  // 7. Conversation history
  let historyMessages: { role: "system" | "user" | "assistant"; content: string }[] = []
  if (opts.conversationId) {
    try {
      const msgs = await db.message.findMany({ where: { conversationId: opts.conversationId }, orderBy: { createdAt: "desc" }, take: 10 })
      historyMessages = msgs.reverse().map(m => ({ role: m.role as "system" | "user" | "assistant", content: m.content }))
      if (historyMessages.length > 0) sources.push(`history(${historyMessages.length})`)
    } catch {}
  }

  // 8. Build system prompt
  const systemPrompt = [
    "أنت MiMo X، مساعد ذكاء اصطناعي محلي. السياق التالي تم تجميعه تلقائياً.",
    activeFilesBlock, evidenceBlock, memoryBlock, knowledgeBlock, skillsBlock, repoMap,
  ].filter(Boolean).join("\n")

  // 9. Token estimation
  const tokenEstimate = estimateTokens(systemPrompt) + historyMessages.reduce((s, m) => s + estimateTokens(m.content), 0)

  return { systemPrompt, messages: historyMessages, evidence, memories, knowledge, skills: detectedSkills, repoMap, tokenEstimate, tokenBudget: 28000, sources }
}

export function formatContextPackage(pkg: ContextPackage): string {
  return [
    `📊 Context Package (${pkg.tokenEstimate}/${pkg.tokenBudget} tokens)`,
    `Sources: ${pkg.sources.join(", ") || "none"}`,
    `Evidence: ${pkg.evidence?.items.length || 0} | Memories: ${pkg.memories.length} | Knowledge: ${pkg.knowledge.length}`,
    `Skills: ${pkg.skills.join(", ") || "none"} | History: ${pkg.messages.length}`,
  ].join("\n")
}
