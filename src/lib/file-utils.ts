// Shared file utilities — deduplicated from files-panel, tool-call-card,
// inline-preview, and mention-autocomplete.
//
// These were copy-pasted in 4 places with slight drift. Now consolidated
// here so adding a new language only requires one edit.

import { File as FileIcon, FileCode, FileText, FilePlus } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  py: "python",
  json: "json",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sql: "sql",
  prisma: "prisma",
  md: "markdown",
  markdown: "markdown",
  txt: "text",
  sh: "bash",
  bash: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "c",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  xml: "xml",
  svg: "xml",
  dockerfile: "dockerfile",
  env: "ini",
  ini: "ini",
};

const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "py", "json", "html", "htm", "css", "scss",
  "sql", "prisma", "sh", "bash", "yml", "yaml", "go", "rs", "java", "c",
  "cpp", "h", "rb", "php", "swift", "kt", "xml",
]);

const TEXT_EXTENSIONS = new Set(["md", "markdown", "txt", "log", "rtf"]);

/**
 * Map a filename to a syntax-highlighter language string.
 * Returns "text" for unknown extensions.
 */
export function getLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext) return "text";
  return EXTENSION_LANGUAGE_MAP[ext] ?? "text";
}

/**
 * Map a filename to a lucide icon component.
 * - FileCode for code files (ts, js, py, json, html, css, etc.)
 * - FileText for markdown/text files
 * - FilePlus for everything else
 */
export function getFileIcon(filename: string): LucideIcon {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext) return FilePlus;
  if (CODE_EXTENSIONS.has(ext)) return FileCode;
  if (TEXT_EXTENSIONS.has(ext)) return FileText;
  return FileIcon;
}

/** Check if a filename is a code file (has a known code extension). */
export function isCodeFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext ? CODE_EXTENSIONS.has(ext) : false;
}
