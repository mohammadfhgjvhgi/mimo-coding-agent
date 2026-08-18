// Citation Verifier — adapted from Quaesitor.
// Checks that URLs cited in LLM reports actually exist in collected sources
// AND that the cited text is supported by the source content.
// 3 levels: verified / unverified / contradicts.
// 0 LLM calls in default mode (regex + fuzzy match only).

import { createHash } from "node:crypto"

export interface Source {
  url: string
  title: string
  text?: string
}

export interface CitationCheck {
  url: string
  citedText: string
  foundInSources: boolean
  supportsClaim: "verified" | "unverified" | "contradicts"
  sourceExcerpt?: string
  sourceTitle?: string
  warning?: string
}

export interface VerificationReport {
  total: number
  verified: number
  unverified: number
  contradicts: number
  details: CitationCheck[]
  warnings: string[]
}

// Cache: sha256(claim+source) → result, TTL 7 days.
const cache = new Map<string, { result: CitationCheck; expires: number }>()
const CACHE_TTL = 7 * 24 * 3600 * 1000 // 7 days

// Extract all citation URLs from a markdown report.
export function extractCitations(report: string): { url: string; citedText: string }[] {
  const citations: { url: string; citedText: string }[] = []
  const seen = new Set<string>()

  // 1. Inline links: [text](url)
  const inlinePattern = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g
  let match: RegExpExecArray | null
  while ((match = inlinePattern.exec(report)) !== null) {
    const citedText = (match[1] ?? "").trim()
    const url = (match[2] ?? "").trim()
    if (!seen.has(url)) {
      seen.add(url)
      citations.push({ url, citedText })
    }
  }

  // 2. Reference-style: [N] in text, [N]: url in Sources
  const refDefPattern = /^\[(\d+)\]:\s*(https?:\/\/[^\s]+)/gm
  const refUrls = new Map<string, string>()
  while ((match = refDefPattern.exec(report)) !== null) {
    refUrls.set(match[1]!, match[2]!.trim())
  }

  if (refUrls.size > 0) {
    const sourcesIdx = report.search(/^#+\s*Sources/im)
    const body = sourcesIdx >= 0 ? report.slice(0, sourcesIdx) : report

    const refPattern = /\[(\d+)\]/g
    let refMatch: RegExpExecArray | null
    while ((refMatch = refPattern.exec(body)) !== null) {
      const refNum = refMatch[1] ?? ""
      const url = refUrls.get(refNum)
      if (url && !seen.has(url)) {
        seen.add(url)
        const before = body.slice(0, refMatch.index)
        const sentenceStart = Math.max(before.lastIndexOf(". "), before.lastIndexOf("\n"), 0)
        const sentenceEnd = body.indexOf(".", refMatch.index)
        const citedText =
          sentenceEnd >= 0
            ? body.slice(sentenceStart, sentenceEnd + 1).trim()
            : before.slice(sentenceStart).trim()
        citations.push({ url, citedText })
      }
    }
  }

  // 3. Plain URLs in text
  const plainUrlPattern = /(https?:\/\/[^\s)\]]+)/g
  while ((match = plainUrlPattern.exec(report)) !== null) {
    const url = (match[1] ?? "").trim()
    if (!seen.has(url)) {
      seen.add(url)
      citations.push({ url, citedText: "" })
    }
  }

  return citations
}

// Check if cited text is supported by source text (fuzzy match).
function isTextSupported(citedText: string, sourceText: string): { supported: boolean; excerpt?: string } {
  if (!citedText || citedText.length < 10) {
    return { supported: true, excerpt: sourceText.slice(0, 200) }
  }

  const source = sourceText.toLowerCase()
  const cited = citedText.toLowerCase()

  const words = cited.split(/\s+/).filter((w) => w.length > 2)
  const phrases: string[] = []
  for (let i = 0; i < words.length - 2; i++) {
    const phrase = words.slice(i, i + 3).join(" ")
    if (phrase.length > 10) phrases.push(phrase)
  }

  if (phrases.length === 0) {
    const significantWords = words.filter((w) => w.length > 4)
    const matches = significantWords.filter((w) => source.includes(w))
    return {
      supported: matches.length >= Math.ceil(significantWords.length * 0.3),
      excerpt: sourceText.slice(0, 200),
    }
  }

  const matchedPhrases = phrases.filter((p) => source.includes(p))
  const matchRatio = matchedPhrases.length / phrases.length

  if (matchRatio >= 0.3) {
    const bestPhrase = matchedPhrases[0]
    const excerptIdx = source.indexOf(bestPhrase)
    return {
      supported: true,
      excerpt: sourceText.slice(Math.max(0, excerptIdx - 50), excerptIdx + 250),
    }
  }

  return { supported: false }
}

// Detect contradiction: negation words near shared keywords.
function detectContradiction(citedText: string, sourceText: string): boolean {
  const negationWords = ["not", "never", "false", "denies", "refutes", "disproves", "contradicts", "لا", "ليس", "كذب", "ينفي", "غير صحيح"]
  const citedWords = citedText.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
  const source = sourceText.toLowerCase()

  for (const neg of negationWords) {
    for (const word of citedWords) {
      if (source.includes(`${neg} ${word}`) || source.includes(`${word} ${neg}`)) {
        return true
      }
    }
  }
  return false
}

// Verify a single citation against sources.
export function verifyCitation(
  citation: { url: string; citedText: string },
  sources: Source[]
): CitationCheck {
  const cacheKey = createHash("sha256")
    .update(`${citation.url}:${citation.citedText}`)
    .digest("hex")

  const cached = cache.get(cacheKey)
  if (cached && Date.now() < cached.expires) {
    return cached.result
  }

  // Find matching source by URL
  const source = sources.find((s) => s.url === citation.url)
  const foundInSources = !!source

  if (!foundInSources) {
    const result: CitationCheck = {
      url: citation.url,
      citedText: citation.citedText,
      foundInSources: false,
      supportsClaim: "unverified",
      warning: "URL not found in collected sources — possibly hallucinated",
    }
    cache.set(cacheKey, { result, expires: Date.now() + CACHE_TTL })
    return result
  }

  if (!source!.text) {
    const result: CitationCheck = {
      url: citation.url,
      citedText: citation.citedText,
      foundInSources: true,
      supportsClaim: "verified", // URL exists, can't verify text
      sourceTitle: source!.title,
    }
    cache.set(cacheKey, { result, expires: Date.now() + CACHE_TTL })
    return result
  }

  // Check if the cited text is supported by the source
  const { supported, excerpt } = isTextSupported(citation.citedText, source!.text)

  if (supported) {
    // Check for contradictions
    const contradicted = detectContradiction(citation.citedText, source!.text)
    const result: CitationCheck = {
      url: citation.url,
      citedText: citation.citedText,
      foundInSources: true,
      supportsClaim: contradicted ? "contradicts" : "verified",
      sourceExcerpt: excerpt,
      sourceTitle: source!.title,
      warning: contradicted ? "Source text appears to contradict the claim (negation detected)" : undefined,
    }
    cache.set(cacheKey, { result, expires: Date.now() + CACHE_TTL })
    return result
  }

  const result: CitationCheck = {
    url: citation.url,
    citedText: citation.citedText,
    foundInSources: true,
    supportsClaim: "unverified",
    sourceExcerpt: excerpt,
    sourceTitle: source!.title,
    warning: "Cited text not found in source (fuzzy match failed)",
  }
  cache.set(cacheKey, { result, expires: Date.now() + CACHE_TTL })
  return result
}

// Verify all citations in a report.
export function verifyAllCitations(report: string, sources: Source[]): VerificationReport {
  const citations = extractCitations(report)
  const details = citations.map((c) => verifyCitation(c, sources))

  return {
    total: details.length,
    verified: details.filter((d) => d.supportsClaim === "verified").length,
    unverified: details.filter((d) => d.supportsClaim === "unverified").length,
    contradicts: details.filter((d) => d.supportsClaim === "contradicts").length,
    details,
    warnings: details.filter((d) => d.warning).map((d) => d.warning!),
  }
}
