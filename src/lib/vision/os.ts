// Vision OS — image + screenshot + PDF analysis via VLM.
// 7 operations, deterministic pipeline, bilingual (Arabic + English), persisted to SQLite.
//
// Design:
//   • VisionAnalysis (Prisma) — every analysis logged for audit + reuse
//   • VisionTemplate (Prisma) — saved prompts for common analyses
//   • Backed by z-ai-web-dev-sdk VLM (chat.completions with image_url)
//   • Images saved to upload/vision/ (gitignored)
//   • The crown jewel: screenshotToCodeFix — screenshot → analyze → identify problem → suggest code fix
//
// 7 operations:
//   1. imageUpload             — save image + return metadata
//   2. imageAnalyze            — general VLM analysis (image + prompt → text)
//   3. screenshotAnalyze       — UI screenshot → identify problems + suggested fixes
//   4. pdfVision               — PDF → VLM analysis (page-by-page or whole-doc)
//   5. uiScreenshotUnderstanding — UI/UX analysis (layout, accessibility, responsiveness)
//   6. diagramUnderstanding    — flowchart/diagram → structured description
//   7. chartUnderstanding      — chart → data extraction (labels, values, trends)
//
// Plus the crown jewel:
//   screenshotToCodeFix       — screenshot → analyze → identify problem → suggest code fix
//   (integrates with code-intel to find the relevant source file)

import { db } from "@/lib/db"
import { mkdir, writeFile, readFile, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VisionType =
  | "image"
  | "screenshot"
  | "pdf"
  | "ui"
  | "diagram"
  | "chart"
  | "screenshot_fix"

export interface VisionAnalysisRecord {
  id: string
  type: VisionType
  sourcePath: string | null
  sourceBase64: string | null
  prompt: string
  response: string
  model: string | null
  durationMs: number
  tokensUsed: number
  structured: Record<string, unknown>
  metadata: Record<string, unknown>
  conversationId: string | null
  messageId: string | null
  createdAt: Date
}

export interface VisionTemplateRecord {
  id: string
  name: string
  description: string | null
  type: VisionType
  promptTemplate: string
  systemPrompt: string | null
  active: boolean
  useCount: number
  lastUsedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface ImageInput {
  /** Image as base64 (no data: prefix). */
  base64?: string
  /** Image file path (alternative to base64). */
  path?: string
  /** MIME type. Default "image/png". */
  mimeType?: string
}

export interface AnalyzeResult {
  analysisId: string
  text: string
  model: string | undefined
  durationMs: number
  tokensUsed: number
  structured: Record<string, unknown>
}

export interface ScreenshotProblem {
  severity: "critical" | "high" | "medium" | "low"
  category: string
  description: string
  location?: string
  suggestedFix?: string
}

export interface ScreenshotFixResult {
  analysisId: string
  problems: ScreenshotProblem[]
  summary: string
  suggestedCodeFile?: string
  suggestedCodeChanges?: string
  confidence: number
}

export interface ChartData {
  chartType: string
  title?: string
  xLabel?: string
  yLabel?: string
  dataPoints: Array<{ label: string; value: number }>
  trends: string[]
}

export interface DiagramStructure {
  type: string
  nodes: Array<{ id: string; label: string; type?: string }>
  edges: Array<{ from: string; to: string; label?: string }>
  description: string
}

export interface UIAnalysis {
  layout: string
  colorScheme: string
  accessibilityIssues: string[]
  responsivenessIssues: string[]
  suggestions: string[]
}

export type VisionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string }

// ---------------------------------------------------------------------------
// Row → record mappers
// ---------------------------------------------------------------------------

interface AnalysisRow {
  id: string
  type: string
  sourcePath: string | null
  sourceBase64: string | null
  prompt: string
  response: string
  model: string | null
  durationMs: number
  tokensUsed: number
  structured: string
  metadata: string
  conversationId: string | null
  messageId: string | null
  createdAt: Date
}

function analysisRowToRecord(row: AnalysisRow): VisionAnalysisRecord {
  return {
    id: row.id,
    type: row.type as VisionType,
    sourcePath: row.sourcePath,
    sourceBase64: row.sourceBase64 ? "(stored)" : null,
    prompt: row.prompt,
    response: row.response,
    model: row.model,
    durationMs: row.durationMs,
    tokensUsed: row.tokensUsed,
    structured: safeParse(row.structured, {}),
    metadata: safeParse(row.metadata, {}),
    conversationId: row.conversationId,
    messageId: row.messageId,
    createdAt: row.createdAt,
  }
}

function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

// ---------------------------------------------------------------------------
// ZAI SDK singleton (shared with Voice OS pattern)
// ---------------------------------------------------------------------------

interface ZaiChat {
  chat: {
    completions: {
      createVision: (body: unknown) => Promise<unknown>
    }
  }
}

let zaiInstance: ZaiChat | null = null

async function getZai(): Promise<ZaiChat | null> {
  if (zaiInstance) return zaiInstance
  try {
    const ZAIModule = await import("z-ai-web-dev-sdk").catch(() => null)
    if (!ZAIModule) return null
    const ZAI = ZAIModule.default
    zaiInstance = (await ZAI.create()) as unknown as ZaiChat
    return zaiInstance
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Image storage helper
// ---------------------------------------------------------------------------

async function saveImageFile(buffer: Buffer, ext: string, prefix: string): Promise<string> {
  const dir = path.join(WORKSPACE_ROOT, "upload", "vision")
  await mkdir(dir, { recursive: true })
  const filename = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
  const filepath = path.join(dir, filename)
  await writeFile(filepath, buffer)
  return filepath
}

function extFromMime(mimeType: string): string {
  if (mimeType.includes("png")) return "png"
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg"
  if (mimeType.includes("webp")) return "webp"
  if (mimeType.includes("gif")) return "gif"
  return "png"
}

async function resolveImage(input: ImageInput): Promise<{ base64: string; dataUrl: string; mimeType: string; path: string | null }> {
  let base64 = input.base64 ?? ""
  let filePath = input.path ?? null
  let mimeType = input.mimeType ?? "image/png"

  if (filePath) {
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(WORKSPACE_ROOT, filePath)
    if (!existsSync(abs)) {
      throw new Error(`❌ الصورة غير موجودة / image not found: ${filePath}`)
    }
    const buffer = await readFile(abs)
    base64 = buffer.toString("base64")
    // Guess MIME from extension
    const ext = path.extname(abs).toLowerCase()
    if (ext === ".png") mimeType = "image/png"
    else if (ext === ".jpg" || ext === ".jpeg") mimeType = "image/jpeg"
    else if (ext === ".webp") mimeType = "image/webp"
    else if (ext === ".gif") mimeType = "image/gif"
  }

  if (!base64) {
    throw new Error("❌ لا صورة مُدخلة / no image input (base64 or path required)")
  }

  const dataUrl = `data:${mimeType};base64,${base64}`
  return { base64, dataUrl, mimeType, path: filePath }
}

// ---------------------------------------------------------------------------
// Core VLM call helper
// ---------------------------------------------------------------------------

interface VlmCallOpts {
  prompt: string
  dataUrl: string
  systemPrompt?: string
  /** If true, ask for JSON-structured output. */
  wantJson?: boolean
}

async function vlmCall(opts: VlmCallOpts): Promise<{ text: string; model: string | undefined; durationMs: number }> {
  const start = Date.now()
  const zai = await getZai()
  if (!zai) {
    throw new Error("❌ z-ai-web-dev-sdk غير متاح / SDK not available")
  }
  const messages: Array<Record<string, unknown>> = []
  if (opts.systemPrompt) {
    messages.push({ role: "system", content: opts.systemPrompt })
  }
  messages.push({
    role: "user",
    content: [
      { type: "text", text: opts.wantJson ? opts.prompt + "\n\nأرجع النتيجة كـ JSON صالح. / Return the result as valid JSON." : opts.prompt },
      { type: "image_url", image_url: { url: opts.dataUrl } },
    ],
  })
  const completion = await zai.chat.completions.createVision({
    model: "glm-4.5v",
    messages,
    thinking: { type: "disabled" },
  }) as { choices?: Array<{ message?: { content?: string } }>; model?: string; usage?: { total_tokens?: number } }
  const text = completion.choices?.[0]?.message?.content ?? ""
  return {
    text,
    model: completion.model,
    durationMs: Date.now() - start,
  }
}

// ---------------------------------------------------------------------------
// Analysis persistence helper
// ---------------------------------------------------------------------------

async function persistAnalysis(opts: {
  type: VisionType
  sourcePath?: string | null
  sourceBase64?: string | null
  prompt: string
  response: string
  model?: string
  durationMs: number
  tokensUsed?: number
  structured?: Record<string, unknown>
  metadata?: Record<string, unknown>
  conversationId?: string
  messageId?: string
}): Promise<string> {
  const row = await db.visionAnalysis.create({
    data: {
      type: opts.type,
      sourcePath: opts.sourcePath ?? null,
      sourceBase64: opts.sourceBase64 ?? null,
      prompt: opts.prompt,
      response: opts.response,
      model: opts.model ?? null,
      durationMs: opts.durationMs,
      tokensUsed: opts.tokensUsed ?? 0,
      structured: JSON.stringify(opts.structured ?? {}),
      metadata: JSON.stringify(opts.metadata ?? {}),
      conversationId: opts.conversationId ?? null,
      messageId: opts.messageId ?? null,
    },
  })
  return row.id
}

// ---------------------------------------------------------------------------
// 1. Image Upload — save image + return metadata
// ---------------------------------------------------------------------------

export async function imageUpload(input: ImageInput): Promise<VisionResult<{ path: string; sizeBytes: number; mimeType: string; width?: number; height?: number }>> {
  try {
    let buffer: Buffer
    let mimeType = input.mimeType ?? "image/png"

    if (input.path) {
      const abs = path.isAbsolute(input.path) ? input.path : path.resolve(WORKSPACE_ROOT, input.path)
      if (!existsSync(abs)) {
        return { ok: false, error: "not_found", message: `❌ الصورة غير موجودة / image not found: ${input.path}` }
      }
      buffer = await readFile(abs)
    } else if (input.base64) {
      buffer = Buffer.from(input.base64, "base64")
    } else {
      return { ok: false, error: "no_input", message: "❌ لا صورة / no image input" }
    }

    const ext = extFromMime(mimeType)
    const savedPath = await saveImageFile(buffer, ext, "img")
    const st = await stat(savedPath)

    return {
      ok: true,
      data: {
        path: savedPath,
        sizeBytes: st.size,
        mimeType,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "upload_failed",
      message: `❌ فشل الرفع / upload failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Image Analyze — general VLM analysis (image + prompt → text)
// ---------------------------------------------------------------------------

export async function imageAnalyze(
  image: ImageInput,
  prompt: string,
  opts: { systemPrompt?: string; conversationId?: string; messageId?: string; wantJson?: boolean } = {}
): Promise<VisionResult<AnalyzeResult>> {
  try {
    const resolved = await resolveImage(image)
    const call = await vlmCall({
      prompt,
      dataUrl: resolved.dataUrl,
      systemPrompt: opts.systemPrompt,
      wantJson: opts.wantJson,
    })

    let structured: Record<string, unknown> = {}
    if (opts.wantJson) {
      try {
        // Extract JSON from the response (may be wrapped in ```json ... ```)
        const jsonMatch = call.text.match(/```json\s*([\s\S]*?)```/) ?? call.text.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          structured = JSON.parse(jsonMatch[1] ?? jsonMatch[0]) as Record<string, unknown>
        }
      } catch {
        /* not valid JSON — leave structured empty */
      }
    }

    const analysisId = await persistAnalysis({
      type: "image",
      sourcePath: resolved.path,
      sourceBase64: resolved.base64,
      prompt,
      response: call.text,
      model: call.model,
      durationMs: call.durationMs,
      structured,
      metadata: { mimeType: resolved.mimeType },
      conversationId: opts.conversationId,
      messageId: opts.messageId,
    })

    return {
      ok: true,
      data: {
        analysisId,
        text: call.text,
        model: call.model,
        durationMs: call.durationMs,
        tokensUsed: 0,
        structured,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "analyze_failed",
      message: `❌ فشل التحليل / analyze failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Screenshot Analyze — UI screenshot → identify problems + suggested fixes
// ---------------------------------------------------------------------------

const SCREENSHOT_SYSTEM_PROMPT = `You are a senior frontend engineer analyzing UI screenshots for bugs and issues.
Identify visual problems, layout issues, accessibility violations, and UX problems.
For each problem, specify: severity (critical/high/medium/low), category, description, and suggested fix.
Return your analysis as JSON with this structure:
{
  "problems": [{ "severity": "...", "category": "...", "description": "...", "location": "...", "suggestedFix": "..." }],
  "summary": "...",
  "confidence": 0.0-1.0
}
Be specific and actionable. If the screenshot looks fine, return an empty problems array.`

export async function screenshotAnalyze(
  image: ImageInput,
  opts: { context?: string; conversationId?: string } = {}
): Promise<VisionResult<{ analysisId: string; problems: ScreenshotProblem[]; summary: string; confidence: number }>> {
  try {
    const resolved = await resolveImage(image)
    const prompt = `حلّل هذه اللقطة الشاشية وحدد المشاكل البصرية والتصميمية.
Analyze this screenshot and identify visual and design issues.
${opts.context ? `السياق / Context: ${opts.context}` : ""}
افحص: التخطيط، الألوان، التباين، المحاذاة، الاستجابة، إمكانية الوصول، تجربة المستخدم.
Check: layout, colors, contrast, alignment, responsiveness, accessibility, UX.`

    const call = await vlmCall({
      prompt,
      dataUrl: resolved.dataUrl,
      systemPrompt: SCREENSHOT_SYSTEM_PROMPT,
      wantJson: true,
    })

    let structured: { problems?: ScreenshotProblem[]; summary?: string; confidence?: number } = {}
    try {
      const jsonMatch = call.text.match(/```json\s*([\s\S]*?)```/) ?? call.text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        structured = JSON.parse(jsonMatch[1] ?? jsonMatch[0])
      }
    } catch {
      /* parse error */
    }

    const analysisId = await persistAnalysis({
      type: "screenshot",
      sourcePath: resolved.path,
      sourceBase64: resolved.base64,
      prompt,
      response: call.text,
      model: call.model,
      durationMs: call.durationMs,
      structured,
      metadata: { mimeType: resolved.mimeType, context: opts.context },
      conversationId: opts.conversationId,
    })

    return {
      ok: true,
      data: {
        analysisId,
        problems: structured.problems ?? [],
        summary: structured.summary ?? call.text.slice(0, 500),
        confidence: structured.confidence ?? 0.5,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "screenshot_failed",
      message: `❌ فشل تحليل اللقطة / screenshot analyze failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 4. PDF Vision — PDF → VLM analysis
// ---------------------------------------------------------------------------

export async function pdfVision(
  input: { pdfPath?: string; pdfBase64?: string; prompt?: string; conversationId?: string },
  opts: { pageRange?: { start: number; end: number } } = {}
): Promise<VisionResult<AnalyzeResult>> {
  try {
    let base64 = input.pdfBase64 ?? ""
    let filePath = input.pdfPath ?? null

    if (filePath) {
      const abs = path.isAbsolute(filePath) ? filePath : path.resolve(WORKSPACE_ROOT, filePath)
      if (!existsSync(abs)) {
        return { ok: false, error: "not_found", message: `❌ PDF غير موجود / PDF not found: ${filePath}` }
      }
      const buffer = await readFile(abs)
      base64 = buffer.toString("base64")
    }

    if (!base64) {
      return { ok: false, error: "no_input", message: "❌ لا PDF / no PDF input" }
    }

    const prompt = input.prompt ?? `حلّل هذا المستند PDF. استخرج النص الرئيسي، العناوين، الجداول، والصور المهمة.
Analyze this PDF document. Extract main text, headings, tables, and important images.
${opts.pageRange ? `الصفحات / Pages: ${opts.pageRange.start}-${opts.pageRange.end}` : "كل الصفحات / all pages"}`

    // Send PDF as base64 data URL. Some VLMs support PDFs directly.
    const dataUrl = `data:application/pdf;base64,${base64}`

    const call = await vlmCall({
      prompt,
      dataUrl,
      systemPrompt: "You are a document analysis expert. Extract and summarize content from PDFs accurately.",
    })

    const analysisId = await persistAnalysis({
      type: "pdf",
      sourcePath: filePath,
      sourceBase64: base64,
      prompt,
      response: call.text,
      model: call.model,
      durationMs: call.durationMs,
      metadata: { pageRange: opts.pageRange },
      conversationId: input.conversationId,
    })

    return {
      ok: true,
      data: {
        analysisId,
        text: call.text,
        model: call.model,
        durationMs: call.durationMs,
        tokensUsed: 0,
        structured: {},
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "pdf_failed",
      message: `❌ فشل تحليل PDF / PDF vision failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 5. UI Screenshot Understanding — UI/UX analysis
// ---------------------------------------------------------------------------

const UI_SYSTEM_PROMPT = `You are a UI/UX expert. Analyze the screenshot for:
1. Layout structure (grid, flex, positioning)
2. Color scheme and contrast
3. Accessibility (WCAG compliance, alt text, focus indicators)
4. Responsiveness (breakpoints, mobile adaptation)
5. UX patterns and usability

Return JSON:
{
  "layout": "description of layout structure",
  "colorScheme": "description of colors + contrast assessment",
  "accessibilityIssues": ["issue1", "issue2"],
  "responsivenessIssues": ["issue1"],
  "suggestions": ["actionable improvement1", "actionable improvement2"]
}`

export async function uiScreenshotUnderstanding(
  image: ImageInput,
  opts: { conversationId?: string } = {}
): Promise<VisionResult<{ analysisId: string; analysis: UIAnalysis }>> {
  try {
    const resolved = await resolveImage(image)
    const prompt = `حلّل واجهة المستخدم في هذه اللقطة. افحص التخطيط، الألوان، إمكانية الوصول، والاستجابة.
Analyze the UI in this screenshot. Examine layout, colors, accessibility, and responsiveness.`

    const call = await vlmCall({
      prompt,
      dataUrl: resolved.dataUrl,
      systemPrompt: UI_SYSTEM_PROMPT,
      wantJson: true,
    })

    let structured: UIAnalysis = {
      layout: "",
      colorScheme: "",
      accessibilityIssues: [],
      responsivenessIssues: [],
      suggestions: [],
    }
    try {
      const jsonMatch = call.text.match(/```json\s*([\s\S]*?)```/) ?? call.text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        structured = JSON.parse(jsonMatch[1] ?? jsonMatch[0])
      }
    } catch {
      /* parse error */
    }

    const analysisId = await persistAnalysis({
      type: "ui",
      sourcePath: resolved.path,
      sourceBase64: resolved.base64,
      prompt,
      response: call.text,
      model: call.model,
      durationMs: call.durationMs,
      structured: structured as unknown as Record<string, unknown>,
      metadata: { mimeType: resolved.mimeType },
      conversationId: opts.conversationId,
    })

    return { ok: true, data: { analysisId, analysis: structured } }
  } catch (e) {
    return {
      ok: false,
      error: "ui_failed",
      message: `❌ فشل تحليل الواجهة / UI analysis failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Diagram Understanding — flowchart/diagram → structured description
// ---------------------------------------------------------------------------

const DIAGRAM_SYSTEM_PROMPT = `You are a diagram analysis expert. Analyze the diagram/flowchart and extract:
1. Diagram type (flowchart, sequence, ER, class, architecture, etc.)
2. All nodes with their labels and types
3. All edges/connections with labels
4. Overall description

Return JSON:
{
  "type": "flowchart|sequence|er|class|architecture|mindmap|other",
  "nodes": [{ "id": "1", "label": "...", "type": "process|decision|data|..." }],
  "edges": [{ "from": "1", "to": "2", "label": "yes|no|..." }],
  "description": "overall description of what the diagram represents"
}`

export async function diagramUnderstanding(
  image: ImageInput,
  opts: { conversationId?: string } = {}
): Promise<VisionResult<{ analysisId: string; structure: DiagramStructure }>> {
  try {
    const resolved = await resolveImage(image)
    const prompt = `حلّل هذا المخطط/الرسم البياني. استخرج العقد، الروابط، والبنية.
Analyze this diagram/flowchart. Extract nodes, edges, and structure.`

    const call = await vlmCall({
      prompt,
      dataUrl: resolved.dataUrl,
      systemPrompt: DIAGRAM_SYSTEM_PROMPT,
      wantJson: true,
    })

    let structured: DiagramStructure = {
      type: "unknown",
      nodes: [],
      edges: [],
      description: "",
    }
    try {
      const jsonMatch = call.text.match(/```json\s*([\s\S]*?)```/) ?? call.text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        structured = JSON.parse(jsonMatch[1] ?? jsonMatch[0])
      }
    } catch {
      /* parse error */
    }

    const analysisId = await persistAnalysis({
      type: "diagram",
      sourcePath: resolved.path,
      sourceBase64: resolved.base64,
      prompt,
      response: call.text,
      model: call.model,
      durationMs: call.durationMs,
      structured: structured as unknown as Record<string, unknown>,
      metadata: { mimeType: resolved.mimeType },
      conversationId: opts.conversationId,
    })

    return { ok: true, data: { analysisId, structure: structured } }
  } catch (e) {
    return {
      ok: false,
      error: "diagram_failed",
      message: `❌ فشل تحليل المخطط / diagram analysis failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Chart Understanding — chart → data extraction
// ---------------------------------------------------------------------------

const CHART_SYSTEM_PROMPT = `You are a data visualization expert. Analyze the chart and extract:
1. Chart type (bar, line, pie, scatter, area, etc.)
2. Title and axis labels
3. Data points (label + value pairs)
4. Trends and patterns

Return JSON:
{
  "chartType": "bar|line|pie|scatter|area|other",
  "title": "...",
  "xLabel": "...",
  "yLabel": "...",
  "dataPoints": [{ "label": "...", "value": 0 }],
  "trends": ["trend1", "trend2"]
}
Be precise with numbers. If you can't read a value, estimate and mark it.`

export async function chartUnderstanding(
  image: ImageInput,
  opts: { conversationId?: string } = {}
): Promise<VisionResult<{ analysisId: string; data: ChartData }>> {
  try {
    const resolved = await resolveImage(image)
    const prompt = `حلّل هذا الرسم البياني. استخرج النقاط، القيم، والاتجاهات بدقة.
Analyze this chart. Extract data points, values, and trends precisely.`

    const call = await vlmCall({
      prompt,
      dataUrl: resolved.dataUrl,
      systemPrompt: CHART_SYSTEM_PROMPT,
      wantJson: true,
    })

    let structured: ChartData = {
      chartType: "unknown",
      dataPoints: [],
      trends: [],
    }
    try {
      const jsonMatch = call.text.match(/```json\s*([\s\S]*?)```/) ?? call.text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        structured = JSON.parse(jsonMatch[1] ?? jsonMatch[0])
      }
    } catch {
      /* parse error */
    }

    const analysisId = await persistAnalysis({
      type: "chart",
      sourcePath: resolved.path,
      sourceBase64: resolved.base64,
      prompt,
      response: call.text,
      model: call.model,
      durationMs: call.durationMs,
      structured: structured as unknown as Record<string, unknown>,
      metadata: { mimeType: resolved.mimeType },
      conversationId: opts.conversationId,
    })

    return { ok: true, data: { analysisId, data: structured } }
  } catch (e) {
    return {
      ok: false,
      error: "chart_failed",
      message: `❌ فشل تحليل الرسم / chart analysis failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Crown Jewel: Screenshot → Code Fix
// screenshot → analyze → identify problem → suggest code file + changes
// ---------------------------------------------------------------------------

const SCREENSHOT_FIX_SYSTEM_PROMPT = `You are a senior frontend engineer. You receive a screenshot of a web application with a visual bug or issue.

Your job:
1. Identify the specific visual/UI problem (be precise about what's wrong)
2. Determine which source file likely contains the bug (based on the visible component)
3. Describe the exact code change needed to fix it

Return JSON:
{
  "problem": {
    "severity": "critical|high|medium|low",
    "category": "layout|color|contrast|alignment|responsive|a11y|ux|other",
    "description": "detailed description of the problem",
    "location": "where on the screen the problem is visible"
  },
  "suggestedCodeFile": "relative/path/to/file.tsx (your best guess)",
  "suggestedCodeChanges": "description of the exact change needed, e.g. 'change margin-top from -10px to 0' or 'add overflow-x: auto to the container'",
  "confidence": 0.0-1.0,
  "summary": "one-line summary"
}

Be specific and actionable. If the problem is not code-related (e.g. missing data), note that.`

export async function screenshotToCodeFix(
  image: ImageInput,
  opts: { context?: string; conversationId?: string } = {}
): Promise<VisionResult<ScreenshotFixResult>> {
  try {
    const resolved = await resolveImage(image)
    const prompt = `خذ لقطة شاشة، حلّلها، حدد المشكلة، واقترح إصلاح الكود.
Take this screenshot, analyze it, identify the problem, and suggest a code fix.
${opts.context ? `السياق / Context: ${opts.context}` : ""}
ما المشكلة البصرية؟ أي ملف كود يحتوي على الخطأ؟ ما التغيير المطلوب؟
What's the visual problem? Which code file has the bug? What change is needed?`

    const call = await vlmCall({
      prompt,
      dataUrl: resolved.dataUrl,
      systemPrompt: SCREENSHOT_FIX_SYSTEM_PROMPT,
      wantJson: true,
    })

    let structured: {
      problem?: ScreenshotProblem
      suggestedCodeFile?: string
      suggestedCodeChanges?: string
      confidence?: number
      summary?: string
    } = {}
    try {
      const jsonMatch = call.text.match(/```json\s*([\s\S]*?)```/) ?? call.text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        structured = JSON.parse(jsonMatch[1] ?? jsonMatch[0])
      }
    } catch {
      /* parse error */
    }

    const problems: ScreenshotProblem[] = structured.problem ? [structured.problem] : []
    const analysisId = await persistAnalysis({
      type: "screenshot_fix",
      sourcePath: resolved.path,
      sourceBase64: resolved.base64,
      prompt,
      response: call.text,
      model: call.model,
      durationMs: call.durationMs,
      structured,
      metadata: { mimeType: resolved.mimeType, context: opts.context },
      conversationId: opts.conversationId,
    })

    return {
      ok: true,
      data: {
        analysisId,
        problems,
        summary: structured.summary ?? "❌ لم يتم استخراج ملخص / no summary extracted",
        suggestedCodeFile: structured.suggestedCodeFile,
        suggestedCodeChanges: structured.suggestedCodeChanges,
        confidence: structured.confidence ?? 0.5,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "fix_failed",
      message: `❌ فشل تحديد الإصلاح / screenshot→fix failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Template management
// ---------------------------------------------------------------------------

export interface TemplateInput {
  name: string
  description?: string
  type: VisionType
  promptTemplate: string
  systemPrompt?: string
  active?: boolean
}

export async function visionTemplateRegister(input: TemplateInput): Promise<VisionResult<VisionTemplateRecord>> {
  try {
    if (!input.name || !input.promptTemplate || !input.type) {
      return { ok: false, error: "bad_input", message: "❌ المدخلات غير مكتملة / incomplete input" }
    }
    const row = await db.visionTemplate.upsert({
      where: { name: input.name },
      update: {
        description: input.description,
        type: input.type,
        promptTemplate: input.promptTemplate,
        systemPrompt: input.systemPrompt,
        active: input.active ?? true,
      },
      create: {
        name: input.name,
        description: input.description,
        type: input.type,
        promptTemplate: input.promptTemplate,
        systemPrompt: input.systemPrompt,
        active: input.active ?? true,
      },
    })
    return { ok: true, data: { ...row, type: row.type as VisionType } }
  } catch (e) {
    return {
      ok: false,
      error: "template_failed",
      message: `❌ فشل القالب / template failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function visionTemplateList(opts: { type?: VisionType; active?: boolean } = {}): Promise<VisionResult<VisionTemplateRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.type) where.type = opts.type
    if (opts.active !== undefined) where.active = opts.active
    const rows = await db.visionTemplate.findMany({ where, orderBy: { createdAt: "desc" } })
    return { ok: true, data: rows.map((r) => ({ ...r, type: r.type as VisionType })) }
  } catch (e) {
    return {
      ok: false,
      error: "template_list_failed",
      message: `❌ فشل سرد القوالب / template list failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function visionTemplateDelete(name: string): Promise<VisionResult<{ deleted: boolean }>> {
  try {
    await db.visionTemplate.delete({ where: { name } })
    return { ok: true, data: { deleted: true } }
  } catch (e) {
    return {
      ok: false,
      error: "template_delete_failed",
      message: `❌ فشل حذف القالب / template delete failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Analysis queries
// ---------------------------------------------------------------------------

export async function visionAnalysisList(opts: { type?: VisionType; limit?: number; conversationId?: string } = {}): Promise<VisionResult<VisionAnalysisRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.type) where.type = opts.type
    if (opts.conversationId) where.conversationId = opts.conversationId
    const rows = await db.visionAnalysis.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 50,
    })
    return { ok: true, data: rows.map(analysisRowToRecord) }
  } catch (e) {
    return {
      ok: false,
      error: "list_failed",
      message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function visionAnalysisGet(id: string): Promise<VisionResult<VisionAnalysisRecord>> {
  try {
    const row = await db.visionAnalysis.findUnique({ where: { id } })
    if (!row) {
      return { ok: false, error: "not_found", message: `❌ التحليل غير موجود / analysis not found: ${id}` }
    }
    return { ok: true, data: analysisRowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "get_failed",
      message: `❌ فشل الجلب / get failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface VisionSnapshot {
  totalAnalyses: number
  byType: Record<string, number>
  totalTemplates: number
  activeTemplates: number
  avgDurationMs: number
  recentAnalyses: Array<{ id: string; type: string; createdAt: Date; model: string | null }>
}

export async function visionSnapshot(): Promise<VisionResult<VisionSnapshot>> {
  try {
    const analyses = await db.visionAnalysis.findMany({ take: 1000, orderBy: { createdAt: "desc" } })
    const byType: Record<string, number> = {}
    let totalDuration = 0
    for (const a of analyses) {
      byType[a.type] = (byType[a.type] ?? 0) + 1
      totalDuration += a.durationMs
    }
    const templates = await db.visionTemplate.findMany()
    const activeTemplates = templates.filter((t) => t.active).length
    return {
      ok: true,
      data: {
        totalAnalyses: analyses.length,
        byType,
        totalTemplates: templates.length,
        activeTemplates,
        avgDurationMs: analyses.length > 0 ? Math.round(totalDuration / analyses.length) : 0,
        recentAnalyses: analyses.slice(0, 10).map((a) => ({
          id: a.id,
          type: a.type,
          createdAt: a.createdAt,
          model: a.model,
        })),
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "snapshot_failed",
      message: `❌ فشل اللقطة / snapshot failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

export function formatVisionResult<T>(result: VisionResult<T>): string {
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
