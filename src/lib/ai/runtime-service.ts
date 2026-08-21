// Runtime Service — build / lint / typecheck commands for project workspaces.
// Adapted from mimo-life-os. Uses our workspace guard to find the project dir.

import { exec } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"

const execAsync = promisify(exec)

export interface BuildResult {
  success: boolean
  stdout: string
  stderr: string
  durationMs: number
}

async function runCommand(
  cmd: string,
  cwd: string,
  timeoutMs = 120_000
): Promise<BuildResult> {
  const start = Date.now()
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 5 * 1024 * 1024,
    })
    return {
      success: true,
      stdout: stdout.toString(),
      stderr: stderr.toString(),
      durationMs: Date.now() - start,
    }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string }
    return {
      success: false,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? err.message ?? String(e),
      durationMs: Date.now() - start,
    }
  }
}

function projectDir(projectId: string): string {
  // If projectId is an absolute path that exists, use it directly.
  // Otherwise, resolve relative to WORKSPACE_ROOT/projects/.
  if (path.isAbsolute(projectId)) {
    return projectId
  }
  // Special case: if the projectId is the workspace root itself
  if (projectId === "." || projectId === "root") {
    return path.resolve(WORKSPACE_ROOT)
  }
  return path.resolve(WORKSPACE_ROOT, "projects", projectId)
}

/** Run the build command inside the project directory. */
export async function build(projectId: string): Promise<BuildResult> {
  return runCommand("npm run build 2>&1 || bun run build 2>&1", projectDir(projectId))
}

/** Run ESLint inside the project directory. */
export async function lint(projectId: string): Promise<BuildResult> {
  return runCommand("npx eslint . --quiet 2>&1", projectDir(projectId))
}

/** Run TypeScript type-check inside the project directory. */
export async function typecheck(projectId: string): Promise<BuildResult> {
  return runCommand("npx tsc --noEmit 2>&1", projectDir(projectId))
}
