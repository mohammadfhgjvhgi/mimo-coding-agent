// Code Extractor — extracts code blocks from LLM responses and classifies them.
// Adapted from mimo-life-os/src/lib/ai/execution-engine.ts (pure logic only;
// the DB-coupled executeResponse is intentionally NOT copied).

import path from "node:path"

export interface CodeBlock {
  lang: string
  code: string
  filename?: string
}

/**
 * Extract code blocks from a model response.
 *
 * Detects fenced code blocks with optional inline filename hints:
 *   ```html               (no filename)
 *   ```html:filename.html (colon separator)
 *   ```html filename.html (space separator)
 *
 * Also looks for a filename hint in the 200 chars of prose preceding each
 * code block (e.g. "create file foo.ts:" / "ملف: bar.py").
 */
export function extractCodeBlocks(content: string): CodeBlock[] {
  const blocks: CodeBlock[] = []
  // Group 1 = language (optional), Group 2 = filename (optional), Group 3 = code.
  const codeBlockRegex = /```(\w+)?(?::|\s+)?([\w\-./]+\.\w+)?\s*\n([\s\S]*?)\n```/g
  let match: RegExpExecArray | null

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const lang = (match[1] || "text").toLowerCase()
    const inlineFilename = match[2]
    const code = match[3]
    const blockStart = match.index

    const before = content.slice(Math.max(0, blockStart - 200), blockStart)
    const filenameMatch = before.match(
      /(?:create|write|save|file|ملف|أنشئ|اكتب)\s*:?\s*[`"]?([\w\-./]+\.\w+)[`"]?/i
    )
    const hintFilename = filenameMatch?.[1]
    const filename = inlineFilename || hintFilename

    blocks.push({ lang, code, filename })
  }

  return blocks
}

const LANG_TO_EXT: Record<string, string> = {
  html: "html", htm: "html", css: "css",
  javascript: "js", js: "js", jsx: "jsx",
  typescript: "ts", ts: "ts", tsx: "tsx",
  json: "json", python: "py", py: "py",
  bash: "sh", sh: "sh", sql: "sql",
  markdown: "md", md: "md", yaml: "yml", yml: "yml",
  xml: "xml", svg: "svg", arduino: "ino", ino: "ino",
  c: "c", cpp: "cpp", java: "java", go: "go",
  rust: "rs", php: "php", ruby: "rb",
}

/**
 * Generate a filename for a code block when none was provided inline.
 * Format: `mimo-<timestamp>-<index>.<ext>`.
 */
export function generateFilename(lang: string, index: number): string {
  const ext = LANG_TO_EXT[lang] ?? "txt"
  return `mimo-${Date.now()}-${index}.${ext}`
}

/** True if the file type can be rendered in the browser preview pane. */
export function isPreviewable(lang: string, filename?: string): boolean {
  const ext = filename ? path.extname(filename).slice(1).toLowerCase() : ""
  if (["html", "htm", "svg"].includes(ext)) return true
  return ["html", "htm", "svg"].includes(lang)
}

/**
 * Classify a code block as one of: "code" | "config" | "document".
 * Used when storing artifacts derived from the model response.
 */
export function getArtifactType(lang: string, filename?: string): string {
  const ext = filename ? path.extname(filename).slice(1).toLowerCase() : ""
  if (ext) {
    if (["html", "htm", "css", "js", "jsx", "ts", "tsx", "py", "sql", "svg"].includes(ext)) return "code"
    if (["json"].includes(ext)) return "config"
    if (["md"].includes(ext)) return "document"
  }
  if (["html", "css", "javascript", "js", "jsx", "typescript", "ts", "tsx", "python", "py", "sql", "c", "cpp", "java", "go", "rust", "php", "ruby", "arduino", "ino", "svg"].includes(lang)) {
    return "code"
  }
  if (["json", "yaml", "yml", "toml", "ini"].includes(lang)) return "config"
  if (["markdown", "md"].includes(lang)) return "document"
  return "code"
}

/** Sanitize a filename to safe filesystem characters. */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_")
}
