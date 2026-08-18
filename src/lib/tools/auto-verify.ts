// Auto-Verification Hook — runs lint/syntax check after write_file/edit_file.
import { spawn } from "node:child_process"
import path from "node:path"
import { WORKSPACE_ROOT } from "./workspace"

const LINTABLE_EXT = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"])

function run(cmd: string, cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", cmd], {
      cwd,
      env: { ...process.env },
      timeout: 20000,
    })
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (d) => (stdout += d.toString()))
    child.stderr?.on("data", (d) => (stderr += d.toString()))
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? -1 }))
    child.on("error", () => resolve({ stdout, stderr, code: -1 }))
  })
}

function isLintable(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return LINTABLE_EXT.has(ext)
}

// Run verification for a file that was just written/edited.
// Returns a short summary the agent can act on.
export async function verifyFile(
  filePath: string
): Promise<{ ok: boolean; summary: string; details: string }> {
  if (!filePath || !isLintable(filePath)) {
    return {
      ok: true,
      summary: "⏭️ لا تحقق تلقائي لهذا النوع من الملفات",
      details: "",
    }
  }

  const root = path.resolve(WORKSPACE_ROOT)
  const abs = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(root, filePath)
  const rel = path.relative(root, abs)

  // 1. Syntax check (fast, works for .js/.mjs/.cjs)
  if (path.extname(abs) === ".js" || path.extname(abs) === ".mjs" || path.extname(abs) === ".cjs") {
    const syntaxRes = await run(`node --check ${JSON.stringify(abs)}`, root)
    if (syntaxRes.code !== 0) {
      return {
        ok: false,
        summary: "❌ خطأ صياغة (Syntax Error)",
        details: (syntaxRes.stderr || syntaxRes.stdout).trim().slice(0, 1500),
      }
    }
  }

  // 2. ESLint on the single file (uses project config, JSON output for parsing)
  // Use npx for cross-platform compatibility (avoids .cmd/.sh extension issues on Windows)
  const eslintRes = await run(
    `npx eslint ${JSON.stringify(rel)} --format json 2>/dev/null`,
    root
  )

  if (eslintRes.code === 0) {
    return {
      ok: true,
      summary: "✅ تحقق تلقائي: لا أخطاء صياغة أو Lint",
      details: "",
    }
  }

  // ESLint reported issues — parse the JSON output
  let errorCount = 0
  let warningCount = 0
  const issues: string[] = []
  try {
    const json = JSON.parse(eslintRes.stdout || "[]") as Array<{
      errorCount: number
      warningCount: number
      messages: Array<{
        ruleId?: string
        severity: number
        message: string
        line: number
        column: number
      }>
    }>
    for (const file of json) {
      errorCount += file.errorCount
      warningCount += file.warningCount
      for (const msg of file.messages.slice(0, 10)) {
        const sev = msg.severity === 2 ? "Error" : "Warning"
        issues.push(
          `  سطر ${msg.line}:${msg.column} ${sev} — ${msg.message}${
            msg.ruleId ? ` (${msg.ruleId})` : ""
          }`
        )
      }
    }
  } catch {
    // JSON parse failed — fall back to raw output
    const raw = (eslintRes.stdout || eslintRes.stderr || "").trim()
    return {
      ok: false,
      summary: "⚠️ تحقق تلقائي: وُجدت مشاكل",
      details: raw.slice(0, 1000),
    }
  }

  if (errorCount === 0 && warningCount === 0) {
    return {
      ok: true,
      summary: "✅ تحقق تلقائي: لا أخطاء صياغة أو Lint",
      details: "",
    }
  }

  return {
    ok: false,
    summary: `⚠️ تحقق تلقائي: ${errorCount} خطأ، ${warningCount} تحذير`,
    details: issues.join("\n").slice(0, 1500),
  }
}
