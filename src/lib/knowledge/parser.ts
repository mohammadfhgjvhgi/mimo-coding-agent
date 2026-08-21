// Document Parser — extracts text from multiple file formats.
// Supports: .txt, .md, .js, .ts, .py, .json, .csv, .html
// For PDF/DOCX/PPTX: uses simple text extraction (no external deps yet).
// Each parser returns { text, metadata, sourceType }.

import { readFileSync, statSync } from "node:fs"
import path from "node:path"

export interface ParsedDocument {
  text: string
  metadata: {
    title?: string
    source: string
    sourceType: string
    size: number
    pages?: number
    author?: string
    createdAt?: string
  }
  chunks: string[]
}

// Detect source type from file extension.
export function detectSourceType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const typeMap: Record<string, string> = {
    ".txt": "text", ".md": "markdown", ".markdown": "markdown",
    ".js": "code", ".ts": "code", ".tsx": "code", ".jsx": "code",
    ".py": "code", ".java": "code", ".go": "code", ".rs": "code",
    ".json": "json", ".csv": "csv", ".yaml": "yaml", ".yml": "yaml",
    ".html": "html", ".xml": "xml",
    ".pdf": "pdf", ".docx": "docx", ".doc": "doc",
    ".pptx": "pptx", ".ppt": "ppt",
    ".xlsx": "xlsx", ".xls": "xls",
  }
  return typeMap[ext] || "text"
}

// Parse a file and extract text + metadata + chunks.
export function parseDocument(filePath: string): ParsedDocument | null {
  try {
    const stat = statSync(filePath)
    const sourceType = detectSourceType(filePath)
    const fileName = path.basename(filePath)

    let text = ""
    let metadata: ParsedDocument["metadata"] = {
      title: fileName,
      source: filePath,
      sourceType,
      size: stat.size,
      createdAt: stat.mtime.toISOString(),
    }

    // For binary formats (PDF/DOCX/PPTX), we can't parse without libraries.
    // Return metadata only — text extraction requires pdf-parse/mammoth/etc.
    if (["pdf", "docx", "doc", "pptx", "ppt", "xlsx", "xls"].includes(sourceType)) {
      return {
        text: `[Binary file: ${fileName} — requires OCR/binary parser. Upload as text for now.]`,
        metadata,
        chunks: [],
      }
    }

    // Read as text for all text-based formats
    const raw = readFileSync(filePath, "utf8")

    switch (sourceType) {
      case "markdown":
        // Strip markdown formatting for cleaner text
        text = raw
          .replace(/^#+\s+/gm, "") // headers
          .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
          .replace(/\*([^*]+)\*/g, "$1") // italic
          .replace(/`([^`]+)`/g, "$1") // inline code
          .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, "").trim()) // code blocks
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
          .replace(/^\s*[-*+]\s+/gm, "") // list markers
          .trim()
        break

      case "html":
        text = raw
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&[a-z]+;/gi, " ")
          .replace(/\s+/g, " ")
          .trim()
        // Extract title
        const titleMatch = raw.match(/<title[^>]*>([^<]*)<\/title>/i)
        if (titleMatch) metadata.title = titleMatch[1].trim()
        break

      case "code":
        // Keep code as-is but extract comments as metadata
        text = raw
        // Extract first comment as description
        const commentMatch = raw.match(/(?:\/\/|#|\/\*)\s*(.+)/)
        if (commentMatch) metadata.author = commentMatch[1].trim()
        break

      case "json":
        try {
          const parsed = JSON.parse(raw)
          text = JSON.stringify(parsed, null, 2)
          metadata.title = typeof parsed.title === "string" ? parsed.title : fileName
        } catch {
          text = raw
        }
        break

      case "csv":
        // Keep CSV as text — each row is a chunk
        text = raw
        break

      default:
        text = raw
    }

    // Chunk the text
    const chunks = chunkDocument(text, sourceType)

    return { text, metadata, chunks }
  } catch (e) {
    console.error("[parseDocument] error:", e instanceof Error ? e.message : String(e))
    return null
  }
}

// Chunk a document into overlapping segments.
export function chunkDocument(text: string, sourceType: string): string[] {
  const CHUNK_SIZE = 512
  const OVERLAP = 50
  const MIN_CHUNK = 120

  if (!text || text.length < MIN_CHUNK) return text ? [text] : []

  const chunks: string[] = []

  // For code: split on function/class boundaries
  if (sourceType === "code") {
    const lines = text.split("\n")
    let currentChunk: string[] = []
    let currentSize = 0

    for (const line of lines) {
      currentChunk.push(line)
      currentSize += line.length + 1

      // Split on function/class boundaries when chunk is large enough
      if (currentSize >= CHUNK_SIZE && /^\s*(function|class|export|def|public|private)/.test(line)) {
        chunks.push(currentChunk.join("\n"))
        currentChunk = []
        currentSize = 0
      }
    }
    if (currentChunk.length > 0) {
      const chunk = currentChunk.join("\n")
      if (chunk.length >= MIN_CHUNK) chunks.push(chunk)
    }
    return chunks.length > 0 ? chunks : [text]
  }

  // For markdown/text: split on paragraph boundaries
  const paragraphs = text.split(/\n\s*\n/)
  let currentChunk = ""

  for (const para of paragraphs) {
    if (currentChunk.length + para.length > CHUNK_SIZE && currentChunk.length >= MIN_CHUNK) {
      chunks.push(currentChunk.trim())
      // Keep overlap from end of previous chunk
      const overlap = currentChunk.slice(-OVERLAP)
      currentChunk = overlap + "\n\n" + para
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + para
    }
  }

  if (currentChunk.trim().length >= MIN_CHUNK) {
    chunks.push(currentChunk.trim())
  } else if (currentChunk.trim()) {
    // Merge small final chunk into previous
    if (chunks.length > 0) {
      chunks[chunks.length - 1] += "\n\n" + currentChunk.trim()
    } else {
      chunks.push(currentChunk.trim())
    }
  }

  return chunks
}

// Parse text content (for URLs, pasted text, notes).
export function parseTextContent(text: string, source: string, sourceType: string = "text"): ParsedDocument {
  const chunks = chunkDocument(text, sourceType)
  return {
    text,
    metadata: {
      title: source,
      source,
      sourceType,
      size: text.length,
    },
    chunks,
  }
}
