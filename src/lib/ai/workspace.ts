// Adapter: workspace helpers used by mimo-life-os API routes.
// Wraps our existing @/lib/tools/workspace for compatibility.
import path from "node:path"
import fs from "node:fs"
import { WORKSPACE_ROOT, resolveWorkspacePath } from "@/lib/tools/workspace"

export const SANDBOX_ROOT = WORKSPACE_ROOT
export const UPLOAD_DIR = path.join(WORKSPACE_ROOT, "upload")

export interface WorkspaceResult {
  success: boolean
  operation: string
  path?: string
  data?: string
  error?: string
  diagnostics?: { code?: string }
  metadata?: { size?: number }
}

/** Ensure the projects/<projectId> directory exists under the workspace root. */
export async function ensureProjectDir(projectId: string): Promise<WorkspaceResult> {
  try {
    const dir = path.join(WORKSPACE_ROOT, "projects", projectId)
    await fs.promises.mkdir(dir, { recursive: true })
    return {
      success: true,
      operation: "ensureProjectDir",
      path: path.relative(WORKSPACE_ROOT, dir),
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      success: false,
      operation: "ensureProjectDir",
      error: msg,
      diagnostics: { code: "MKDIR_FAILED" },
    }
  }
}

/** Ensure the standard workspace subdirs exist (upload/, projects/). */
export async function ensureWorkspaceDirs(): Promise<void> {
  try {
    await fs.promises.mkdir(UPLOAD_DIR, { recursive: true })
    await fs.promises.mkdir(path.join(WORKSPACE_ROOT, "projects"), { recursive: true })
  } catch {
    /* best-effort */
  }
}

/** Write a project-scoped file. */
export async function writeProjectFile(
  projectId: string,
  filename: string,
  content: string
): Promise<WorkspaceResult> {
  const resolved = resolveWorkspacePath(`projects/${projectId}/${filename}`, { workspaceRoot: WORKSPACE_ROOT })
  if (!resolved.ok || !resolved.absolute) {
    return {
      success: false,
      operation: "writeProjectFile",
      error: resolved.error ?? "invalid path",
      diagnostics: { code: "PATH_REJECTED" },
    }
  }
  try {
    await fs.promises.mkdir(path.dirname(resolved.absolute), { recursive: true })
    await fs.promises.writeFile(resolved.absolute, content, "utf8")
    const stat = await fs.promises.stat(resolved.absolute)
    return {
      success: true,
      operation: "writeProjectFile",
      path: resolved.rel,
      metadata: { size: stat.size },
    }
  } catch (e) {
    return {
      success: false,
      operation: "writeProjectFile",
      error: e instanceof Error ? e.message : String(e),
      diagnostics: { code: "WRITE_FAILED" },
    }
  }
}

/** Write a global (non-project) file under upload/. */
export async function write(
  filename: string,
  content: string
): Promise<WorkspaceResult> {
  const resolved = resolveWorkspacePath(`upload/${filename}`, { workspaceRoot: WORKSPACE_ROOT })
  if (!resolved.ok || !resolved.absolute) {
    return {
      success: false,
      operation: "write",
      error: resolved.error ?? "invalid path",
      diagnostics: { code: "PATH_REJECTED" },
    }
  }
  try {
    await fs.promises.mkdir(path.dirname(resolved.absolute), { recursive: true })
    await fs.promises.writeFile(resolved.absolute, content, "utf8")
    const stat = await fs.promises.stat(resolved.absolute)
    return {
      success: true,
      operation: "write",
      path: resolved.rel,
      metadata: { size: stat.size },
    }
  } catch (e) {
    return {
      success: false,
      operation: "write",
      error: e instanceof Error ? e.message : String(e),
      diagnostics: { code: "WRITE_FAILED" },
    }
  }
}
