// Research-to-Knowledge Pipeline — turn research into permanent knowledge.
// "اعمل بحثًا شاملًا عن PLC" → Research → Sources → Report → Knowledge Base → Future Retrieval
//
// Pipeline stages:
//   1. Parse research topic from message
//   2. Search web (via z-ai web_search) for sources
//   3. Extract key facts from search results (deterministic)
//   4. Generate a structured report (markdown)
//   5. Save to Knowledge Base (KnowledgeChunk in DB)
//   6. Save key facts to Memory OS (for future retrieval)
//   7. Return report + knowledge chunk ID + memory keys

import { db } from "@/lib/db"
import { createHash } from "node:crypto"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchResultItem {
  url: string
  name: string
  snippet: string
  host_name: string
  date?: string
}

export interface ExtractedFact {
  source: string
  fact: string
  confidence: number
}

export interface ResearchReport {
  topic: string
  summary: string
  sources: SearchResultItem[]
  keyFacts: ExtractedFact[]
  report: string // markdown
  knowledgeChunkId: string
  memoryKeys: string[]
  stages: Array<{ name: string; status: "done" | "error"; durationMs: number; result?: string }>
  totalDurationMs: number
}

export type ResearchResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string }

// ---------------------------------------------------------------------------
// 1. Parse research topic
// ---------------------------------------------------------------------------

export function parseResearchTopic(message: string): string {
  // Extract the topic from common patterns
  const patterns = [
    /(?:اعمل|اكتب|أنشئ|do|make|conduct|perform)\s+(?:بحثا?\s*شاملا?|بحث\s*عن|research\s+on|research\s+about)\s+(.+?)(?:\.|$)/i,
    /(?:بحث\s*عن|search\s+for|search\s+about)\s+(.+?)(?:\.|$)/i,
    /(?:معلومات\s*عن|info\s+about|tell\s+me\s+about)\s+(.+?)(?:\.|$)/i,
  ]
  for (const p of patterns) {
    const m = message.match(p)
    if (m) return m[1].trim()
  }
  // Fallback: use the whole message
  return message.trim().slice(0, 200)
}

// ---------------------------------------------------------------------------
// 2. Web search via z-ai SDK
// ---------------------------------------------------------------------------

export async function webSearch(query: string, num: number = 10): Promise<SearchResultItem[]> {
  try {
    const ZAIModule = await import("z-ai-web-dev-sdk").catch(() => null)
    if (!ZAIModule) return []
    const ZAI = ZAIModule.default
    const zai = await ZAI.create()
    const results = await zai.functions.invoke("web_search", { query, num }) as SearchResultItem[]
    return Array.isArray(results) ? results : []
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// 3. Extract key facts (deterministic — no LLM)
// ---------------------------------------------------------------------------

export function extractFacts(results: SearchResultItem[], topic: string): ExtractedFact[] {
  const facts: ExtractedFact[] = []
  const seen = new Set<string>()

  for (const r of results) {
    const snippet = r.snippet?.trim()
    if (!snippet || snippet.length < 20) continue

    // Strategy 1: Extract sentences containing the topic keyword
    const sentences = snippet.split(/(?<=[.!?])\s+/)
    for (const sentence of sentences) {
      if (sentence.length < 15 || sentence.length > 300) continue
      const lower = sentence.toLowerCase()
      const topicLower = topic.toLowerCase()
      // Check if the sentence contains the topic or its keywords
      const topicWords = topicLower.split(/\s+/).filter(w => w.length > 2)
      const matchesTopic = topicWords.some(w => lower.includes(w))
      if (!matchesTopic) continue

      // Dedupe
      const key = sentence.toLowerCase().slice(0, 60)
      if (seen.has(key)) continue
      seen.add(key)

      // Confidence based on: has numbers (facts usually do), length, source quality
      let confidence = 0.5
      if (/\d/.test(sentence)) confidence += 0.2 // contains numbers
      if (sentence.length > 50) confidence += 0.1 // substantial
      if (r.host_name.includes("wiki") || r.host_name.includes("edu") || r.host_name.includes("gov")) confidence += 0.15
      if (r.host_name.includes("blog") || r.host_name.includes("medium")) confidence -= 0.1
      confidence = Math.min(0.95, confidence)

      facts.push({
        source: r.host_name,
        fact: sentence.trim(),
        confidence: Math.round(confidence * 100) / 100,
      })
    }
  }

  // Sort by confidence desc, take top 15
  return facts.sort((a, b) => b.confidence - a.confidence).slice(0, 15)
}

// ---------------------------------------------------------------------------
// 4. Generate report (deterministic markdown)
// ---------------------------------------------------------------------------

export function generateReport(topic: string, results: SearchResultItem[], facts: ExtractedFact[]): string {
  let md = `# بحث شامل: ${topic}\n\n`
  md += `> **تاريخ البحث:** ${new Date().toISOString()}\n`
  md += `> **عدد المصادر:** ${results.length}\n`
  md += `> **عدد الحقائق المستخرجة:** ${facts.length}\n\n`
  md += `---\n\n`

  // Summary
  md += `## ملخص / Summary\n\n`
  md += `تم إجراء بحث شامل عن "${topic}" باستخدام ${results.length} مصدر. `
  md += `تم استخراج ${facts.length} حقيقة رئيسية بمستويات ثقة متفاوتة. `
  md += `الحقائق مرتبة حسب درجة الثقة.\n\n`
  md += `---\n\n`

  // Key facts by confidence
  md += `## الحقائق الرئيسية / Key Facts\n\n`
  const highConf = facts.filter(f => f.confidence >= 0.7)
  const medConf = facts.filter(f => f.confidence >= 0.5 && f.confidence < 0.7)
  const lowConf = facts.filter(f => f.confidence < 0.5)

  if (highConf.length > 0) {
    md += `### ثقة عالية / High Confidence (${highConf.length})\n\n`
    for (const f of highConf) {
      md += `- **${f.fact}** *(المصدر: ${f.source}, الثقة: ${(f.confidence * 100).toFixed(0)}%)*\n`
    }
    md += `\n`
  }

  if (medConf.length > 0) {
    md += `### ثقة متوسطة / Medium Confidence (${medConf.length})\n\n`
    for (const f of medConf) {
      md += `- ${f.fact} *(المصدر: ${f.source}, الثقة: ${(f.confidence * 100).toFixed(0)}%)*\n`
    }
    md += `\n`
  }

  if (lowConf.length > 0) {
    md += `### ثقة منخفضة / Low Confidence (${lowConf.length})\n\n`
    for (const f of lowConf) {
      md += `- ${f.fact} *(المصدر: ${f.source}, الثقة: ${(f.confidence * 100).toFixed(0)}%)*\n`
    }
    md += `\n`
  }

  md += `---\n\n`

  // Sources
  md += `## المصادر / Sources\n\n`
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    md += `${i + 1}. [${r.name || r.host_name}](${r.url})\n`
    if (r.snippet) md += `   > ${r.snippet.slice(0, 200)}${r.snippet.length > 200 ? "..." : ""}\n`
    md += `\n`
  }

  md += `---\n\n`
  md += `## الاسترجاع المستقبلي / Future Retrieval\n\n`
  md += `تم حفظ هذا البحث في قاعدة المعرفة (Knowledge Base) للاسترجاع المستقبلي.\n`
  md += `استخدم أداة البحث في المعرفة للعثور على هذه المعلومات لاحقاً.\n`

  return md
}

// ---------------------------------------------------------------------------
// 5. Save to Knowledge Base (KnowledgeChunk)
// ---------------------------------------------------------------------------

export async function saveToKnowledge(topic: string, report: string, sources: SearchResultItem[]): Promise<string> {
  const content = report
  const tokens = Math.ceil(content.length / 4)
  const chunk = await db.knowledgeChunk.create({
    data: {
      source: `research:${topic}`,
      sourceType: "note",
      content: content.slice(0, 50000),
      embedding: "[]",
      chunkIndex: 0,
      tokens,
    },
  })
  return chunk.id
}

// ---------------------------------------------------------------------------
// 6. Save key facts to Memory OS
// ---------------------------------------------------------------------------

export async function saveFactsToMemory(topic: string, facts: ExtractedFact[]): Promise<string[]> {
  const memoryKeys: string[] = []
  const topicSlug = topic.toLowerCase().replace(/\s+/g, "_").slice(0, 30)

  for (let i = 0; i < Math.min(facts.length, 10); i++) {
    const fact = facts[i]
    const key = `research_${topicSlug}_${i}`
    try {
      const existing = await db.memory.findUnique({ where: { key } })
      if (existing) {
        await db.memory.update({
          where: { key },
          data: {
            value: fact.fact,
            category: "research",
            source: fact.source,
            updatedAt: new Date(),
          },
        })
      } else {
        await db.memory.create({
          data: {
            key,
            value: fact.fact,
            category: "research",
            source: fact.source,
          },
        })
      }
      memoryKeys.push(key)
    } catch {
      // best-effort
    }
  }

  return memoryKeys
}

// ---------------------------------------------------------------------------
// Full Pipeline: Research → Sources → Report → Knowledge → Memory
// ---------------------------------------------------------------------------

export async function runResearchPipeline(message: string, opts: { numResults?: number } = {}): Promise<ResearchResult<ResearchReport>> {
  const start = Date.now()
  try {
    if (!message || !message.trim()) {
      return { ok: false, error: "no_message", message: "❌ لا رسالة / no message provided" }
    }

    const stages: ResearchReport["stages"] = []
    const num = opts.numResults ?? 10

    // Stage 1: Parse topic
    const parseStart = Date.now()
    const topic = parseResearchTopic(message)
    stages.push({ name: "parse_topic", status: "done", durationMs: Date.now() - parseStart, result: topic })

    // Stage 2: Web search
    const searchStart = Date.now()
    const results = await webSearch(topic, num)
    if (results.length === 0) {
      stages.push({ name: "web_search", status: "error", durationMs: Date.now() - searchStart, result: "no results" })
      return {
        ok: false,
        error: "no_results",
        message: `❌ لم يتم العثور على نتائج بحث عن: ${topic}`,
      }
    }
    stages.push({ name: "web_search", status: "done", durationMs: Date.now() - searchStart, result: `${results.length} results` })

    // Stage 3: Extract facts
    const extractStart = Date.now()
    const facts = extractFacts(results, topic)
    stages.push({ name: "extract_facts", status: "done", durationMs: Date.now() - extractStart, result: `${facts.length} facts` })

    // Stage 4: Generate report
    const reportStart = Date.now()
    const report = generateReport(topic, results, facts)
    stages.push({ name: "generate_report", status: "done", durationMs: Date.now() - reportStart, result: `${report.length} chars` })

    // Stage 5: Save to Knowledge Base
    const kbStart = Date.now()
    const knowledgeChunkId = await saveToKnowledge(topic, report, results)
    stages.push({ name: "save_knowledge", status: "done", durationMs: Date.now() - kbStart, result: knowledgeChunkId })

    // Stage 6: Save to Memory OS
    const memStart = Date.now()
    const memoryKeys = await saveFactsToMemory(topic, facts)
    stages.push({ name: "save_memory", status: "done", durationMs: Date.now() - memStart, result: `${memoryKeys.length} memories` })

    // Summary
    const summary = `بحث عن "${topic}": ${results.length} مصدر، ${facts.length} حقيقة، ${memoryKeys.length} ذاكرة محفوظة. تم حفظ التقرير في قاعدة المعرفة.`

    return {
      ok: true,
      data: {
        topic,
        summary,
        sources: results,
        keyFacts: facts,
        report,
        knowledgeChunkId,
        memoryKeys,
        stages,
        totalDurationMs: Date.now() - start,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "pipeline_failed",
      message: `❌ فشل خط البحث: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

export function formatResearchReport(r: ResearchReport): string {
  const lines: string[] = []
  lines.push(`📚 **Research → Knowledge Pipeline**`)
  lines.push(`🔍 الموضوع: ${r.topic}`)
  lines.push(`📊 المصادر: ${r.sources.length} | الحقائق: ${r.keyFacts.length} | الذاكرة: ${r.memoryKeys.length}`)
  lines.push("")
  for (const s of r.stages) {
    const icon = s.status === "done" ? "✅" : "❌"
    lines.push(`${icon} ${s.name} (${s.durationMs}ms)${s.result ? ` — ${s.result}` : ""}`)
  }
  lines.push("")
  lines.push(`⏱️ ${r.totalDurationMs}ms إجمالي`)
  lines.push(`💾 Knowledge ID: ${r.knowledgeChunkId}`)
  lines.push(`🧠 Memory keys: ${r.memoryKeys.length}`)
  lines.push("")
  lines.push(`---`)
  lines.push(r.report.slice(0, 3000))
  if (r.report.length > 3000) lines.push(`\n... (${r.report.length - 3000} chars more)`)
  return lines.join("\n")
}
