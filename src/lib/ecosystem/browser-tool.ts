// Browser Tool — navigate URLs and extract text/screenshot using Playwright (headless).
import { chromium } from "playwright"
import path from "node:path"
import fs from "node:fs"
import { WORKSPACE_ROOT, truncate } from "@/lib/tools/workspace"
import type { ToolDef, ToolResult, ToolContext } from "@/lib/tools/types"

function ok(id: string, name: string, args: Record<string, unknown>, result: string, durationMs: number): ToolResult {
  return { id, name, args, result: truncate(result, 6000), status: "success", durationMs }
}
function fail(id: string, name: string, args: Record<string, unknown>, error: string, durationMs: number): ToolResult {
  return { id, name, args, result: error, status: "error", error, durationMs }
}
function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

// ---- browser_navigate -----------------------------------------------------
export const browserNavigateTool: ToolDef = {
  name: "browser_navigate",
  description:
    "يفتح رابط ويب في متصفح headless ويستخرج النص الأساسي (عنوان الصفحة، العناوين، الفقرات) والـ HTML. مثالي لقراءة التوثيق أو استخراج محتوى صفحة.",
  schema: {
    type: "object",
    properties: {
      url: { type: "string", description: "الرابط الكامل (مثل https://example.com)" },
    },
    required: ["url"],
  },
  async execute(args, _ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now()
    const id = newId("bnav")
    const url = String(args.url || "").trim()
    if (!url || !/^https?:\/\//i.test(url)) {
      return fail(id, "browser_navigate", args, "الرابط مطلوب ويجب أن يبدأ بـ http:// أو https://", 0)
    }

    let browser
    try {
      browser = await chromium.launch({ headless: true })
      const page = await browser.newPage()
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 })

      const title = await page.title()
      // Extract main text: headings + paragraphs + links
      const textContent = await page.evaluate(() => {
        const get = (sel: string) =>
          Array.from(document.querySelectorAll(sel))
            .map((el) => el.textContent?.trim() || "")
            .filter(Boolean)
        const headings = [
          ...get("h1"), ...get("h2"), ...get("h3"),
        ]
        const paragraphs = get("p").slice(0, 20)
        const links = Array.from(document.querySelectorAll("a[href]"))
          .map((a) => `${(a as HTMLAnchorElement).textContent?.trim()}: ${(a as HTMLAnchorElement).href}`)
          .filter(Boolean)
          .slice(0, 10)
        return { headings, paragraphs, links }
      })

      const html = await page.content()

      await browser.close()
      browser = null

      const summary = [
        `🌐 ${url}`,
        `العنوان: ${title}`,
        ``,
        `## العناوين الرئيسية`,
        ...textContent.headings.slice(0, 10).map((h: string, i: number) => `${i + 1}. ${h}`),
        ``,
        `## الفقرات (أول 5)`,
        ...textContent.paragraphs.slice(0, 5).map((p: string) => p.slice(0, 200)),
        ``,
        `## الروابط (أول 5)`,
        ...textContent.links.slice(0, 5),
        ``,
        `## HTML (${html.length} بايت)`,
        html.slice(0, 500) + (html.length > 500 ? "…" : ""),
      ].join("\n")

      return ok(id, "browser_navigate", args, summary, Date.now() - start)
    } catch (e) {
      if (browser) await browser.close().catch(() => {})
      const msg = e instanceof Error ? e.message : String(e)
      // Fallback: try a simple fetch if Playwright fails
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
        const html = await res.text()
        const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
        const title = titleMatch ? titleMatch[1].trim() : "(no title)"
        // Strip HTML tags for text
        const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 2000)
        return ok(
          id,
          "browser_navigate",
          args,
          `🌐 ${url} (fallback: fetch)\nالعنوان: ${title}\n\n## النص المستخرج\n${text}\n\n## HTML (${html.length} بايت)\n${html.slice(0, 500)}`,
          Date.now() - start
        )
      } catch (e2) {
        // Third fallback: try z-ai web_search (works even when DNS fails)
        try {
          const ZAIModule = await import("z-ai-web-dev-sdk").catch(() => null)
          if (ZAIModule) {
            const ZAI = ZAIModule.default
            const zai = await ZAI.create()
            // Extract search query from URL — use the domain name as keyword
            const urlObj = new URL(url)
            const domain = urlObj.hostname.replace(/^www\./, "")
            const results = await zai.functions.invoke("web_search", {
              query: domain,
              num: 5,
            }) as Array<{ url: string; name: string; snippet: string; host_name: string }>
            if (results && results.length > 0) {
              const text = results.map((r, i) =>
                `${i + 1}. ${r.name}\n   ${r.snippet}\n   ${r.url}`
              ).join("\n\n")
              return ok(
                id,
                "browser_navigate",
                args,
                `🌐 ${url} (fallback: web_search)\n⚠️ DNS فشل للموقع المطلوب — إليك نتائج بحث عن ${domain}:\n\n${text}`,
                Date.now() - start
              )
            }
          }
        } catch (e3) {
          // All 3 fallbacks failed
        }
        return fail(
          id,
          "browser_navigate",
          args,
          `فشل Playwright (${msg}) وفشل fetch البديل (${e2 instanceof Error ? e2.message : String(e2)})`,
          Date.now() - start
        )
      }
    }
  },
}

// ---- browser_screenshot ---------------------------------------------------
export const browserScreenshotTool: ToolDef = {
  name: "browser_screenshot",
  description:
    "يلتقط لقطة شاشة لرابط ويب في متصفح headless ويحفظها كملف PNG في مجلد upload/. يُرجع مسار الملف.",
  schema: {
    type: "object",
    properties: {
      url: { type: "string", description: "الرابط الكامل" },
      fullPage: { type: "boolean", description: "لقطة كاملة للصفحة (افتراضي: false)" },
    },
    required: ["url"],
  },
  async execute(args, _ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now()
    const id = newId("bshot")
    const url = String(args.url || "").trim()
    const fullPage = args.fullPage === true
    if (!url || !/^https?:\/\//i.test(url)) {
      return fail(id, "browser_screenshot", args, "الرابط مطلوب ويجب أن يبدأ بـ http:// أو https://", 0)
    }

    let browser
    try {
      browser = await chromium.launch({ headless: true })
      const page = await browser.newPage()
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 })

      // Save screenshot to the upload folder
      const screenshotsDir = path.join(WORKSPACE_ROOT, "upload")
      if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true })
      }
      const filename = `screenshot-${Date.now()}.png`
      const filepath = path.join(screenshotsDir, filename)
      await page.screenshot({ path: filepath, fullPage, type: "png" })
      const stats = fs.statSync(filepath)

      await browser.close()
      browser = null

      return ok(
        id,
        "browser_screenshot",
        args,
        `📸 تم التقاط لقطة شاشة لـ ${url}\nالمسار: upload/${filename} (${(stats.size / 1024).toFixed(1)} KB)${fullPage ? " (صفحة كاملة)" : ""}`,
        Date.now() - start
      )
    } catch (e) {
      if (browser) await browser.close().catch(() => {})
      return fail(
        id,
        "browser_screenshot",
        args,
        `فشل التقاط اللقطة: ${e instanceof Error ? e.message : String(e)}`,
        Date.now() - start
      )
    }
  },
}
