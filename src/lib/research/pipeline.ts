// Research Pipeline — full deep research pipeline.
// 7 stages: PLAN → SEARCH → FETCH → EXTRACT → VERIFY → COMPARE → REPORT
// Uses: web-search (DuckDuckGo), source-manager (ranking/dedup/claims), citation-verifier.

import { db } from "@/lib/db"
import { completeChatRouted, type ProviderSettings } from "@/lib/llm-provider"
import { webSearch, multiQuerySearch, fetchAndExtract, rankSources, deduplicateSources, type SearchResult } from "./web-search"
import {
  toResearchSources,
  scoreRelevance,
  extractClaims,
  verifyClaim,
  crossSourceCompare,
  getReliabilityScore,
  type ResearchSource,
  type Claim,
} from "./source-manager"
import { saveToTier } from "@/lib/memory/tiers"

export interface ResearchConfig {
  depth: "quick" | "standard" | "deep"
  numSubQueries: number
  maxSources: number
  maxClaimsPerSource: number
  enableMultiRound: boolean
  enableClaimVerification: boolean
  enableCrossCompare: boolean
}

export interface ResearchResult {
  jobId: string
  query: string
  status: "done" | "failed"
  plan: string[]
  subQueries: string[]
  sources: ResearchSource[]
  findings: { query: string; source: string; content: string }[]
  claims: Claim[]
  agreements: { claim: string; sources: string[] }[]
  contradictions: { claim: string; sources: { url: string; verdict: string }[] }[]
  report: string
  tokenUsage: number
  stages: { name: string; detail: string; durationMs: number }[]
}

const DEPTH_PRESETS: Record<string, ResearchConfig> = {
  quick: { depth: "quick", numSubQueries: 1, maxSources: 3, maxClaimsPerSource: 3, enableMultiRound: false, enableClaimVerification: false, enableCrossCompare: false },
  standard: { depth: "standard", numSubQueries: 3, maxSources: 6, maxClaimsPerSource: 5, enableMultiRound: true, enableClaimVerification: true, enableCrossCompare: true },
  deep: { depth: "deep", numSubQueries: 5, maxSources: 10, maxClaimsPerSource: 8, enableMultiRound: true, enableClaimVerification: true, enableCrossCompare: true },
}

// Run the full research pipeline.
export async function runResearchPipeline(
  query: string,
  settings: ProviderSettings,
  depth: string = "standard"
): Promise<ResearchResult> {
  const config = DEPTH_PRESETS[depth] || DEPTH_PRESETS.standard
  const stages: ResearchResult["stages"] = []
  let tokenUsage = 0

  // Create research job in DB
  const job = await db.researchJob.create({
    data: { query, status: "running", depth: config.depth },
  })

  // ===== Stage 1: PLAN =====
  const planStart = Date.now()
  const planResult = await completeChatRouted(settings, [
    { role: "system", content: "أنت مخطط أبحاث. قسّم السؤال إلى أسئلة فرعية للبحث. أرجع JSON: {\"subQueries\": [\"q1\", \"q2\", ...]}" },
    { role: "user", content: `خطّط بحثاً للموضوع: "${query}". أنشئ ${config.numSubQueries} أسئلة فرعية قابلة للبحث.` },
  ])
  tokenUsage += Math.ceil(planResult.text.length / 4)

  let subQueries: string[] = [query]
  try {
    const match = planResult.text.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0])
      if (Array.isArray(parsed.subQueries)) subQueries = parsed.subQueries
    }
  } catch {}
  if (subQueries.length === 0) subQueries = [query]

  stages.push({ name: "PLAN", detail: `${subQueries.length} أسئلة فرعية`, durationMs: Date.now() - planStart })

  // ===== Stage 2: SEARCH =====
  const searchStart = Date.now()
  let allResults: SearchResult[] = []

  // Multi-query search
  allResults = await multiQuerySearch(subQueries, config.maxSources)

  // Deduplicate + rank
  allResults = deduplicateSources(allResults)
  allResults = rankSources(allResults, query)
  allResults = allResults.slice(0, config.maxSources)

  stages.push({ name: "SEARCH", detail: `${allResults.length} نتيجة من DuckDuckGo`, durationMs: Date.now() - searchStart })

  // ===== Stage 3: FETCH + EXTRACT =====
  const fetchStart = Date.now()
  const sources: ResearchSource[] = toResearchSources(allResults)

  // Fetch and extract text from top sources
  for (let i = 0; i < Math.min(sources.length, config.depth === "deep" ? 10 : 5); i++) {
    try {
      const extracted = await fetchAndExtract(sources[i].url)
      sources[i].text = extracted.text
      sources[i].title = extracted.title
      sources[i].fetchedAt = new Date().toISOString()
    } catch {}
  }

  // Score relevance after fetching text
  const scoredSources = scoreRelevance(sources, query)
  stages.push({ name: "FETCH", detail: `${sources.filter(s => s.text).length} صفحات مُستخرجة`, durationMs: Date.now() - fetchStart })

  // ===== Stage 4: EXTRACT CLAIMS =====
  const extractStart = Date.now()
  let allClaims: Claim[] = []

  for (const source of sources) {
    if (source.text) {
      const claims = extractClaims(source.text, source.url, source.title)
      allClaims.push(...claims.slice(0, config.maxClaimsPerSource))
    }
  }

  stages.push({ name: "EXTRACT", detail: `${allClaims.length} ادعاءات مُستخرجة`, durationMs: Date.now() - extractStart })

  // ===== Stage 5: VERIFY CLAIMS =====
  if (config.enableClaimVerification) {
    const verifyStart = Date.now()
    for (const source of sources) {
      if (!source.text) continue
      const sourceClaims = allClaims.filter(c => c.sourceUrl === source.url)
      for (const claim of sourceClaims) {
        const verified = verifyClaim(claim, source.text)
        const idx = allClaims.findIndex(c => c === claim)
        if (idx >= 0) allClaims[idx] = verified
      }
    }
    stages.push({ name: "VERIFY", detail: `${allClaims.filter(c => c.verdict === "verified").length} موثّق، ${allClaims.filter(c => c.verdict === "contradicts").length} متناقض`, durationMs: Date.now() - verifyStart })
  }

  // ===== Stage 6: CROSS-SOURCE COMPARE =====
  let agreements: ResearchResult["agreements"] = []
  let contradictions: ResearchResult["contradictions"] = []

  if (config.enableCrossCompare) {
    const compareStart = Date.now()
    const result = crossSourceCompare(allClaims)
    agreements = result.agreements
    contradictions = result.contradictions
    stages.push({ name: "COMPARE", detail: `${agreements.length} اتفاق، ${contradictions.length} تناقض`, durationMs: Date.now() - compareStart })
  }

  // ===== Stage 7: REPORT =====
  const reportStart = Date.now()
  const findings = sources.filter(s => s.text).map(s => ({
    query: subQueries[0] || query,
    source: s.url,
    content: s.text!.slice(0, 500),
  }))

  const sourceSummary = sources.map((s, i) =>
    `[${i + 1}] ${s.title} — ${s.url} (موثوقية: ${getReliabilityScore(s)}, صلة: ${Math.round(s.relevanceScore * 100)}%)`
  ).join("\n")

  const claimSummary = allClaims.slice(0, 20).map((c, i) =>
    `${i + 1}. [${c.verdict === "verified" ? "✅" : c.verdict === "contradicts" ? "❌" : "⚠️"}] ${c.text.slice(0, 100)} — ${c.sourceTitle}`
  ).join("\n")

  const reportResult = await completeChatRouted(settings, [
    {
      role: "system",
      content: "أنت كاتب تقارير أبحاث محترف. اكتب تقريراً شاملاً بالعربية بصيغة Markdown مع استشهادات [1]، [2].",
    },
    {
      role: "user",
      content: `السؤال: "${query}"

المصادر:
${sourceSummary}

النتائج:
${findings.map((f, i) => `[${i + 1}] ${f.content}`).join("\n\n")}

الادعاءات:
${claimSummary}

${contradictions.length > 0 ? `التناقضات:\n${contradictions.map(c => `- ${c.claim}`).join("\n")}` : ""}

اكتب تقريراً شاملاً بالعربية بصيغة Markdown مع استشهادات [1]، [2].`,
    },
  ])
  tokenUsage += Math.ceil(reportResult.text.length / 4)

  stages.push({ name: "REPORT", detail: `${reportResult.text.length} حرف`, durationMs: Date.now() - reportStart })

  // Save to DB
  await db.researchJob.update({
    where: { id: job.id },
    data: {
      status: "done",
      plan: JSON.stringify(subQueries),
      sources: JSON.stringify(sources),
      findings: JSON.stringify(findings),
      claims: JSON.stringify(allClaims),
      report: reportResult.text,
      citations: JSON.stringify({ agreements, contradictions }),
      tokenUsage,
    },
  })

  // Save research to memory (episodic tier)
  await saveToTier(`research_${job.id}`, `بحث: ${query} — ${allClaims.filter(c => c.verdict === "verified").length} ادعاء موثّق من ${sources.length} مصدر`, "episodic", "research")

  return {
    jobId: job.id,
    query,
    status: "done",
    plan: subQueries,
    subQueries,
    sources,
    findings,
    claims: allClaims,
    agreements,
    contradictions,
    report: reportResult.text,
    tokenUsage,
    stages,
  }
}
