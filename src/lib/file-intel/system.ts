// File Intelligence — file indexing, search, metadata, dedup, versioning.
// 11 operations, deterministic, bilingual (Arabic + English), persisted to SQLite.
//
// Design:
//   • FileIndex (Prisma) — registry: path, checksum, extracted text, metadata, status
//   • FileVersion (Prisma) — snapshot history with checksum + optional content snapshot
//   • FolderWatcher (Prisma) — polled directories with include/exclude globs
//   • Uses node:fs + node:crypto — no external deps
//   • OCR via z-ai-web-dev-sdk VLM skill (when available; else mark as pending)
//   • Content hashing (SHA-256) for dedup + tamper detection
//   • Incremental indexing: only re-hash files whose mtime changed since last scan
//
// 11 operations:
//   1.  fileUpload             — save uploaded buffer + create FileIndex
//   2.  filePreview            — return file content (text|base64) + preview metadata
//   3.  fileExtract            — extract text content (txt/md/code → direct; pdf/docx → heuristics)
//   4.  fileOcr                — OCR images via VLM skill (returns text)
//   5.  fileParse              — structured document parsing (headings, sections, tables)
//   6.  fileSearch             — full-text search over extractedText (case-insensitive, ranked)
//   7.  folderWatcherAdd       — register a directory for polling
//   8.  folderWatcherScan      — incremental scan: detect added/modified/deleted + index
//   9.  fileDedup              — find files with identical checksums; mark duplicates
//   10. fileMetadata            — get/set metadata (title, author, tags, custom)
//   11. fileVersioning           — create version snapshots + list versions + restore

import { db } from "@/lib/db"
import { createHash } from "node:crypto"
import { readFile, writeFile, mkdir, stat, readdir, copyFile, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileSource = "workspace" | "upload" | "external"

export type IndexStatus = "pending" | "indexed" | "error" | "deleted"

export interface FileMetadata {
  title?: string
  author?: string
  pages?: number
  dimensions?: { width: number; height: number }
  duration?: number
  encoding?: string
  language?: string
  [key: string]: unknown
}

export interface FileRecord {
  id: string
  path: string
  source: FileSource
  filename: string
  extension: string
  mimeType: string
  sizeBytes: number
  checksum: string | null
  metadata: FileMetadata
  extractedText: string | null
  ocrDone: boolean
  indexStatus: IndexStatus
  indexedAt: Date | null
  fileModifiedAt: Date | null
  duplicateOfId: string | null
  versionCount: number
  tags: string[]
  createdAt: Date
  updatedAt: Date
}

export interface FileVersionRecord {
  id: string
  fileId: string
  version: number
  checksum: string
  sizeBytes: number
  snapshotPath: string | null
  editSummary: { reason?: string; authorId?: string; trigger?: string }
  createdAt: Date
}

export interface FolderWatcherRecord {
  id: string
  path: string
  includeGlobs: string[]
  excludeGlobs: string[]
  active: boolean
  intervalSec: number
  lastScanAt: Date | null
  lastScanAdded: number
  lastScanModified: number
  lastScanDeleted: number
  createdAt: Date
  updatedAt: Date
}

export interface SearchHit {
  fileId: string
  path: string
  filename: string
  score: number
  snippet: string
  matchedLine: number
}

export interface ScanResult {
  added: number
  modified: number
  deleted: number
  unchanged: number
  errors: string[]
  durationMs: number
}

export interface DedupGroup {
  checksum: string
  files: FileRecord[]
  totalSize: number
  wastedBytes: number
}

export type FileResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string }

// ---------------------------------------------------------------------------
// Constants + helpers
// ---------------------------------------------------------------------------

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "rst",
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "json", "yaml", "yml", "toml", "ini", "cfg",
  "py", "rb", "go", "rs", "java", "kt", "swift", "c", "cpp", "h", "hpp",
  "sh", "bash", "zsh", "fish", "ps1",
  "html", "htm", "css", "scss", "sass", "less",
  "xml", "svg", "csv", "tsv", "log", "env",
])

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp", "tiff", "ico"])

const DOC_EXTENSIONS = new Set(["pdf", "docx", "doc", "pptx", "xlsx", "odt", "rtf"])

const MIME_MAP: Record<string, string> = {
  txt: "text/plain", md: "text/markdown", markdown: "text/markdown",
  ts: "text/typescript", tsx: "text/typescript", js: "text/javascript", jsx: "text/javascript",
  mjs: "text/javascript", cjs: "text/javascript",
  json: "application/json", yaml: "text/yaml", yml: "text/yaml", toml: "text/plain",
  py: "text/x-python", rb: "text/x-ruby", go: "text/x-go", rs: "text/x-rust",
  html: "text/html", htm: "text/html", css: "text/css", scss: "text/x-scss",
  xml: "application/xml", svg: "image/svg+xml", csv: "text/csv",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  bmp: "image/bmp", webp: "image/webp", ico: "image/x-icon",
  pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip", gz: "application/gzip", tar: "application/x-tar",
}

function extOf(filename: string): string {
  const m = filename.match(/\.([^.]+)$/)
  return m ? m[1].toLowerCase() : ""
}

function mimeOf(filename: string): string {
  return MIME_MAP[extOf(filename)] ?? "application/octet-stream"
}

function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

function checksumOf(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex")
}

// ---------------------------------------------------------------------------
// Row → record mappers
// ---------------------------------------------------------------------------

interface FileRow {
  id: string
  path: string
  source: string
  filename: string
  extension: string
  mimeType: string
  sizeBytes: number
  checksum: string | null
  metadata: string
  extractedText: string | null
  ocrDone: boolean
  indexStatus: string
  indexedAt: Date | null
  fileModifiedAt: Date | null
  duplicateOfId: string | null
  versionCount: number
  tags: string
  createdAt: Date
  updatedAt: Date
}

function rowToRecord(row: FileRow): FileRecord {
  return {
    id: row.id,
    path: row.path,
    source: row.source as FileSource,
    filename: row.filename,
    extension: row.extension,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    checksum: row.checksum,
    metadata: safeParse(row.metadata, {}),
    extractedText: row.extractedText,
    ocrDone: row.ocrDone,
    indexStatus: row.indexStatus as IndexStatus,
    indexedAt: row.indexedAt,
    fileModifiedAt: row.fileModifiedAt,
    duplicateOfId: row.duplicateOfId,
    versionCount: row.versionCount,
    tags: safeParse(row.tags, []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

interface WatcherRow {
  id: string
  path: string
  includeGlobs: string
  excludeGlobs: string
  active: boolean
  intervalSec: number
  lastScanAt: Date | null
  lastScanAdded: number
  lastScanModified: number
  lastScanDeleted: number
  createdAt: Date
  updatedAt: Date
}

function watcherRowToRecord(row: WatcherRow): FolderWatcherRecord {
  return {
    id: row.id,
    path: row.path,
    includeGlobs: safeParse(row.includeGlobs, []),
    excludeGlobs: safeParse(row.excludeGlobs, []),
    active: row.active,
    intervalSec: row.intervalSec,
    lastScanAt: row.lastScanAt,
    lastScanAdded: row.lastScanAdded,
    lastScanModified: row.lastScanModified,
    lastScanDeleted: row.lastScanDeleted,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

interface VersionRow {
  id: string
  fileId: string
  version: number
  checksum: string
  sizeBytes: number
  snapshotPath: string | null
  editSummary: string
  createdAt: Date
}

function versionRowToRecord(row: VersionRow): FileVersionRecord {
  return {
    id: row.id,
    fileId: row.fileId,
    version: row.version,
    checksum: row.checksum,
    sizeBytes: row.sizeBytes,
    snapshotPath: row.snapshotPath,
    editSummary: safeParse(row.editSummary, {}),
    createdAt: row.createdAt,
  }
}

// ---------------------------------------------------------------------------
// Glob matching (minimal — supports ** and *)
// ---------------------------------------------------------------------------

function globToRegex(glob: string): RegExp {
  // ** → match any path segment(s)
  // * → match any chars except path separator
  let re = glob.replace(/\./g, "\\.").replace(/\*\*/g, "::DOUBLESTAR::").replace(/\*/g, "[^/]*").replace(/::DOUBLESTAR::/g, ".*")
  if (!re.startsWith("^")) re = "^" + re
  if (!re.endsWith("$")) re = re + "$"
  return new RegExp(re)
}

function matchesGlobs(p: string, globs: string[]): boolean {
  if (globs.length === 0) return true
  for (const g of globs) {
    try {
      if (globToRegex(g).test(p)) return true
    } catch {
      /* skip bad glob */
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// 1. File Upload — save uploaded buffer + create FileIndex
// ---------------------------------------------------------------------------

export interface UploadInput {
  filename: string
  content: Buffer | string
  source?: FileSource
  /** For uploads, where to save. Default: upload/<filename> */
  savePath?: string
  metadata?: FileMetadata
  tags?: string[]
  /** If true, immediately extract text content after upload. Default true. */
  extractImmediately?: boolean
}

export async function fileUpload(input: UploadInput): Promise<FileResult<FileRecord>> {
  try {
    if (!input.filename) {
      return { ok: false, error: "bad_input", message: "❌ اسم الملف مطلوب / filename required" }
    }
    const buffer = typeof input.content === "string" ? Buffer.from(input.content, "utf8") : input.content
    const ext = extOf(input.filename)
    const cs = checksumOf(buffer)
    const source = input.source ?? "upload"

    // Save to disk if upload.
    let savedPath: string
    if (source === "upload") {
      const dir = path.join(WORKSPACE_ROOT, "upload")
      await mkdir(dir, { recursive: true })
      const filename = input.savePath ?? `${Date.now()}-${input.filename}`
      savedPath = path.join(dir, path.basename(filename))
      await writeFile(savedPath, buffer)
    } else {
      // workspace: path is already on disk
      savedPath = input.savePath
        ? (path.isAbsolute(input.savePath) ? input.savePath : path.resolve(WORKSPACE_ROOT, input.savePath))
        : path.resolve(WORKSPACE_ROOT, input.filename)
    }

    const st = await stat(savedPath)
    const row = await db.fileIndex.upsert({
      where: { path: savedPath },
      update: {
        filename: path.basename(savedPath),
        extension: ext,
        mimeType: mimeOf(input.filename),
        sizeBytes: st.size,
        checksum: cs,
        metadata: JSON.stringify(input.metadata ?? {}),
        tags: JSON.stringify(input.tags ?? []),
        indexStatus: "pending",
        fileModifiedAt: st.mtime,
      },
      create: {
        path: savedPath,
        source,
        filename: path.basename(savedPath),
        extension: ext,
        mimeType: mimeOf(input.filename),
        sizeBytes: st.size,
        checksum: cs,
        metadata: JSON.stringify(input.metadata ?? {}),
        tags: JSON.stringify(input.tags ?? []),
        indexStatus: "pending",
        fileModifiedAt: st.mtime,
      },
    })

    // Optionally extract text immediately.
    if (input.extractImmediately !== false) {
      await fileExtract(row.id)
    }

    // Check for duplicates (same checksum).
    const dup = await db.fileIndex.findFirst({
      where: { checksum: cs, NOT: { id: row.id } },
    })
    if (dup) {
      await db.fileIndex.update({
        where: { id: row.id },
        data: { duplicateOfId: dup.id },
      })
    }

    const updated = await db.fileIndex.findUnique({ where: { id: row.id } })
    return { ok: true, data: rowToRecord(updated!) }
  } catch (e) {
    return {
      ok: false,
      error: "upload_failed",
      message: `❌ فشل الرفع / upload failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 2. File Preview — return file content (text|base64) + preview metadata
// ---------------------------------------------------------------------------

export async function filePreview(
  idOrPath: string,
  opts: { maxBytes?: number; asBase64?: boolean } = {}
): Promise<FileResult<{
  file: FileRecord
  content: string
  encoding: "utf8" | "base64"
  truncated: boolean
  previewType: "text" | "image" | "binary" | "missing"
}>> {
  try {
    const row = await db.fileIndex.findFirst({
      where: { OR: [{ id: idOrPath }, { path: idOrPath }] },
    })
    if (!row) {
      return { ok: false, error: "not_found", message: `❌ الملف غير موجود / file not found: ${idOrPath}` }
    }
    const record = rowToRecord(row)
    if (!existsSync(record.path)) {
      return { ok: true, data: { file: record, content: "", encoding: "utf8", truncated: false, previewType: "missing" } }
    }
    const maxBytes = opts.maxBytes ?? 64_000
    const st = await stat(record.path)
    const isImage = IMAGE_EXTENSIONS.has(record.extension)
    const isText = TEXT_EXTENSIONS.has(record.extension)

    if (isImage || opts.asBase64) {
      const buffer = await readFile(record.path)
      const truncated = buffer.length > maxBytes
      const sliced = truncated ? buffer.slice(0, maxBytes) : buffer
      return {
        ok: true,
        data: {
          file: record,
          content: sliced.toString("base64"),
          encoding: "base64",
          truncated,
          previewType: isImage ? "image" : "binary",
        },
      }
    }

    if (isText) {
      const buffer = await readFile(record.path)
      const truncated = buffer.length > maxBytes
      const content = truncated ? buffer.slice(0, maxBytes).toString("utf8") : buffer.toString("utf8")
      return {
        ok: true,
        data: { file: record, content, encoding: "utf8", truncated, previewType: "text" },
      }
    }

    // Binary or doc — return empty content (use extract/parse for text).
    return {
      ok: true,
      data: {
        file: record,
        content: "",
        encoding: "utf8",
        truncated: false,
        previewType: st.size > maxBytes ? "binary" : "binary",
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "preview_failed",
      message: `❌ فشل المعاينة / preview failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 3. File Extract — extract text content
// ---------------------------------------------------------------------------

export async function fileExtract(idOrPath: string): Promise<FileResult<{ fileId: string; text: string; chars: number; source: string }>> {
  try {
    const row = await db.fileIndex.findFirst({
      where: { OR: [{ id: idOrPath }, { path: idOrPath }] },
    })
    if (!row) {
      return { ok: false, error: "not_found", message: `❌ الملف غير موجود / file not found: ${idOrPath}` }
    }
    if (!existsSync(row.path)) {
      return { ok: false, error: "missing", message: `❌ الملف محذوف من القرص / file missing on disk` }
    }
    const ext = row.extension
    let text = ""
    let source = "direct"

    if (TEXT_EXTENSIONS.has(ext)) {
      text = await readFile(row.path, "utf8")
      source = "direct"
    } else if (ext === "pdf") {
      // Heuristic PDF extraction: pull text between BT/ET markers (works for simple PDFs).
      const buffer = await readFile(row.path)
      const rawText = buffer.toString("latin1")
      const matches = rawText.match(/\(([^)]*)\)\s*Tj/g) ?? []
      text = matches.map((m) => m.match(/\(([^)]*)\)/)?.[1] ?? "").join("\n").slice(0, 50000)
      source = "pdf-heuristic"
      if (text.length === 0) {
        // Mark for OCR (likely scanned PDF).
        await db.fileIndex.update({ where: { id: row.id }, data: { extractedText: "", ocrDone: false, indexStatus: "indexed", indexedAt: new Date() } })
        return { ok: true, data: { fileId: row.id, text: "", chars: 0, source: "pdf-needs-ocr" } }
      }
    } else if (ext === "docx" || ext === "pptx" || ext === "xlsx") {
      // OOXML — extract text from word/document.xml, ppt/slides, xl/sharedStrings.
      // Minimal: pull text between <w:t> tags (docx) or <a:t> (pptx) or <t> (xlsx).
      const buffer = await readFile(row.path)
      // Decompress the zip — we use a heuristic by scanning the raw bytes for XML.
      const rawText = buffer.toString("latin1")
      const textMatches = rawText.match(/<(?:w|a)??:?t[^>]*>([^<]+)</g) ?? []
      text = textMatches.map((m) => m.match(/>([^<]+)</)?.[1] ?? "").join(" ").slice(0, 50000)
      source = "ooxml-heuristic"
    } else if (ext === "csv" || ext === "tsv") {
      text = await readFile(row.path, "utf8")
      source = "direct"
    } else if (IMAGE_EXTENSIONS.has(ext)) {
      // Images need OCR.
      await db.fileIndex.update({ where: { id: row.id }, data: { extractedText: "", ocrDone: false, indexStatus: "indexed", indexedAt: new Date() } })
      return { ok: true, data: { fileId: row.id, text: "", chars: 0, source: "image-needs-ocr" } }
    } else {
      // Unknown — try UTF-8 read.
      try {
        text = await readFile(row.path, "utf8")
        source = "fallback-utf8"
      } catch {
        text = ""
        source = "binary"
      }
    }

    await db.fileIndex.update({
      where: { id: row.id },
      data: {
        extractedText: text,
        indexStatus: "indexed",
        indexedAt: new Date(),
      },
    })

    return { ok: true, data: { fileId: row.id, text, chars: text.length, source } }
  } catch (e) {
    return {
      ok: false,
      error: "extract_failed",
      message: `❌ فشل الاستخراج / extract failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 4. File OCR — OCR images via VLM skill (z-ai-web-dev-sdk)
// ---------------------------------------------------------------------------

export async function fileOcr(idOrPath: string): Promise<FileResult<{ fileId: string; text: string; chars: number; model?: string }>> {
  try {
    const row = await db.fileIndex.findFirst({
      where: { OR: [{ id: idOrPath }, { path: idOrPath }] },
    })
    if (!row) {
      return { ok: false, error: "not_found", message: `❌ الملف غير موجود / file not found: ${idOrPath}` }
    }
    if (!IMAGE_EXTENSIONS.has(row.extension) && row.extension !== "pdf") {
      return { ok: false, error: "not_image", message: `❌ OCR متاح للصور و PDF فقط / OCR available for images + PDF only` }
    }
    if (!existsSync(row.path)) {
      return { ok: false, error: "missing", message: `❌ الملف محذوف / file missing` }
    }

    // Read as base64.
    const buffer = await readFile(row.path)
    const base64 = buffer.toString("base64")
    const dataUrl = `data:${row.mimeType || "image/png"};base64,${base64}`

    // Try to use the VLM skill via the SDK.
    let ocrText = ""
    let model: string | undefined
    try {
      const ZAIModule = await import("z-ai-web-dev-sdk").catch(() => null)
      if (!ZAIModule) {
        // SDK not available — mark as pending.
        await db.fileIndex.update({ where: { id: row.id }, data: { ocrDone: false } })
        return { ok: false, error: "no_vlm", message: "❌ VLM SDK غير متاح / VLM SDK not available" }
      }
      const ZAI = ZAIModule.default
      const zai = await ZAI.create()
      const completion = await zai.chat.completions.create({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "استخرج كل النص من هذه الصورة بدقة. Extract all text from this image accurately." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ] as never,
        thinking: { type: "disabled" } as never,
      } as never)
      ocrText = (completion as { choices?: Array<{ message?: { content?: string } }>; model?: string }).choices?.[0]?.message?.content ?? ""
      model = (completion as { model?: string }).model
    } catch (e) {
      return {
        ok: false,
        error: "ocr_failed",
        message: `❌ فشل OCR / OCR failed: ${e instanceof Error ? e.message : String(e)}`,
      }
    }

    // Save the OCR'd text as extractedText.
    const existingText = row.extractedText ?? ""
    const combined = existingText ? `${existingText}\n\n[OCR]\n${ocrText}` : ocrText
    await db.fileIndex.update({
      where: { id: row.id },
      data: { extractedText: combined, ocrDone: true },
    })

    return { ok: true, data: { fileId: row.id, text: ocrText, chars: ocrText.length, model } }
  } catch (e) {
    return {
      ok: false,
      error: "ocr_failed",
      message: `❌ فشل OCR / OCR failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 5. File Parse — structured document parsing (headings, sections)
// ---------------------------------------------------------------------------

export interface ParsedDocument {
  fileId: string
  title?: string
  headings: Array<{ level: number; text: string; line: number }>
  sections: Array<{ heading?: string; content: string; line: number }>
  links: Array<{ text: string; href?: string }>
  codeBlocks: Array<{ lang?: string; content: string; line: number }>
  wordCount: number
}

export async function fileParse(idOrPath: string): Promise<FileResult<ParsedDocument>> {
  try {
    const row = await db.fileIndex.findFirst({
      where: { OR: [{ id: idOrPath }, { path: idOrPath }] },
    })
    if (!row) {
      return { ok: false, error: "not_found", message: `❌ الملف غير موجود / file not found: ${idOrPath}` }
    }
    // Ensure text is extracted.
    let text = row.extractedText
    if (!text) {
      const ext = await fileExtract(row.id)
      if (!ext.ok) return ext as unknown as FileResult<ParsedDocument>
      text = ext.data.text
    }
    if (!text) {
      return { ok: true, data: { fileId: row.id, headings: [], sections: [], links: [], codeBlocks: [], wordCount: 0 } }
    }
    const lines = text.split("\n")
    const headings: ParsedDocument["headings"] = []
    const sections: ParsedDocument["sections"] = []
    const codeBlocks: ParsedDocument["codeBlocks"] = []
    const links: ParsedDocument["links"] = []
    let currentSection: { heading?: string; content: string; line: number } | null = null
    let inCodeBlock = false
    let codeLang: string | undefined
    let codeContent = ""
    let codeStartLine = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // Markdown code fence.
      const fenceMatch = line.match(/^```\s*(\w+)?/)
      if (fenceMatch) {
        if (inCodeBlock) {
          codeBlocks.push({ lang: codeLang, content: codeContent, line: codeStartLine })
          codeContent = ""
          inCodeBlock = false
        } else {
          inCodeBlock = true
          codeLang = fenceMatch[1]
          codeStartLine = i + 1
        }
        continue
      }
      if (inCodeBlock) {
        codeContent += line + "\n"
        continue
      }
      // Markdown heading.
      const h = line.match(/^(#{1,6})\s+(.+)$/)
      if (h) {
        const level = h[1].length
        const headingText = h[2].trim()
        headings.push({ level, text: headingText, line: i + 1 })
        if (currentSection) sections.push(currentSection)
        currentSection = { heading: headingText, content: "", line: i + 1 }
        continue
      }
      // Markdown link: [text](href)
      const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g
      let lm: RegExpExecArray | null
      while ((lm = linkRe.exec(line)) !== null) {
        links.push({ text: lm[1], href: lm[2] })
      }
      if (currentSection) {
        currentSection.content += line + "\n"
      } else {
        currentSection = { content: line + "\n", line: i + 1 }
      }
    }
    if (currentSection) sections.push(currentSection)
    if (inCodeBlock && codeContent) {
      codeBlocks.push({ lang: codeLang, content: codeContent, line: codeStartLine })
    }
    const title = headings.find((h) => h.level === 1)?.text
    const wordCount = text.split(/\s+/).filter(Boolean).length

    return {
      ok: true,
      data: { fileId: row.id, title, headings, sections, links, codeBlocks, wordCount },
    }
  } catch (e) {
    return {
      ok: false,
      error: "parse_failed",
      message: `❌ فشل التحليل / parse failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 6. File Search — full-text search over extractedText
// ---------------------------------------------------------------------------

export async function fileSearch(
  query: string,
  opts: { extensions?: string[]; limit?: number; snippetChars?: number } = {}
): Promise<FileResult<SearchHit[]>> {
  try {
    if (!query.trim()) {
      return { ok: true, data: [] }
    }
    const where: Record<string, unknown> = {
      extractedText: { not: null },
      indexStatus: "indexed",
    }
    if (opts.extensions && opts.extensions.length > 0) {
      where.extension = { in: opts.extensions }
    }
    const rows = await db.fileIndex.findMany({ where })
    const q = query.toLowerCase()
    const hits: SearchHit[] = []
    const snippetChars = opts.snippetChars ?? 200
    for (const r of rows) {
      const text = r.extractedText ?? ""
      const lower = text.toLowerCase()
      const idx = lower.indexOf(q)
      if (idx === -1) continue
      // Score = occurrence count + recency bonus.
      const occurrences = lower.split(q).length - 1
      const score = occurrences * 10 + (r.tags.includes("favorite") ? 5 : 0)
      const lineNum = text.slice(0, idx).split("\n").length
      const snippetStart = Math.max(0, idx - snippetChars / 2)
      const snippetEnd = Math.min(text.length, idx + q.length + snippetChars / 2)
      const snippet = (snippetStart > 0 ? "…" : "") + text.slice(snippetStart, snippetEnd) + (snippetEnd < text.length ? "…" : "")
      hits.push({
        fileId: r.id,
        path: r.path,
        filename: r.filename,
        score,
        snippet,
        matchedLine: lineNum,
      })
    }
    hits.sort((a, b) => b.score - a.score)
    return { ok: true, data: hits.slice(0, opts.limit ?? 20) }
  } catch (e) {
    return {
      ok: false,
      error: "search_failed",
      message: `❌ فشل البحث / search failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Folder Watcher Add — register a directory for polling
// ---------------------------------------------------------------------------

export interface WatcherInput {
  path: string
  includeGlobs?: string[]
  excludeGlobs?: string[]
  intervalSec?: number
  active?: boolean
}

export async function folderWatcherAdd(input: WatcherInput): Promise<FileResult<FolderWatcherRecord>> {
  try {
    if (!input.path) {
      return { ok: false, error: "bad_input", message: "❌ المسار مطلوب / path required" }
    }
    const abs = path.isAbsolute(input.path) ? input.path : path.resolve(WORKSPACE_ROOT, input.path)
    if (!existsSync(abs)) {
      return { ok: false, error: "not_found", message: `❌ المسار غير موجود / path not found: ${abs}` }
    }
    const st = await stat(abs)
    if (!st.isDirectory()) {
      return { ok: false, error: "not_dir", message: `❌ ليس مجلداً / not a directory: ${abs}` }
    }
    const row = await db.folderWatcher.upsert({
      where: { path: abs },
      update: {
        includeGlobs: JSON.stringify(input.includeGlobs ?? []),
        excludeGlobs: JSON.stringify(input.excludeGlobs ?? ["**/node_modules/**", "**/.git/**", "**/.next/**"]),
        intervalSec: input.intervalSec ?? 60,
        active: input.active ?? true,
      },
      create: {
        path: abs,
        includeGlobs: JSON.stringify(input.includeGlobs ?? []),
        excludeGlobs: JSON.stringify(input.excludeGlobs ?? ["**/node_modules/**", "**/.git/**", "**/.next/**"]),
        intervalSec: input.intervalSec ?? 60,
        active: input.active ?? true,
      },
    })
    return { ok: true, data: watcherRowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "watcher_add_failed",
      message: `❌ فشل إضافة المراقب / watcher add failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function folderWatcherList(): Promise<FileResult<FolderWatcherRecord[]>> {
  try {
    const rows = await db.folderWatcher.findMany({ orderBy: { createdAt: "desc" } })
    return { ok: true, data: rows.map(watcherRowToRecord) }
  } catch (e) {
    return {
      ok: false,
      error: "watcher_list_failed",
      message: `❌ فشل سرد المراقبين / watcher list failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function folderWatcherRemove(id: string): Promise<FileResult<{ deleted: boolean }>> {
  try {
    await db.folderWatcher.delete({ where: { id } })
    return { ok: true, data: { deleted: true } }
  } catch (e) {
    return {
      ok: false,
      error: "watcher_remove_failed",
      message: `❌ فشل الحذف / remove failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 8. Folder Watcher Scan — incremental scan: detect added/modified/deleted
// ---------------------------------------------------------------------------

async function walkDir(dir: string, excludeGlobs: string[], includeGlobs: string[], out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [] as import("node:fs").Dirent[])
  for (const ent of entries) {
    const full = path.join(dir, ent.name)
    const rel = path.relative(WORKSPACE_ROOT, full)
    if (matchesGlobs(rel, excludeGlobs)) continue
    if (ent.isDirectory()) {
      await walkDir(full, excludeGlobs, includeGlobs, out)
    } else if (ent.isFile()) {
      if (matchesGlobs(rel, includeGlobs)) out.push(full)
    }
  }
}

export async function folderWatcherScan(watcherId: string): Promise<FileResult<ScanResult>> {
  const start = Date.now()
  try {
    const watcher = await db.folderWatcher.findUnique({ where: { id: watcherId } })
    if (!watcher) {
      return { ok: false, error: "not_found", message: `❌ المراقب غير موجود / watcher not found: ${watcherId}` }
    }
    if (!existsSync(watcher.path)) {
      return { ok: false, error: "missing", message: `❌ المسار محذوف / path missing: ${watcher.path}` }
    }
    const includeGlobs = safeParse<string[]>(watcher.includeGlobs, [])
    const excludeGlobs = safeParse<string[]>(watcher.excludeGlobs, ["**/node_modules/**", "**/.git/**", "**/.next/**"])

    // Walk the directory.
    const diskFiles: string[] = []
    await walkDir(watcher.path, excludeGlobs, includeGlobs, diskFiles)
    const diskSet = new Set(diskFiles)

    // Fetch indexed files in this watcher's tree.
    const indexedFiles = await db.fileIndex.findMany({
      where: { path: { startsWith: watcher.path } },
    })
    const indexedMap = new Map(indexedFiles.map((r) => [r.path, r]))

    let added = 0
    let modified = 0
    let unchanged = 0
    const errors: string[] = []

    // Process each disk file.
    for (const filePath of diskFiles) {
      try {
        const st = await stat(filePath)
        const existing = indexedMap.get(filePath)
        // Check if mtime changed since last index.
        const needsReindex = !existing
          || (existing.fileModifiedAt && existing.fileModifiedAt < st.mtime)
          || !existing.checksum

        if (!existing) {
          // New file — index it.
          const ext = extOf(path.basename(filePath))
          const buffer = await readFile(filePath)
          const cs = checksumOf(buffer)
          await db.fileIndex.create({
            data: {
              path: filePath,
              source: "workspace",
              filename: path.basename(filePath),
              extension: ext,
              mimeType: mimeOf(path.basename(filePath)),
              sizeBytes: st.size,
              checksum: cs,
              fileModifiedAt: st.mtime,
              indexStatus: "indexed",
              indexedAt: new Date(),
            },
          })
          added++
          // Extract text if it's a text file.
          if (TEXT_EXTENSIONS.has(ext)) {
            await db.fileIndex.update({
              where: { path: filePath },
              data: { extractedText: buffer.toString("utf8").slice(0, 200_000) },
            })
          }
        } else if (needsReindex) {
          // Modified file — re-hash, create a version snapshot, update.
          const ext = extOf(path.basename(filePath))
          const buffer = await readFile(filePath)
          const cs = checksumOf(buffer)
          if (existing.checksum !== cs) {
            // Content changed — create a version snapshot.
            await fileCreateVersion(existing.id, { reason: "watcher-scan-detected-change", trigger: "scan" })
            await db.fileIndex.update({
              where: { id: existing.id },
              data: {
                checksum: cs,
                sizeBytes: st.size,
                fileModifiedAt: st.mtime,
                indexStatus: "indexed",
                indexedAt: new Date(),
                extractedText: TEXT_EXTENSIONS.has(ext) ? buffer.toString("utf8").slice(0, 200_000) : existing.extractedText,
              },
            })
            modified++
          } else {
            // Same content, just mtime touch.
            await db.fileIndex.update({
              where: { id: existing.id },
              data: { fileModifiedAt: st.mtime, indexedAt: new Date() },
            })
            unchanged++
          }
        } else {
          unchanged++
        }
        indexedMap.delete(filePath)
      } catch (e) {
        errors.push(`${filePath}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    // Remaining in indexedMap = deleted from disk.
    let deleted = 0
    for (const [, row] of indexedMap) {
      await db.fileIndex.update({
        where: { id: row.id },
        data: { indexStatus: "deleted" },
      })
      deleted++
    }

    await db.folderWatcher.update({
      where: { id: watcherId },
      data: {
        lastScanAt: new Date(),
        lastScanAdded: added,
        lastScanModified: modified,
        lastScanDeleted: deleted,
      },
    })

    return {
      ok: true,
      data: { added, modified, deleted, unchanged, errors, durationMs: Date.now() - start },
    }
  } catch (e) {
    return {
      ok: false,
      error: "scan_failed",
      message: `❌ فشل المسح / scan failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

/** Scan all active watchers. Returns aggregated stats per watcher. */
export async function folderWatcherScanAll(): Promise<FileResult<Array<{ watcherId: string; path: string; result: ScanResult | null; error?: string }>>> {
  try {
    const watchers = await db.folderWatcher.findMany({ where: { active: true } })
    const results: Array<{ watcherId: string; path: string; result: ScanResult | null; error?: string }> = []
    for (const w of watchers) {
      const r = await folderWatcherScan(w.id)
      results.push({
        watcherId: w.id,
        path: w.path,
        result: r.ok ? r.data : null,
        error: r.ok ? undefined : r.message,
      })
    }
    return { ok: true, data: results }
  } catch (e) {
    return {
      ok: false,
      error: "scan_all_failed",
      message: `❌ فشل مسح الكل / scan all failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 9. File Dedup — find files with identical checksums; mark duplicates
// ---------------------------------------------------------------------------

export async function fileDedup(opts: { mark?: boolean } = {}): Promise<FileResult<{ groups: DedupGroup[]; totalDuplicates: number; wastedBytes: number }>> {
  try {
    // Find checksums with >1 file.
    const rows = await db.fileIndex.findMany({
      where: { checksum: { not: null }, indexStatus: { not: "deleted" } },
    })
    const byChecksum = new Map<string, FileRow[]>()
    for (const r of rows) {
      if (!r.checksum) continue
      const arr = byChecksum.get(r.checksum) ?? []
      arr.push(r)
      byChecksum.set(r.checksum, arr)
    }
    const groups: DedupGroup[] = []
    let totalDuplicates = 0
    let wastedBytes = 0
    for (const [cs, files] of byChecksum) {
      if (files.length < 2) continue
      const sorted = files.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      const canonical = sorted[0]
      const dups = sorted.slice(1)
      totalDuplicates += dups.length
      wastedBytes += dups.reduce((sum, f) => sum + f.sizeBytes, 0)
      groups.push({
        checksum: cs,
        files: sorted.map(rowToRecord),
        totalSize: canonical.sizeBytes * sorted.length,
        wastedBytes: dups.reduce((sum, f) => sum + f.sizeBytes, 0),
      })
      // Optionally mark duplicates in DB.
      if (opts.mark) {
        for (const dup of dups) {
          await db.fileIndex.update({
            where: { id: dup.id },
            data: { duplicateOfId: canonical.id },
          })
        }
      }
    }
    groups.sort((a, b) => b.wastedBytes - a.wastedBytes)
    return { ok: true, data: { groups, totalDuplicates, wastedBytes } }
  } catch (e) {
    return {
      ok: false,
      error: "dedup_failed",
      message: `❌ فشل كشف التكرار / dedup failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 10. File Metadata — get/set metadata (title, author, tags, custom)
// ---------------------------------------------------------------------------

export async function fileGetMetadata(idOrPath: string): Promise<FileResult<{ file: FileRecord; metadata: FileMetadata; tags: string[] }>> {
  try {
    const row = await db.fileIndex.findFirst({
      where: { OR: [{ id: idOrPath }, { path: idOrPath }] },
    })
    if (!row) {
      return { ok: false, error: "not_found", message: `❌ الملف غير موجود / file not found: ${idOrPath}` }
    }
    const record = rowToRecord(row)
    return { ok: true, data: { file: record, metadata: record.metadata, tags: record.tags } }
  } catch (e) {
    return {
      ok: false,
      error: "metadata_failed",
      message: `❌ فشل قراءة البيانات / metadata failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function fileSetMetadata(
  idOrPath: string,
  patch: { metadata?: Partial<FileMetadata>; tags?: string[]; addTags?: string[]; removeTags?: string[] }
): Promise<FileResult<FileRecord>> {
  try {
    const existing = await db.fileIndex.findFirst({
      where: { OR: [{ id: idOrPath }, { path: idOrPath }] },
    })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الملف غير موجود / file not found: ${idOrPath}` }
    }
    const currentMeta = safeParse<FileMetadata>(existing.metadata, {})
    const mergedMeta = { ...currentMeta, ...(patch.metadata ?? {}) }
    let tags = safeParse<string[]>(existing.tags, [])
    if (patch.tags) tags = patch.tags
    if (patch.addTags) tags = Array.from(new Set([...tags, ...patch.addTags]))
    if (patch.removeTags) tags = tags.filter((t) => !patch.removeTags!.includes(t))
    const row = await db.fileIndex.update({
      where: { id: existing.id },
      data: {
        metadata: JSON.stringify(mergedMeta),
        tags: JSON.stringify(tags),
      },
    })
    return { ok: true, data: rowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "metadata_failed",
      message: `❌ فشل تحديث البيانات / metadata failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 11. File Versioning — create version snapshots + list versions + restore
// ---------------------------------------------------------------------------

export async function fileCreateVersion(
  idOrPath: string,
  opts: { reason?: string; authorId?: string; trigger?: string } = {}
): Promise<FileResult<FileVersionRecord>> {
  try {
    const existing = await db.fileIndex.findFirst({
      where: { OR: [{ id: idOrPath }, { path: idOrPath }] },
    })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الملف غير موجود / file not found: ${idOrPath}` }
    }
    if (!existsSync(existing.path)) {
      return { ok: false, error: "missing", message: `❌ الملف محذوف من القرص / file missing on disk` }
    }
    const buffer = await readFile(existing.path)
    const cs = checksumOf(buffer)
    const newVersion = (existing.versionCount ?? 0) + 1

    // Save snapshot to .file-intel/versions/<fileId>/v<N>.bin
    const snapshotDir = path.join(WORKSPACE_ROOT, ".file-intel", "versions", existing.id)
    await mkdir(snapshotDir, { recursive: true })
    const snapshotPath = path.join(snapshotDir, `v${newVersion}.bin`)
    await writeFile(snapshotPath, buffer)
    const relSnapshot = path.relative(WORKSPACE_ROOT, snapshotPath)

    const row = await db.fileVersion.create({
      data: {
        fileId: existing.id,
        version: newVersion,
        checksum: cs,
        sizeBytes: buffer.length,
        snapshotPath: relSnapshot,
        editSummary: JSON.stringify({
          reason: opts.reason,
          authorId: opts.authorId,
          trigger: opts.trigger ?? "manual",
        }),
      },
    })
    await db.fileIndex.update({
      where: { id: existing.id },
      data: { versionCount: newVersion },
    })
    return { ok: true, data: versionRowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "version_failed",
      message: `❌ فشل إنشاء الإصدار / version failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function fileListVersions(idOrPath: string): Promise<FileResult<Array<{ version: number; checksum: string; sizeBytes: number; createdAt: Date; reason?: string; trigger?: string }>>> {
  try {
    const existing = await db.fileIndex.findFirst({
      where: { OR: [{ id: idOrPath }, { path: idOrPath }] },
    })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الملف غير موجود / file not found: ${idOrPath}` }
    }
    const versions = await db.fileVersion.findMany({
      where: { fileId: existing.id },
      orderBy: { version: "asc" },
    })
    return {
      ok: true,
      data: versions.map((v) => {
        const summary = safeParse<{ reason?: string; trigger?: string }>(v.editSummary, {})
        return {
          version: v.version,
          checksum: v.checksum,
          sizeBytes: v.sizeBytes,
          createdAt: v.createdAt,
          reason: summary.reason,
          trigger: summary.trigger,
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

export async function fileRestoreVersion(
  idOrPath: string,
  version: number
): Promise<FileResult<{ restored: boolean; checksum: string }>> {
  try {
    const existing = await db.fileIndex.findFirst({
      where: { OR: [{ id: idOrPath }, { path: idOrPath }] },
    })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الملف غير موجود / file not found: ${idOrPath}` }
    }
    const ver = await db.fileVersion.findUnique({
      where: { fileId_version: { fileId: existing.id, version } },
    })
    if (!ver || !ver.snapshotPath) {
      return { ok: false, error: "version_not_found", message: `❌ الإصدار غير موجود أو لا لقطة / version not found or no snapshot` }
    }
    const snapshotAbs = path.resolve(WORKSPACE_ROOT, ver.snapshotPath)
    if (!existsSync(snapshotAbs)) {
      return { ok: false, error: "snapshot_missing", message: `❌ اللقطة محذوفة / snapshot missing` }
    }
    // Create a version of the current state first (so we can undo the restore).
    await fileCreateVersion(existing.id, { reason: `pre-restore to v${version}`, trigger: "restore" })
    // Copy snapshot to the live path.
    await copyFile(snapshotAbs, existing.path)
    // Update file metadata.
    const st = await stat(existing.path)
    await db.fileIndex.update({
      where: { id: existing.id },
      data: {
        checksum: ver.checksum,
        sizeBytes: ver.sizeBytes,
        fileModifiedAt: st.mtime,
        indexedAt: new Date(),
      },
    })
    return { ok: true, data: { restored: true, checksum: ver.checksum } }
  } catch (e) {
    return {
      ok: false,
      error: "restore_failed",
      message: `❌ فشل الاستعادة / restore failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Index management helpers
// ---------------------------------------------------------------------------

export async function fileList(opts: { extension?: string; source?: FileSource; status?: IndexStatus; limit?: number } = {}): Promise<FileResult<FileRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.extension) where.extension = opts.extension
    if (opts.source) where.source = opts.source
    if (opts.status) where.indexStatus = opts.status
    else where.indexStatus = { not: "deleted" }
    const rows = await db.fileIndex.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: opts.limit ?? 100,
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

export async function fileGet(idOrPath: string): Promise<FileResult<FileRecord>> {
  try {
    const row = await db.fileIndex.findFirst({
      where: { OR: [{ id: idOrPath }, { path: idOrPath }] },
    })
    if (!row) {
      return { ok: false, error: "not_found", message: `❌ الملف غير موجود / file not found: ${idOrPath}` }
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

export async function fileDelete(idOrPath: string, opts: { deleteFromDisk?: boolean } = {}): Promise<FileResult<{ deleted: boolean }>> {
  try {
    const existing = await db.fileIndex.findFirst({
      where: { OR: [{ id: idOrPath }, { path: idOrPath }] },
    })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الملف غير موجود / file not found: ${idOrPath}` }
    }
    if (opts.deleteFromDisk && existsSync(existing.path)) {
      await rm(existing.path, { force: true })
    }
    await db.fileVersion.deleteMany({ where: { fileId: existing.id } })
    await db.fileIndex.update({
      where: { id: existing.id },
      data: { indexStatus: "deleted" },
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

export interface FileSnapshot {
  totalFiles: number
  indexed: number
  pending: number
  error: number
  totalSizeBytes: number
  byExtension: Record<string, number>
  duplicatesCount: number
  watchersActive: number
  versionsTotal: number
}

export async function fileSnapshot(): Promise<FileResult<FileSnapshot>> {
  try {
    const files = await db.fileIndex.findMany({ where: { indexStatus: { not: "deleted" } } })
    const indexed = files.filter((f) => f.indexStatus === "indexed").length
    const pending = files.filter((f) => f.indexStatus === "pending").length
    const error = files.filter((f) => f.indexStatus === "error").length
    const totalSizeBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0)
    const byExtension: Record<string, number> = {}
    for (const f of files) {
      byExtension[f.extension || "(none)"] = (byExtension[f.extension || "(none)"] ?? 0) + 1
    }
    const duplicatesCount = files.filter((f) => f.duplicateOfId !== null).length
    const watchersActive = await db.folderWatcher.count({ where: { active: true } })
    const versionsTotal = await db.fileVersion.count()
    return {
      ok: true,
      data: {
        totalFiles: files.length,
        indexed,
        pending,
        error,
        totalSizeBytes,
        byExtension,
        duplicatesCount,
        watchersActive,
        versionsTotal,
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

export function formatFileResult<T>(result: FileResult<T>): string {
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
