// Browser Agent — comprehensive Playwright-based browser automation layer.
// 16 operations, deterministic, bilingual (Arabic + English), persistent sessions.
//
// Design:
//   • A BrowserSession holds a chromium browser + context + page.
//   • Multiple named sessions can coexist (default, "auth", "test", ...).
//   • Each session can have its own profile (cookies, localStorage, viewport).
//   • All operations return structured results, not raw Playwright objects.
//   • 0 LLM calls — pure automation.
//
// 16 operations:
//   1.  browserLaunch         — start a named session with a profile
//   2.  browserNavigate        — goto a URL
//   3.  browserInspectPage     — title, url, meta, viewport, visible text
//   4.  browserInspectDom      — query elements, return matched list
//   5.  browserSelectElement   — pick an element by selector + return metadata
//   6.  browserClick           — click an element (text/selector/role/xy)
//   7.  browserType            — type text into a field
//   8.  browserScroll          — scroll page/element by amount or to selector
//   9.  browserScreenshot      — capture viewport or full page
//   10. browserInspectConsole  — capture console logs since last call
//   11. browserInspectNetwork  — capture network requests since last call
//   12. browserTestForm        — fill + submit a form, return result state
//   13. browserTestWebApp      — run a multi-step test script
//   14. browserNavigateMulti   — visit a sequence of URLs in order
//   15. browserAuthSession     — login + persist session state to disk
//   16. browserProfiles        — list/create/delete browser profiles

import { chromium, type Browser, type BrowserContext, type Page } from "playwright"
import path from "node:path"
import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BrowserSelectorKind = "css" | "text" | "role" | "testid" | "xpath" | "xy"

export interface BrowserSelector {
  kind: BrowserSelectorKind
  /** CSS selector, text content, role name, test id, xpath, or "x,y" for xy. */
  value: string
  /** For role selectors, the accessible name regex. */
  name?: string
}

export type LaunchHeadless = boolean

export interface LaunchOptions {
  /** Session name. "default" if omitted. */
  session?: string
  /** Headless mode. Default true. */
  headless?: LaunchHeadless
  /** Viewport. Default 1280×720. */
  viewport?: { width: number; height: number }
  /** User agent override. */
  userAgent?: string
  /** Locale (e.g. "ar", "en-US"). Default "en-US". */
  locale?: string
  /** Timezone (e.g. "Asia/Hebron"). */
  timezone?: string
  /** Block resource types for speed. */
  blockedResources?: Array<"image" | "stylesheet" | "font" | "media">
  /** Extra HTTP headers. */
  extraHeaders?: Record<string, string>
  /** Storage state path (cookies + localStorage) for auth persistence. */
  storageStatePath?: string
  /** SlowMo in ms — slows each action for debugging. */
  slowMo?: number
}

export interface SessionInfo {
  name: string
  createdAt: string
  lastUsedAt: string
  url: string | null
  title: string | null
  viewport: { width: number; height: number } | null
  closed: boolean
}

export interface ElementInfo {
  tag: string
  text: string
  attrs: Record<string, string>
  box: { x: number; y: number; width: number; height: number } | null
  visible: boolean
  disabled: boolean
  /** CSS path for re-selecting. */
  path: string
}

export interface DomQueryResult {
  selector: string
  matched: number
  elements: ElementInfo[]
}

export interface ClickResult {
  selector: BrowserSelector
  clicked: boolean
  element?: ElementInfo
  navigatedTo?: string
}

export interface TypeResult {
  selector: BrowserSelector
  typed: boolean
  finalValue: string
}

export interface ScrollResult {
  scrolled: boolean
  finalScrollY: number
  finalScrollX: number
}

export interface ScreenshotResult {
  path: string
  fullPage: boolean
  sizeBytes: number
  width: number
  height: number
}

export interface ConsoleEntry {
  type: "log" | "info" | "warning" | "error" | "debug"
  text: string
  url?: string
  line?: number
  location?: string
}

export interface NetworkRequest {
  method: string
  url: string
  resourceType: string
  status: number | null
  method_status: string
  durationMs: number | null
  requestHeaders: Record<string, string>
  requestBody?: string
  responseBody?: string
  failed: boolean
  failure?: string
}

export interface FormTestStep {
  selector: BrowserSelector
  value: string
}

export interface FormTestResult {
  filled: number
  submitted: boolean
  finalUrl: string
  title: string
  errors: string[]
  durationMs: number
}

export interface WebAppTestStep {
  action: "navigate" | "click" | "type" | "scroll" | "wait" | "assert" | "screenshot"
  selector?: BrowserSelector
  value?: string
  amount?: number
  ms?: number
  /** For assert action: "url" | "title" | "text" | "visible" | "hidden" */
  assert?: string
  expected?: string
}

export interface WebAppTestResult {
  stepsTotal: number
  stepsPassed: number
  stepsFailed: number
  failure?: { stepIndex: number; reason: string }
  finalUrl: string
  finalTitle: string
  durationMs: number
  screenshots: string[]
}

export interface MultiNavResult {
  visited: Array<{ url: string; status: "ok" | "fail"; title?: string; error?: string; durationMs: number }>
  totalDurationMs: number
}

export interface AuthSessionResult {
  loggedIn: boolean
  storageStatePath: string
  cookiesCount: number
  localStorageCount: number
  finalUrl: string
  finalTitle: string
}

export interface BrowserProfile {
  name: string
  path: string
  createdAt: string
  sizeBytes: number
  hasCookies: boolean
}

export type BrowserResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string }

// ---------------------------------------------------------------------------
// Session manager — persistent browser instances by name
// ---------------------------------------------------------------------------

interface BrowserSession {
  name: string
  browser: Browser
  context: BrowserContext
  page: Page
  createdAt: string
  lastUsedAt: string
  closed: boolean
  consoleBuffer: ConsoleEntry[]
  networkBuffer: NetworkRequest[]
}

const sessions = new Map<string, BrowserSession>()

function nowISO(): string {
  return new Date().toISOString()
}

function touch(s: BrowserSession): void {
  s.lastUsedAt = nowISO()
}

async function requireSession(name?: string): Promise<BrowserSession> {
  const s = sessions.get(name ?? "default")
  if (!s) {
    throw new Error(`❌ الجلسة غير موجودة: ${name ?? "default"} / session not found`)
  }
  if (s.closed) {
    throw new Error(`❌ الجلسة مغلقة: ${name ?? "default"} / session closed`)
  }
  touch(s)
  return s
}

// ---------------------------------------------------------------------------
// 1. Browser Launch
// ---------------------------------------------------------------------------

export async function browserLaunch(opts: LaunchOptions = {}): Promise<BrowserResult<SessionInfo>> {
  const name = opts.session ?? "default"
  try {
    // Close existing session with the same name (no duplicate).
    const existing = sessions.get(name)
    if (existing && !existing.closed) {
      await existing.browser.close().catch(() => {})
      sessions.delete(name)
    }

    const launchOpts: Parameters<typeof chromium.launch>[0] = {
      headless: opts.headless ?? true,
      slowMo: opts.slowMo ?? 0,
    }
    const browser = await chromium.launch(launchOpts)

    const contextOpts: Record<string, unknown> = {
      viewport: opts.viewport ?? { width: 1280, height: 720 },
      locale: opts.locale ?? "en-US",
    }
    if (opts.userAgent) contextOpts.userAgent = opts.userAgent
    if (opts.timezone) contextOpts.timezoneId = opts.timezone
    if (opts.extraHeaders) contextOpts.extraHTTPHeaders = opts.extraHeaders
    if (opts.storageStatePath && existsSync(opts.storageStatePath)) {
      contextOpts.storageState = opts.storageStatePath
    }
    const context = await browser.newContext(contextOpts as Parameters<Browser["newContext"]>[0])

    // Block resources for speed.
    if (opts.blockedResources && opts.blockedResources.length > 0) {
      await context.route("**/*", (route) => {
        const type = route.request().resourceType()
        if (opts.blockedResources!.includes(type as "image" | "stylesheet" | "font" | "media")) {
          return route.abort()
        }
        return route.continue()
      })
    }

    const page = await context.newPage()

    const session: BrowserSession = {
      name,
      browser,
      context,
      page,
      createdAt: nowISO(),
      lastUsedAt: nowISO(),
      closed: false,
      consoleBuffer: [],
      networkBuffer: [],
    }

    // Wire up console + network capture.
    page.on("console", (msg) => {
      const type = msg.type() as ConsoleEntry["type"]
      const text = msg.text()
      const loc = msg.location()
      session.consoleBuffer.push({
        type,
        text,
        url: loc.url,
        line: loc.lineNumber,
        location: `${loc.url}:${loc.lineNumber}`,
      })
    })
    page.on("pageerror", (err) => {
      session.consoleBuffer.push({
        type: "error",
        text: err.message,
        location: err.stack?.split("\n")[1]?.trim(),
      })
    })
    page.on("request", (req) => {
      session.networkBuffer.push({
        method: req.method(),
        url: req.url(),
        resourceType: req.resourceType(),
        status: null,
        method_status: `${req.method()} ?`,
        durationMs: null,
        requestHeaders: req.headers(),
        requestBody: req.postData() ?? undefined,
        failed: false,
      })
    })
    page.on("response", async (res) => {
      const req = res.request()
      for (let i = session.networkBuffer.length - 1; i >= 0; i--) {
        const r = session.networkBuffer[i]
        if (r.url === req.url() && r.method === req.method() && r.status === null) {
          r.status = res.status()
          r.method_status = `${r.method} ${res.status()}`
          try {
            const body = await res.body().catch(() => null)
            r.responseBody = body ? body.toString("utf-8").slice(0, 2000) : undefined
          } catch {
            /* ignore */
          }
          break
        }
      }
    })
    page.on("requestfailed", (req) => {
      for (let i = session.networkBuffer.length - 1; i >= 0; i--) {
        const r = session.networkBuffer[i]
        if (r.url === req.url() && r.method === req.method() && r.status === null) {
          r.failed = true
          r.failure = req.failure()?.errorText
          r.method_status = `${r.method} FAIL`
          break
        }
      }
    })

    sessions.set(name, session)

    return {
      ok: true,
      data: {
        name,
        createdAt: session.createdAt,
        lastUsedAt: session.lastUsedAt,
        url: null,
        title: null,
        viewport: opts.viewport ?? { width: 1280, height: 720 },
        closed: false,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "launch_failed",
      message: `❌ فشل تشغيل المتصفح / launch failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: resolve a BrowserSelector to a Playwright locator or xy.
// ---------------------------------------------------------------------------

async function resolveSelector(
  page: Page,
  sel: BrowserSelector
): Promise<{ locator: ReturnType<Page["locator"]> | null; xy?: { x: number; y: number } }> {
  switch (sel.kind) {
    case "css":
      return { locator: page.locator(sel.value) }
    case "text":
      return { locator: page.locator(`text=${sel.value}`) }
    case "role": {
      // Playwright getByRole is strongly typed; cast through unknown for our string input.
      const role = sel.value as "button" | "link" | "textbox" | "checkbox" | "radio" | "heading" | "navigation" | "menuitem"
      const locator = sel.name
        ? page.getByRole(role, { name: sel.name })
        : page.getByRole(role)
      return { locator }
    }
    case "testid":
      return { locator: page.getByTestId(sel.value) }
    case "xpath":
      return { locator: page.locator(`xpath=${sel.value}`) }
    case "xy": {
      const parts = sel.value.split(",").map((p) => Number(p.trim()))
      if (parts.length !== 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return { locator: null }
      return { locator: null, xy: { x: parts[0], y: parts[1] } }
    }
    default:
      return { locator: null }
  }
}

async function describeElement(
  page: Page,
  locator: ReturnType<Page["locator"]>
): Promise<ElementInfo> {
  const handle = await locator.elementHandle().catch(() => null)
  if (!handle) {
    return { tag: "?", text: "", attrs: {}, box: null, visible: false, disabled: true, path: "?" }
  }
  const info = await page.evaluate((el) => {
    const tag = el.tagName.toLowerCase()
    const text = (el.textContent || "").trim().slice(0, 500)
    const attrs: Record<string, string> = {}
    for (const a of Array.from(el.attributes)) {
      attrs[a.name] = a.value
    }
    const rect = el.getBoundingClientRect()
    const box = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    const pathSegs: string[] = []
    let cur: Element | null = el
    while (cur && cur !== document.body) {
      const t = cur.tagName.toLowerCase()
      const id = cur.id ? `#${cur.id}` : ""
      const cls = cur.classList.length ? `.${Array.from(cur.classList).slice(0, 2).join(".")}` : ""
      pathSegs.unshift(`${t}${id}${cls}`)
      cur = cur.parentElement
    }
    pathSegs.unshift("body")
    const path = pathSegs.join(" > ")
    return {
      tag,
      text,
      attrs,
      box,
      visible: rect.width > 0 && rect.height > 0,
      disabled: (el as HTMLButtonElement).disabled ?? false,
      path,
    }
  }, handle)
  await handle.dispose()
  return info
}

// ---------------------------------------------------------------------------
// 2. URL Navigation
// ---------------------------------------------------------------------------

export async function browserNavigate(
  url: string,
  sessionName?: string,
  opts: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeoutMs?: number } = {}
): Promise<BrowserResult<{ url: string; title: string; finalUrl: string }>> {
  try {
    const s = await requireSession(sessionName)
    const finalUrl = await s.page.goto(url, {
      waitUntil: opts.waitUntil ?? "domcontentloaded",
      timeout: opts.timeoutMs ?? 30000,
    })
    const title = await s.page.title()
    return {
      ok: true,
      data: { url, title, finalUrl: finalUrl?.toString() ?? s.page.url() },
    }
  } catch (e) {
    return {
      ok: false,
      error: "navigate_failed",
      message: `❌ فشل التنقل / navigate failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Page Inspection
// ---------------------------------------------------------------------------

export async function browserInspectPage(sessionName?: string): Promise<BrowserResult<{
  url: string
  finalUrl: string
  title: string
  meta: Array<{ name: string; content: string }>
  viewport: { width: number; height: number }
  headings: Array<{ level: number; text: string }>
  paragraphs: string[]
  links: Array<{ text: string; href: string }>
  visibleText: string
}>> {
  try {
    const s = await requireSession(sessionName)
    const url = s.page.url()
    const title = await s.page.title()
    const viewport = s.page.viewportSize() ?? { width: 0, height: 0 }
    const data = await s.page.evaluate(() => {
      const meta = Array.from(document.querySelectorAll("meta")).map((m) => ({
        name: m.getAttribute("name") || m.getAttribute("property") || "",
        content: m.getAttribute("content") || "",
      })).filter((m) => m.name)
      const headings = Array.from(document.querySelectorAll("h1, h2, h3")).map((h) => ({
        level: Number(h.tagName.slice(1)),
        text: (h.textContent || "").trim().slice(0, 200),
      })).filter((h) => h.text)
      const paragraphs = Array.from(document.querySelectorAll("p")).map((p) =>
        (p.textContent || "").trim()
      ).filter(Boolean).slice(0, 10)
      const links = Array.from(document.querySelectorAll("a[href]")).slice(0, 20).map((a) => ({
        text: (a.textContent || "").trim().slice(0, 100),
        href: (a as HTMLAnchorElement).href,
      })).filter((l) => l.href)
      const visibleText = (document.body?.innerText || "").slice(0, 5000)
      return { meta, headings, paragraphs, links, visibleText }
    })
    return {
      ok: true,
      data: { url, finalUrl: url, title, viewport, ...data },
    }
  } catch (e) {
    return {
      ok: false,
      error: "inspect_page_failed",
      message: `❌ فشل فحص الصفحة / page inspect failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 4. DOM Inspection
// ---------------------------------------------------------------------------

export async function browserInspectDom(
  selector: string,
  sessionName?: string,
  limit = 20
): Promise<BrowserResult<DomQueryResult>> {
  try {
    const s = await requireSession(sessionName)
    const loc = s.page.locator(selector)
    const count = await loc.count().catch(() => 0)
    const elements: ElementInfo[] = []
    const cap = Math.min(count, limit)
    for (let i = 0; i < cap; i++) {
      const info = await describeElement(s.page, loc.nth(i))
      elements.push(info)
    }
    return {
      ok: true,
      data: { selector, matched: count, elements },
    }
  } catch (e) {
    return {
      ok: false,
      error: "dom_inspect_failed",
      message: `❌ فشل فحص DOM / dom inspect failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Element Selection
// ---------------------------------------------------------------------------

export async function browserSelectElement(
  sel: BrowserSelector,
  sessionName?: string
): Promise<BrowserResult<ElementInfo>> {
  try {
    const s = await requireSession(sessionName)
    const { locator, xy } = await resolveSelector(s.page, sel)
    if (xy) {
      const cap = await s.page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y)
        if (!el) return null
        return el.tagName.toLowerCase()
      }, xy)
      return {
        ok: true,
        data: {
          tag: cap ?? "?",
          text: `(xy: ${xy.x},${xy.y})`,
          attrs: {},
          box: { x: xy.x, y: xy.y, width: 0, height: 0 },
          visible: true,
          disabled: false,
          path: `xy:${xy.x},${xy.y}`,
        },
      }
    }
    if (!locator) {
      return { ok: false, error: "bad_selector", message: "❌ محدد غير صالح / invalid selector" }
    }
    const count = await locator.count().catch(() => 0)
    if (count === 0) {
      return {
        ok: false,
        error: "not_found",
        message: `❌ لا عنصر مطابق / no matching element: ${sel.kind}=${sel.value}`,
      }
    }
    const info = await describeElement(s.page, locator.first())
    return { ok: true, data: info }
  } catch (e) {
    return {
      ok: false,
      error: "select_failed",
      message: `❌ فشل الاختيار / select failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Click
// ---------------------------------------------------------------------------

export async function browserClick(
  sel: BrowserSelector,
  sessionName?: string,
  opts: { timeoutMs?: number; modifiers?: Array<"Shift" | "Control" | "Alt" | "Meta">; double?: boolean } = {}
): Promise<BrowserResult<ClickResult>> {
  try {
    const s = await requireSession(sessionName)
    const { locator, xy } = await resolveSelector(s.page, sel)
    const urlBefore = s.page.url()

    if (xy) {
      await s.page.mouse.click(xy.x, xy.y, {
        button: "left",
        clickCount: opts.double ? 2 : 1,
      })
    } else if (!locator) {
      return { ok: false, error: "bad_selector", message: "❌ محدد غير صالح / invalid selector" }
    } else {
      const first = locator.first()
      await first.click({
        timeout: opts.timeoutMs ?? 10000,
        modifiers: opts.modifiers,
        clickCount: opts.double ? 2 : 1,
      })
    }

    const urlAfter = s.page.url()
    let element: ElementInfo | undefined
    if (locator) {
      try {
        element = await describeElement(s.page, locator.first())
      } catch {
        /* element may have detached after click */
      }
    }

    return {
      ok: true,
      data: {
        selector: sel,
        clicked: true,
        element,
        navigatedTo: urlBefore !== urlAfter ? urlAfter : undefined,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "click_failed",
      message: `❌ فشل النقر / click failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Type
// ---------------------------------------------------------------------------

export async function browserType(
  sel: BrowserSelector,
  text: string,
  sessionName?: string,
  opts: { delayMs?: number; clearFirst?: boolean; timeoutMs?: number } = {}
): Promise<BrowserResult<TypeResult>> {
  try {
    const s = await requireSession(sessionName)
    const { locator } = await resolveSelector(s.page, sel)
    if (!locator) {
      return { ok: false, error: "bad_selector", message: "❌ محدد غير صالح / invalid selector" }
    }
    const first = locator.first()
    if (opts.clearFirst ?? true) {
      await first.fill("").catch(() => {})
    }
    await first.type(text, {
      delay: opts.delayMs ?? 0,
      timeout: opts.timeoutMs ?? 15000,
    })
    const finalValue = (await first.inputValue().catch(() => "")) as string
    return {
      ok: true,
      data: { selector: sel, typed: true, finalValue },
    }
  } catch (e) {
    return {
      ok: false,
      error: "type_failed",
      message: `❌ فشل الكتابة / type failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 8. Scroll
// ---------------------------------------------------------------------------

export async function browserScroll(
  opts: { x?: number; y?: number; selector?: string; toSelector?: BrowserSelector; session?: string } = {}
): Promise<BrowserResult<ScrollResult>> {
  try {
    const s = await requireSession(opts.session)
    if (opts.toSelector) {
      const { locator } = await resolveSelector(s.page, opts.toSelector)
      if (!locator) {
        return { ok: false, error: "bad_selector", message: "❌ محدد غير صالح / invalid selector" }
      }
      await locator.first().scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => {})
    } else if (opts.selector) {
      const loc = s.page.locator(opts.selector).first()
      await loc.scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => {})
    } else {
      const x = opts.x ?? 0
      const y = opts.y ?? 500
      await s.page.mouse.wheel(x, y)
    }
    const pos = await s.page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
    return {
      ok: true,
      data: { scrolled: true, finalScrollY: pos.y, finalScrollX: pos.x },
    }
  } catch (e) {
    return {
      ok: false,
      error: "scroll_failed",
      message: `❌ فشل التمرير / scroll failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 9. Screenshot
// ---------------------------------------------------------------------------

export async function browserScreenshot(
  opts: { fullPage?: boolean; session?: string; filename?: string; selector?: string } = {}
): Promise<BrowserResult<ScreenshotResult>> {
  try {
    const s = await requireSession(opts.session)
    const dir = path.join(WORKSPACE_ROOT, "upload", "browser")
    if (!existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true })
    }
    const filename = opts.filename ?? `shot-${Date.now()}.png`
    const filepath = path.join(dir, filename)
    const shotOpts: Record<string, unknown> = {
      path: filepath,
      fullPage: opts.fullPage ?? false,
      type: "png",
    }
    if (opts.selector) {
      const loc = s.page.locator(opts.selector).first()
      await loc.screenshot(shotOpts as Parameters<ReturnType<Page["locator"]>["screenshot"]>[0])
    } else {
      await s.page.screenshot(shotOpts as Parameters<Page["screenshot"]>[0])
    }
    const stats = await fs.stat(filepath)
    const vp = s.page.viewportSize() ?? { width: 0, height: 0 }
    return {
      ok: true,
      data: {
        path: path.relative(WORKSPACE_ROOT, filepath),
        fullPage: opts.fullPage ?? false,
        sizeBytes: stats.size,
        width: vp.width,
        height: vp.height,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "screenshot_failed",
      message: `❌ فشل لقطة الشاشة / screenshot failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 10. Console Inspection
// ---------------------------------------------------------------------------

export async function browserInspectConsole(
  sessionName?: string,
  opts: { type?: ConsoleEntry["type"]; since?: number; limit?: number } = {}
): Promise<BrowserResult<{ entries: ConsoleEntry[]; total: number; returned: number }>> {
  try {
    const s = await requireSession(sessionName)
    let entries = s.consoleBuffer
    if (opts.type) {
      entries = entries.filter((e) => e.type === opts.type)
    }
    if (typeof opts.since === "number") {
      entries = entries.slice(opts.since)
    }
    const total = entries.length
    const limit = opts.limit ?? 100
    const returned = Math.min(total, limit)
    return {
      ok: true,
      data: { entries: entries.slice(0, limit), total, returned },
    }
  } catch (e) {
    return {
      ok: false,
      error: "console_inspect_failed",
      message: `❌ فشل فحص الكونسول / console inspect failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function browserClearConsole(sessionName?: string): Promise<BrowserResult<{ cleared: number }>> {
  try {
    const s = await requireSession(sessionName)
    const cleared = s.consoleBuffer.length
    s.consoleBuffer = []
    return { ok: true, data: { cleared } }
  } catch (e) {
    return {
      ok: false,
      error: "clear_console_failed",
      message: `❌ فشل مسح الكونسول / clear console failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 11. Network Inspection
// ---------------------------------------------------------------------------

export async function browserInspectNetwork(
  sessionName?: string,
  opts: { urlContains?: string; method?: string; resourceType?: string; status?: number; failedOnly?: boolean; limit?: number } = {}
): Promise<BrowserResult<{ requests: NetworkRequest[]; total: number; returned: number }>> {
  try {
    const s = await requireSession(sessionName)
    let requests = s.networkBuffer
    if (opts.urlContains) {
      requests = requests.filter((r) => r.url.includes(opts.urlContains!))
    }
    if (opts.method) {
      requests = requests.filter((r) => r.method === opts.method)
    }
    if (opts.resourceType) {
      requests = requests.filter((r) => r.resourceType === opts.resourceType)
    }
    if (typeof opts.status === "number") {
      requests = requests.filter((r) => r.status === opts.status)
    }
    if (opts.failedOnly) {
      requests = requests.filter((r) => r.failed)
    }
    const total = requests.length
    const limit = opts.limit ?? 50
    const returned = Math.min(total, limit)
    return {
      ok: true,
      data: { requests: requests.slice(0, limit), total, returned },
    }
  } catch (e) {
    return {
      ok: false,
      error: "network_inspect_failed",
      message: `❌ فشل فحص الشبكة / network inspect failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function browserClearNetwork(sessionName?: string): Promise<BrowserResult<{ cleared: number }>> {
  try {
    const s = await requireSession(sessionName)
    const cleared = s.networkBuffer.length
    s.networkBuffer = []
    return { ok: true, data: { cleared } }
  } catch (e) {
    return {
      ok: false,
      error: "clear_network_failed",
      message: `❌ فشل مسح الشبكة / clear network failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 12. Form Testing
// ---------------------------------------------------------------------------

export async function browserTestForm(
  opts: {
    fields: FormTestStep[]
    submit?: BrowserSelector
    session?: string
    expectNavigation?: boolean
    timeoutMs?: number
  }
): Promise<BrowserResult<FormTestResult>> {
  const start = Date.now()
  try {
    const s = await requireSession(opts.session)
    const errors: string[] = []
    let filled = 0
    for (const step of opts.fields) {
      const res = await browserType(step.selector, step.value, opts.session)
      if (res.ok) filled++
      else errors.push(`field ${step.selector.kind}=${step.selector.value}: ${res.message}`)
    }
    let submitted = false
    if (opts.submit) {
      const clickRes = await browserClick(opts.submit, opts.session, { timeoutMs: opts.timeoutMs ?? 15000 })
      submitted = clickRes.ok
      if (!clickRes.ok) errors.push(`submit: ${clickRes.message}`)
      if (opts.expectNavigation ?? true) {
        try {
          await s.page.waitForLoadState("domcontentloaded", { timeout: opts.timeoutMs ?? 15000 })
        } catch {
          /* might not navigate */
        }
      }
    }
    const finalUrl = s.page.url()
    const title = await s.page.title().catch(() => "")
    return {
      ok: true,
      data: {
        filled,
        submitted,
        finalUrl,
        title,
        errors,
        durationMs: Date.now() - start,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "form_test_failed",
      message: `❌ فشل اختبار النموذج / form test failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 13. Web App Testing — multi-step script
// ---------------------------------------------------------------------------

export async function browserTestWebApp(
  steps: WebAppTestStep[],
  sessionName?: string
): Promise<BrowserResult<WebAppTestResult>> {
  const start = Date.now()
  try {
    const s = await requireSession(sessionName)
    let passed = 0
    let failed = 0
    const screenshots: string[] = []
    let failure: { stepIndex: number; reason: string } | undefined

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      try {
        switch (step.action) {
          case "navigate": {
            if (!step.value) throw new Error("value (url) required")
            await s.page.goto(step.value, { waitUntil: "domcontentloaded", timeout: 30000 })
            break
          }
          case "click": {
            if (!step.selector) throw new Error("selector required")
            const r = await browserClick(step.selector, sessionName)
            if (!r.ok) throw new Error(r.message)
            break
          }
          case "type": {
            if (!step.selector || step.value === undefined) throw new Error("selector + value required")
            const r = await browserType(step.selector, step.value, sessionName)
            if (!r.ok) throw new Error(r.message)
            break
          }
          case "scroll": {
            await s.page.mouse.wheel(step.amount ?? 500, step.amount ?? 500)
            break
          }
          case "wait": {
            await s.page.waitForTimeout(step.ms ?? 1000)
            break
          }
          case "assert": {
            if (!step.assert || !step.expected) throw new Error("assert + expected required")
            switch (step.assert) {
              case "url": {
                if (!s.page.url().includes(step.expected)) {
                  throw new Error(`url "${s.page.url()}" does not contain "${step.expected}"`)
                }
                break
              }
              case "title": {
                const t = await s.page.title()
                if (!t.includes(step.expected)) {
                  throw new Error(`title "${t}" does not contain "${step.expected}"`)
                }
                break
              }
              case "text": {
                const found = await s.page.getByText(step.expected).count()
                if (found === 0) throw new Error(`text "${step.expected}" not found`)
                break
              }
              case "visible": {
                if (!step.selector) throw new Error("selector required for visible assert")
                const { locator } = await resolveSelector(s.page, step.selector)
                if (!locator) throw new Error("bad selector")
                const visible = await locator.first().isVisible().catch(() => false)
                if (!visible) throw new Error(`element not visible`)
                break
              }
              case "hidden": {
                if (!step.selector) throw new Error("selector required for hidden assert")
                const { locator } = await resolveSelector(s.page, step.selector)
                if (!locator) throw new Error("bad selector")
                const visible = await locator.first().isVisible().catch(() => false)
                if (visible) throw new Error(`element still visible`)
                break
              }
              default:
                throw new Error(`unknown assert: ${step.assert}`)
            }
            break
          }
          case "screenshot": {
            const r = await browserScreenshot({ session: sessionName, filename: `test-step-${i}-${Date.now()}.png` })
            if (r.ok) screenshots.push(r.data.path)
            break
          }
          default:
            throw new Error(`unknown action: ${step.action}`)
        }
        passed++
      } catch (e) {
        failed++
        failure = { stepIndex: i, reason: e instanceof Error ? e.message : String(e) }
        break
      }
    }

    const finalUrl = s.page.url()
    const finalTitle = await s.page.title().catch(() => "")
    return {
      ok: true,
      data: {
        stepsTotal: steps.length,
        stepsPassed: passed,
        stepsFailed: failed,
        failure,
        finalUrl,
        finalTitle,
        durationMs: Date.now() - start,
        screenshots,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "webapp_test_failed",
      message: `❌ فشل اختبار التطبيق / webapp test failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 14. Multi-Page Navigation
// ---------------------------------------------------------------------------

export async function browserNavigateMulti(
  urls: string[],
  sessionName?: string,
  opts: { waitMs?: number; waitUntil?: "load" | "domcontentloaded" | "networkidle" } = {}
): Promise<BrowserResult<MultiNavResult>> {
  const start = Date.now()
  try {
    const s = await requireSession(sessionName)
    const visited: MultiNavResult["visited"] = []
    for (const url of urls) {
      const t0 = Date.now()
      try {
        await s.page.goto(url, {
          waitUntil: opts.waitUntil ?? "domcontentloaded",
          timeout: 30000,
        })
        const title = await s.page.title().catch(() => "")
        visited.push({ url, status: "ok", title, durationMs: Date.now() - t0 })
        if (opts.waitMs) await s.page.waitForTimeout(opts.waitMs)
      } catch (e) {
        visited.push({
          url,
          status: "fail",
          error: e instanceof Error ? e.message : String(e),
          durationMs: Date.now() - t0,
        })
      }
    }
    return {
      ok: true,
      data: { visited, totalDurationMs: Date.now() - start },
    }
  } catch (e) {
    return {
      ok: false,
      error: "multi_nav_failed",
      message: `❌ فشل التنقل المتعدد / multi-nav failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 15. Authentication Session
// ---------------------------------------------------------------------------

export async function browserAuthSession(
  opts: {
    loginUrl: string
    steps: WebAppTestStep[]
    storageStatePath: string
    successSelector?: BrowserSelector
    session?: string
  }
): Promise<BrowserResult<AuthSessionResult>> {
  try {
    const s = await requireSession(opts.session)
    const nav = await browserNavigate(opts.loginUrl, opts.session)
    if (!nav.ok) throw new Error(nav.message)

    const test = await browserTestWebApp(opts.steps, opts.session)
    if (!test.ok) throw new Error(test.message)

    let loggedIn = true
    if (opts.successSelector) {
      const sel = await browserSelectElement(opts.successSelector, opts.session)
      loggedIn = sel.ok
    }

    const absPath = path.isAbsolute(opts.storageStatePath)
      ? opts.storageStatePath
      : path.resolve(WORKSPACE_ROOT, opts.storageStatePath)
    await fs.mkdir(path.dirname(absPath), { recursive: true })
    await s.context.storageState({ path: absPath })

    const cookies = await s.context.cookies()
    const localStorageData = await s.page.evaluate(() => {
      return Array.from(Object.keys(window.localStorage)).length
    }).catch(() => 0)

    const finalUrl = s.page.url()
    const finalTitle = await s.page.title().catch(() => "")

    return {
      ok: true,
      data: {
        loggedIn,
        storageStatePath: path.relative(WORKSPACE_ROOT, absPath),
        cookiesCount: cookies.length,
        localStorageCount: localStorageData,
        finalUrl,
        finalTitle,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "auth_session_failed",
      message: `❌ فشل جلسة المصادقة / auth session failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 16. Browser Profiles
// ---------------------------------------------------------------------------

const PROFILES_DIR = ".browser-profiles"

export async function browserProfilesList(): Promise<BrowserResult<BrowserProfile[]>> {
  try {
    const root = path.resolve(WORKSPACE_ROOT)
    const dir = path.join(root, PROFILES_DIR)
    if (!existsSync(dir)) return { ok: true, data: [] }
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const profiles: BrowserProfile[] = []
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      const p = path.join(dir, ent.name)
      try {
        const stat = await fs.stat(p)
        const stateFile = path.join(p, "state.json")
        const hasCookies = existsSync(stateFile)
        profiles.push({
          name: ent.name,
          path: path.relative(root, p),
          createdAt: stat.birthtime.toISOString(),
          sizeBytes: stat.size,
          hasCookies,
        })
      } catch {
        /* skip */
      }
    }
    return { ok: true, data: profiles }
  } catch (e) {
    return {
      ok: false,
      error: "profiles_list_failed",
      message: `❌ فشل سرد البروفايلات / profiles list failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function browserProfileCreate(name: string): Promise<BrowserResult<BrowserProfile>> {
  try {
    const root = path.resolve(WORKSPACE_ROOT)
    const dir = path.join(root, PROFILES_DIR, name)
    await fs.mkdir(dir, { recursive: true })
    const stateFile = path.join(dir, "state.json")
    await fs.writeFile(stateFile, JSON.stringify({ cookies: [], origins: [] }, null, 2))
    const stat = await fs.stat(dir)
    return {
      ok: true,
      data: {
        name,
        path: path.relative(root, dir),
        createdAt: stat.birthtime.toISOString(),
        sizeBytes: stat.size,
        hasCookies: true,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "profile_create_failed",
      message: `❌ فشل إنشاء البروفايل / profile create failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function browserProfileDelete(name: string): Promise<BrowserResult<{ deleted: boolean }>> {
  try {
    const root = path.resolve(WORKSPACE_ROOT)
    const dir = path.join(root, PROFILES_DIR, name)
    if (!existsSync(dir)) {
      return { ok: false, error: "not_found", message: `❌ البروفايل غير موجود / profile not found: ${name}` }
    }
    await fs.rm(dir, { recursive: true, force: true })
    return { ok: true, data: { deleted: true } }
  } catch (e) {
    return {
      ok: false,
      error: "profile_delete_failed",
      message: `❌ فشل حذف البروفايل / profile delete failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Session management — list, close, close-all
// ---------------------------------------------------------------------------

export async function browserSessionsList(): Promise<BrowserResult<SessionInfo[]>> {
  try {
    const out: SessionInfo[] = []
    for (const s of sessions.values()) {
      let url: string | null = null
      let title: string | null = null
      if (!s.closed) {
        try {
          url = s.page.url()
          title = await s.page.title().catch(() => null)
        } catch {
          /* page gone */
        }
      }
      out.push({
        name: s.name,
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt,
        url,
        title,
        viewport: s.page.viewportSize() ?? null,
        closed: s.closed,
      })
    }
    return { ok: true, data: out }
  } catch (e) {
    return {
      ok: false,
      error: "sessions_list_failed",
      message: `❌ فشل سرد الجلسات / sessions list failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function browserSessionClose(name?: string): Promise<BrowserResult<{ closed: boolean }>> {
  try {
    const s = sessions.get(name ?? "default")
    if (!s) return { ok: false, error: "not_found", message: `❌ الجلسة غير موجودة / session not found: ${name}` }
    if (s.closed) return { ok: true, data: { closed: true } }
    await s.browser.close().catch(() => {})
    s.closed = true
    return { ok: true, data: { closed: true } }
  } catch (e) {
    return {
      ok: false,
      error: "session_close_failed",
      message: `❌ فشل إغلاق الجلسة / session close failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function browserCloseAll(): Promise<BrowserResult<{ closed: number }>> {
  let count = 0
  for (const name of Array.from(sessions.keys())) {
    const r = await browserSessionClose(name)
    if (r.ok && r.data.closed) count++
    sessions.delete(name)
  }
  return { ok: true, data: { closed: count } }
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

export function formatBrowserResult<T>(result: BrowserResult<T>): string {
  if (!result.ok) {
    return `${result.message}\n[error: ${result.error}]`
  }
  const data = result.data as unknown
  if (data === null || data === undefined) return "✅ OK"
  if (typeof data === "string") return data
  if (typeof data === "number" || typeof data === "boolean") return String(data)
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}
