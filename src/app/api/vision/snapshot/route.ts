// /api/vision/snapshot
//   GET  — list recent vision analyses (snapshot)
//   POST — capture a fresh screenshot via Playwright + (optional) analyze it via VLM.
//
// Before this, only GET existed — the "screenshot → analyze" crown jewel was
// unreachable from the API. Now the full loop works end-to-end.
import { NextRequest, NextResponse } from "next/server"
import { visionSnapshot, screenshotAnalyze } from "@/lib/vision/os"
import { browserScreenshot, browserNavigate, browserLaunch } from "@/lib/browser/agent"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

// GET — read-only snapshot of recent analyses (unchanged behavior)
export async function GET() {
  try {
    const res = await visionSnapshot()
    return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// Ensure a browser session exists; launch on-demand if missing.
async function ensureSession(sessionName: string) {
  // Try a no-op navigate to a blank page to check if session is alive.
  // If it fails, launch a fresh session.
  try {
    const test = await browserScreenshot({ session: sessionName, filename: `probe-${Date.now()}.png` })
    if (test.ok) return { ok: true, alreadyRunning: true }
  } catch {
    /* fall through to launch */
  }
  const launch = await browserLaunch({ session: sessionName, headless: true })
  return { ok: launch.ok, alreadyRunning: false, error: launch.ok ? undefined : launch.message }
}

// POST — capture a live screenshot of a URL, optionally analyze it.
// Body:
//   { url: string, analyze?: boolean, context?: string, conversationId?: string }
// Returns:
//   { ok: true, screenshotPath, analysisId? } | { ok: false, error }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const url = String(body.url || "").trim()
    if (!url) {
      return NextResponse.json(
        { error: "url مطلوب / url is required" },
        { status: 400 }
      )
    }

    const sessionName = body.session ?? "snapshot"

    // 0) Ensure the browser session exists (launch on demand)
    const sess = await ensureSession(sessionName)
    if (!sess.ok) {
      return NextResponse.json(
        { error: sess.error ?? "failed to launch browser", step: "launch" },
        { status: 502 }
      )
    }

    // 1) Navigate + capture screenshot via Playwright
    const navRes = await browserNavigate(url, sessionName)
    if (!navRes.ok) {
      return NextResponse.json(
        { error: navRes.message, step: "navigate" },
        { status: 502 }
      )
    }

    const shotRes = await browserScreenshot({
      session: sessionName,
      filename: `snapshot-${Date.now()}.png`,
      fullPage: body.fullPage ?? true,
    })
    if (!shotRes.ok) {
      return NextResponse.json(
        { error: shotRes.message, step: "screenshot" },
        { status: 502 }
      )
    }

    const screenshotPath = shotRes.data.path
    const result: {
      url: string
      title: string | null
      screenshotPath: string
      analysisId?: string
      analysis?: unknown
    } = {
      url: navRes.data.url,
      title: navRes.data.title,
      screenshotPath,
    }

    // 2) Optional: analyze the screenshot with VLM
    if (body.analyze) {
      const analyzeRes = await screenshotAnalyze(
        { path: screenshotPath },
        { context: body.context, conversationId: body.conversationId }
      )
      if (analyzeRes.ok) {
        result.analysisId = analyzeRes.data.analysisId
        result.analysis = analyzeRes.data
      } else {
        // Screenshot succeeded, but analysis failed — still return the screenshot.
        result.analysis = { error: analyzeRes.message }
      }
    }

    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
