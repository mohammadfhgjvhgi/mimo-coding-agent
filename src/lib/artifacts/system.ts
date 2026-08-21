// Artifacts — Claude/Open-WebUI-style interactive, editable, versioned artifacts.
// 8 operations, deterministic, bilingual (Arabic + English), persisted to SQLite.
//
// Design:
//   • Artifact (Prisma) — current content + metadata + visibility
//   • ArtifactVersion (Prisma) — full version history with content snapshots + diffs
//   • ArtifactShare (Prisma) — share links with optional password + expiry + view caps
//   • Content types: html | svg | dashboard | diagram | report | code | visualization | react | markdown
//   • Every save creates a new version (no destructive updates to content history)
//   • Diffs computed line-by-line (Myers-lite) + stored on ArtifactVersion
//
// 8 operations:
//   1. artifactCreate        — create a new artifact + initial version
//   2. artifactPreview        — render-safe preview (sanitize HTML, validate SVG, etc.)
//   3. artifactEdit           — save a new version (creates ArtifactVersion row)
//   4. artifactVersioning     — list versions, get a specific version, restore to a version
//   5. artifactDiff            — compute diff between two versions
//   6. artifactExport          — export as file (html/svg/md/code/raw)
//   7. artifactFork            — fork an artifact into a new one (with forkedFromId)
//   8. artifactShare            — create a share link (token + optional password + expiry)
//
// Plus the read helpers: artifactGet, artifactList, artifactGetByShare, artifactIncrementView.

import { db } from "@/lib/db"
import { createHash } from "node:crypto"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ArtifactType =
  | "html"
  | "svg"
  | "dashboard"
  | "diagram"
  | "report"
  | "code"
  | "visualization"
  | "react"
  | "markdown"

export type ArtifactVisibility = "private" | "unlisted" | "public"

export type ArtifactStatus = "active" | "archived" | "deleted"

export interface ArtifactMetadata {
  width?: number
  height?: number
  theme?: "light" | "dark" | "auto"
  dependencies?: string[]
  standalone?: boolean
  [key: string]: unknown
}

export interface ArtifactRecord {
  id: string
  slug: string
  title: string
  description: string | null
  type: ArtifactType
  content: string
  language: string | null
  checksum: string | null
  version: number
  metadata: ArtifactMetadata
  conversationId: string | null
  messageId: string | null
  authorId: string | null
  visibility: ArtifactVisibility
  tags: string[]
  forkedFromId: string | null
  viewCount: number
  forkCount: number
  status: ArtifactStatus
  createdAt: Date
  updatedAt: Date
}

export interface ArtifactVersionRecord {
  id: string
  artifactId: string
  version: number
  content: string
  checksum: string | null
  editSummary: {
    authorId?: string
    reason?: string
    editSource?: "user" | "agent" | "import"
  }
  sizeBytes: number
  diff: ArtifactDiff | null
  createdAt: Date
}

export interface ArtifactDiff {
  additions: number
  deletions: number
  blocks: Array<{
    type: "context" | "addition" | "deletion"
    lines: string[]
  }>
}

export interface ArtifactShareRecord {
  id: string
  artifactId: string
  token: string
  hasPassword: boolean
  expiresAt: Date | null
  maxViews: number
  viewCount: number
  allowFork: boolean
  createdBy: string | null
  createdAt: Date
}

export type ArtifactResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string }

// ---------------------------------------------------------------------------
// Row → record mappers
// ---------------------------------------------------------------------------

interface ArtifactRow {
  id: string
  slug: string
  title: string
  description: string | null
  type: string
  content: string
  language: string | null
  checksum: string | null
  version: number
  metadata: string
  conversationId: string | null
  messageId: string | null
  authorId: string | null
  visibility: string
  tags: string
  forkedFromId: string | null
  viewCount: number
  forkCount: number
  status: string
  createdAt: Date
  updatedAt: Date
}

function rowToRecord(row: ArtifactRow): ArtifactRecord {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    type: row.type as ArtifactType,
    content: row.content,
    language: row.language,
    checksum: row.checksum,
    version: row.version,
    metadata: safeParse<ArtifactMetadata>(row.metadata, {}),
    conversationId: row.conversationId,
    messageId: row.messageId,
    authorId: row.authorId,
    visibility: row.visibility as ArtifactVisibility,
    tags: safeParse<string[]>(row.tags, []),
    forkedFromId: row.forkedFromId,
    viewCount: row.viewCount,
    forkCount: row.forkCount,
    status: row.status as ArtifactStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

interface VersionRow {
  id: string
  artifactId: string
  version: number
  content: string
  checksum: string | null
  editSummary: string
  sizeBytes: number
  diff: string | null
  createdAt: Date
}

function versionRowToRecord(row: VersionRow): ArtifactVersionRecord {
  return {
    id: row.id,
    artifactId: row.artifactId,
    version: row.version,
    content: row.content,
    checksum: row.checksum,
    editSummary: safeParse(row.editSummary, {}),
    sizeBytes: row.sizeBytes,
    diff: row.diff ? safeParse<ArtifactDiff>(row.diff, { additions: 0, deletions: 0, blocks: [] }) : null,
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

function checksum(s: string): string {
  return createHash("sha256").update(s).digest("hex")
}

// ---------------------------------------------------------------------------
// Diff algorithm (Myers-lite: LCS-based line diff)
// ---------------------------------------------------------------------------

function computeDiff(oldText: string, newText: string): ArtifactDiff {
  const oldLines = oldText.split("\n")
  const newLines = newText.split("\n")
  // LCS table (small inputs only — for large artifacts, switch to a streaming diff).
  const MAX = 5000
  if (oldLines.length > MAX || newLines.length > MAX) {
    return {
      additions: newLines.length,
      deletions: oldLines.length,
      blocks: [{ type: "addition", lines: ["(diff too large — replaced with full content)"] }],
    }
  }
  const m = oldLines.length
  const n = newLines.length
  // dp[i][j] = LCS length of oldLines[i..] and newLines[j..]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
  }
  // Walk forward to build the diff blocks.
  const blocks: ArtifactDiff["blocks"] = []
  let i = 0
  let j = 0
  let current: ArtifactDiff["blocks"][number] | null = null
  let additions = 0
  let deletions = 0
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      // context line
      if (current && current.type !== "context") {
        blocks.push(current)
        current = null
      }
      if (!current) current = { type: "context", lines: [] }
      current.lines.push(oldLines[i])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      // deletion from old
      if (current && current.type !== "deletion") {
        blocks.push(current)
        current = null
      }
      if (!current) current = { type: "deletion", lines: [] }
      current.lines.push(oldLines[i])
      deletions++
      i++
    } else {
      // addition to new
      if (current && current.type !== "addition") {
        blocks.push(current)
        current = null
      }
      if (!current) current = { type: "addition", lines: [] }
      current.lines.push(newLines[j])
      additions++
      j++
    }
  }
  while (i < m) {
    if (current && current.type !== "deletion") {
      blocks.push(current)
      current = null
    }
    if (!current) current = { type: "deletion", lines: [] }
    current.lines.push(oldLines[i])
    deletions++
    i++
  }
  while (j < n) {
    if (current && current.type !== "addition") {
      blocks.push(current)
      current = null
    }
    if (!current) current = { type: "addition", lines: [] }
    current.lines.push(newLines[j])
    additions++
    j++
  }
  if (current) blocks.push(current)
  return { additions, deletions, blocks }
}

// ---------------------------------------------------------------------------
// Content sanitization (best-effort, deterministic, no external deps)
// ---------------------------------------------------------------------------

/**
 * Sanitize HTML for safe preview in an iframe sandbox.
 * Strips <script>, on* attributes, javascript: URLs.
 * NOTE: This is a basic pass — for production use DOMPurify.
 */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/<iframe\b[^>]*>/gi, "<!-- iframe blocked -->")
}

/**
 * Validate that content is well-formed SVG (starts with <svg or contains an <svg).
 */
function isValidSvg(content: string): boolean {
  return /<svg[\s>]/i.test(content) && /<\/svg>/i.test(content)
}

/**
 * Wrap bare content with the right preview envelope based on type.
 */
function wrapForPreview(content: string, type: ArtifactType, metadata: ArtifactMetadata): string {
  switch (type) {
    case "html":
    case "dashboard":
    case "visualization":
      return sanitizeHtml(content)
    case "svg":
    case "diagram":
      return isValidSvg(content) ? content : `<div>❌ SVG غير صالح / invalid SVG</div>`
    case "react": {
      // For react artifacts, we can't transpile at runtime without babel — show source.
      const escaped = content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      return `<pre style="padding:1rem;background:#0d1117;color:#c9d1d9;border-radius:6px;overflow:auto;font-family:ui-monospace,monospace;font-size:13px">${escaped}</pre>`
    }
    case "code": {
      const escaped = content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      return `<pre style="padding:1rem;background:#0d1117;color:#c9d1d9;border-radius:6px;overflow:auto;font-family:ui-monospace,monospace;font-size:13px">${escaped}</pre>`
    }
    case "markdown":
    case "report": {
      // Ultra-light markdown: headings, bold, italic, code, paragraphs.
      let html = content
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/^### (.+)$/gm, "<h3>$1</h3>")
        .replace(/^## (.+)$/gm, "<h2>$1</h2>")
        .replace(/^# (.+)$/gm, "<h1>$1</h1>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*]+)\*/g, "<em>$1</em>")
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\n\n/g, "</p><p>")
      return `<div style="padding:1rem;font-family:system-ui,sans-serif;line-height:1.6"><p>${html}</p></div>`
    }
    default:
      return sanitizeHtml(content)
  }
}

// ---------------------------------------------------------------------------
// 1. Artifact Creation — create a new artifact + initial version
// ---------------------------------------------------------------------------

export interface CreateArtifactInput {
  title: string
  description?: string
  type: ArtifactType
  content: string
  language?: string
  metadata?: ArtifactMetadata
  conversationId?: string
  messageId?: string
  authorId?: string
  visibility?: ArtifactVisibility
  tags?: string[]
}

export async function artifactCreate(input: CreateArtifactInput): Promise<ArtifactResult<ArtifactRecord>> {
  try {
    if (!input.title || !input.content) {
      return {
        ok: false,
        error: "bad_input",
        message: "❌ المدخلات غير مكتملة / incomplete input (title + content required)",
      }
    }
    const cs = checksum(input.content)
    const row = await db.artifact.create({
      data: {
        title: input.title,
        description: input.description,
        type: input.type,
        content: input.content,
        language: input.language,
        checksum: cs,
        version: 1,
        metadata: JSON.stringify(input.metadata ?? {}),
        conversationId: input.conversationId,
        messageId: input.messageId,
        authorId: input.authorId,
        visibility: input.visibility ?? "private",
        tags: JSON.stringify(input.tags ?? []),
        status: "active",
      },
    })
    // Create the initial version.
    await db.artifactVersion.create({
      data: {
        artifactId: row.id,
        version: 1,
        content: input.content,
        checksum: cs,
        editSummary: JSON.stringify({ editSource: "user" }),
        sizeBytes: Buffer.byteLength(input.content, "utf8"),
        diff: null, // first version — no diff
      },
    })
    return { ok: true, data: rowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "create_failed",
      message: `❌ فشل الإنشاء / create failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Artifact Preview — return render-safe content for an iframe sandbox
// ---------------------------------------------------------------------------

export async function artifactPreview(
  idOrSlug: string,
  opts: { version?: number; raw?: boolean } = {}
): Promise<ArtifactResult<{ html: string; type: ArtifactType; version: number; metadata: ArtifactMetadata; raw: string }>> {
  try {
    let row: ArtifactRow | null = null
    if (opts.version) {
      // Fetch a specific version.
      const artifact = await db.artifact.findFirst({
        where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      })
      if (!artifact) {
        return { ok: false, error: "not_found", message: `❌ الأرتيفاكت غير موجود / artifact not found: ${idOrSlug}` }
      }
      const ver = await db.artifactVersion.findUnique({
        where: { artifactId_version: { artifactId: artifact.id, version: opts.version } },
      })
      if (!ver) {
        return { ok: false, error: "version_not_found", message: `❌ الإصدار غير موجود / version not found: ${opts.version}` }
      }
      row = {
        ...artifact,
        content: ver.content,
        checksum: ver.checksum,
        version: ver.version,
      } as ArtifactRow
    } else {
      row = (await db.artifact.findFirst({
        where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      })) as ArtifactRow | null
    }
    if (!row) {
      return { ok: false, error: "not_found", message: `❌ الأرتيفاكت غير موجود / artifact not found: ${idOrSlug}` }
    }
    const metadata = safeParse<ArtifactMetadata>(row.metadata, {})
    const raw = row.content
    if (opts.raw) {
      return { ok: true, data: { html: raw, type: row.type as ArtifactType, version: row.version, metadata, raw } }
    }
    const html = wrapForPreview(raw, row.type as ArtifactType, metadata)
    return { ok: true, data: { html, type: row.type as ArtifactType, version: row.version, metadata, raw } }
  } catch (e) {
    return {
      ok: false,
      error: "preview_failed",
      message: `❌ فشل المعاينة / preview failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Artifact Editing — save a new version (creates ArtifactVersion row)
// ---------------------------------------------------------------------------

export interface EditArtifactInput {
  content: string
  reason?: string
  editSource?: "user" | "agent" | "import"
  authorId?: string
  title?: string  // optional title update
  description?: string
}

export async function artifactEdit(
  idOrSlug: string,
  input: EditArtifactInput
): Promise<ArtifactResult<ArtifactRecord>> {
  try {
    const existing = await db.artifact.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الأرتيفاكت غير موجود / artifact not found: ${idOrSlug}` }
    }
    const oldContent = existing.content
    const newContent = input.content
    const newChecksum = checksum(newContent)
    const newVersion = existing.version + 1

    // Compute diff against previous version.
    const diff = computeDiff(oldContent, newContent)

    // Create the new version row.
    await db.artifactVersion.create({
      data: {
        artifactId: existing.id,
        version: newVersion,
        content: newContent,
        checksum: newChecksum,
        editSummary: JSON.stringify({
          authorId: input.authorId,
          reason: input.reason,
          editSource: input.editSource ?? "user",
        }),
        sizeBytes: Buffer.byteLength(newContent, "utf8"),
        diff: JSON.stringify(diff),
      },
    })

    // Update the artifact's current content + version.
    const data: Record<string, unknown> = {
      content: newContent,
      checksum: newChecksum,
      version: newVersion,
    }
    if (input.title !== undefined) data.title = input.title
    if (input.description !== undefined) data.description = input.description

    const row = await db.artifact.update({
      where: { id: existing.id },
      data,
    })
    return { ok: true, data: rowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "edit_failed",
      message: `❌ فشل التحرير / edit failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Artifact Versioning — list versions, get a specific version, restore
// ---------------------------------------------------------------------------

export async function artifactListVersions(idOrSlug: string): Promise<ArtifactResult<Array<{
  version: number
  createdAt: Date
  sizeBytes: number
  additions: number
  deletions: number
  editSource: string
  reason?: string
}>>> {
  try {
    const existing = await db.artifact.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الأرتيفاكت غير موجود / artifact not found: ${idOrSlug}` }
    }
    const versions = await db.artifactVersion.findMany({
      where: { artifactId: existing.id },
      orderBy: { version: "asc" },
    })
    return {
      ok: true,
      data: versions.map((v) => {
        const diff = v.diff ? safeParse<ArtifactDiff>(v.diff, { additions: 0, deletions: 0, blocks: [] }) : null
        const summary = safeParse<{ editSource?: string; reason?: string }>(v.editSummary, {})
        return {
          version: v.version,
          createdAt: v.createdAt,
          sizeBytes: v.sizeBytes,
          additions: diff?.additions ?? 0,
          deletions: diff?.deletions ?? 0,
          editSource: summary.editSource ?? "user",
          reason: summary.reason,
        }
      }),
    }
  } catch (e) {
    return {
      ok: false,
      error: "list_versions_failed",
      message: `❌ فشل سرد الإصدارات / list versions failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function artifactGetVersion(
  idOrSlug: string,
  version: number
): Promise<ArtifactResult<ArtifactVersionRecord>> {
  try {
    const existing = await db.artifact.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الأرتيفاكت غير موجود / artifact not found: ${idOrSlug}` }
    }
    const ver = await db.artifactVersion.findUnique({
      where: { artifactId_version: { artifactId: existing.id, version } },
    })
    if (!ver) {
      return { ok: false, error: "version_not_found", message: `❌ الإصدار غير موجود / version not found: ${version}` }
    }
    return { ok: true, data: versionRowToRecord(ver) }
  } catch (e) {
    return {
      ok: false,
      error: "get_version_failed",
      message: `❌ فشل جلب الإصدار / get version failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function artifactRestore(
  idOrSlug: string,
  version: number,
  opts: { authorId?: string; reason?: string } = {}
): Promise<ArtifactResult<ArtifactRecord>> {
  try {
    const existing = await db.artifact.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الأرتيفاكت غير موجود / artifact not found: ${idOrSlug}` }
    }
    const ver = await db.artifactVersion.findUnique({
      where: { artifactId_version: { artifactId: existing.id, version } },
    })
    if (!ver) {
      return { ok: false, error: "version_not_found", message: `❌ الإصدار غير موجود / version not found: ${version}` }
    }
    // Restore = create a new version with the old content.
    return artifactEdit(idOrSlug, {
      content: ver.content,
      reason: opts.reason ?? `restored to v${version}`,
      editSource: "user",
      authorId: opts.authorId,
    })
  } catch (e) {
    return {
      ok: false,
      error: "restore_failed",
      message: `❌ فشل الاستعادة / restore failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Artifact Diff — compute diff between two versions
// ---------------------------------------------------------------------------

export async function artifactDiff(
  idOrSlug: string,
  fromVersion: number,
  toVersion: number
): Promise<ArtifactResult<{ fromVersion: number; toVersion: number; diff: ArtifactDiff }>> {
  try {
    const existing = await db.artifact.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الأرتيفاكت غير موجود / artifact not found: ${idOrSlug}` }
    }
    const from = await db.artifactVersion.findUnique({
      where: { artifactId_version: { artifactId: existing.id, version: fromVersion } },
    })
    const to = await db.artifactVersion.findUnique({
      where: { artifactId_version: { artifactId: existing.id, version: toVersion } },
    })
    if (!from || !to) {
      return { ok: false, error: "version_not_found", message: `❌ إصدار غير موجود / version not found` }
    }
    const diff = computeDiff(from.content, to.content)
    return { ok: true, data: { fromVersion, toVersion, diff } }
  } catch (e) {
    return {
      ok: false,
      error: "diff_failed",
      message: `❌ فشل حساب الفرق / diff failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Artifact Export — export as a downloadable file
// ---------------------------------------------------------------------------

export interface ExportResult {
  filename: string
  mimeType: string
  content: string
  sizeBytes: number
}

export async function artifactExport(
  idOrSlug: string,
  opts: { format?: "raw" | "html" | "svg" | "md" | "json"; version?: number } = {}
): Promise<ArtifactResult<ExportResult>> {
  try {
    const preview = await artifactPreview(idOrSlug, { version: opts.version, raw: true })
    if (!preview.ok) return preview as unknown as ArtifactResult<ExportResult>
    const { type, version, raw, metadata } = preview.data
    const format = opts.format ?? "raw"
    let content = raw
    let mimeType = "text/plain"
    let ext = "txt"
    switch (format) {
      case "raw":
        content = raw
        ext = type === "code" ? "txt" : type === "markdown" || type === "report" ? "md" : type
        mimeType = type === "svg" || type === "diagram" ? "image/svg+xml" : "text/plain"
        break
      case "html":
        content = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${idOrSlug}</title>
<style>body{margin:0;padding:1rem;font-family:system-ui,sans-serif}</style>
</head>
<body>
${wrapForPreview(raw, type, metadata)}
</body>
</html>`
        ext = "html"
        mimeType = "text/html"
        break
      case "svg":
        if (type !== "svg" && type !== "diagram") {
          return { ok: false, error: "bad_type", message: `❌ التصدير SVG متاح فقط للأنواع svg/diagram / SVG export only for svg/diagram types` }
        }
        content = raw
        ext = "svg"
        mimeType = "image/svg+xml"
        break
      case "md":
        content = raw
        ext = "md"
        mimeType = "text/markdown"
        break
      case "json": {
        const artifact = await artifactGet(idOrSlug)
        if (!artifact.ok) return artifact as unknown as ArtifactResult<ExportResult>
        content = JSON.stringify(artifact.data, null, 2)
        ext = "json"
        mimeType = "application/json"
        break
      }
    }
    const filename = `${idOrSlug}-v${version}.${ext}`
    return {
      ok: true,
      data: {
        filename,
        mimeType,
        content,
        sizeBytes: Buffer.byteLength(content, "utf8"),
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "export_failed",
      message: `❌ فشل التصدير / export failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Artifact Forking — fork an artifact into a new one
// ---------------------------------------------------------------------------

export async function artifactFork(
  idOrSlug: string,
  opts: { title?: string; authorId?: string; visibility?: ArtifactVisibility } = {}
): Promise<ArtifactResult<ArtifactRecord>> {
  try {
    const existing = await db.artifact.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الأرتيفاكت غير موجود / artifact not found: ${idOrSlug}` }
    }
    // Create a new artifact with the same content but new id + forkedFromId.
    const fork = await artifactCreate({
      title: opts.title ?? `${existing.title} (نسخة)`,
      description: existing.description ?? undefined,
      type: existing.type as ArtifactType,
      content: existing.content,
      language: existing.language ?? undefined,
      metadata: safeParse<ArtifactMetadata>(existing.metadata, {}),
      authorId: opts.authorId,
      visibility: opts.visibility ?? "private",
      tags: safeParse<string[]>(existing.tags, []),
    })
    if (!fork.ok) return fork
    // Mark the forkedFromId.
    const updated = await db.artifact.update({
      where: { id: fork.data.id },
      data: { forkedFromId: existing.id },
    })
    // Increment the original's fork count.
    await db.artifact.update({
      where: { id: existing.id },
      data: { forkCount: { increment: 1 } },
    })
    return { ok: true, data: rowToRecord(updated) }
  } catch (e) {
    return {
      ok: false,
      error: "fork_failed",
      message: `❌ فشل التفريع / fork failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 8. Artifact Sharing — create a share link (token + optional password + expiry)
// ---------------------------------------------------------------------------

export interface CreateShareInput {
  artifactId: string
  password?: string  // plaintext — will be hashed via SHA-256 (not bcrypt to avoid dep)
  expiresInHours?: number  // null/0 = never expires
  maxViews?: number  // 0 = unlimited
  allowFork?: boolean  // default true
  createdBy?: string
}

export async function artifactShare(input: CreateShareInput): Promise<ArtifactResult<ArtifactShareRecord>> {
  try {
    const existing = await db.artifact.findUnique({ where: { id: input.artifactId } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الأرتيفاكت غير موجود / artifact not found` }
    }
    const expiresAt = input.expiresInHours && input.expiresInHours > 0
      ? new Date(Date.now() + input.expiresInHours * 3600_000)
      : null
    const passwordHash = input.password
      ? createHash("sha256").update(input.password).digest("hex")
      : null
    const row = await db.artifactShare.create({
      data: {
        artifactId: input.artifactId,
        password: passwordHash,
        expiresAt,
        maxViews: input.maxViews ?? 0,
        allowFork: input.allowFork ?? true,
        createdBy: input.createdBy,
      },
    })
    return {
      ok: true,
      data: {
        id: row.id,
        artifactId: row.artifactId,
        token: row.token,
        hasPassword: row.password !== null,
        expiresAt: row.expiresAt,
        maxViews: row.maxViews,
        viewCount: row.viewCount,
        allowFork: row.allowFork,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "share_failed",
      message: `❌ فشل المشاركة / share failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function artifactGetByShare(
  token: string,
  opts: { password?: string } = {}
): Promise<ArtifactResult<{ artifact: ArtifactRecord; share: ArtifactShareRecord }>> {
  try {
    const share = await db.artifactShare.findUnique({ where: { token } })
    if (!share) {
      return { ok: false, error: "not_found", message: `❌ رابط المشاركة غير صالح / invalid share link` }
    }
    // Check expiry.
    if (share.expiresAt && share.expiresAt < new Date()) {
      return { ok: false, error: "expired", message: `❌ انتهت صلاحية الرابط / link expired` }
    }
    // Check view cap.
    if (share.maxViews > 0 && share.viewCount >= share.maxViews) {
      return { ok: false, error: "max_views", message: `❌ تم الوصول للحد الأقصى من المشاهدات / max views reached` }
    }
    // Check password.
    if (share.password) {
      if (!opts.password) {
        return { ok: false, error: "password_required", message: `❌ كلمة سر مطلوبة / password required` }
      }
      const providedHash = createHash("sha256").update(opts.password).digest("hex")
      if (providedHash !== share.password) {
        return { ok: false, error: "bad_password", message: `❌ كلمة سر خاطئة / wrong password` }
      }
    }
    const artifact = await db.artifact.findUnique({ where: { id: share.artifactId } })
    if (!artifact) {
      return { ok: false, error: "artifact_gone", message: `❌ الأرتيفاكت محذوف / artifact deleted` }
    }
    // Increment view count.
    await db.artifactShare.update({
      where: { id: share.id },
      data: { viewCount: { increment: 1 } },
    })
    // Also increment the artifact's view count.
    await db.artifact.update({
      where: { id: artifact.id },
      data: { viewCount: { increment: 1 } },
    })
    return {
      ok: true,
      data: {
        artifact: rowToRecord(artifact),
        share: {
          id: share.id,
          artifactId: share.artifactId,
          token: share.token,
          hasPassword: share.password !== null,
          expiresAt: share.expiresAt,
          maxViews: share.maxViews,
          viewCount: share.viewCount + 1,
          allowFork: share.allowFork,
          createdBy: share.createdBy,
          createdAt: share.createdAt,
        },
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "share_access_failed",
      message: `❌ فشل الوصول عبر المشاركة / share access failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function artifactListShares(artifactId: string): Promise<ArtifactResult<ArtifactShareRecord[]>> {
  try {
    const shares = await db.artifactShare.findMany({
      where: { artifactId },
      orderBy: { createdAt: "desc" },
    })
    return {
      ok: true,
      data: shares.map((s) => ({
        id: s.id,
        artifactId: s.artifactId,
        token: s.token,
        hasPassword: s.password !== null,
        expiresAt: s.expiresAt,
        maxViews: s.maxViews,
        viewCount: s.viewCount,
        allowFork: s.allowFork,
        createdBy: s.createdBy,
        createdAt: s.createdAt,
      })),
    }
  } catch (e) {
    return {
      ok: false,
      error: "list_shares_failed",
      message: `❌ فشل سرد الروابط / list shares failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function artifactRevokeShare(token: string): Promise<ArtifactResult<{ revoked: boolean }>> {
  try {
    await db.artifactShare.delete({ where: { token } }).catch(() => null)
    return { ok: true, data: { revoked: true } }
  } catch (e) {
    return {
      ok: false,
      error: "revoke_failed",
      message: `❌ فشل الإلغاء / revoke failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

export async function artifactGet(idOrSlug: string): Promise<ArtifactResult<ArtifactRecord>> {
  try {
    const row = await db.artifact.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    })
    if (!row) {
      return { ok: false, error: "not_found", message: `❌ الأرتيفاكت غير موجود / artifact not found: ${idOrSlug}` }
    }
    return { ok: true, data: rowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "get_failed",
      message: `❌ فشل الجلب / get failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function artifactList(opts: {
  conversationId?: string
  type?: ArtifactType
  visibility?: ArtifactVisibility
  authorId?: string
  status?: ArtifactStatus
  limit?: number
} = {}): Promise<ArtifactResult<ArtifactRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.conversationId) where.conversationId = opts.conversationId
    if (opts.type) where.type = opts.type
    if (opts.visibility) where.visibility = opts.visibility
    if (opts.authorId) where.authorId = opts.authorId
    if (opts.status) where.status = opts.status
    else where.status = { not: "deleted" }
    const rows = await db.artifact.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: opts.limit ?? 50,
    })
    return { ok: true, data: rows.map(rowToRecord) }
  } catch (e) {
    return {
      ok: false,
      error: "list_failed",
      message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function artifactArchive(idOrSlug: string): Promise<ArtifactResult<ArtifactRecord>> {
  try {
    const existing = await db.artifact.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الأرتيفاكت غير موجود / artifact not found: ${idOrSlug}` }
    }
    const row = await db.artifact.update({
      where: { id: existing.id },
      data: { status: "archived" },
    })
    return { ok: true, data: rowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "archive_failed",
      message: `❌ فشل الأرشفة / archive failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function artifactDelete(idOrSlug: string): Promise<ArtifactResult<{ deleted: boolean }>> {
  try {
    const existing = await db.artifact.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الأرتيفاكت غير موجود / artifact not found: ${idOrSlug}` }
    }
    // Soft delete: mark status as deleted (preserves version history).
    await db.artifact.update({
      where: { id: existing.id },
      data: { status: "deleted" },
    })
    return { ok: true, data: { deleted: true } }
  } catch (e) {
    return {
      ok: false,
      error: "delete_failed",
      message: `❌ فشل الحذف / delete failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface ArtifactSnapshot {
  total: number
  active: number
  archived: number
  byType: Record<string, number>
  byVisibility: Record<string, number>
  totalVersions: number
  totalShares: number
  totalForks: number
  totalViews: number
}

export async function artifactSnapshot(): Promise<ArtifactResult<ArtifactSnapshot>> {
  try {
    const artifacts = await db.artifact.findMany({ where: { status: { not: "deleted" } } })
    const active = artifacts.filter((a) => a.status === "active").length
    const archived = artifacts.filter((a) => a.status === "archived").length
    const byType: Record<string, number> = {}
    const byVisibility: Record<string, number> = {}
    for (const a of artifacts) {
      byType[a.type] = (byType[a.type] ?? 0) + 1
      byVisibility[a.visibility] = (byVisibility[a.visibility] ?? 0) + 1
    }
    const totalVersions = await db.artifactVersion.count()
    const totalShares = await db.artifactShare.count()
    const totalForks = artifacts.reduce((sum, a) => sum + a.forkCount, 0)
    const totalViews = artifacts.reduce((sum, a) => sum + a.viewCount, 0)
    return {
      ok: true,
      data: {
        total: artifacts.length,
        active,
        archived,
        byType,
        byVisibility,
        totalVersions,
        totalShares,
        totalForks,
        totalViews,
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

export function formatArtifactResult<T>(result: ArtifactResult<T>): string {
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
