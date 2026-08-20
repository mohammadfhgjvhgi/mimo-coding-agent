// Source Manager — manages research sources with ranking, dedup, reliability.
// Also handles claim extraction and verification (0-LLM + optional LLM).

import type { SearchResult } from "./web-search"

export interface ResearchSource {
  url: string
  title: string
  snippet: string
  text?: string // full extracted text
  reliability: number // 0-1
  relevanceScore: number // 0-1
  fetchedAt?: string
}

export interface Claim {
  text: string
  sourceUrl: string
  sourceTitle: string
  verdict: "verified" | "unverified" | "contradicts"
  evidence?: string
}

// Convert SearchResult[] to ResearchSource[] with reliability scoring.
export function toResearchSources(results: SearchResult[]): ResearchSource[] {
  return results.map(r => {
    let reliability = 0.5 // base

    // Domain-based reliability
    const domain = (() => {
      try { return new URL(r.url).hostname } catch { return "" }
    })()

    if (domain.includes("wikipedia.org")) reliability = 0.9
    else if (domain.includes("arxiv.org")) reliability = 0.95
    else if (domain.includes(".edu")) reliability = 0.85
    else if (domain.includes("github.com")) reliability = 0.8
    else if (domain.includes("stackoverflow.com")) reliability = 0.75
    else if (domain.includes("mdn") || domain.includes("mozilla.org")) reliability = 0.85
    else if (domain.includes("medium.com") || domain.includes("blog.")) reliability = 0.5
    else if (domain.includes("reddit.com") || domain.includes("forum")) reliability = 0.3
    else reliability = 0.5

    return {
      url: r.url,
      title: r.title,
      snippet: r.snippet,
      reliability,
      relevanceScore: 0.5, // updated later
    }
  })
}

// Update relevance scores based on query keywords.
export function scoreRelevance(sources: ResearchSource[], query: string): ResearchSource[] {
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  return sources.map(s => {
    let score = 0
    const titleLower = s.title.toLowerCase()
    const snippetLower = s.snippet.toLowerCase()
    const textLower = (s.text || "").toLowerCase()

    for (const kw of keywords) {
      if (titleLower.includes(kw)) score += 0.3
      if (snippetLower.includes(kw)) score += 0.15
      if (textLower.includes(kw)) score += 0.1
    }

    // Normalize to 0-1
    score = Math.min(1, score / (keywords.length * 0.55))

    return { ...s, relevanceScore: score }
  })
}

// Extract claims from a text (simple heuristic — sentences with factual assertions).
export function extractClaims(text: string, sourceUrl: string, sourceTitle: string): Claim[] {
  const sentences = text.split(/[.!?]\s+/).filter(s => s.length > 30 && s.length < 300)
  const claims: Claim[] = []

  for (const sentence of sentences) {
    // Heuristic: look for factual markers
    const hasNumber = /\d/.test(sentence)
    const hasAssertion = /\b(is|are|was|were|has|have|will|can|could|should|must|الـ|يوجد|كانت|سيكون)\b/i.test(sentence)

    if (hasNumber || hasAssertion) {
      claims.push({
        text: sentence.trim(),
        sourceUrl,
        sourceTitle,
        verdict: "unverified",
      })
    }
  }

  return claims.slice(0, 10) // max 10 claims per source
}

// Verify a claim against source text (0-LLM).
export function verifyClaim(claim: Claim, sourceText: string): Claim {
  if (!sourceText) {
    return { ...claim, verdict: "unverified" }
  }

  const sourceLower = sourceText.toLowerCase()
  const claimWords = claim.text.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  const matched = claimWords.filter(w => sourceLower.includes(w))

  // 30% keyword match = verified
  const matchRatio = matched.length / Math.max(claimWords.length, 1)

  // Check for negation (contradiction)
  const negationWords = ["not", "false", "denies", "refutes", "لا", "ليس", "كذب", "خطأ", "غير صحيح"]
  const hasNegation = negationWords.some(nw =>
    sourceLower.includes(nw) &&
    claimWords.some(cw => sourceLower.includes(`${nw} ${cw}`))
  )

  if (hasNegation && matchRatio > 0.2) {
    return { ...claim, verdict: "contradicts", evidence: "Negation detected near claim keywords" }
  }
  if (matchRatio >= 0.3) {
    return { ...claim, verdict: "verified", evidence: `${Math.round(matchRatio * 100)}% keyword match` }
  }

  return { ...claim, verdict: "unverified" }
}

// Cross-source comparison — find agreements and contradictions.
export function crossSourceCompare(claims: Claim[]): {
  agreements: { claim: string; sources: string[] }[]
  contradictions: { claim: string; sources: { url: string; verdict: string }[] }[]
} {
  // Group claims by similar text (keyword overlap)
  const groups: { keywords: string[]; claims: Claim[] }[] = []

  for (const claim of claims) {
    const words = claim.text.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    let matched = false

    for (const group of groups) {
      const overlap = words.filter(w => group.keywords.includes(w))
      if (overlap.length >= 3) {
        group.claims.push(claim)
        matched = true
        break
      }
    }

    if (!matched) {
      groups.push({ keywords: words, claims: [claim] })
    }
  }

  const agreements: { claim: string; sources: string[] }[] = []
  const contradictions: { claim: string; sources: { url: string; verdict: string }[] }[] = []

  for (const group of groups) {
    if (group.claims.length < 2) continue

    const verified = group.claims.filter(c => c.verdict === "verified")
    const contradicted = group.claims.filter(c => c.verdict === "contradicts")

    if (verified.length >= 2) {
      agreements.push({
        claim: verified[0].text.slice(0, 100),
        sources: verified.map(c => c.sourceUrl),
      })
    }

    if (contradicted.length > 0) {
      contradictions.push({
        claim: group.claims[0].text.slice(0, 100),
        sources: group.claims.map(c => ({ url: c.sourceUrl, verdict: c.verdict })),
      })
    }
  }

  return { agreements, contradictions }
}

// Generate a reliability score for a source.
export function getReliabilityScore(source: ResearchSource): number {
  // Combine domain reliability + relevance score
  return Math.round((source.reliability * 0.6 + source.relevanceScore * 0.4) * 100) / 100
}
