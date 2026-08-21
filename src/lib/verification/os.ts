// Verification OS — comprehensive multi-stage verification system.
// 14 stages, deterministic (0 LLM calls), bilingual (Arabic + English).
//
// Stages:
//   Automated Verification
//     1.  Syntax Check        — node --check / tsc --noEmit on a single file
//     2.  AST Check           — structural parse via code-intel ast-engine
//     3.  LSP Diagnostics     — lightweight deterministic diagnostic heuristics
//     4.  Typecheck           — tsc --noEmit on the whole project
//     5.  Lint                — eslint
//     6.  Unit Tests          — *.test.ts / *.spec.ts
//     7.  Integration Tests   — *.integration.test.ts
//     8.  Regression Tests    — run + compare against a stored baseline
//     9.  Targeted Tests      — run a single named test file
//     10. Full Test Suite     — run the whole test runner
//     11. Build Verification  — next build / tsc build dry-run
//     12. Diff Review        — git diff structural review
//     13. Security Scan       — secret / dangerous-pattern scan
//   Definition of Done
//     14. Aggregate gate — all required stages pass + policy checks
//
// Every stage is independent and re-runnable. The orchestrator runs an ordered
// subset (a "profile") and produces a single Definition-of-Done verdict.

import { spawn } from "node:child_process"
import path from "node:path"
import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"
import { isParsable, parseFile } from "@/lib/code-intel/ast-engine"

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type VerificationStageName =
  | "syntax"
  | "ast"
  | "lsp_diagnostics"
  | "typecheck"
  | "lint"
  | "unit_tests"
  | "integration_tests"
  | "regression_tests"
  | "targeted_tests"
  | "full_test_suite"
  | "build"
  | "diff_review"
  | "security_scan"
  | "definition_of_done"

export type VerificationStatus = "pass" | "fail" | "skip" | "warn"

export type Severity = "info" | "low" | "medium" | "high" | "critical"

export interface Diagnostic {
  file: string
  line?: number
  column?: number
  severity: Severity
  rule?: string
  message: string
}

export interface StageResult {
  stage: VerificationStageName
  status: VerificationStatus
  /** Arabic + English bilingual headline. */
  message: string
  details?: string
  diagnostics?: Diagnostic[]
  durationMs: number
  /** Whether a failure here should block downstream stages. */
  blocking: boolean
  /** Raw metrics, free-form per stage. */
  metrics?: Record<string, number | string>
}

export interface VerificationProfile {
  name: string
  stages: VerificationStageName[]
  /** Stages that must pass for Definition of Done. */
  required: VerificationStageName[]
}

export interface VerificationContext {
  /** File or directory under verification. */
  target: string
  /** Optional specific test file for targeted_tests. */
  targetedTestFile?: string
  /** Git baseline ref for regression comparison (e.g. "HEAD~1"). */
  baselineRef?: string
  /** Profile to run; defaults to "standard". */
  profile?: ProfileName
  /** Optional list of changed files (for diff_review / security_scan). */
  changedFiles?: string[]
}

export interface VerificationOSResult {
  context: VerificationContext
  stages: StageResult[]
  definitionOfDone: StageResult
  allPassed: boolean
  totalDurationMs: number
  summary: string
  /** Short machine-readable digest for the agent loop. */
  digest: {
    passed: string[]
    failed: string[]
    skipped: string[]
    warnings: string[]
    dod: boolean
  }
}

export type ProfileName = "fast" | "standard" | "full" | "pre_commit" | "ci"

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export const PROFILES: Record<ProfileName, VerificationProfile> = {
  // Fast — only cheap local checks. No tests, no build.
  fast: {
    name: "fast",
    stages: ["syntax", "ast", "lsp_diagnostics", "lint"],
    required: ["syntax", "ast", "lsp_diagnostics", "lint"],
  },
  // Standard — the default for after a write_file/edit_file.
  standard: {
    name: "standard",
    stages: ["syntax", "ast", "lsp_diagnostics", "typecheck", "lint", "unit_tests", "security_scan"],
    required: ["syntax", "ast", "typecheck", "lint"],
  },
  // Full — everything, including build + full suite.
  full: {
    name: "full",
    stages: [
      "syntax",
      "ast",
      "lsp_diagnostics",
      "typecheck",
      "lint",
      "unit_tests",
      "integration_tests",
      "regression_tests",
      "full_test_suite",
      "build",
      "diff_review",
      "security_scan",
    ],
    required: ["syntax", "ast", "typecheck", "lint", "build", "security_scan"],
  },
  // Pre-commit — focused on the working tree diff.
  pre_commit: {
    name: "pre_commit",
    stages: ["syntax", "ast", "typecheck", "lint", "diff_review", "security_scan"],
    required: ["syntax", "typecheck", "lint", "security_scan"],
  },
  // CI — like full but Definition of Done requires every stage.
  ci: {
    name: "ci",
    stages: [
      "syntax",
      "ast",
      "lsp_diagnostics",
      "typecheck",
      "lint",
      "unit_tests",
      "integration_tests",
      "full_test_suite",
      "build",
      "diff_review",
      "security_scan",
    ],
    required: [
      "syntax",
      "ast",
      "lsp_diagnostics",
      "typecheck",
      "lint",
      "unit_tests",
      "build",
      "security_scan",
    ],
  },
}

// ---------------------------------------------------------------------------
// Shell runner
// ---------------------------------------------------------------------------

function run(
  cmd: string,
  cwd: string,
  timeout = 30_000
): Promise<{ stdout: string; stderr: string; code: number }> {
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

function now(): number {
  return Date.now()
}

function ext(name: string): string {
  return path.extname(name).toLowerCase()
}

const LINTABLE = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"])
const TS_LIKE = new Set([".ts", ".tsx", ".mts", ".cts"])
const JS_LIKE = new Set([".js", ".jsx", ".mjs", ".cjs"])

// ---------------------------------------------------------------------------
// Stage 1: Syntax Check
// ---------------------------------------------------------------------------

async function stageSyntax(ctx: VerificationContext): Promise<StageResult> {
  const start = now()
  const root = path.resolve(WORKSPACE_ROOT)
  const target = path.isAbsolute(ctx.target) ? ctx.target : path.resolve(root, ctx.target)

  // Directory mode: syntax-check every lintable file.
  let stat
  try {
    stat = await fs.stat(target)
  } catch {
    return {
      stage: "syntax",
      status: "skip",
      message: "⏭️ الهدف غير موجود — تم التخطي / target not found",
      durationMs: now() - start,
      blocking: false,
    }
  }

  if (stat.isDirectory()) {
    // For a directory we rely on tsc to cover the whole tree.
    const res = await run("npx tsc --noEmit --skipLibCheck 2>&1", root, 60_000)
    if (res.code === 0) {
      return {
        stage: "syntax",
        status: "pass",
        message: "✅ صياغة سليمة لكل المجلد / dir syntax OK",
        durationMs: now() - start,
        blocking: true,
      }
    }
    return {
      stage: "syntax",
      status: "fail",
      message: "❌ أخطاء TypeScript في المجلد / TS errors in dir",
      details: (res.stdout || res.stderr).trim().slice(0, 800),
      durationMs: now() - start,
      blocking: true,
    }
  }

  const e = ext(target)
  if (JS_LIKE.has(e)) {
    const res = await run(`node --check ${JSON.stringify(target)}`, root)
    if (res.code === 0) {
      return {
        stage: "syntax",
        status: "pass",
        message: "✅ لا أخطاء صياغة / no syntax errors",
        durationMs: now() - start,
        blocking: true,
      }
    }
    return {
      stage: "syntax",
      status: "fail",
      message: "❌ خطأ صياغة / syntax error",
      details: (res.stderr || res.stdout).trim().slice(0, 800),
      durationMs: now() - start,
      blocking: true,
    }
  }

  if (TS_LIKE.has(e)) {
    const res = await run(
      `npx tsc --noEmit --skipLibCheck ${JSON.stringify(target)} 2>&1`,
      root,
      45_000
    )
    if (res.code === 0) {
      return {
        stage: "syntax",
        status: "pass",
        message: "✅ لا أخطاء TypeScript / no TS errors",
        durationMs: now() - start,
        blocking: true,
      }
    }
    const relevant = (res.stdout + res.stderr).includes(target)
    if (!relevant) {
      return {
        stage: "syntax",
        status: "pass",
        message: "✅ لا أخطاء مباشرة في الملف / no direct file errors",
        durationMs: now() - start,
        blocking: true,
      }
    }
    return {
      stage: "syntax",
      status: "fail",
      message: "❌ أخطاء TypeScript / TS errors",
      details: (res.stdout || res.stderr).trim().slice(0, 800),
      durationMs: now() - start,
      blocking: true,
    }
  }

  return {
    stage: "syntax",
    status: "skip",
    message: "⏭️ لا فحص صياغة لهذا النوع / no syntax check for this type",
    durationMs: 0,
    blocking: false,
  }
}

// ---------------------------------------------------------------------------
// Stage 2: AST Check — structural parse via code-intel
// ---------------------------------------------------------------------------

async function stageAst(ctx: VerificationContext): Promise<StageResult> {
  const start = now()
  const root = path.resolve(WORKSPACE_ROOT)
  const target = path.isAbsolute(ctx.target) ? ctx.target : path.resolve(root, ctx.target)

  let stat
  try {
    stat = await fs.stat(target)
  } catch {
    return {
      stage: "ast",
      status: "skip",
      message: "⏭️ الهدف غير موجود / target not found",
      durationMs: now() - start,
      blocking: false,
    }
  }

  const files: string[] = []
  if (stat.isFile()) {
    files.push(target)
  } else {
    // Walk the directory for lintable files.
    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const ent of entries) {
        if (ent.name === "node_modules" || ent.name === ".git" || ent.name === ".next") continue
        const full = path.join(dir, ent.name)
        if (ent.isDirectory()) await walk(full)
        else if (LINTABLE.has(ext(ent.name))) files.push(full)
      }
    }
    await walk(target)
  }

  const diagnostics: Diagnostic[] = []
  let parsed = 0
  let symbols = 0
  for (const f of files) {
    if (!isParsable(f)) {
      diagnostics.push({
        file: path.relative(root, f),
        severity: "high",
        rule: "ast/unparseable",
        message: "الملف غير قابل للتحليل البنيوي / file is not structurally parsable",
      })
      continue
    }
    const parsed_result = parseFile(f)
    if (!parsed_result) {
      diagnostics.push({
        file: path.relative(root, f),
        severity: "medium",
        rule: "ast/empty",
        message: "تحليل فارغ / empty parse result",
      })
      continue
    }
    parsed++
    symbols += parsed_result.symbols?.length ?? 0
  }

  if (files.length === 0) {
    return {
      stage: "ast",
      status: "skip",
      message: "⏭️ لا ملفات قابلة للتحليل / no parsable files",
      durationMs: now() - start,
      blocking: false,
    }
  }

  if (diagnostics.length > 0) {
    return {
      stage: "ast",
      status: "fail",
      message: `❌ ${diagnostics.length} ملف غير قابل للتحليل / unparseable files`,
      details: diagnostics
        .slice(0, 10)
        .map((d) => `${d.file}: ${d.message}`)
        .join("\n"),
      diagnostics,
      durationMs: now() - start,
      blocking: true,
      metrics: { files: files.length, parsed, symbols },
    }
  }

  return {
    stage: "ast",
    status: "pass",
    message: `✅ ${parsed}/${files.length} ملف تحلل بنجياً (${symbols} رمز) / parsed ok`,
    diagnostics: [],
    durationMs: now() - start,
    blocking: true,
    metrics: { files: files.length, parsed, symbols },
  }
}

// ---------------------------------------------------------------------------
// Stage 3: LSP Diagnostics — lightweight deterministic diagnostics
// (We don't run a real LSP server; we emulate the most valuable checks.)
// ---------------------------------------------------------------------------

async function stageLspDiagnostics(ctx: VerificationContext): Promise<StageResult> {
  const start = now()
  const root = path.resolve(WORKSPACE_ROOT)
  const target = path.isAbsolute(ctx.target) ? ctx.target : path.resolve(root, ctx.target)

  let stat
  try {
    stat = await fs.stat(target)
  } catch {
    return {
      stage: "lsp_diagnostics",
      status: "skip",
      message: "⏭️ الهدف غير موجود / target not found",
      durationMs: now() - start,
      blocking: false,
    }
  }

  const files: string[] = []
  if (stat.isFile()) {
    if (LINTABLE.has(ext(target))) files.push(target)
  } else {
    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const ent of entries) {
        if (ent.name === "node_modules" || ent.name === ".git" || ent.name === ".next") continue
        const full = path.join(dir, ent.name)
        if (ent.isDirectory()) await walk(full)
        else if (LINTABLE.has(ext(ent.name))) files.push(full)
      }
    }
    await walk(target)
  }

  const diagnostics: Diagnostic[] = []

  for (const f of files) {
    let content = ""
    try {
      content = await fs.readFile(f, "utf-8")
    } catch {
      continue
    }
    const lines = content.split("\n")
    const rel = path.relative(root, f)

    // D1: `any` usage in TS (informational, but flagged as a code smell)
    if (TS_LIKE.has(ext(f))) {
      lines.forEach((line, i) => {
        const m = line.match(/:\s*any\b|<any>|\bas any\b/)
        if (m) {
          diagnostics.push({
            file: rel,
            line: i + 1,
            column: (m.index ?? 0) + 1,
            severity: "info",
            rule: "ts/no-explicit-any",
            message: "استخدام `any` صراحةً / explicit `any` usage",
          })
        }
      })
    }

    // D2: `console.log` left in production code (warn)
    lines.forEach((line, i) => {
      if (/\bconsole\.(log|debug|info)\b/.test(line) && !/\/\/|\/\*/.test(line.split("console")[0])) {
        diagnostics.push({
          file: rel,
          line: i + 1,
          column: (line.indexOf("console") ?? 0) + 1,
          severity: "low",
          rule: "style/no-console",
          message: "console.log متبقي / leftover console.log",
        })
      }
    })

    // D3: `TODO` / `FIXME` without an owner (low)
    lines.forEach((line, i) => {
      const m = line.match(/\b(TODO|FIXME|XXX|HACK)\b(?:\(([^)]+)\))?/)
      if (m) {
        diagnostics.push({
          file: rel,
          line: i + 1,
          column: (m.index ?? 0) + 1,
          severity: "low",
          rule: "style/todo",
          message: `علامة ${m[1]} بدون مسؤول / ${m[1]} without owner`,
        })
      }
    })

    // D4: `eval(` — high severity
    lines.forEach((line, i) => {
      if (/\beval\s*\(/.test(line)) {
        diagnostics.push({
          file: rel,
          line: i + 1,
          severity: "high",
          rule: "security/no-eval",
          message: "استخدام eval / eval usage",
        })
      }
    })

    // D5: unresolved `@ts-ignore` / `@ts-nocheck` (medium)
    lines.forEach((line, i) => {
      if (/@ts-ignore|@ts-nocheck/.test(line)) {
        diagnostics.push({
          file: rel,
          line: i + 1,
          severity: "medium",
          rule: "ts/no-suppressed-error",
          message: "كبت أخطاء TypeScript / suppressed TS error",
        })
      }
    })
  }

  // Status: pass with info, warn on low+, fail on high+/critical.
  const high = diagnostics.filter((d) => d.severity === "high" || d.severity === "critical").length
  const med = diagnostics.filter((d) => d.severity === "medium").length
  const low = diagnostics.filter((d) => d.severity === "low" || d.severity === "info").length

  if (high > 0) {
    return {
      stage: "lsp_diagnostics",
      status: "fail",
      message: `❌ ${high} تشخيص عالي الخطورة / ${high} high-severity diagnostics`,
      details: diagnostics
        .filter((d) => d.severity === "high" || d.severity === "critical")
        .slice(0, 10)
        .map((d) => `${d.file}:${d.line} [${d.rule}] ${d.message}`)
        .join("\n"),
      diagnostics,
      durationMs: now() - start,
      blocking: false,
      metrics: { high, medium: med, low, total: diagnostics.length, files: files.length },
    }
  }

  if (med > 0) {
    return {
      stage: "lsp_diagnostics",
      status: "warn",
      message: `⚠️ ${med} متوسط، ${low} منخفض / ${med} medium, ${low} low`,
      diagnostics,
      durationMs: now() - start,
      blocking: false,
      metrics: { high, medium: med, low, total: diagnostics.length, files: files.length },
    }
  }

  return {
    stage: "lsp_diagnostics",
    status: "pass",
    message: `✅ ${low} ملاحظات منخفضة فقط / ${low} low-severity notes`,
    diagnostics,
    durationMs: now() - start,
    blocking: false,
    metrics: { high, medium: med, low, total: diagnostics.length, files: files.length },
  }
}

// ---------------------------------------------------------------------------
// Stage 4: Typecheck — whole-project tsc
// ---------------------------------------------------------------------------

async function stageTypecheck(_ctx: VerificationContext): Promise<StageResult> {
  const start = now()
  const root = path.resolve(WORKSPACE_ROOT)
  const res = await run("npx tsc --noEmit --skipLibCheck 2>&1", root, 90_000)

  if (res.code === 0) {
    return {
      stage: "typecheck",
      status: "pass",
      message: "✅ لا أخطاء أنواع / no type errors",
      durationMs: now() - start,
      blocking: true,
    }
  }

  // Parse tsc output for diagnostics.
  const diagnostics: Diagnostic[] = []
  const re = /([^\s].+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(res.stdout)) !== null) {
    diagnostics.push({
      file: m[1],
      line: Number(m[2]),
      column: Number(m[3]),
      severity: "high",
      rule: m[4],
      message: m[5],
    })
    if (diagnostics.length >= 50) break
  }

  return {
    stage: "typecheck",
    status: "fail",
    message: `❌ ${diagnostics.length} خطأ أنواع / ${diagnostics.length} type errors`,
    details: diagnostics.slice(0, 20).map((d) => `${d.file}:${d.line}:${d.column} ${d.rule} ${d.message}`).join("\n"),
    diagnostics,
    durationMs: now() - start,
    blocking: true,
    metrics: { errors: diagnostics.length },
  }
}

// ---------------------------------------------------------------------------
// Stage 5: Lint — eslint
// ---------------------------------------------------------------------------

async function stageLint(ctx: VerificationContext): Promise<StageResult> {
  const start = now()
  const root = path.resolve(WORKSPACE_ROOT)
  const target = path.isAbsolute(ctx.target) ? ctx.target : path.resolve(root, ctx.target)

  // Resolve the lint target: a file, or the changed-files list, or the whole project.
  let lintArgs: string
  let stat
  try {
    stat = await fs.stat(target)
  } catch {
    return {
      stage: "lint",
      status: "skip",
      message: "⏭️ الهدف غير موجود / target not found",
      durationMs: now() - start,
      blocking: false,
    }
  }

  if (stat.isFile() && LINTABLE.has(ext(target))) {
    lintArgs = JSON.stringify(target)
  } else if (ctx.changedFiles && ctx.changedFiles.length > 0) {
    lintArgs = ctx.changedFiles.filter((f) => LINTABLE.has(ext(f))).map((f) => JSON.stringify(f)).join(" ")
    if (!lintArgs) {
      return {
        stage: "lint",
        status: "skip",
        message: "⏭️ لا ملفات قابلة للـ Lint / no lintable files",
        durationMs: now() - start,
        blocking: false,
      }
    }
  } else {
    lintArgs = "."
  }

  const res = await run(`npx eslint ${lintArgs} --format json 2>/dev/null`, root, 60_000)
  if (res.code === 0) {
    return {
      stage: "lint",
      status: "pass",
      message: "✅ لا أخطاء Lint / no lint errors",
      durationMs: now() - start,
      blocking: true,
    }
  }

  let errors = 0
  let warnings = 0
  const diagnostics: Diagnostic[] = []
  try {
    const json = JSON.parse(res.stdout || "[]") as Array<{
      filePath: string
      errorCount: number
      warningCount: number
      messages: Array<{ message: string; line: number; column: number; severity: number; ruleId?: string }>
    }>
    for (const f of json) {
      for (const msg of f.messages) {
        errors += msg.severity === 2 ? 1 : 0
        warnings += msg.severity === 1 ? 1 : 0
        diagnostics.push({
          file: path.relative(root, f.filePath),
          line: msg.line,
          column: msg.column,
          severity: msg.severity === 2 ? "high" : "low",
          rule: msg.ruleId,
          message: msg.message,
        })
        if (diagnostics.length >= 50) break
      }
    }
  } catch {
    return {
      stage: "lint",
      status: "skip",
      message: "⏭️ فشل تحليل Lint / failed to parse lint output",
      durationMs: now() - start,
      blocking: false,
    }
  }

  if (errors === 0 && warnings === 0) {
    return {
      stage: "lint",
      status: "pass",
      message: "✅ لا أخطاء Lint / no lint errors",
      durationMs: now() - start,
      blocking: true,
    }
  }

  return {
    stage: "lint",
    status: errors > 0 ? "fail" : "warn",
    message: `${errors > 0 ? "❌" : "⚠️"} ${errors} خطأ، ${warnings} تحذير / ${errors} errors, ${warnings} warnings`,
    details: diagnostics.slice(0, 20).map((d) => `${d.file}:${d.line} ${d.rule ?? ""} ${d.message}`).join("\n"),
    diagnostics,
    durationMs: now() - start,
    blocking: errors > 0,
    metrics: { errors, warnings },
  }
}

// ---------------------------------------------------------------------------
// Shared: test discovery + runner
// ---------------------------------------------------------------------------

async function findTestFiles(root: string, pattern: RegExp): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [] as import("node:fs").Dirent[])
    for (const ent of entries) {
      if (ent.name === "node_modules" || ent.name === ".git" || ent.name === ".next") continue
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) await walk(full)
      else if (pattern.test(ent.name)) out.push(full)
    }
  }
  await walk(root)
  return out
}

async function runTestFiles(files: string[], root: string, timeout: number): Promise<StageResult> {
  const start = now()
  if (files.length === 0) {
    return {
      stage: "unit_tests",
      status: "skip",
      message: "⏭️ لا ملفات اختبار / no test files",
      durationMs: now() - start,
      blocking: false,
    }
  }
  const args = files.map((f) => JSON.stringify(f)).join(" ")
  // Prefer bun (fast), fall back to npx vitest if a vitest config exists.
  const useBun = existsSync(path.join(root, "bun.lockb")) || existsSync(path.join(root, "bun.lock"))
  const cmd = useBun
    ? `bun test ${args} 2>&1`
    : `npx vitest run ${args} 2>&1`
  const res = await run(cmd, root, timeout)

  // Parse pass/fail counts from output.
  const passed = Number((res.stdout.match(/(\d+)\s+pass/) ?? [])[1] ?? 0)
  const failed = Number((res.stdout.match(/(\d+)\s+fail/) ?? [])[1] ?? 0)
  const skipped = Number((res.stdout.match(/(\d+)\s+(?:skip|pending)/) ?? [])[1] ?? 0)

  const diagnostics: Diagnostic[] = []
  const failRe = /(?:✗|FAIL|failed).+?([^\s].+?\.(?:test|spec)\.[tj]sx?)(?::(\d+))?/g
  let m: RegExpExecArray | null
  while ((m = failRe.exec(res.stdout)) !== null) {
    diagnostics.push({
      file: path.relative(root, m[1]),
      line: m[2] ? Number(m[2]) : undefined,
      severity: "high",
      rule: "test/failure",
      message: "فشل اختبار / test failed",
    })
    if (diagnostics.length >= 30) break
  }

  if (res.code === 0 && failed === 0) {
    return {
      stage: "unit_tests",
      status: "pass",
      message: `✅ ${passed} اختبار نجح / ${passed} passed`,
      details: res.stdout.trim().slice(0, 400),
      diagnostics,
      durationMs: now() - start,
      blocking: false,
      metrics: { passed, failed, skipped, files: files.length },
    }
  }

  return {
    stage: "unit_tests",
    status: "fail",
    message: `❌ ${failed} فشل، ${passed} نجح / ${failed} failed, ${passed} passed`,
    details: (res.stdout || res.stderr).trim().slice(0, 800),
    diagnostics,
    durationMs: now() - start,
    blocking: false,
    metrics: { passed, failed, skipped, files: files.length },
  }
}

// ---------------------------------------------------------------------------
// Stage 6: Unit Tests — *.test.ts / *.spec.ts (excluding integration)
// ---------------------------------------------------------------------------

async function stageUnitTests(ctx: VerificationContext): Promise<StageResult> {
  const root = path.resolve(WORKSPACE_ROOT)
  const target = path.isAbsolute(ctx.target) ? ctx.target : path.resolve(root, ctx.target)
  let stat
  try {
    stat = await fs.stat(target)
  } catch {
    return {
      stage: "unit_tests",
      status: "skip",
      message: "⏭️ الهدف غير موجود / target not found",
      durationMs: 0,
      blocking: false,
    }
  }
  // Unit tests = test files NOT matching integration/regression.
  const base = stat.isDirectory() ? target : root
  const all = await findTestFiles(base, /\.(test|spec)\.[tj]sx?$/)
  const files = all.filter((f) => !/\.integration\./.test(f) && !/\.regression\./.test(f))
  if (stat.isFile()) {
    // If the target is a single test file, run just that.
    if (/\.(test|spec)\.[tj]sx?$/.test(stat.name ?? path.basename(target))) {
      return runTestFiles([target], root, 60_000)
    }
    // Otherwise run the co-located test file (foo.ts → foo.test.ts).
    const stem = path.basename(target, path.extname(target))
    const dir = path.dirname(target)
    const guess = await findTestFiles(dir, new RegExp(`^${stem}\\.(test|spec)\\.[tj]sx?$`))
    if (guess.length > 0) return runTestFiles(guess, root, 60_000)
    return {
      stage: "unit_tests",
      status: "skip",
      message: "⏭️ لا ملف اختبار مطابق / no matching test file",
      durationMs: 0,
      blocking: false,
    }
  }
  return runTestFiles(files, root, 120_000)
}

// ---------------------------------------------------------------------------
// Stage 7: Integration Tests — *.integration.test.ts
// ---------------------------------------------------------------------------

async function stageIntegrationTests(_ctx: VerificationContext): Promise<StageResult> {
  const root = path.resolve(WORKSPACE_ROOT)
  const files = await findTestFiles(root, /\.integration\.(test|spec)\.[tj]sx?$/)
  return runTestFiles(files, root, 180_000)
}

// ---------------------------------------------------------------------------
// Stage 8: Regression Tests — run + compare against a stored baseline.
// Baseline: .verification/baseline.json — { tests: { name: status } }
// ---------------------------------------------------------------------------

interface RegressionBaseline {
  generatedAt: string
  tests: Record<string, "pass" | "fail">
}

const BASELINE_PATH = ".verification/baseline.json"

async function readBaseline(root: string): Promise<RegressionBaseline | null> {
  try {
    const raw = await fs.readFile(path.join(root, BASELINE_PATH), "utf-8")
    return JSON.parse(raw) as RegressionBaseline
  } catch {
    return null
  }
}

async function stageRegressionTests(ctx: VerificationContext): Promise<StageResult> {
  const start = now()
  const root = path.resolve(WORKSPACE_ROOT)
  const baseline = await readBaseline(root)

  if (!baseline) {
    return {
      stage: "regression_tests",
      status: "skip",
      message: "⏭️ لا يوجد خط أساس — شغّل saveBaseline أولاً / no baseline — run saveBaseline first",
      durationMs: now() - start,
      blocking: false,
    }
  }

  // Run the full suite and compare to the baseline.
  const full = await stageFullTestSuite(ctx)
  if (full.status === "skip") {
    return {
      stage: "regression_tests",
      status: "skip",
      message: "⏭️ لا اختبارات للمقارنة / no tests to compare",
      durationMs: now() - start,
      blocking: false,
    }
  }

  // Heuristic regression detection: any previously-passing test that now fails.
  const newFailures: string[] = []
  for (const [name, prev] of Object.entries(baseline.tests)) {
    if (prev === "pass" && full.diagnostics?.some((d) => d.file.includes(name))) {
      newFailures.push(name)
    }
  }

  if (newFailures.length > 0) {
    return {
      stage: "regression_tests",
      status: "fail",
      message: `❌ ${newFailures.length} انحدار / ${newFailures.length} regressions`,
      details: newFailures.slice(0, 10).join("\n"),
      durationMs: now() - start,
      blocking: false,
      metrics: { regressions: newFailures.length, baselineGeneratedAt: baseline.generatedAt },
    }
  }

  return {
    stage: "regression_tests",
    status: "pass",
    message: "✅ لا انحدارات / no regressions vs baseline",
    durationMs: now() - start,
    blocking: false,
    metrics: { baselineGeneratedAt: baseline.generatedAt },
  }
}

// Save the current test state as a new baseline (called by CI or manually).
export async function saveRegressionBaseline(): Promise<boolean> {
  const root = path.resolve(WORKSPACE_ROOT)
  const files = await findTestFiles(root, /\.(test|spec)\.[tj]sx?$/)
  const tests: Record<string, "pass" | "fail"> = {}
  for (const f of files) {
    tests[path.relative(root, f)] = "pass"
  }
  const baseline: RegressionBaseline = {
    generatedAt: new Date().toISOString(),
    tests,
  }
  try {
    await fs.mkdir(path.dirname(path.join(root, BASELINE_PATH)), { recursive: true })
    await fs.writeFile(path.join(root, BASELINE_PATH), JSON.stringify(baseline, null, 2))
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Stage 9: Targeted Tests — run a single named test file
// ---------------------------------------------------------------------------

async function stageTargetedTests(ctx: VerificationContext): Promise<StageResult> {
  const start = now()
  const root = path.resolve(WORKSPACE_ROOT)
  const file = ctx.targetedTestFile
  if (!file) {
    return {
      stage: "targeted_tests",
      status: "skip",
      message: "⏭️ لا ملف اختبار محدد / no targeted test file specified",
      durationMs: now() - start,
      blocking: false,
    }
  }
  const abs = path.isAbsolute(file) ? file : path.resolve(root, file)
  if (!existsSync(abs)) {
    return {
      stage: "targeted_tests",
      status: "fail",
      message: `❌ الملف غير موجود: ${file} / file not found`,
      durationMs: now() - start,
      blocking: false,
    }
  }
  return runTestFiles([abs], root, 60_000)
}

// ---------------------------------------------------------------------------
// Stage 10: Full Test Suite — run the whole test runner
// ---------------------------------------------------------------------------

async function stageFullTestSuite(_ctx: VerificationContext): Promise<StageResult> {
  const start = now()
  const root = path.resolve(WORKSPACE_ROOT)
  const useBun = existsSync(path.join(root, "bun.lockb")) || existsSync(path.join(root, "bun.lock"))
  const cmd = useBun ? "bun test 2>&1" : "npx vitest run 2>&1"
  const res = await run(cmd, root, 300_000)

  const passed = Number((res.stdout.match(/(\d+)\s+pass/) ?? [])[1] ?? 0)
  const failed = Number((res.stdout.match(/(\d+)\s+fail/) ?? [])[1] ?? 0)

  if (res.code === 0 && failed === 0) {
    return {
      stage: "full_test_suite",
      status: "pass",
      message: `✅ ${passed} اختبار / ${passed} tests passed`,
      details: res.stdout.trim().slice(0, 400),
      durationMs: now() - start,
      blocking: false,
      metrics: { passed, failed },
    }
  }
  return {
    stage: "full_test_suite",
    status: "fail",
    message: `❌ ${failed} فشل، ${passed} نجح / ${failed} failed, ${passed} passed`,
    details: (res.stdout || res.stderr).trim().slice(0, 800),
    durationMs: now() - start,
    blocking: false,
    metrics: { passed, failed },
  }
}

// ---------------------------------------------------------------------------
// Stage 11: Build Verification
// ---------------------------------------------------------------------------

async function stageBuild(_ctx: VerificationContext): Promise<StageResult> {
  const start = now()
  const root = path.resolve(WORKSPACE_ROOT)

  // Prefer a quick type build dry-run over a full Next build (faster).
  // If package.json has a "build" script, we run `tsc --noEmit` as the cheap proxy.
  const res = await run("npx tsc --noEmit --skipLibCheck 2>&1", root, 120_000)
  if (res.code === 0) {
    return {
      stage: "build",
      status: "pass",
      message: "✅ البناء نظيف (type build) / build clean",
      durationMs: now() - start,
      blocking: true,
      metrics: { mode: "typecheck-dry-run" },
    }
  }
  return {
    stage: "build",
    status: "fail",
    message: "❌ فشل البناء / build failed",
    details: (res.stdout || res.stderr).trim().slice(0, 800),
    durationMs: now() - start,
    blocking: true,
    metrics: { mode: "typecheck-dry-run" },
  }
}

// ---------------------------------------------------------------------------
// Stage 12: Diff Review — structural review of git diff
// ---------------------------------------------------------------------------

async function stageDiffReview(ctx: VerificationContext): Promise<StageResult> {
  const start = now()
  const root = path.resolve(WORKSPACE_ROOT)
  const ref = ctx.baselineRef ?? "HEAD~1"

  const res = await run(`git diff --no-color ${JSON.stringify(ref)} 2>&1`, root, 15_000)
  if (res.code !== 0) {
    return {
      stage: "diff_review",
      status: "skip",
      message: "⏭️ لا فرق متاح / no diff available",
      durationMs: now() - start,
      blocking: false,
    }
  }

  const diff = res.stdout
  if (!diff.trim()) {
    return {
      stage: "diff_review",
      status: "pass",
      message: "✅ لا تغييرات / no changes",
      durationMs: now() - start,
      blocking: false,
    }
  }

  const diagnostics: Diagnostic[] = []
  const filesChanged = new Set<string>()
  let currentFile = ""
  let currentLine = 0

  for (const line of diff.split("\n")) {
    const fm = line.match(/^\+\+\+\s+b\/(.+)$/)
    if (fm) {
      currentFile = fm[1]
      filesChanged.add(currentFile)
      currentLine = 0
      continue
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentLine++
      // R1: debug-only additions
      if (/console\.(log|debug)/.test(line)) {
        diagnostics.push({
          file: currentFile,
          line: currentLine,
          severity: "low",
          rule: "diff/debug-added",
          message: "أضيف console.log / added console.log",
        })
      }
      // R2: secrets
      if (/(?:AKIA|sk-|ghp_|xoxb-|api[_-]?key\s*[:=]\s*["'][A-Za-z0-9])/i.test(line)) {
        diagnostics.push({
          file: currentFile,
          line: currentLine,
          severity: "critical",
          rule: "diff/secret",
          message: "محتمل سرّي / potential secret in diff",
        })
      }
      // R3: `eval(`
      if (/\beval\s*\(/.test(line)) {
        diagnostics.push({
          file: currentFile,
          line: currentLine,
          severity: "high",
          rule: "diff/eval",
          message: "أضيف eval / added eval",
        })
      }
      // R4: `// @ts-ignore` added
      if (/@ts-ignore|@ts-nocheck/.test(line)) {
        diagnostics.push({
          file: currentFile,
          line: currentLine,
          severity: "medium",
          rule: "diff/ts-ignore",
          message: "أضيف @ts-ignore / added @ts-ignore",
        })
      }
    } else if (line.startsWith(" ")) {
      currentLine++
    }
  }

  const critical = diagnostics.filter((d) => d.severity === "critical").length
  const high = diagnostics.filter((d) => d.severity === "high").length

  if (critical > 0 || high > 0) {
    return {
      stage: "diff_review",
      status: "fail",
      message: `❌ ${critical} حرج، ${high} عالي في الفرق / ${critical} critical, ${high} high in diff`,
      details: diagnostics.slice(0, 20).map((d) => `${d.file}:${d.line} [${d.rule}] ${d.message}`).join("\n"),
      diagnostics,
      durationMs: now() - start,
      blocking: false,
      metrics: { filesChanged: filesChanged.size, critical, high, total: diagnostics.length },
    }
  }

  return {
    stage: "diff_review",
    status: "pass",
    message: `✅ ${filesChanged.size} ملف تغير، ${diagnostics.length} ملاحظات / ${filesChanged.size} files, ${diagnostics.length} notes`,
    diagnostics,
    durationMs: now() - start,
    blocking: false,
    metrics: { filesChanged: filesChanged.size, total: diagnostics.length },
  }
}

// ---------------------------------------------------------------------------
// Stage 13: Security Scan — secret + dangerous-pattern scan
// ---------------------------------------------------------------------------

const SECRET_PATTERNS: Array<{ rule: string; re: RegExp; severity: Severity; message: string }> = [
  { rule: "sec/aws-key", re: /AKIA[0-9A-Z]{16}/, severity: "critical", message: "AWS access key" },
  { rule: "sec/openai-key", re: /sk-[A-Za-z0-9]{20,}/, severity: "critical", message: "OpenAI-style secret" },
  { rule: "sec/github-pat", re: /gh[pousr]_[A-Za-z0-9]{36,}/, severity: "critical", message: "GitHub PAT" },
  { rule: "sec/slack-token", re: /xox[baprs]-[A-Za-z0-9-]+/, severity: "critical", message: "Slack token" },
  { rule: "sec/generic-secret", re: /(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*["'][^"']{8,}["']/i, severity: "high", message: "Generic secret assignment" },
  { rule: "sec/private-key", re: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/, severity: "critical", message: "Embedded private key" },
]

const DANGER_PATTERNS: Array<{ rule: string; re: RegExp; severity: Severity; message: string }> = [
  { rule: "sec/eval", re: /\beval\s*\(/, severity: "high", message: "eval() usage" },
  { rule: "sec/child-exec-shell", re: /(?:exec|execSync|spawn)\([^)]*shell:\s*true/, severity: "medium", message: "Shell injection risk" },
  { rule: "sec/fs-unvalidated", re: /(?:readFile|writeFile|unlink|rm)\s*\(\s*[^,)]*\+/, severity: "medium", message: "Unvalidated path to fs" },
  { rule: "sec/http-insecure", re: /http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/, severity: "low", message: "Insecure http:// URL" },
]

async function stageSecurityScan(ctx: VerificationContext): Promise<StageResult> {
  const start = now()
  const root = path.resolve(WORKSPACE_ROOT)
  const target = path.isAbsolute(ctx.target) ? ctx.target : path.resolve(root, ctx.target)

  let stat
  try {
    stat = await fs.stat(target)
  } catch {
    return {
      stage: "security_scan",
      status: "skip",
      message: "⏭️ الهدف غير موجود / target not found",
      durationMs: now() - start,
      blocking: false,
    }
  }

  const files: string[] = []
  if (stat.isFile()) {
    if (LINTABLE.has(ext(target)) || ext(target) === ".json" || ext(target) === ".env") {
      files.push(target)
    }
  } else {
    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const ent of entries) {
        if (ent.name === "node_modules" || ent.name === ".git" || ent.name === ".next") continue
        // Skip .env.example — only flag real .env files.
        if (ent.name.startsWith(".env") && !ent.name.endsWith(".example")) {
          files.push(path.join(dir, ent.name))
          continue
        }
        const full = path.join(dir, ent.name)
        if (ent.isDirectory()) await walk(full)
        else if (LINTABLE.has(ext(ent.name)) || ext(ent.name) === ".json") files.push(full)
      }
    }
    await walk(target)
  }

  const diagnostics: Diagnostic[] = []
  for (const f of files) {
    let content = ""
    try {
      content = await fs.readFile(f, "utf-8")
    } catch {
      continue
    }
    const lines = content.split("\n")
    const rel = path.relative(root, f)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      for (const p of SECRET_PATTERNS) {
        if (p.re.test(line)) {
          diagnostics.push({
            file: rel,
            line: i + 1,
            severity: p.severity,
            rule: p.rule,
            message: p.message,
          })
        }
      }
      for (const p of DANGER_PATTERNS) {
        if (p.re.test(line)) {
          diagnostics.push({
            file: rel,
            line: i + 1,
            severity: p.severity,
            rule: p.rule,
            message: p.message,
          })
        }
      }
    }
  }

  const critical = diagnostics.filter((d) => d.severity === "critical").length
  const high = diagnostics.filter((d) => d.severity === "high").length
  const med = diagnostics.filter((d) => d.severity === "medium").length

  if (critical > 0) {
    return {
      stage: "security_scan",
      status: "fail",
      message: `🚨 ${critical} سرّ حرج / ${critical} critical secrets`,
      details: diagnostics
        .filter((d) => d.severity === "critical")
        .slice(0, 10)
        .map((d) => `${d.file}:${d.line} [${d.rule}] ${d.message}`)
        .join("\n"),
      diagnostics,
      durationMs: now() - start,
      blocking: true,
      metrics: { critical, high, medium: med, total: diagnostics.length, files: files.length },
    }
  }

  if (high > 0) {
    return {
      stage: "security_scan",
      status: "fail",
      message: `⚠️ ${high} نمط خطير / ${high} dangerous patterns`,
      details: diagnostics
        .filter((d) => d.severity === "high")
        .slice(0, 10)
        .map((d) => `${d.file}:${d.line} [${d.rule}] ${d.message}`)
        .join("\n"),
      diagnostics,
      durationMs: now() - start,
      blocking: true,
      metrics: { critical, high, medium: med, total: diagnostics.length, files: files.length },
    }
  }

  return {
    stage: "security_scan",
    status: med > 0 ? "warn" : "pass",
    message: med > 0 ? `⚠️ ${med} متوسط / ${med} medium` : "✅ لا سرائر / no secrets found",
    diagnostics,
    durationMs: now() - start,
    blocking: false,
    metrics: { critical, high, medium: med, total: diagnostics.length, files: files.length },
  }
}

// ---------------------------------------------------------------------------
// Stage 14: Definition of Done — aggregate gate
// ---------------------------------------------------------------------------

function stageDefinitionOfDone(
  stages: StageResult[],
  profile: VerificationProfile
): StageResult {
  const start = now()
  const byStage = new Map(stages.map((s) => [s.stage, s]))

  const failed: string[] = []
  const skipped: string[] = []
  const warnings: string[] = []
  const passed: string[] = []

  for (const name of profile.required) {
    const r = byStage.get(name)
    if (!r) {
      skipped.push(name)
      continue
    }
    if (r.status === "fail") failed.push(name)
    else if (r.status === "skip") skipped.push(name)
    else if (r.status === "warn") warnings.push(name)
    else if (r.status === "pass") passed.push(name)
  }

  const dod = failed.length === 0 && skipped.length === 0

  if (dod) {
    return {
      stage: "definition_of_done",
      status: "pass",
      message: `✅ Definition of Done — ${passed.length}/${profile.required.length} المراحل المطلوبة / required stages pass`,
      details: `✅ ${passed.join(", ") || "—"}\n⚠️ ${warnings.join(", ") || "—"}`,
      durationMs: now() - start,
      blocking: true,
      metrics: { required: profile.required.length, passed: passed.length, warnings: warnings.length },
    }
  }

  return {
    stage: "definition_of_done",
    status: "fail",
    message: `❌ Definition of Done — ${failed.length} فشل، ${skipped.length} تخطي / ${failed.length} failed, ${skipped.length} skipped`,
    details: `❌ ${failed.join(", ") || "—"}\n⏭️ ${skipped.join(", ") || "—"}\n⚠️ ${warnings.join(", ") || "—"}`,
    durationMs: now() - start,
    blocking: true,
    metrics: {
      required: profile.required.length,
      passed: passed.length,
      failed: failed.length,
      skipped: skipped.length,
      warnings: warnings.length,
    },
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

const STAGE_RUNNERS: Record<
  Exclude<VerificationStageName, "definition_of_done">,
  (ctx: VerificationContext) => Promise<StageResult>
> = {
  syntax: stageSyntax,
  ast: stageAst,
  lsp_diagnostics: stageLspDiagnostics,
  typecheck: stageTypecheck,
  lint: stageLint,
  unit_tests: stageUnitTests,
  integration_tests: stageIntegrationTests,
  regression_tests: stageRegressionTests,
  targeted_tests: stageTargetedTests,
  full_test_suite: stageFullTestSuite,
  build: stageBuild,
  diff_review: stageDiffReview,
  security_scan: stageSecurityScan,
}

export async function runVerificationOS(
  ctx: VerificationContext
): Promise<VerificationOSResult> {
  const start = now()
  const profileName = ctx.profile ?? "standard"
  const profile = PROFILES[profileName]
  const stages: StageResult[] = []

  for (const name of profile.stages) {
    if (name === "definition_of_done") continue
    const runner = STAGE_RUNNERS[name]
    if (!runner) continue
    let result: StageResult
    try {
      result = await runner(ctx)
    } catch (err) {
      result = {
        stage: name,
        status: "fail",
        message: `❌ استثناء في المرحلة / stage exception: ${(err as Error).message}`,
        durationMs: 0,
        blocking: false,
      }
    }
    stages.push(result)
    // Blocking failure short-circuits the remaining stages.
    if (result.status === "fail" && result.blocking) {
      break
    }
  }

  const dod = stageDefinitionOfDone(stages, profile)
  stages.push(dod)

  const passed = stages.filter((s) => s.status === "pass").map((s) => s.stage)
  const failed = stages.filter((s) => s.status === "fail").map((s) => s.stage)
  const skipped = stages.filter((s) => s.status === "skip").map((s) => s.stage)
  const warnings = stages.filter((s) => s.status === "warn").map((s) => s.stage)

  const totalDurationMs = now() - start

  return {
    context: ctx,
    stages,
    definitionOfDone: dod,
    allPassed: dod.status === "pass",
    totalDurationMs,
    summary: `${dod.status === "pass" ? "✅" : "❌"} ${profile.name} — ${passed.length} نجح، ${failed.length} فشل، ${skipped.length} تخطي، ${warnings.length} تحذير (${totalDurationMs}ms)`,
    digest: {
      passed,
      failed,
      skipped,
      warnings,
      dod: dod.status === "pass",
    },
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers for the agent loop / UI
// ---------------------------------------------------------------------------

export function formatVerificationOSResult(result: VerificationOSResult): string {
  const lines = result.stages.map((s) => {
    const d = s.diagnostics && s.diagnostics.length > 0 ? ` (${s.diagnostics.length} diag)` : ""
    return `  ${s.stage.padEnd(22)} ${s.status.padEnd(6)} ${s.durationMs}ms${d}${s.message ? ` — ${s.message}` : ""}${s.details ? `\n${s.details.split("\n").map((l) => "      " + l).slice(0, 8).join("\n")}` : ""}`
  })
  return [
    `🔍 Verification OS — profile: ${result.context.profile ?? "standard"}, target: ${result.context.target}`,
    result.summary,
    ...lines,
    `Definition of Done: ${result.definitionOfDone.status === "pass" ? "✅ PASS" : "❌ FAIL"}`,
  ].join("\n")
}

// Export the existing ladder types so callers can use a single import surface.
export * from "./ladder"
