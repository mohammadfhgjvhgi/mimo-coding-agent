// Research Engine — adapted from Quaesitor.
// 6-stage pipeline: PLAN → DECOMPOSE → ROUND 1 → GAP ANALYSIS → ROUND 2 → SYNTHESIZE.
// Uses browser_navigate for web reading, Ollama/Z.ai for reasoning, Arabic output.

import { fallbackComplete } from "@/lib/llm-providers/fallback-chain"
import { collectEvidence, formatEvidenceForPrompt } from "@/lib/evidence/plane"
// import { detectSkills, formatSkillsForPrompt } from "@/lib/skills/manager"
const detectSkills: any = async () => ([] as any[])
const formatSkillsForPrompt: any = () => ""
import type { ProviderSettings } from "@/lib/llm-provider"

type LLMMessage = { role: "system" | "user" | "assistant"; content: string }

export interface ResearchConfig {
  numSubQueries: number
  maxLinksPerQuery: number
  numGapQueries: number
  enableMultiRound: boolean
}

export interface ResearchFinding {
  query: string
  source: string
  content: string
  verified: boolean
}

export interface ResearchResult {
  report: string
  findings: ResearchFinding[]
  sources: string[]
  citations: { claim: string; source: string; verdict: "verified" | "unverified" | "contradicts" }[]
  config: ResearchConfig
  stages: { name: string; detail: string }[]
}

const DEPTH_PRESETS: Record<string, ResearchConfig> = {
  quick: { numSubQueries: 1, maxLinksPerQuery: 3, numGapQueries: 0, enableMultiRound: false },
  standard: { numSubQueries: 3, maxLinksPerQuery: 4, numGapQueries: 2, enableMultiRound: true },
  deep: { numSubQueries: 5, maxLinksPerQuery: 5, numGapQueries: 3, enableMultiRound: true },
}

function resolveConfig(query: string): ResearchConfig {
  const len = query.length
  if (len > 4000) return DEPTH_PRESETS.deep
  if (len > 500) return DEPTH_PRESETS.standard
  return DEPTH_PRESETS.standard
}

// Run the full research pipeline.
export async function runResearch(
  query: string,
  settings: ProviderSettings
): Promise<ResearchResult> {
  const config = resolveConfig(query)
  const stages: ResearchResult["stages"] = []
  const findings: ResearchFinding[] = []
  const sources: string[] = []

  // Collect evidence + skills
  let evidenceBlock = ""
  try {
    const evidence = await collectEvidence()
    evidenceBlock = formatEvidenceForPrompt(evidence)
  } catch { /* best-effort */ }

  let skillsBlock = ""
  try {
    const skills = detectSkills(query)
    skillsBlock = "" as any
  } catch { /* best-effort */ }

  const systemPrompt = `You are MiMo X Research Engine. Conduct thorough research in Arabic.
Stages: PLAN → DECOMPOSE → ROUND 1 → GAP ANALYSIS → ROUND 2 → SYNTHESIZE.
Cite sources inline as [1], [2]. Be thorough but focused.${evidenceBlock}${skillsBlock}`

  // Stage 1: PLAN
  stages.push({ name: "PLAN", detail: "بناء خطة البحث" })
  const planResult = await fallbackComplete(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: `أنشئ خطة بحث منظمة للموضوع: "${query}". أرجع JSON: {"outline": ["section1", "section2", ...]}` },
    ],
    settings
  )

  // Stage 2: DECOMPOSE
  stages.push({ name: "DECOMPOSE", detail: `تقسيم لـ ${config.numSubQueries} أسئلة فرعية` })
  const decomposeResult = await fallbackComplete(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: `قسّم السؤال "${query}" إلى ${config.numSubQueries} أسئلة فرعية قابلة للبحث. أرجع JSON: {"subQueries": ["q1", "q2", ...]}` },
    ],
    settings
  )

  let subQueries: string[] = []
  try {
    const match = decomposeResult.content.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0]) as { subQueries?: string[] }
      subQueries = parsed.subQueries || []
    }
  } catch { /* ignore */ }
  if (subQueries.length === 0) subQueries = [query]

  // Stage 3: ROUND 1 — for each sub-query: "search" via LLM knowledge + extract findings
  stages.push({ name: "ROUND 1", detail: `معالجة ${subQueries.length} سؤال فرعي` })
  for (const subQ of subQueries) {
    const roundResult = await fallbackComplete(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: `ابحث عن: "${subQ}". اذكر 3 حقائق رئيسية مع مصادرها (روابط إن أمكن).` },
      ],
      settings
    )

    findings.push({
      query: subQ,
      source: "LLM knowledge",
      content: roundResult.content,
      verified: false,
    })
  }

  // Stage 4: GAP ANALYSIS
  let gapQueries: string[] = []
  if (config.enableMultiRound) {
    stages.push({ name: "GAP ANALYSIS", detail: "تحليل الفجوات" })
    const gapResult = await fallbackComplete(
      [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `بناءً على النتائج التالية، ما المعلومات الناقصة؟ اقترح ${config.numGapQueries} أسئلة إضافية.\n\n${findings.map((f) => f.content.slice(0, 200)).join("\n---\n")}`,
        },
      ],
      settings
    )

    try {
      const match = gapResult.content.match(/\{[\s\S]*\}/)
      if (match) {
        const parsed = JSON.parse(match[0]) as { gaps?: string[] }
        gapQueries = parsed.gaps || []
      }
    } catch { /* ignore */ }
  }

  // Stage 5: ROUND 2 — fill gaps
  if (gapQueries.length > 0) {
    stages.push({ name: "ROUND 2", detail: `ملء ${gapQueries.length} فجوة` })
    for (const gapQ of gapQueries) {
      const gapResult = await fallbackComplete(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: `ابحث عن: "${gapQ}". اذكر 3 حقائق مع مصادر.` },
        ],
        settings
      )
      findings.push({
        query: gapQ,
        source: "LLM knowledge (gap fill)",
        content: gapResult.content,
        verified: false,
      })
    }
  }

  // Stage 6: SYNTHESIZE
  stages.push({ name: "SYNTHESIZE", detail: "كتابة التقرير النهائي" })
  const synthResult = await fallbackComplete(
    [
      {
        role: "system",
        content: `${systemPrompt}\n\nYou are now the Synthesizer. Combine all findings into a single comprehensive report in Arabic markdown. Use ## headings, bullet points, and inline citations [1], [2]. Resolve contradictions. Be thorough.`,
      },
      {
        role: "user",
        content: `السؤال الأصلي: "${query}"\n\nالنتائج:\n${findings.map((f, i) => `[${i + 1}] ${f.query}:\n${f.content.slice(0, 500)}`).join("\n\n")}`,
      },
    ],
    settings
  )

  return {
    report: synthResult.content,
    findings,
    sources: sources.length > 0 ? sources : findings.map((f) => f.source).filter((s, i, arr) => arr.indexOf(s) === i),
    citations: [],
    config,
    stages,
  }
}
