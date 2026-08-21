import { NextRequest, NextResponse } from "next/server"
import { spawn } from "node:child_process"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"
import path from "node:path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/diagnostics — run lint + typecheck + git status
export async function GET(req: NextRequest) {
  const check = req.nextUrl.searchParams.get("check") || "all"
  const root = path.resolve(WORKSPACE_ROOT)
  const results: { check: string; status: "pass" | "fail" | "skip"; output: string; durationMs: number }[] = []

  async function run(checkName: string, cmd: string): Promise<void> {
    const start = Date.now()
    try {
      const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
        const child = spawn("bash", ["-lc", cmd], { cwd: root, timeout: 30000, env: { ...process.env } })
        let stdout = "", stderr = ""
        child.stdout?.on("data", (d) => stdout += d.toString())
        child.stderr?.on("data", (d) => stderr += d.toString())
        child.on("close", (code) => resolve({ stdout, stderr, code: code ?? -1 }))
        child.on("error", () => resolve({ stdout, stderr, code: -1 }))
      })
      const output = (result.stdout + result.stderr).trim().slice(0, 500)
      results.push({ check: checkName, status: result.code === 0 ? "pass" : "fail", output, durationMs: Date.now() - start })
    } catch (e) {
      results.push({ check: checkName, status: "skip", output: String(e).slice(0, 200), durationMs: Date.now() - start })
    }
  }

  if (check === "all" || check === "lint") await run("lint", "npx eslint src/ --quiet 2>&1 | head -20")
  if (check === "all" || check === "typecheck") await run("typecheck", "npx tsc --noEmit 2>&1 | head -20")
  if (check === "all" || check === "git") await run("git-status", "git status --short 2>&1 | head -10")

  return NextResponse.json({
    results,
    passed: results.filter(r => r.status === "pass").length,
    failed: results.filter(r => r.status === "fail").length,
    total: results.length,
  })
}
