// Result-to-Artifact Pipeline — turn chat results into editable artifacts.
// "اعمل لي صفحة dashboard" → Generate → Artifact → Preview → Modify → Export
//
// Pipeline stages:
//   1. Parse request → determine artifact type (html, svg, code, markdown, dashboard, chart)
//   2. Generate content (deterministic templates — no LLM needed for simple cases)
//   3. Create artifact (via Artifacts OS)
//   4. Preview (sanitize for iframe)
//   5. Modify (edit + create new version)
//   6. Export (download as file)
//
// This is the "حوّل النتيجة إلى Artifact" feature.

import { db } from "@/lib/db"
import { artifactCreate, artifactEdit, artifactPreview, artifactExport } from "@/lib/artifacts/system"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ArtifactGenType =
  | "html_page"
  | "dashboard"
  | "chart"
  | "diagram"
  | "code_snippet"
  | "markdown_doc"
  | "svg_graphic"
  | "table"
  | "form"

export interface GenRequest {
  message: string
  conversationId?: string
  /** If provided, use this as the content instead of generating */
  content?: string
  /** Force a specific type */
  type?: ArtifactGenType
}

export interface PipelineResult {
  artifactId: string
  type: string
  title: string
  previewHtml: string
  version: number
  rawContent: string
  exportFormats: string[]
  stages: Array<{
    name: string
    status: "done" | "error"
    durationMs: number
    result?: string
  }>
  totalDurationMs: number
}

export type ResultArtifactResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string }

// ---------------------------------------------------------------------------
// 1. Parse request → determine artifact type
// ---------------------------------------------------------------------------

export function parseGenType(message: string): { type: ArtifactGenType; title: string; keywords: string[] } {
  const msg = message.toLowerCase()
  const keywords: string[] = []

  if (/(?:dashboard|لوحة\s*تحكم|لوحة\s*عرض)/i.test(msg)) {
    keywords.push("dashboard")
    return { type: "dashboard", title: extractTitle(message, "Dashboard"), keywords }
  }
  if (/(?:chart|رسم\s*بياني|مخطط\s*بياني|graph)/i.test(msg)) {
    keywords.push("chart")
    return { type: "chart", title: extractTitle(message, "Chart"), keywords }
  }
  if (/(?:diagram|flowchart|مخطط\s*انسيابي|مخطط\s*تدفق)/i.test(msg)) {
    keywords.push("diagram")
    return { type: "diagram", title: extractTitle(message, "Diagram"), keywords }
  }
  if (/(?:svg|رسمة|graphic|رسم\s*متججه)/i.test(msg)) {
    keywords.push("svg")
    return { type: "svg_graphic", title: extractTitle(message, "SVG"), keywords }
  }
  if (/(?:table|جدول)/i.test(msg)) {
    keywords.push("table")
    return { type: "table", title: extractTitle(message, "Table"), keywords }
  }
  if (/(?:form|نموذج|formular)/i.test(msg)) {
    keywords.push("form")
    return { type: "form", title: extractTitle(message, "Form"), keywords }
  }
  if (/(?:code|كود|function|دالة|script)/i.test(msg)) {
    keywords.push("code")
    return { type: "code_snippet", title: extractTitle(message, "Code"), keywords }
  }
  if (/(?:markdown|doc|تقرير|مستند|report)/i.test(msg)) {
    keywords.push("markdown")
    return { type: "markdown_doc", title: extractTitle(message, "Document"), keywords }
  }
  // Default: HTML page
  keywords.push("html")
  return { type: "html_page", title: extractTitle(message, "HTML Page"), keywords }
}

function extractTitle(message: string, fallback: string): string {
  // Try to extract a title from the message
  const m = message.match(/(?:صفحة|page|لوحة|dashboard|chart|diagram|جدول|نموذج|كود|code|تقرير|report)\s+(.+?)(?:\.|$)/i)
  return m?.[1]?.trim().slice(0, 80) ?? fallback
}

// ---------------------------------------------------------------------------
// 2. Generate content — deterministic templates
// ---------------------------------------------------------------------------

export function generateContent(type: ArtifactGenType, message: string, content?: string): { content: string; artifactType: string; language?: string } {
  // If content provided, use it directly
  if (content) {
    return { content, artifactType: mapType(type), language: detectLanguage(content) }
  }

  switch (type) {
    case "dashboard":
      return { content: generateDashboard(message), artifactType: "dashboard" }
    case "chart":
      return { content: generateChart(message), artifactType: "visualization" }
    case "diagram":
      return { content: generateDiagram(message), artifactType: "diagram" }
    case "svg_graphic":
      return { content: generateSvg(message), artifactType: "svg" }
    case "table":
      return { content: generateTable(message), artifactType: "html" }
    case "form":
      return { content: generateForm(message), artifactType: "html" }
    case "code_snippet":
      return { content: generateCode(message), artifactType: "code", language: "typescript" }
    case "markdown_doc":
      return { content: generateMarkdown(message), artifactType: "markdown" }
    case "html_page":
    default:
      return { content: generateHtmlPage(message), artifactType: "html" }
  }
}

function mapType(type: ArtifactGenType): string {
  const map: Record<ArtifactGenType, string> = {
    html_page: "html",
    dashboard: "dashboard",
    chart: "visualization",
    diagram: "diagram",
    code_snippet: "code",
    markdown_doc: "markdown",
    svg_graphic: "svg",
    table: "html",
    form: "html",
  }
  return map[type] ?? "html"
}

function detectLanguage(content: string): string | undefined {
  if (/\b(function|const|let|interface|type|import|export)\b/.test(content)) return "typescript"
  if (/\b(def|class|import|from|print)\b/.test(content)) return "python"
  if (/<html|<div|<span|<body/i.test(content)) return undefined // HTML
  return undefined
}

// --- Template generators ---

function generateHtmlPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(extractTitle(message, "صفحة جديدة"))}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f0f4f8; color: #1a202c; padding: 2rem; }
    h1 { color: #2d3748; margin-bottom: 1rem; }
    .card { background: white; border-radius: 12px; padding: 1.5rem; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin-bottom: 1rem; }
    .card h2 { font-size: 1.1rem; color: #4a5568; margin-bottom: 0.5rem; }
    .card p { color: #718096; line-height: 1.6; }
  </style>
</head>
<body>
  <h1>${escapeHtml(extractTitle(message, "صفحة جديدة"))}</h1>
  <div class="card">
    <h2>بطاقة 1 / Card 1</h2>
    <p>هذه صفحة مولّدة تلقائياً من طلبك. عدّل المحتوى كما تريد.</p>
    <p>This page was auto-generated from your request. Edit the content as needed.</p>
  </div>
</body>
</html>`
}

function generateDashboard(message: string): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard — ${escapeHtml(extractTitle(message, "Dashboard"))}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #1a1a2e; color: #e2e8f0; padding: 1.5rem; }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1rem; }
    .stat { background: #16213e; border-radius: 12px; padding: 1.5rem; }
    .stat .value { font-size: 2rem; font-weight: bold; }
    .stat .label { color: #8892b0; font-size: 0.85rem; }
    .chart { background: #16213e; border-radius: 12px; padding: 1.5rem; height: 300px; display: flex; align-items: end; gap: 0.5rem; }
    .bar { flex: 1; background: linear-gradient(to top, #6366f1, #818cf8); border-radius: 6px 6px 0 0; min-height: 20px; }
  </style>
</head>
<body>
  <h1>📊 ${escapeHtml(extractTitle(message, "Dashboard"))}</h1>
  <div class="grid">
    <div class="stat"><div class="value">1,247</div><div class="label">الزوار / Visitors</div></div>
    <div class="stat"><div class="value">89%</div><div class="label">معدل النجاح / Success Rate</div></div>
    <div class="stat"><div class="value">2.3s</div><div class="label">متوسط الاستجابة / Avg Response</div></div>
    <div class="stat"><div class="value">42</div><div class="label">المهام / Tasks</div></div>
  </div>
  <div class="chart">
    <div class="bar" style="height: 40%"></div>
    <div class="bar" style="height: 65%"></div>
    <div class="bar" style="height: 30%"></div>
    <div class="bar" style="height: 80%"></div>
    <div class="bar" style="height: 55%"></div>
    <div class="bar" style="height: 90%"></div>
    <div class="bar" style="height: 70%"></div>
  </div>
</body>
</html>`
}

function generateChart(message: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400">
  <rect width="800" height="400" fill="#1a1a2e" rx="12"/>
  <text x="400" y="40" text-anchor="middle" fill="#e2e8f0" font-size="20" font-weight="bold">Chart — ${escapeHtml(extractTitle(message, "Chart"))}</text>
  <g transform="translate(50, 80)">
    <rect x="0" y="200" width="80" height="100" fill="#6366f1" rx="4"/>
    <rect x="100" y="100" width="80" height="200" fill="#818cf8" rx="4"/>
    <rect x="200" y="150" width="80" height="150" fill="#6366f1" rx="4"/>
    <rect x="300" y="50" width="80" height="250" fill="#818cf8" rx="4"/>
    <rect x="400" y="120" width="80" height="180" fill="#6366f1" rx="4"/>
    <text x="40" y="320" text-anchor="middle" fill="#8892b0" font-size="12">Q1</text>
    <text x="140" y="320" text-anchor="middle" fill="#8892b0" font-size="12">Q2</text>
    <text x="240" y="320" text-anchor="middle" fill="#8892b0" font-size="12">Q3</text>
    <text x="340" y="320" text-anchor="middle" fill="#8892b0" font-size="12">Q4</text>
    <text x="440" y="320" text-anchor="middle" fill="#8892b0" font-size="12">Q5</text>
  </g>
</svg>`
}

function generateDiagram(message: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">
  <rect width="600" height="400" fill="#f8fafc" rx="12"/>
  <!-- Start -->
  <ellipse cx="300" cy="50" rx="80" ry="25" fill="#10b981" stroke="none"/>
  <text x="300" y="55" text-anchor="middle" fill="white" font-size="14">ابدأ / Start</text>
  <!-- Arrow -->
  <line x1="300" y1="75" x2="300" y2="120" stroke="#475569" stroke-width="2"/>
  <polygon points="295,115 305,115 300,125" fill="#475569"/>
  <!-- Process -->
  <rect x="220" y="130" width="160" height="50" rx="8" fill="#6366f1"/>
  <text x="300" y="160" text-anchor="middle" fill="white" font-size="14">معالجة / Process</text>
  <!-- Arrow -->
  <line x1="300" y1="180" x2="300" y2="220" stroke="#475569" stroke-width="2"/>
  <polygon points="295,215 305,215 300,225" fill="#475569"/>
  <!-- Decision -->
  <polygon points="300,230 380,280 300,330 220,280" fill="#f59e0b"/>
  <text x="300" y="285" text-anchor="middle" fill="white" font-size="14">قرار / Decision?</text>
  <!-- Yes arrow -->
  <line x1="300" y1="330" x2="300" y2="370" stroke="#10b981" stroke-width="2"/>
  <polygon points="295,365 305,365 300,375" fill="#10b981"/>
  <text x="310" y="355" fill="#10b981" font-size="12">نعم / Yes</text>
  <!-- End -->
  <ellipse cx="300" cy="385" rx="80" ry="20" fill="#ef4444" stroke="none"/>
  <text x="300" y="390" text-anchor="middle" fill="white" font-size="14">انتهى / End</text>
</svg>`
}

function generateSvg(message: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <circle cx="100" cy="100" r="80" fill="none" stroke="#6366f1" stroke-width="4"/>
  <circle cx="100" cy="100" r="50" fill="none" stroke="#818cf8" stroke-width="3"/>
  <circle cx="100" cy="100" r="20" fill="#6366f1"/>
  <text x="100" y="105" text-anchor="middle" fill="white" font-size="14">${escapeHtml(extractTitle(message, "SVG"))}</text>
</svg>`
}

function generateTable(message: string): string {
  return `<table style="width:100%;border-collapse:collapse;font-family:system-ui,sans-serif">
  <thead>
    <tr style="background:#6366f1;color:white">
      <th style="padding:12px;text-align:right">الاسم / Name</th>
      <th style="padding:12px;text-align:right">القيمة / Value</th>
      <th style="padding:12px;text-align:right">الحالة / Status</th>
    </tr>
  </thead>
  <tbody>
    <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:12px">العنصر 1</td><td style="padding:12px">100</td><td style="padding:12px">✅</td></tr>
    <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:12px">العنصر 2</td><td style="padding:12px">200</td><td style="padding:12px">⏳</td></tr>
    <tr><td style="padding:12px">العنصر 3</td><td style="padding:12px">300</td><td style="padding:12px">❌</td></tr>
  </tbody>
</table>`
}

function generateForm(message: string): string {
  return `<form style="font-family:system-ui,sans-serif;max-width:400px;margin:2rem auto;padding:2rem;background:#f8fafc;border-radius:12px">
  <h2 style="margin-bottom:1rem">${escapeHtml(extractTitle(message, "نموذج"))}</h2>
  <div style="margin-bottom:1rem">
    <label style="display:block;margin-bottom:0.5rem">الاسم / Name</label>
    <input type="text" style="width:100%;padding:0.5rem;border:1px solid #cbd5e1;border-radius:6px" placeholder="اكتب اسمك"/>
  </div>
  <div style="margin-bottom:1rem">
    <label style="display:block;margin-bottom:0.5rem">البريد / Email</label>
    <input type="email" style="width:100%;padding:0.5rem;border:1px solid #cbd5e1;border-radius:6px" placeholder="example@mail.com"/>
  </div>
  <button type="submit" style="width:100%;padding:0.75rem;background:#6366f1;color:white;border:none;border-radius:6px;cursor:pointer">إرسال / Submit</button>
</form>`
}

function generateCode(message: string): string {
  return `// ${extractTitle(message, "Generated Code")}
// Auto-generated from request: ${message.slice(0, 100)}

export function ${camelCase(extractTitle(message, "generated"))}() {
  // Implementation stub — replace with actual logic
  return { status: "ok", message: "Generated successfully" };
}`
}

function generateMarkdown(message: string): string {
  return `# ${extractTitle(message, "مستند")}

## نظرة عامة / Overview

هذا مستند مولّد تلقائياً من طلبك.
This document was auto-generated from your request.

## المحتويات / Contents

1. **المقدمة / Introduction** — نظرة عامة
2. **التفاصيل / Details** — معلومات تفصيلية
3. **الخلاصة / Conclusion** — ملخص

## المقدمة / Introduction

الطلب الأصلي: ${escapeHtml(message.slice(0, 200))}

## التفاصيل / Details

| البند | الوصف |
|---|---|
| النوع | مستند / Document |
| المصدر | محادثة / Chat |
| الحالة | مسودة / Draft |

## الخلاصة / Conclusion

عدّل هذا المستند حسب احتياجاتك.
Edit this document as needed.`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function camelCase(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase()).replace(/^[A-Z]/, c => c.toLowerCase()).replace(/[^a-zA-Z0-9]/g, "")
}

// ---------------------------------------------------------------------------
// 3. Full Pipeline — Generate → Artifact → Preview → (ready for modify/export)
// ---------------------------------------------------------------------------

export async function runResultArtifactPipeline(opts: GenRequest): Promise<ResultArtifactResult<PipelineResult>> {
  const start = Date.now()
  try {
    if (!opts.message || !opts.message.trim()) {
      return { ok: false, error: "no_message", message: "❌ لا رسالة / no message provided" }
    }

    const stages: PipelineResult["stages"] = []

    // Stage 1: Parse type
    const parseStart = Date.now()
    const { type, title } = opts.type ? { type: opts.type, title: extractTitle(opts.message, "Artifact") } : parseGenType(opts.message)
    stages.push({ name: "parse", status: "done", durationMs: Date.now() - parseStart, result: type })

    // Stage 2: Generate content
    const genStart = Date.now()
    const gen = generateContent(type, opts.message, opts.content)
    stages.push({ name: "generate", status: "done", durationMs: Date.now() - genStart, result: `${gen.content.length} chars` })

    // Stage 3: Create artifact
    const createStart = Date.now()
    const createRes = await artifactCreate({
      title,
      type: gen.artifactType as "html" | "svg" | "code" | "markdown" | "visualization" | "dashboard" | "diagram",
      content: gen.content,
      language: gen.language,
      conversationId: opts.conversationId,
    })
    if (!createRes.ok) {
      stages.push({ name: "create_artifact", status: "error", durationMs: Date.now() - createStart, result: createRes.message })
      return { ok: false, error: "create_failed", message: createRes.message }
    }
    stages.push({ name: "create_artifact", status: "done", durationMs: Date.now() - createStart, result: createRes.data.id })

    // Stage 4: Preview
    const previewStart = Date.now()
    const previewRes = await artifactPreview(createRes.data.id)
    if (!previewRes.ok) {
      stages.push({ name: "preview", status: "error", durationMs: Date.now() - previewStart, result: previewRes.message })
    } else {
      stages.push({ name: "preview", status: "done", durationMs: Date.now() - previewStart, result: "ready" })
    }

    return {
      ok: true,
      data: {
        artifactId: createRes.data.id,
        type: gen.artifactType,
        title,
        previewHtml: previewRes.ok ? previewRes.data.html : "",
        version: 1,
        rawContent: gen.content,
        exportFormats: ["raw", "html", "json", "svg"],
        stages,
        totalDurationMs: Date.now() - start,
      },
    }
  } catch (e) {
    return { ok: false, error: "pipeline_failed", message: `❌ فشل الخط: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 4. Modify — edit artifact content (creates new version)
// ---------------------------------------------------------------------------

export async function modifyArtifact(artifactId: string, newContent: string, reason?: string): Promise<ResultArtifactResult<{ artifactId: string; version: number; previewHtml: string }>> {
  try {
    const editRes = await artifactEdit(artifactId, { content: newContent, reason: reason ?? "modified via pipeline" })
    if (!editRes.ok) return editRes as unknown as ResultArtifactResult<{ artifactId: string; version: number; previewHtml: string }>
    const previewRes = await artifactPreview(artifactId)
    return {
      ok: true,
      data: {
        artifactId: editRes.data.id,
        version: editRes.data.version,
        previewHtml: previewRes.ok ? previewRes.data.html : "",
      },
    }
  } catch (e) {
    return { ok: false, error: "modify_failed", message: `❌ فشل التعديل: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 5. Export — download artifact as file
// ---------------------------------------------------------------------------

export async function exportArtifact(artifactId: string, format: "raw" | "html" | "svg" | "md" | "json" = "raw"): Promise<ResultArtifactResult<{ filename: string; mimeType: string; content: string; sizeBytes: number }>> {
  try {
    const res = await artifactExport(artifactId, { format })
    if (!res.ok) return res as unknown as ResultArtifactResult<{ filename: string; mimeType: string; content: string; sizeBytes: number }>
    return { ok: true, data: res.data }
  } catch (e) {
    return { ok: false, error: "export_failed", message: `❌ فشل التصدير: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

export function formatPipelineResult(result: PipelineResult): string {
  const lines: string[] = []
  lines.push(`🎨 **Result → Artifact Pipeline**`)
  lines.push(`📋 النوع: ${result.type} | العنوان: ${result.title}`)
  lines.push(`🔢 الإصدار: ${result.version} | الحجم: ${result.rawContent.length} حرف`)
  lines.push("")
  for (const stage of result.stages) {
    const icon = stage.status === "done" ? "✅" : "❌"
    lines.push(`${icon} ${stage.name} (${stage.durationMs}ms)${stage.result ? ` — ${stage.result}` : ""}`)
  }
  lines.push("")
  lines.push(`⏱️ ${result.totalDurationMs}ms إجمالي`)
  lines.push(`📤 صيغ التصدير: ${result.exportFormats.join(", ")}`)
  lines.push(`🔗 Artifact ID: ${result.artifactId}`)
  return lines.join("\n")
}
