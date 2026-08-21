// Creative Tools — image generation + editing + diagram/chart generation.
// 6 operations, deterministic pipeline, bilingual (Arabic + English), persisted to SQLite.
//
// Design:
//   • ImageCreation (Prisma) — every generation logged for audit + reuse
//   • Backed by z-ai-web-dev-sdk images.generations.create + images.edit + images.search
//   • Images saved to upload/creative/ (gitignored)
//   • Diagrams/flowcharts/architecture/charts generated via VLM as SVG + code (no image API for those)
//
// 6 operations:
//   1. imageGenerate           — text → image (z-ai images.generations.create)
//   2. imageEdit               — image + prompt → edited image (z-ai images.edit)
//   3. diagramGenerate         — text description → SVG diagram (VLM-generated)
//   4. flowchartGenerate        — text description → SVG flowchart (VLM-generated)
//   5. architectureDiagramGenerate — system description → SVG architecture diagram
//   6. chartGenerate           — data → SVG chart (deterministic, no VLM)

import { db } from "@/lib/db"
import { mkdir, writeFile, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CreativeType =
  | "image_gen"
  | "image_edit"
  | "diagram"
  | "flowchart"
  | "architecture"
  | "chart"

export type ImageSize =
  | "1024x1024"
  | "768x1344"
  | "864x1152"
  | "1344x768"
  | "1152x864"
  | "1440x720"
  | "720x1440"

export type ImageQuality = "standard" | "hd"

export interface ImageCreationRecord {
  id: string
  type: CreativeType
  prompt: string
  imagePath: string | null
  sourcePath: string | null
  size: string
  quality: string
  style: string | null
  model: string | null
  success: boolean
  durationMs: number
  metadata: Record<string, unknown>
  params: Record<string, unknown>
  conversationId: string | null
  messageId: string | null
  createdAt: Date
}

export interface ImageGenResult {
  creationId: string
  imagePath: string
  sizeBytes: number
  size: string
  model: string | undefined
  durationMs: number
}

export interface ImageEditResult {
  creationId: string
  imagePath: string
  sizeBytes: number
  size: string
  model: string | undefined
  durationMs: number
}

export interface DiagramResult {
  creationId: string
  svgPath: string
  svgContent: string
  durationMs: number
}

export interface ChartDataPoint {
  label: string
  value: number
}

export interface ChartInput {
  title?: string
  type: "bar" | "line" | "pie" | "area"
  dataPoints: ChartDataPoint[]
  xLabel?: string
  yLabel?: string
  width?: number
  height?: number
  colors?: string[]
}

export interface ChartResult {
  creationId: string
  svgPath: string
  svgContent: string
  durationMs: number
}

export type CreativeResult<T> =
  | { ok: true; data: T }
  | { ok: false, error: string; message: string }

// ---------------------------------------------------------------------------
// ZAI SDK singleton
// ---------------------------------------------------------------------------

interface ZaiImages {
  images: {
    generations: {
      create: (body: unknown) => Promise<unknown>
      edit: (body: unknown) => Promise<unknown>
    }
    search: {
      create: (body: unknown) => Promise<unknown>
    }
  }
  chat: {
    completions: {
      createVision: (body: unknown) => Promise<unknown>
    }
  }
}

let zaiInstance: ZaiImages | null = null

async function getZai(): Promise<ZaiImages | null> {
  if (zaiInstance) return zaiInstance
  try {
    const ZAIModule = await import("z-ai-web-dev-sdk").catch(() => null)
    if (!ZAIModule) return null
    const ZAI = ZAIModule.default
    zaiInstance = (await ZAI.create()) as unknown as ZaiImages
    return zaiInstance
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

async function saveImage(buffer: Buffer, ext: string, prefix: string): Promise<string> {
  const dir = path.join(WORKSPACE_ROOT, "upload", "creative")
  await mkdir(dir, { recursive: true })
  const filename = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
  const filepath = path.join(dir, filename)
  await writeFile(filepath, buffer)
  return filepath
}

async function saveSvg(content: string, prefix: string): Promise<string> {
  const dir = path.join(WORKSPACE_ROOT, "upload", "creative")
  await mkdir(dir, { recursive: true })
  const filename = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.svg`
  const filepath = path.join(dir, filename)
  await writeFile(filepath, content, "utf8")
  return filepath
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
// Persistence
// ---------------------------------------------------------------------------

interface PersistOpts {
  type: CreativeType
  prompt: string
  imagePath?: string | null
  sourcePath?: string | null
  size?: string
  quality?: string
  style?: string | null
  model?: string | null
  success: boolean
  durationMs: number
  metadata?: Record<string, unknown>
  params?: Record<string, unknown>
  conversationId?: string
  messageId?: string
}

async function persistCreation(opts: PersistOpts): Promise<string> {
  const row = await db.imageCreation.create({
    data: {
      type: opts.type,
      prompt: opts.prompt,
      imagePath: opts.imagePath ?? null,
      sourcePath: opts.sourcePath ?? null,
      size: opts.size ?? "1024x1024",
      quality: opts.quality ?? "standard",
      style: opts.style ?? null,
      model: opts.model ?? null,
      success: opts.success,
      durationMs: opts.durationMs,
      metadata: JSON.stringify(opts.metadata ?? {}),
      params: JSON.stringify(opts.params ?? {}),
      conversationId: opts.conversationId ?? null,
      messageId: opts.messageId ?? null,
    },
  })
  return row.id
}

// ---------------------------------------------------------------------------
// 1. Image Generate — text → image (z-ai images.generations.create)
// ---------------------------------------------------------------------------

export interface ImageGenInput {
  prompt: string
  size?: ImageSize
  /** Optional conversation link. */
  conversationId?: string
}

export async function imageGenerate(input: ImageGenInput): Promise<CreativeResult<ImageGenResult>> {
  const start = Date.now()
  try {
    if (!input.prompt || !input.prompt.trim()) {
      return { ok: false, error: "no_prompt", message: "❌ لا وصف / no prompt provided" }
    }
    const zai = await getZai()
    if (!zai) {
      return { ok: false, error: "no_sdk", message: "❌ z-ai-web-dev-sdk غير متاح / SDK not available" }
    }
    const size = input.size ?? "1024x1024"
    const response = await zai.images.generations.create({
      prompt: input.prompt,
      size,
    }) as { data?: Array<{ base64?: string }> }

    const base64 = response.data?.[0]?.base64
    if (!base64) {
      const creationId = await persistCreation({
        type: "image_gen",
        prompt: input.prompt,
        size,
        success: false,
        durationMs: Date.now() - start,
        conversationId: input.conversationId,
      })
      return {
        ok: false,
        error: "no_image",
        message: `❌ لم يُرجع الـ API صورة / API returned no image (creationId=${creationId})`,
      }
    }
    const buffer = Buffer.from(base64, "base64")
    const ext = "png"
    const imagePath = await saveImage(buffer, ext, "gen")

    const creationId = await persistCreation({
      type: "image_gen",
      prompt: input.prompt,
      imagePath,
      size,
      success: true,
      durationMs: Date.now() - start,
      metadata: { sizeBytes: buffer.length, mimeType: "image/png" },
      conversationId: input.conversationId,
    })

    return {
      ok: true,
      data: {
        creationId,
        imagePath,
        sizeBytes: buffer.length,
        size,
        model: undefined,
        durationMs: Date.now() - start,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "gen_failed",
      message: `❌ فشل التوليد / generate failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Image Edit — image + prompt → edited image (z-ai images.edit)
// ---------------------------------------------------------------------------

export interface ImageEditInput {
  /** Source image as base64. */
  base64?: string
  /** Or source image file path. */
  path?: string
  prompt: string
  size?: ImageSize
  conversationId?: string
}

export async function imageEdit(input: ImageEditInput): Promise<CreativeResult<ImageEditResult>> {
  const start = Date.now()
  try {
    if (!input.prompt || !input.prompt.trim()) {
      return { ok: false, error: "no_prompt", message: "❌ لا وصف / no prompt provided" }
    }
    let base64 = input.base64 ?? ""
    let sourcePath: string | null = input.path ?? null

    if (input.path) {
      const abs = path.isAbsolute(input.path) ? input.path : path.resolve(WORKSPACE_ROOT, input.path)
      if (!existsSync(abs)) {
        return { ok: false, error: "not_found", message: `❌ الصورة غير موجودة / image not found: ${input.path}` }
      }
      const buffer = await readFile(abs)
      base64 = buffer.toString("base64")
      sourcePath = abs
    }
    if (!base64) {
      return { ok: false, error: "no_source", message: "❌ لا صورة مصدر / no source image (base64 or path required)" }
    }

    const zai = await getZai()
    if (!zai) {
      return { ok: false, error: "no_sdk", message: "❌ z-ai-web-dev-sdk غير متاح / SDK not available" }
    }
    const size = input.size ?? "1024x1024"
    const response = await zai.images.generations.edit({
      prompt: input.prompt,
      image: base64,
      size,
    }) as { data?: Array<{ base64?: string }> }

    const outBase64 = response.data?.[0]?.base64
    if (!outBase64) {
      const creationId = await persistCreation({
        type: "image_edit",
        prompt: input.prompt,
        sourcePath,
        size,
        success: false,
        durationMs: Date.now() - start,
        conversationId: input.conversationId,
      })
      return {
        ok: false,
        error: "no_image",
        message: `❌ لم يُرجع الـ API صورة / API returned no image (creationId=${creationId})`,
      }
    }
    const buffer = Buffer.from(outBase64, "base64")
    const imagePath = await saveImage(buffer, "png", "edit")

    const creationId = await persistCreation({
      type: "image_edit",
      prompt: input.prompt,
      imagePath,
      sourcePath,
      size,
      success: true,
      durationMs: Date.now() - start,
      metadata: { sizeBytes: buffer.length, mimeType: "image/png" },
      conversationId: input.conversationId,
    })

    return {
      ok: true,
      data: {
        creationId,
        imagePath,
        sizeBytes: buffer.length,
        size,
        model: undefined,
        durationMs: Date.now() - start,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "edit_failed",
      message: `❌ فشل التحرير / edit failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// VLM-based SVG generator (used for diagram/flowchart/architecture)
// ---------------------------------------------------------------------------

const SVG_SYSTEM_PROMPT = `You are an expert at generating valid, self-contained SVG diagrams.
Generate ONLY the SVG markup, no markdown, no explanation, no code fences.
Requirements:
- Valid SVG with xmlns="http://www.w3.org/2000/svg"
- Use viewBox for responsive scaling
- Clean, modern styling with rounded rectangles, arrows, and readable text
- Use a professional color palette (blues, grays, accent colors)
- Text should be readable with proper font sizes
- Include arrows/markers for connections
- Make it self-contained (inline styles, no external refs)
- RTL-aware for Arabic text (dir="rtl" where needed)
Output: <svg>...</svg> only.`

async function vlmGenerateSvg(prompt: string, context: string): Promise<CreativeResult<{ svg: string; durationMs: number }>> {
  const start = Date.now()
  try {
    const zai = await getZai()
    if (!zai) {
      return { ok: false, error: "no_sdk", message: "❌ z-ai-web-dev-sdk غير متاح / SDK not available" }
    }
    // Use a 1x1 transparent PNG as the "image" since createVision requires an image_url.
    // Actually, createVision allows text-only messages too — let's use it that way.
    const completion = await zai.chat.completions.createVision({
      model: "glm-4.5v",
      messages: [
        { role: "system", content: SVG_SYSTEM_PROMPT },
        { role: "user", content: `${context}\n\n${prompt}` },
      ],
      thinking: { type: "disabled" },
    }) as { choices?: Array<{ message?: { content?: string } }> }
    let svg = completion.choices?.[0]?.message?.content ?? ""
    // Strip markdown code fences if present.
    svg = svg.replace(/```(?:svg|xml|html)?\s*/gi, "").replace(/```/g, "").trim()
    // Extract just the <svg>...</svg> portion.
    const match = svg.match(/<svg[\s\S]*<\/svg>/i)
    if (match) svg = match[0]
    if (!svg.startsWith("<svg")) {
      return {
        ok: false,
        error: "bad_svg",
        message: `❌ لم يُولّد SVG صالح / did not generate valid SVG. Got: ${svg.slice(0, 200)}`,
      }
    }
    return { ok: true, data: { svg, durationMs: Date.now() - start } }
  } catch (e) {
    return {
      ok: false,
      error: "vlm_svg_failed",
      message: `❌ فشل توليد SVG / VLM SVG generation failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Diagram Generate — text description → SVG diagram
// ---------------------------------------------------------------------------

export interface DiagramInput {
  description: string
  /** Optional additional context (e.g. "ER diagram for users/posts/comments"). */
  context?: string
  conversationId?: string
}

export async function diagramGenerate(input: DiagramInput): Promise<CreativeResult<DiagramResult>> {
  const start = Date.now()
  try {
    if (!input.description || !input.description.trim()) {
      return { ok: false, error: "no_desc", message: "❌ لا وصف / no description provided" }
    }
    const prompt = `ولّد مخطط SVG بناءً على هذا الوصف:
Generate an SVG diagram based on this description:
${input.description}
${input.context ? `السياق / Context: ${input.context}` : ""}`
    const vlmRes = await vlmGenerateSvg(prompt, "Generate a general-purpose diagram.")
    if (!vlmRes.ok) {
      await persistCreation({
        type: "diagram",
        prompt: input.description,
        success: false,
        durationMs: Date.now() - start,
        conversationId: input.conversationId,
      })
      return vlmRes as unknown as CreativeResult<DiagramResult>
    }
    const svgPath = await saveSvg(vlmRes.data.svg, "diagram")
    const creationId = await persistCreation({
      type: "diagram",
      prompt: input.description,
      imagePath: svgPath,
      success: true,
      durationMs: Date.now() - start,
      metadata: { sizeBytes: Buffer.byteLength(vlmRes.data.svg, "utf8"), context: input.context },
      conversationId: input.conversationId,
    })
    return {
      ok: true,
      data: {
        creationId,
        svgPath,
        svgContent: vlmRes.data.svg,
        durationMs: Date.now() - start,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "diagram_failed",
      message: `❌ فشل توليد المخطط / diagram generation failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Flowchart Generate — text description → SVG flowchart
// ---------------------------------------------------------------------------

export async function flowchartGenerate(input: DiagramInput): Promise<CreativeResult<DiagramResult>> {
  const start = Date.now()
  try {
    if (!input.description || !input.description.trim()) {
      return { ok: false, error: "no_desc", message: "❌ لا وصف / no description provided" }
    }
    const prompt = `ولّد مخطط انسيابي (flowchart) SVG بناءً على هذا الوصف. استخدم أشكال معيارية:
- مستطيلات بيضاوية للبداية/النهاية
- مستطيلات للعمليات
- معينات للقرارات
- أسهم للاتجاه
Generate an SVG flowchart based on this description. Use standard shapes:
- Ovals for start/end
- Rectangles for processes
- Diamonds for decisions
- Arrows for flow direction
${input.description}
${input.context ? `السياق / Context: ${input.context}` : ""}`
    const vlmRes = await vlmGenerateSvg(prompt, "Generate a flowchart.")
    if (!vlmRes.ok) {
      await persistCreation({
        type: "flowchart",
        prompt: input.description,
        success: false,
        durationMs: Date.now() - start,
        conversationId: input.conversationId,
      })
      return vlmRes as unknown as CreativeResult<DiagramResult>
    }
    const svgPath = await saveSvg(vlmRes.data.svg, "flowchart")
    const creationId = await persistCreation({
      type: "flowchart",
      prompt: input.description,
      imagePath: svgPath,
      success: true,
      durationMs: Date.now() - start,
      metadata: { sizeBytes: Buffer.byteLength(vlmRes.data.svg, "utf8"), context: input.context },
      conversationId: input.conversationId,
    })
    return {
      ok: true,
      data: {
        creationId,
        svgPath,
        svgContent: vlmRes.data.svg,
        durationMs: Date.now() - start,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "flowchart_failed",
      message: `❌ فشل توليد المخطط الانسيابي / flowchart generation failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Architecture Diagram Generate — system description → SVG architecture
// ---------------------------------------------------------------------------

export async function architectureDiagramGenerate(input: DiagramInput): Promise<CreativeResult<DiagramResult>> {
  const start = Date.now()
  try {
    if (!input.description || !input.description.trim()) {
      return { ok: false, error: "no_desc", message: "❌ لا وصف / no description provided" }
    }
    const prompt = `ولّد مخطط معماري (architecture diagram) SVG لهذا النظام. أظهر:
- المكونات الرئيسية (Frontend, Backend, Database, APIs, External services)
- العلاقات بينها (arrows for data flow)
- الطبقات (Layers: Presentation, Business Logic, Data)
- التقنيات المستخدمة (label each component)
Generate an SVG architecture diagram for this system. Show:
- Main components (Frontend, Backend, Database, APIs, External services)
- Relationships between them (arrows for data flow)
- Layers (Presentation, Business Logic, Data)
- Technologies used (label each component)
${input.description}
${input.context ? `السياق / Context: ${input.context}` : ""}`
    const vlmRes = await vlmGenerateSvg(prompt, "Generate an architecture diagram.")
    if (!vlmRes.ok) {
      await persistCreation({
        type: "architecture",
        prompt: input.description,
        success: false,
        durationMs: Date.now() - start,
        conversationId: input.conversationId,
      })
      return vlmRes as unknown as CreativeResult<DiagramResult>
    }
    const svgPath = await saveSvg(vlmRes.data.svg, "architecture")
    const creationId = await persistCreation({
      type: "architecture",
      prompt: input.description,
      imagePath: svgPath,
      success: true,
      durationMs: Date.now() - start,
      metadata: { sizeBytes: Buffer.byteLength(vlmRes.data.svg, "utf8"), context: input.context },
      conversationId: input.conversationId,
    })
    return {
      ok: true,
      data: {
        creationId,
        svgPath,
        svgContent: vlmRes.data.svg,
        durationMs: Date.now() - start,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "arch_failed",
      message: `❌ فشل توليد المخطط المعماري / architecture diagram failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Chart Generate — data → SVG chart (deterministic, no VLM)
// ---------------------------------------------------------------------------

const DEFAULT_CHART_COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"]

export async function chartGenerate(input: ChartInput): Promise<CreativeResult<ChartResult>> {
  const start = Date.now()
  try {
    if (!input.dataPoints || input.dataPoints.length === 0) {
      return { ok: false, error: "no_data", message: "❌ لا بيانات / no data points provided" }
    }
    const width = input.width ?? 800
    const height = input.height ?? 500
    const colors = input.colors ?? DEFAULT_CHART_COLORS
    const padding = { top: 50, right: 40, bottom: 60, left: 70 }
    const chartWidth = width - padding.left - padding.right
    const chartHeight = height - padding.top - padding.bottom

    let svgContent = ""

    if (input.type === "bar") {
      const maxVal = Math.max(...input.dataPoints.map((d) => d.value), 1)
      const barWidth = chartWidth / input.dataPoints.length * 0.7
      const barGap = chartWidth / input.dataPoints.length * 0.3
      let bars = ""
      input.dataPoints.forEach((d, i) => {
        const barHeight = (d.value / maxVal) * chartHeight
        const x = padding.left + i * (barWidth + barGap) + barGap / 2
        const y = padding.top + chartHeight - barHeight
        const color = colors[i % colors.length]
        bars += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${color}" rx="4" ry="4"/>`
        bars += `<text x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle" font-size="12" font-family="system-ui">${d.value}</text>`
        bars += `<text x="${x + barWidth / 2}" y="${padding.top + chartHeight + 20}" text-anchor="middle" font-size="11" font-family="system-ui" fill="#666">${d.label}</text>`
      })
      // Y-axis gridlines
      let gridlines = ""
      for (let i = 0; i <= 5; i++) {
        const y = padding.top + (chartHeight / 5) * i
        const val = Math.round(maxVal * (1 - i / 5))
        gridlines += `<line x1="${padding.left}" y1="${y}" x2="${padding.left + chartWidth}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>`
        gridlines += `<text x="${padding.left - 10}" y="${y + 4}" text-anchor="end" font-size="10" font-family="system-ui" fill="#666">${val}</text>`
      }
      svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="system-ui">
  ${input.title ? `<text x="${width / 2}" y="25" text-anchor="middle" font-size="18" font-weight="bold" fill="#1f2937">${escapeXml(input.title)}</text>` : ""}
  ${gridlines}
  <line x1="${padding.left}" y1="${padding.top + chartHeight}" x2="${padding.left + chartWidth}" y2="${padding.top + chartHeight}" stroke="#374151" stroke-width="2"/>
  <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + chartHeight}" stroke="#374151" stroke-width="2"/>
  ${bars}
  ${input.xLabel ? `<text x="${padding.left + chartWidth / 2}" y="${height - 10}" text-anchor="middle" font-size="12" fill="#666">${escapeXml(input.xLabel)}</text>` : ""}
  ${input.yLabel ? `<text x="20" y="${padding.top + chartHeight / 2}" text-anchor="middle" font-size="12" fill="#666" transform="rotate(-90 20 ${padding.top + chartHeight / 2})">${escapeXml(input.yLabel)}</text>` : ""}
</svg>`
    } else if (input.type === "line") {
      const maxVal = Math.max(...input.dataPoints.map((d) => d.value), 1)
      const xStep = chartWidth / Math.max(input.dataPoints.length - 1, 1)
      const points = input.dataPoints.map((d, i) => {
        const x = padding.left + i * xStep
        const y = padding.top + chartHeight - (d.value / maxVal) * chartHeight
        return `${x},${y}`
      }).join(" ")
      let labels = ""
      input.dataPoints.forEach((d, i) => {
        const x = padding.left + i * xStep
        labels += `<text x="${x}" y="${padding.top + chartHeight + 20}" text-anchor="middle" font-size="11" font-family="system-ui" fill="#666">${escapeXml(d.label)}</text>`
      })
      let gridlines = ""
      for (let i = 0; i <= 5; i++) {
        const y = padding.top + (chartHeight / 5) * i
        const val = Math.round(maxVal * (1 - i / 5))
        gridlines += `<line x1="${padding.left}" y1="${y}" x2="${padding.left + chartWidth}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>`
        gridlines += `<text x="${padding.left - 10}" y="${y + 4}" text-anchor="end" font-size="10" font-family="system-ui" fill="#666">${val}</text>`
      }
      svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="system-ui">
  ${input.title ? `<text x="${width / 2}" y="25" text-anchor="middle" font-size="18" font-weight="bold" fill="#1f2937">${escapeXml(input.title)}</text>` : ""}
  ${gridlines}
  <line x1="${padding.left}" y1="${padding.top + chartHeight}" x2="${padding.left + chartWidth}" y2="${padding.top + chartHeight}" stroke="#374151" stroke-width="2"/>
  <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + chartHeight}" stroke="#374151" stroke-width="2"/>
  <polyline points="${points}" fill="none" stroke="${colors[0]}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
  ${input.dataPoints.map((d, i) => {
    const x = padding.left + i * xStep
    const y = padding.top + chartHeight - (d.value / maxVal) * chartHeight
    return `<circle cx="${x}" cy="${y}" r="5" fill="${colors[0]}"/>`
  }).join("")}
  ${labels}
  ${input.xLabel ? `<text x="${padding.left + chartWidth / 2}" y="${height - 10}" text-anchor="middle" font-size="12" fill="#666">${escapeXml(input.xLabel)}</text>` : ""}
  ${input.yLabel ? `<text x="20" y="${padding.top + chartHeight / 2}" text-anchor="middle" font-size="12" fill="#666" transform="rotate(-90 20 ${padding.top + chartHeight / 2})">${escapeXml(input.yLabel)}</text>` : ""}
</svg>`
    } else if (input.type === "pie") {
      const total = input.dataPoints.reduce((sum, d) => sum + d.value, 0)
      if (total === 0) {
        return { ok: false, error: "zero_total", message: "❌ مجموع القيم صفر / total of values is zero" }
      }
      const cx = width / 2
      const cy = height / 2
      const r = Math.min(width, height) / 2 - 60
      let currentAngle = -Math.PI / 2 // start at top
      let slices = ""
      let legend = ""
      input.dataPoints.forEach((d, i) => {
        const sliceAngle = (d.value / total) * 2 * Math.PI
        const x1 = cx + r * Math.cos(currentAngle)
        const y1 = cy + r * Math.sin(currentAngle)
        const x2 = cx + r * Math.cos(currentAngle + sliceAngle)
        const y2 = cy + r * Math.sin(currentAngle + sliceAngle)
        const largeArc = sliceAngle > Math.PI ? 1 : 0
        const color = colors[i % colors.length]
        const pct = ((d.value / total) * 100).toFixed(1)
        slices += `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z" fill="${color}" stroke="white" stroke-width="2"/>`
        // Label outside the slice
        const labelAngle = currentAngle + sliceAngle / 2
        const lx = cx + (r + 20) * Math.cos(labelAngle)
        const ly = cy + (r + 20) * Math.sin(labelAngle)
        slices += `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="11" font-family="system-ui" fill="#374151">${escapeXml(d.label)} (${pct}%)</text>`
        // Legend
        const ly2 = 30 + i * 20
        legend += `<rect x="${width - 150}" y="${ly2 - 10}" width="12" height="12" fill="${color}"/>`
        legend += `<text x="${width - 130}" y="${ly2}" font-size="11" font-family="system-ui" fill="#374151">${escapeXml(d.label)}: ${d.value}</text>`
        currentAngle += sliceAngle
      })
      svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="system-ui">
  ${input.title ? `<text x="${width / 2}" y="25" text-anchor="middle" font-size="18" font-weight="bold" fill="#1f2937">${escapeXml(input.title)}</text>` : ""}
  ${slices}
  ${legend}
</svg>`
    } else if (input.type === "area") {
      const maxVal = Math.max(...input.dataPoints.map((d) => d.value), 1)
      const xStep = chartWidth / Math.max(input.dataPoints.length - 1, 1)
      const points = input.dataPoints.map((d, i) => {
        const x = padding.left + i * xStep
        const y = padding.top + chartHeight - (d.value / maxVal) * chartHeight
        return `${x},${y}`
      }).join(" ")
      const areaPoints = `${padding.left},${padding.top + chartHeight} ${points} ${padding.left + (input.dataPoints.length - 1) * xStep},${padding.top + chartHeight}`
      let labels = ""
      input.dataPoints.forEach((d, i) => {
        const x = padding.left + i * xStep
        labels += `<text x="${x}" y="${padding.top + chartHeight + 20}" text-anchor="middle" font-size="11" font-family="system-ui" fill="#666">${escapeXml(d.label)}</text>`
      })
      svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="system-ui">
  ${input.title ? `<text x="${width / 2}" y="25" text-anchor="middle" font-size="18" font-weight="bold" fill="#1f2937">${escapeXml(input.title)}</text>` : ""}
  <line x1="${padding.left}" y1="${padding.top + chartHeight}" x2="${padding.left + chartWidth}" y2="${padding.top + chartHeight}" stroke="#374151" stroke-width="2"/>
  <polygon points="${areaPoints}" fill="${colors[0]}" fill-opacity="0.3" stroke="${colors[0]}" stroke-width="2"/>
  ${labels}
  ${input.xLabel ? `<text x="${padding.left + chartWidth / 2}" y="${height - 10}" text-anchor="middle" font-size="12" fill="#666">${escapeXml(input.xLabel)}</text>` : ""}
  ${input.yLabel ? `<text x="20" y="${padding.top + chartHeight / 2}" text-anchor="middle" font-size="12" fill="#666" transform="rotate(-90 20 ${padding.top + chartHeight / 2})">${escapeXml(input.yLabel)}</text>` : ""}
</svg>`
    } else {
      return { ok: false, error: "bad_type", message: `❌ نوع رسم غير معروف / unknown chart type: ${input.type}` }
    }

    const svgPath = await saveSvg(svgContent, `chart-${input.type}`)
    const creationId = await persistCreation({
      type: "chart",
      prompt: input.title ?? `chart-${input.type}`,
      imagePath: svgPath,
      success: true,
      durationMs: Date.now() - start,
      metadata: { chartType: input.type, dataPoints: input.dataPoints.length, sizeBytes: Buffer.byteLength(svgContent, "utf8") },
      params: { type: input.type, title: input.title, xLabel: input.xLabel, yLabel: input.yLabel },
    })

    return {
      ok: true,
      data: {
        creationId,
        svgPath,
        svgContent,
        durationMs: Date.now() - start,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "chart_failed",
      message: `❌ فشل توليد الرسم / chart generation failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function creativeList(opts: { type?: CreativeType; success?: boolean; limit?: number; conversationId?: string } = {}): Promise<CreativeResult<ImageCreationRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.type) where.type = opts.type
    if (opts.success !== undefined) where.success = opts.success
    if (opts.conversationId) where.conversationId = opts.conversationId
    const rows = await db.imageCreation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 50,
    })
    return {
      ok: true,
      data: rows.map((r) => ({
        ...r,
        type: r.type as CreativeType,
        metadata: safeParse(r.metadata, {}),
        params: safeParse(r.params, {}),
      })),
    }
  } catch (e) {
    return {
      ok: false,
      error: "list_failed",
      message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function creativeGet(id: string): Promise<CreativeResult<ImageCreationRecord>> {
  try {
    const row = await db.imageCreation.findUnique({ where: { id } })
    if (!row) {
      return { ok: false, error: "not_found", message: `❌ غير موجود / not found: ${id}` }
    }
    return {
      ok: true,
      data: {
        ...row,
        type: row.type as CreativeType,
        metadata: safeParse(row.metadata, {}),
        params: safeParse(row.params, {}),
      },
    }
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

export interface CreativeSnapshot {
  totalCreations: number
  successful: number
  failed: number
  byType: Record<string, number>
  avgDurationMs: number
  recentCreations: Array<{ id: string; type: string; success: boolean; createdAt: Date }>
}

export async function creativeSnapshot(): Promise<CreativeResult<CreativeSnapshot>> {
  try {
    const creations = await db.imageCreation.findMany({ take: 1000, orderBy: { createdAt: "desc" } })
    const successful = creations.filter((c) => c.success).length
    const failed = creations.length - successful
    const byType: Record<string, number> = {}
    let totalDuration = 0
    for (const c of creations) {
      byType[c.type] = (byType[c.type] ?? 0) + 1
      totalDuration += c.durationMs
    }
    return {
      ok: true,
      data: {
        totalCreations: creations.length,
        successful,
        failed,
        byType,
        avgDurationMs: creations.length > 0 ? Math.round(totalDuration / creations.length) : 0,
        recentCreations: creations.slice(0, 10).map((c) => ({
          id: c.id,
          type: c.type,
          success: c.success,
          createdAt: c.createdAt,
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

export function formatCreativeResult<T>(result: CreativeResult<T>): string {
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
