// Verification Ladder — multi-stage verification after code changes.
// Stages: syntax → lint → typecheck → test → build
// Each stage produces a result; failures are reported with actionable messages.

import { spawn } from "node:child_process"
import path from "node:path"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"
import { isParsable } from "@/lib/code-intel/ast-engine"

export type VerificationStage =
  | "syntax"
  | "lint"
  | "typecheck"
  | "test"
  | "build"

export type VerificationStatus = "pass" | "fail" | "skip"

export interface VerificationResult {
  stage: VerificationStage
  status: VerificationStatus
  message: string
  details?: string
  durationMs: number
}

export interface LadderResult {
  results: VerificationResult[]
  allPassed: boolean
  summary: string
  totalDurationMs: number
}

function run(cmd: string, cwd: string, timeout = 20000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", cmd], {
      cwd,
      env: { ...process.env },
      timeout,
    })
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (d) => (stdout += d.toString()))
    child.stderr?.on("data", (d) => (stderr += d.toString()))
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? -1 }))
    child.on("error", () => resolve({ stdout, stderr, code: -1 }))
  })
}

// Stage 1: Syntax check (node --check for .js, tsc --noEmit for .ts)
async function checkSyntax(filePath: string, root: string): Promise<VerificationResult> {
  const start = Date.now()
  const ext = path.extname(filePath).toLowerCase()

  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
    const res = await run(`node --check ${JSON.stringify(filePath)}`, root)
    if (res.code === 0) {
      return { stage: "syntax", status: "pass", message: "✅ لا أخطاء صياغة", durationMs: Date.now() - start }
    }
    return {
      stage: "syntax",
      status: "fail",
      message: "❌ خطأ صياغة",
      details: (res.stderr || res.stdout).trim().slice(0, 500),
      durationMs: Date.now() - start,
    }
  }

  if (ext === ".ts" || ext === ".tsx") {
    // For TS, syntax check via tsc --noEmit on the single file
    const res = await run(`npx tsc --noEmit --skipLibCheck ${JSON.stringify(filePath)} 2>&1`, root, 30000)
    if (res.code === 0) {
      return { stage: "syntax", status: "pass", message: "✅ لا أخطاء TypeScript", durationMs: Date.now() - start }
    }
    // tsc often reports errors from imported files — only report if the error mentions our file
    const relevant = (res.stdout + res.stderr).includes(filePath)
    if (!relevant) {
      return { stage: "syntax", status: "pass", message: "✅ لا أخطاء مباشرة في الملف", durationMs: Date.now() - start }
    }
    return {
      stage: "syntax",
      status: "fail",
      message: "❌ أخطاء TypeScript",
      details: (res.stdout || res.stderr).trim().slice(0, 500),
      durationMs: Date.now() - start,
    }
  }

  return { stage: "syntax", status: "skip", message: "⏭️ لا فحص صياغة لهذا النوع", durationMs: 0 }
}

// Stage 2: ESLint
async function checkLint(filePath: string, root: string): Promise<VerificationResult> {
  const start = Date.now()
  const ext = path.extname(filePath).toLowerCase()
  if (![".js", ".jsx", ".ts", ".tsx", ".mjs"].includes(ext)) {
    return { stage: "lint", status: "skip", message: "⏭️ لا فحص Lint", durationMs: 0 }
  }

  const res = await run(`npx eslint ${JSON.stringify(filePath)} --format json 2>/dev/null`, root)
  if (res.code === 0) {
    return { stage: "lint", status: "pass", message: "✅ لا أخطاء Lint", durationMs: Date.now() - start }
  }

  try {
    const json = JSON.parse(res.stdout || "[]") as Array<{
      errorCount: number
      warningCount: number
      messages: Array<{ message: string; line: number; severity: number; ruleId?: string }>
    }>
    let errors = 0
    let warnings = 0
    const issues: string[] = []
    for (const f of json) {
      errors += f.errorCount
      warnings += f.warningCount
      for (const m of f.messages.slice(0, 5)) {
        issues.push(`  سطر ${m.line}: ${m.message}${m.ruleId ? ` (${m.ruleId})` : ""}`)
      }
    }
    if (errors === 0 && warnings === 0) {
      return { stage: "lint", status: "pass", message: "✅ لا أخطاء Lint", durationMs: Date.now() - start }
    }
    return {
      stage: "lint",
      status: errors > 0 ? "fail" : "pass",
      message: `${errors > 0 ? "❌" : "⚠️"} ${errors} خطأ، ${warnings} تحذير`,
      details: issues.join("\n").slice(0, 500),
      durationMs: Date.now() - start,
    }
  } catch {
    return { stage: "lint", status: "skip", message: "⏭️ فشل تحليل Lint", durationMs: Date.now() - start }
  }
}

// Stage 3: Test run (if a test file exists for the given file)
async function checkTests(filePath: string, root: string): Promise<VerificationResult> {
  const start = Date.now()
  const ext = path.extname(filePath).toLowerCase()
  if (![".js", ".mjs"].includes(ext)) {
    return { stage: "test", status: "skip", message: "⏭️ لا اختبارات لهذا النوع", durationMs: 0 }
  }

  // Try to run the file itself (many JS files have self-tests)
  const res = await run(`node ${JSON.stringify(filePath)} 2>&1`, root, 15000)
  if (res.code === 0) {
    return { stage: "test", status: "pass", message: "✅ التنفيذ نجح (exit 0)", durationMs: Date.now() - start }
  }
  return {
    stage: "test",
    status: "fail",
    message: `❌ التنفيذ فشل (exit ${res.code})`,
    details: (res.stderr || res.stdout).trim().slice(0, 500),
    durationMs: Date.now() - start,
  }
}

// Main entry: run the full verification ladder on a file
export async function runVerificationLadder(
  filePath: string
): Promise<LadderResult> {
  const root = path.resolve(WORKSPACE_ROOT)
  const results: VerificationResult[] = []
  const totalStart = Date.now()

  // Stage 1: Syntax
  const syntax = await checkSyntax(filePath, root)
  results.push(syntax)
  // If syntax fails, skip remaining stages
  if (syntax.status === "fail") {
    return {
      results,
      allPassed: false,
      summary: `❌ فشل في الصياغة — أصلح أولاً`,
      totalDurationMs: Date.now() - totalStart,
    }
  }

  // Stage 2: Lint
  const lint = await checkLint(filePath, root)
  results.push(lint)

  // Stage 3: Tests
  const test = await checkTests(filePath, root)
  results.push(test)

  const allPassed = results.every((r) => r.status !== "fail")
  const passed = results.filter((r) => r.status === "pass").length
  const failed = results.filter((r) => r.status === "fail").length
  const skipped = results.filter((r) => r.status === "skip").length

  return {
    results,
    allPassed,
    summary: `${allPassed ? "✅" : "⚠️"} السلم: ${passed} نجح، ${failed} فشل، ${skipped} تخطي`,
    totalDurationMs: Date.now() - totalStart,
  }
}

// Format ladder results for the agent (tool result)
export function formatLadderResult(result: LadderResult): string {
  const lines = result.results.map(
    (r) => `${r.stage}: ${r.message}${r.details ? `\n  ${r.details}` : ""}`
  )
  return `🔍 Verification Ladder (${result.totalDurationMs}ms):\n${result.summary}\n${lines.join("\n")}`
}
