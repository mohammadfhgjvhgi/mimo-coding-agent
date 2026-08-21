// Web Search — primary: DuckDuckGo HTML scraping (no API key).
// Fallback: z-ai-web-dev-sdk web_search (used when DuckDuckGo returns a
// CAPTCHA / anomaly page, which is common from sandbox IPs).
// Returns { title, url, snippet } results.

export interface SearchResult {
  title: string
  url: string
  snippet: string
  source: string // "duckduckgo" | "zai"
}

// Search via z-ai-web-dev-sdk (server-side only). Used as fallback when
// DuckDuckGo is blocked / returns CAPTCHA.
async function zaiWebSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default
    const zai = await ZAI.create()
    const results = await zai.functions.invoke("web_search", {
      query,
      num: Math.min(maxResults, 10),
    })
    if (!Array.isArray(results)) return []
    return results.slice(0, maxResults).map((r) => ({
      title: String(r.name || "").trim() || r.url,
      url: String(r.url || ""),
      snippet: String(r.snippet || "").slice(0, 300),
      source: "zai",
    })).filter((r) => r.url)
  } catch (e) {
    console.error("[zaiWebSearch] error:", e instanceof Error ? e.message : String(e))
    return []
  }
}

// Detect DuckDuckGo CAPTCHA / anomaly pages (no real results).
function isDuckDuckGoBlocked(html: string): boolean {
  return html.includes("anomaly-modal") || html.includes("If this error persists")
}

// Search DuckDuckGo via HTML scraping (no API key).
export async function webSearch(query: string, maxResults = 5): Promise<SearchResult[]> {
  // Try DuckDuckGo first.
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(15000),
    })

    if (res.ok) {
      const html = await res.text()
      if (!isDuckDuckGoBlocked(html)) {
        // Parse DuckDuckGo HTML results
        const results: SearchResult[] = []
        const linkPattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/g
        const snippetPattern = /<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/g

        const links: { url: string; title: string }[] = []
        let match: RegExpExecArray | null

        while ((match = linkPattern.exec(html)) !== null) {
          const rawUrl = match[1]
          const title = match[2].replace(/<[^>]+>/g, "").trim()
          // DuckDuckGo wraps URLs — extract the actual URL
          const urlMatch = rawUrl.match(/uddg=([^&]+)/)
          const actualUrl = urlMatch ? decodeURIComponent(urlMatch[1]) : rawUrl
          if (title && actualUrl && !actualUrl.includes("duckduckgo.com")) {
            links.push({ url: actualUrl, title })
          }
        }

        const snippets: string[] = []
        while ((match = snippetPattern.exec(html)) !== null) {
          snippets.push(match[1].replace(/<[^>]+>/g, "").trim())
        }

        for (let i = 0; i < Math.min(links.length, maxResults); i++) {
          results.push({
            title: links[i].title,
            url: links[i].url,
            snippet: snippets[i] || "",
            source: "duckduckgo",
          })
        }

        if (results.length > 0) return results
      } else {
        console.warn("[webSearch] DuckDuckGo returned CAPTCHA/anomaly page — falling back to z-ai")
      }
    }
  } catch (e) {
    console.error("[webSearch] DuckDuckGo error:", e instanceof Error ? e.message : String(e))
  }

  // Fallback: z-ai web search.
  return zaiWebSearch(query, maxResults)
}

// Multi-query search — runs multiple queries and deduplicates.
export async function multiQuerySearch(
  queries: string[],
  perQuery = 3
): Promise<SearchResult[]> {
  const allResults: SearchResult[] = []
  const seenUrls = new Set<string>()

  for (const query of queries) {
    const results = await webSearch(query, perQuery)
    for (const r of results) {
      if (!seenUrls.has(r.url)) {
        seenUrls.add(r.url)
        allResults.push(r)
      }
    }
  }

  return allResults
}

// Fetch a URL and extract main text content.
export async function fetchAndExtract(url: string): Promise<{ title: string; text: string; url: string }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
    const title = titleMatch ? titleMatch[1].trim() : url

    // Remove scripts, styles, nav, footer
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")

    // Extract main content
    const mainMatch = text.match(/<(?:main|article|div)[^>]*>([\s\S]*?)<\/(?:main|article|div)>/i)
    if (mainMatch) text = mainMatch[1]

    // Strip remaining HTML tags
    text = text.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim()

    // Truncate to first 3000 chars (keep it manageable)
    if (text.length > 3000) text = text.slice(0, 3000) + "…"

    return { title, text, url }
  } catch (e) {
    return { title: url, text: "", url }
  }
}

// Rank sources by relevance to the query.
export function rankSources(
  sources: SearchResult[],
  query: string
): SearchResult[] {
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)

  return sources
    .map(s => {
      let score = 0
      const titleLower = s.title.toLowerCase()
      const snippetLower = s.snippet.toLowerCase()

      for (const kw of keywords) {
        if (titleLower.includes(kw)) score += 3
        if (snippetLower.includes(kw)) score += 1
      }

      // Boost reliable domains
      if (s.url.includes("wikipedia.org")) score += 2
      if (s.url.includes("github.com")) score += 1
      if (s.url.includes("stackoverflow.com")) score += 1
      if (s.url.includes(".edu")) score += 2
      if (s.url.includes("arxiv.org")) score += 2

      return { ...s, score }
    })
    .sort((a, b) => (b as any).score - (a as any).score)
    .map(({ ...s }) => s)
}

// Deduplicate sources by URL domain.
export function deduplicateSources(sources: SearchResult[]): SearchResult[] {
  const seen = new Set<string>()
  return sources.filter(s => {
    try {
      const domain = new URL(s.url).hostname
      if (seen.has(domain)) return false
      seen.add(domain)
      return true
    } catch {
      return true
    }
  })
}
