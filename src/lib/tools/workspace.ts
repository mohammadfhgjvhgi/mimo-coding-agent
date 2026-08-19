// Workspace guard: keep all file operations confined to the project root and
// reject dangerous paths. Used by every tool before touching the filesystem.

import path from "node:path"
import fs from "node:fs"

const WORKSPACE_ROOT_ENV = process.env.MIMO_WORKSPACE_ROOT
export const WORKSPACE_ROOT = WORKSPACE_ROOT_ENV || process.cwd()

// Paths that must never be written/edited (relative to workspace root).
const WRITE_DENYLIST = [
  /(^|[\\/])\.env(\.|$)/i, // .env, .env.local
  /(^|[\\/])node_modules([\\/])/i,
  /(^|[\\/])\.git([\\/])/i,
  /(^|[\\/])dev\.log$/i,
  /(^|[\\/])server\.log$/i,
  /(^|[\\/])worklog\.md$/i,
  /([\\/])prisma[\\/]db[\\/]/i, // sqlite db files
  /\.db(-journal|-wal|-shm)?$/i,
]

export interface ResolvedPath {
  ok: boolean
  absolute?: string
  rel?: string
  error?: string
}

export function resolveWorkspacePath(
  input: string,
  ctx: { workspaceRoot: string }
): ResolvedPath {
  if (!input || typeof input !== "string") {
    return { ok: false, error: "المسار مطلوب" }
  }
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, error: "المسار فارغ" }

  // Reject obvious traversal attempts early
  if (/\0/.test(trimmed)) {
    return { ok: false, error: "المسار يحوي محارف غير صالحة" }
  }

  // Resolve relative to workspace root. Absolute paths are allowed only if they
  // are already inside the workspace root.
  const root = path.resolve(ctx.workspaceRoot)
  const absolute = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(root, trimmed)

  // Ensure the resolved path is within the workspace root
  const rel = path.relative(root, absolute)
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return {
      ok: false,
      error: `المسار خارج مجلد العمل: ${trimmed}`,
    }
  }

  return { ok: true, absolute, rel }
}

export function canWrite(rel: string): { ok: boolean; error?: string } {
  for (const pattern of WRITE_DENYLIST) {
    if (pattern.test(rel)) {
      return {
        ok: false,
        error: `محظور الكتابة على: ${rel} (ملف حساس أو مجلد نظام)`,
      }
    }
  }
  return { ok: true }
}

export function ensureDirFor(file: string): void {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
}

export function truncate(s: string, max = 12000): string {
  if (s.length <= max) return s
  const kept = max - 200
  return (
    s.slice(0, kept) +
    `\n\n…[تم اقتطاع ${s.length - kept} محرفاً]…\n` +
    s.slice(-150)
  )
}
