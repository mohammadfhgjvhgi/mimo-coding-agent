// @ts-nocheck
// Self-Repair — closed-loop recovery when verification fails.
import { exec } from "node:child_process"
import { existsSync } from "node:fs"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"
import { db } from "@/lib/db"
import { promisify } from "node:util"
import path from "node:path"
import fs from "node:fs/promises"
import { rollbackToCheckpoint, getLastCheckpoint, saveFailureMemory } from "@/lib/recovery/manager"

type VerificationOSResult<T> = { ok: boolean; data?: T; error?: string; message?: string }
type StageResult = { status: string; details?: string; severity?: string; file?: string; line?: number; message?: string }
type Diagnostic = { name: string; status: string; message: string; severity?: string; file?: string; line?: number }
type ProfileName = string
type VerificationContext = any

const execAsync = promisify(exec)
const runVerificationOS: any = async () => ({ ok: false, error: "removed" } as any)
//
// Pipeline:
//   1. Failure Classification     — categorize the failure (syntax/type/lint/test/build/security/runtime)
//   2. Error Localization         — extract file:line:col from diagnostics
//   3. Repair Planning            — pick a deterministic repair strategy
//   4. Bounded Retry              — re-run verification up to N times with backoff
//   5. Regression Protection      — snapshot tests before repair, compare after
//   6. Rollback                   — git reset --hard to a checkpoint on catastrophic failure
//   7. Checkpoint Restore         — restore a previously saved checkpoint from disk
//
// The orchestrator (runSelfRepairLoop) ties all 7 together with the Verification OS.


// ---------------------------------------------------------------------------
// 1. Failure Classification
// ---------------------------------------------------------------------------

export type FailureClass =
  | "syntax_error"
  | "type_error"
  | "lint_error"
  | "test_failure"
  | "build_failure"
  | "security_violation"
  | "runtime_error"
  | "dependency_error"
  | "unknown"

export const FAILURE_CLASS_LABEL: Record<FailureClass, string> = {
  syntax_error: "خطأ صياغة / syntax error",
  type_error: "خطأ أنواع / type error",
  lint_error: "خطأ Lint / lint error",
  test_failure: "فشل اختبار / test failure",
  build_failure: "فشل بناء / build failure",
  security_violation: "خرق أمني / security violation",
  runtime_error: "خطأ زمن تشغيل / runtime error",
  dependency_error: "خطأ اعتماديات / dependency error",
  unknown: "غير معروف / unknown",
}

/**
 * Classify a verification failure into a deterministic category.
 * Pure function — no IO. Used to drive the repair strategy.
 */
export function classifyFailure(result: VerificationOSResult<any>): FailureClass {
  const failedStages = result(result as any).stages.filter((s) => s.status === "fail")

  // Priority order: security > syntax > type > lint > build > test > runtime > unknown
  for (const s of failedStages) {
    if (s.stage === "security_scan") return "security_violation"
  }
  for (const s of failedStages) {
    if (s.stage === "syntax") return "syntax_error"
  }
  for (const s of failedStages) {
    if (s.stage === "typecheck") return "type_error"
  }
  for (const s of failedStages) {
    if (s.stage === "lsp_diagnostics") {
      // LSP can flag security issues (eval) or type issues — escalate if high+.
      const high = s.diagnostics?.filter((d) => d.severity === "high" || d.severity === "critical").length ?? 0
      if (high > 0) return "syntax_error"
    }
  }
  for (const s of failedStages) {
    if (s.stage === "lint") return "lint_error"
  }
  for (const s of failedStages) {
    if (s.stage === "build") return "build_failure"
  }
  for (const s of failedStages) {
    if (
      s.stage === "unit_tests" ||
      s.stage === "integration_tests" ||
      s.stage === "regression_tests" ||
      s.stage === "targeted_tests" ||
      s.stage === "full_test_suite"
    ) {
      return "test_failure"
    }
  }

  // Inspect diagnostics for runtime markers.
  const allDiags = failedStages.flatMap((s) => s.diagnostics ?? [])
  if (allDiags.some((d) => /cannot find module|ERR_MODULE_NOT_FOUND|ENOENT/.test(d.message))) {
    return "dependency_error"
  }
  if (allDiags.some((d) => /TypeError|ReferenceError|RangeError|SyntaxError/.test(d.message))) {
    return "runtime_error"
  }

  return "unknown"
}

// ---------------------------------------------------------------------------
// 2. Error Localization
// ---------------------------------------------------------------------------

export interface LocalizedError {
  file?: string
  line?: number
  column?: number
  rule?: string
  severity: string
  message: string
  raw?: string
}

/**
 * Extract the most actionable localized error from verification results.
 * Picks the highest-severity diagnostic with a file location.
 */
export function localizeError(result: VerificationOSResult<any>): LocalizedError | null {
  const all: Diagnostic[] = []
  for (const s of result(result as any).stages) {
    if (s.status === "fail" || s.status === "warn") {
      all.push(...(s.diagnostics ?? []))
    }
  }
  if (all.length === 0) {
    // Fall back to stage-level details.
    for (const s of result(result as any).stages) {
      if (s.status === "fail" && s.details) {
        return { severity: "high", message: s.message, raw: s.details }
      }
    }
    return null
  }

  const severityRank: Record<string, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
    info: 0,
  }
  // Sort by severity (desc), then prefer ones with file+line.
  all.sort((a, b) => {
    const sa = severityRank[a.severity] ?? 0
    const sb = severityRank[b.severity] ?? 0
    if (sb !== sa) return sb - sa
    const aHasLoc = a.file && a.line ? 1 : 0
    const bHasLoc = b.file && b.line ? 1 : 0
    return bHasLoc - aHasLoc
  })

  const top = all[0]
  return {
    file: top.file,
    line: top.line,
    column: (top as any).column,
    rule: (top as any).rule,
    severity: top.severity,
    message: top.message,
  }
}

// ---------------------------------------------------------------------------
// 3. Repair Planning
// ---------------------------------------------------------------------------

export type RepairStrategy =
  | "fix_syntax"           // re-read the file, fix the obvious syntax error
  | "fix_type"             // align types — usually adding a cast or fixing a return type
  | "fix_lint"             // apply the lint diagnostic.rule as any's suggested fix (eslint --fix)
  | "fix_test"             // inspect the failing test, fix the implementation
  | "fix_build"            // usually a type/build config issue
  | "fix_security"         // remove secret / dangerous pattern
  | "install_dependency"   // missing module — run install
  | "revert_and_retry"     // rollback to checkpoint and try a different approach
  | "escalate"             // give up — ask the user / abort

export interface RepairPlan {
  strategy: RepairStrategy
  failureClass: FailureClass
  localized: LocalizedError | null
  /** Arabic + English bilingual instructions for the agent. */
  instructions: string[]
  /** Suggested shell commands to run (if any). */
  commands: string[]
  /** Whether a rollback should be attempted before retrying. */
  shouldRollback: boolean
}

/**
 * Build a deterministic repair plan from the failure class + localized error.
 */
export function planRepair(
  result: VerificationOSResult<any>,
  failureClass: FailureClass,
  localized: LocalizedError | null
): RepairPlan {
  const loc = localized
    ? `${localized.file ?? "?"}${localized.line ? `:${localized.line}` : ""}${localized.diagnostic.column as any ? `:${localized.diagnostic.column as any}` : ""}`
    : "موقع غير معروف / unknown location"

  switch (failureClass) {
    case "syntax_error":
      return {
        strategy: "fix_syntax",
        failureClass,
        localized,
        instructions: [
          `أصلح خطأ الصياغة في: ${loc}`,
          `Fix the syntax error at: ${loc}`,
          localized?.message ? `الرسالة: ${localized.message}` : "",
          "الخطأ: اقرأ الملف، حدّد السطر، صحّح القوس/الفاصلة/الكلمة المفتاحية المفقودة.",
          "Approach: read the file, find the offending line, fix the missing bracket/comma/keyword.",
        ].filter(Boolean),
        commands: [],
        shouldRollback: false,
      }

    case "type_error":
      return {
        strategy: "fix_type",
        failureClass,
        localized,
        instructions: [
          `أصلح خطأ الأنواع في: ${loc} (${localized?.diagnostic.rule as any ?? "TS????"})`,
          `Fix the type error at: ${loc} (${localized?.diagnostic.rule as any ?? "TS????"})`,
          localized?.message ? `الرسالة: ${localized.message}` : "",
          "راجع الأنواع المتوقعة مقابل الفعلية. قد تحتاج إلى cast أو تعديل توقيع الدالة.",
          "Review expected vs actual types. May need a cast or a signature change.",
        ].filter(Boolean),
        commands: [],
        shouldRollback: false,
      }

    case "lint_error":
      return {
        strategy: "fix_lint",
        failureClass,
        localized,
        instructions: [
          `أصلح خطأ Lint في: ${loc} (${localized?.diagnostic.rule as any ?? "?"})`,
          `Fix the lint error at: ${loc} (${localized?.diagnostic.rule as any ?? "?"})`,
          "جرّب الإصلاح التلقائي أولاً via eslint --fix.",
          "Try auto-fix first via eslint --fix.",
        ],
        commands: [
          `npx eslint --fix ${localized?.file ? JSON.stringify(localized.file) : "."}`,
        ],
        shouldRollback: false,
      }

    case "test_failure":
      return {
        strategy: "fix_test",
        failureClass,
        localized,
        instructions: [
          `فشل اختبار في: ${loc}`,
          `Test failure at: ${loc}`,
          localized?.message ? `الرسالة: ${localized.message}` : "",
          "اقرأ ملف الاختبار، شغّله منفرداً، افحص التوقع مقابل الفعلي. صحّح التطبيق (وليس الاختبار) ما لم يكن الاختبار نفسه خاطئاً.",
          "Read the test file, run it in isolation, compare expected vs actual. Fix the impl (not the test) unless the test itself is wrong.",
        ],
        commands: localized?.file
          ? [`bun test ${JSON.stringify(localized.file)}`]
          : [],
        shouldRollback: false,
      }

    case "build_failure":
      return {
        strategy: "fix_build",
        failureClass,
        localized,
        instructions: [
          `فشل البناء. غالباً خطأ أنواع أو تكوين.`,
          "Build failed. Likely a type error or config issue.",
          "شغّل tsc --noEmit لرؤية الخطأ الكامل، ثم عالج كل خطأ بالترتيب.",
          "Run tsc --noEmit to see the full error, then address each error in order.",
        ],
        commands: ["npx tsc --noEmit --skipLibCheck"],
        shouldRollback: false,
      }

    case "security_violation":
      return {
        strategy: "fix_security",
        failureClass,
        localized,
        instructions: [
          `🚨 خرق أمني في: ${loc} (${localized?.diagnostic.rule as any ?? "?"})`,
          `🚨 Security violation at: ${loc} (${localized?.diagnostic.rule as any ?? "?"})`,
          localized?.message ? `الرسالة: ${localized.message}` : "",
          "احذف السرّ من الكود فوراً. استخدم متغيرات البيئة. إذا كان سراً حقيقياً — ادره (rotate) الآن.",
          "Remove the secret from code immediately. Use env vars. If it's a real secret — rotate it now.",
        ],
        commands: [],
        shouldRollback: true, // secrets warrant a rollback to a clean state
      }

    case "dependency_error":
      return {
        strategy: "install_dependency",
        failureClass,
        localized,
        instructions: [
          "وحدة مفقودة. ثبّت الحزمة المطلوبة.",
          "Missing module. Install the required package.",
        ],
        commands: ["bun install"],
        shouldRollback: false,
      }

    case "runtime_error":
      return {
        strategy: "revert_and_retry",
        failureClass,
        localized,
        instructions: [
          `خطأ زمن تشغيل في: ${loc}`,
          `Runtime error at: ${loc}`,
          localized?.message ? `الرسالة: ${localized.message}` : "",
          "التراجع إلى نقطة استرجاع آمنة ثم إعادة المحاولة بنهج مختلف.",
          "Roll back to a safe checkpoint, then retry with a different approach.",
        ],
        commands: [],
        shouldRollback: true,
      }

    case "unknown":
    default:
      return {
        strategy: "escalate",
        failureClass,
        localized,
        instructions: [
          "فشل غير مصنّف — لا يمكن الإصلاح التلقائي.",
          "Unclassified failure — cannot auto-repair.",
          "تطلّب تدخّل المستخدم أو تجربة نهج مختلف كلياً.",
          "Requires user intervention or a completely different approach.",
        ],
        commands: [],
        shouldRollback: true,
      }
  }
}

// ---------------------------------------------------------------------------
// 4. Bounded Retry
// ---------------------------------------------------------------------------

export interface RetryPolicy {
  maxAttempts: number
  backoffMs: number
  backoffMultiplier: number
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoffMs: 500,
  backoffMultiplier: 2,
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

// ---------------------------------------------------------------------------
// 5. Regression Protection
// ---------------------------------------------------------------------------

interface RegressionSnapshot {
  createdAt: string
  files: Record<string, string> // path -> sha256
}

const SNAPSHOT_PATH = ".verification/regression-snapshot.json"

async function sha256(s: string): Promise<string> {
  const { createHash } = await import("node:crypto")
  return createHash("sha256").update(s).digest("hex")
}

async function takeRegressionSnapshot(root: string, files: string[]): Promise<RegressionSnapshot> {
  const hashes: Record<string, string> = {}
  for (const f of files) {
    try {
      const content = await fs.readFile(f, "utf-8")
      hashes[path.relative(root, f)] = await sha256(content)
    } catch {
      // skip unreadable
    }
  }
  return { createdAt: new Date().toISOString(), files: hashes }
}

/**
 * Compare a snapshot to the current state. Returns files that changed.
 * Used to ensure a repair didn't accidentally touch unrelated files.
 */
async function diffRegressionSnapshot(
  root: string,
  before: RegressionSnapshot
): Promise<{ changed: string[]; added: string[]; removed: string[] }> {
  const after = await takeRegressionSnapshot(root, Object.keys(before.files).map((p) => path.join(root, p)))
  const changed: string[] = []
  const removed: string[] = []
  for (const [p, hash] of Object.entries(before.files)) {
    if (!(p in after.files)) removed.push(p)
    else if (after.files[p] !== hash) changed.push(p)
  }
  const added = Object.keys(after.files).filter((p) => !(p in before.files))
  return { changed, added, removed }
}

// ---------------------------------------------------------------------------
// 6 & 7. Checkpoint Restore
// ---------------------------------------------------------------------------

const CHECKPOINT_DIR = ".verification/checkpoints"

export interface Checkpoint {
  id: string
  createdAt: string
  gitHash: string | null
  description: string
}

/**
 * Save a checkpoint: records the current git HEAD + a manifest.
 * Deterministic — no LLM.
 */
export async function saveCheckpoint(description: string): Promise<Checkpoint | null> {
  const root = path.resolve(WORKSPACE_ROOT)
  const gitHash = await getLastCheckpoint()
  if (!gitHash) return null
  const id = `cp_${Date.now()}`
  const cp: Checkpoint = {
    id,
    createdAt: new Date().toISOString(),
    gitHash,
    description,
  }
  try {
    await fs.mkdir(path.join(root, CHECKPOINT_DIR), { recursive: true })
    await fs.writeFile(
      path.join(root, CHECKPOINT_DIR, `${id}.json`),
      JSON.stringify(cp, null, 2)
    )
    return cp
  } catch {
    return null
  }
}

/**
 * Restore a previously saved checkpoint by id, or the most recent one if id is null.
 */
export async function restoreCheckpoint(id?: string): Promise<Checkpoint | null> {
  const root = path.resolve(WORKSPACE_ROOT)
  let cp: Checkpoint
  try {
    if (id) {
      cp = JSON.parse(
        await fs.readFile(path.join(root, CHECKPOINT_DIR, `${id}.json`), "utf-8")
      ) as Checkpoint
    } else {
      // Find the most recent checkpoint file.
      const dir = path.join(root, CHECKPOINT_DIR)
      if (!existsSync(dir)) return null
      const entries = await fs.readdir(dir)
      const cps: Checkpoint[] = []
      for (const f of entries) {
        if (!f.endsWith(".json")) continue
        try {
          cps.push(JSON.parse(await fs.readFile(path.join(dir, f), "utf-8")) as Checkpoint)
        } catch {
          /* ignore */
        }
      }
      if (cps.length === 0) return null
      cps.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      cp = cps[0]
    }
  } catch {
    return null
  }

  if (!cp.gitHash) return null
  const ok = await rollbackToCheckpoint(cp.gitHash)
  return ok ? cp : null
}

export async function listCheckpoints(): Promise<Checkpoint[]> {
  const root = path.resolve(WORKSPACE_ROOT)
  const dir = path.join(root, CHECKPOINT_DIR)
  if (!existsSync(dir)) return []
  const entries = await fs.readdir(dir)
  const cps: Checkpoint[] = []
  for (const f of entries) {
    if (!f.endsWith(".json")) continue
    try {
      cps.push(JSON.parse(await fs.readFile(path.join(dir, f), "utf-8")) as Checkpoint)
    } catch {
      /* ignore */
    }
  }
  cps.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return cps
}

/**
 * Hard rollback to the current git HEAD (the simplest checkpoint).
 * Wraps recovery/manager.rollbackToCheckpoint + failure memory.
 */
export async function rollbackNow(reason: string): Promise<boolean> {
  const root = path.resolve(WORKSPACE_ROOT)
  const hash = await getLastCheckpoint()
  if (!hash) return false
  const ok = await rollbackToCheckpoint(hash)
  if (ok) {
    await saveFailureMemory("self-repair rollback", reason, hash)
  }
  return ok
}

// ---------------------------------------------------------------------------
// Self-Repair Loop — the orchestrator
// ---------------------------------------------------------------------------

export interface SelfRepairAttempt {
  attempt: number
  verification: VerificationOSResult<any>
  failureClass: FailureClass
  localized: LocalizedError | null
  plan: RepairPlan
  rolledBack: boolean
  durationMs: number
}

export interface SelfRepairResult {
  attempts: SelfRepairAttempt[]
  final: VerificationOSResult<any>
  repaired: boolean
  totalDurationMs: number
  summary: string
  /** A short machine-readable digest for the agent loop. */
  digest: {
    attempts: number
    finalClass: FailureClass | null
    rolledBack: boolean
    dod: boolean
    strategy: RepairStrategy | null
  }
}

export interface SelfRepairOptions {
  /** Verification context (target + profile). Required. */
  context: VerificationContext
  /** Retry budget. Defaults to 3 attempts. */
  retry?: Partial<RetryPolicy>
  /**
   * Called between attempts to actually perform the repair.
   * MUST be deterministic side-effecting code (no LLM in the loop here).
   * Returns true if it made a change worth re-verifying.
   * If not provided, the loop only does rollback-based repairs.
   */
  repair?: (plan: RepairPlan, attempt: number) => Promise<boolean>
  /**
   * Files to snapshot for regression protection.
   * Defaults to the target (or the project tree if target is a dir).
   */
  protectedFiles?: string[]
  /** Profile to run during verification. Defaults to "standard". */
  profile?: ProfileName
}

/**
 * Run the full Self-Repair loop:
 *   verify → classify → localize → plan → (apply repair) → re-verify → ...
 * Stops when Definition of Done passes, or retry budget exhausted.
 */
export async function runSelfRepairLoop(opts: SelfRepairOptions): Promise<SelfRepairResult> {
  const start = Date.now()
  const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...opts.retry }
  const attempts: SelfRepairAttempt[] = []

  const ctx: VerificationContext = {
    ...opts.context,
    profile: opts.profile ?? opts.context.profile ?? "standard",
  }

  // Take a regression snapshot before any repair.
  const root = path.resolve(WORKSPACE_ROOT)
  let protectedFiles = opts.protectedFiles
  if (!protectedFiles) {
    if (ctx.target) {
      const abs = path.isAbsolute(ctx.target) ? ctx.target : path.resolve(root, ctx.target)
      protectedFiles = [abs]
    } else {
      protectedFiles = []
    }
  }
  const snapshot = await takeRegressionSnapshot(root, protectedFiles)

  let lastResult: VerificationOSResult<any> | null = null
  let lastClass: FailureClass | null = null
  let lastPlan: RepairPlan | null = null
  let didRollback = false

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    const attemptStart = Date.now()

    // Run verification.
    const result = await runVerificationOS(ctx)
    lastResult = result

    // If DoD passes, we're done.
    if (result.allPassed) {
      // Regression check: did we touch unrelated files?
      const diff = await diffRegressionSnapshot(root, snapshot)
      const unexpectedChanges = diff.changed.filter(
        (p) => !protectedFiles!.some((pf) => path.relative(root, pf) === p)
      )
      if (unexpectedChanges.length > 0 && attempt > 1) {
        // Repair leaked outside the protected files — flag as a warning.
        lastClass = "unknown"
        lastPlan = planRepair(result, lastClass ?? "unknown", localizeError(result))
      } else {
        attempts.push({
          attempt,
          verification: result,
          failureClass: "unknown" as FailureClass,
          localized: null,
          plan: {
            strategy: "fix_syntax",
            failureClass: "unknown",
            localized: null,
            instructions: ["✅ DoD تحقق — لا حاجة للإصلاح / DoD passed — no repair needed"],
            commands: [],
            shouldRollback: false,
          },
          rolledBack: false,
          durationMs: Date.now() - attemptStart,
        })
        break
      }
    } else {
      // Classify + localize + plan.
      lastClass = classifyFailure(result)
      const localized = localizeError(result)
      lastPlan = planRepair(result, lastClass, localized)
    }

    const rolledBackThisAttempt = lastPlan.shouldRollback && attempt < policy.maxAttempts
    if (rolledBackThisAttempt) {
      const ok = await rollbackNow(`attempt ${attempt}: ${FAILURE_CLASS_LABEL[lastClass]}`)
      didRollback = didRollback || ok
    }

    attempts.push({
      attempt,
      verification: result,
      failureClass: lastClass,
      localized: localizeError(result),
      plan: lastPlan,
      rolledBack: rolledBackThisAttempt,
      durationMs: Date.now() - attemptStart,
    })

    // Last attempt — don't bother repairing, just record and exit.
    if (attempt === policy.maxAttempts) break

    // Apply the repair (if a repair function was provided).
    if (opts.repair) {
      try {
        await opts.repair(lastPlan, attempt)
      } catch {
        // repair threw — record and continue to next attempt
      }
    } else {
      // No repair function: run any commands the plan suggests.
      for (const cmd of lastPlan.commands) {
        try {
          await execAsync(cmd, { cwd: root, timeout: 60_000 })
        } catch {
          /* best-effort */
        }
      }
    }

    // Backoff before re-verifying.
    await sleep(policy.backoffMs * Math.pow(policy.backoffMultiplier, attempt - 1))
  }

  const final = lastResult!
  const repaired = final.allPassed

  const totalDurationMs = Date.now() - start

  const summary = repaired
    ? `✅ Self-Repair نجح بعد ${attempts.length} محاولة (${totalDurationMs}ms) / repaired after ${attempts.length} attempts`
    : `❌ Self-Repair فشل بعد ${attempts.length} محاولة — ${lastClass ? FAILURE_CLASS_LABEL[lastClass] : "unknown"} / failed after ${attempts.length} attempts`

  return {
    attempts,
    final,
    repaired,
    totalDurationMs,
    summary,
    digest: {
      attempts: attempts.length,
      finalClass: lastClass,
      rolledBack: didRollback,
      dod: repaired,
      strategy: lastPlan?.strategy ?? null,
    },
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatSelfRepairResult(result: SelfRepairResult): string {
  const lines = [
    `🔧 Self-Repair Loop — ${result.attempts.length} attempts (${result.totalDurationMs}ms)`,
    result.summary,
  ]
  for (const a of result.attempts) {
    lines.push(
      `  Attempt ${a.attempt}: ${a.verification.digest.dod ? "✅ DoD" : "❌ " + FAILURE_CLASS_LABEL[a.failureClass]}${a.rolledBack ? " [+rollback]" : ""} (${a.durationMs}ms)`
    )
    if (a.localized) {
      const loc = `${a.localized.file ?? "?"}${a.localized.line ? `:${a.localized.line}` : ""}`
      lines.push(`    → ${loc} [${a.localized.diagnostic.rule as any ?? a.localized.severity}] ${a.localized.message}`)
    }
    if (a.plan.instructions.length > 0) {
      lines.push(`    ${a.plan.instructions[0]}`)
    }
  }
  return lines.join("\n")
}

/**
 * Convert a RepairPlan into a short prompt fragment the agent can follow.
 * Used by the agent loop to feed the next tool-call decision.
 */
export function repairPlanToPrompt(plan: RepairPlan): string {
  const loc = plan.localized
    ? `${plan.localized.file ?? "?"}${plan.localized.line ? `:${plan.localized.line}` : ""}`
    : "—"
  return [
    `إصلاح مطلوب / Repair required:`,
    `  الاستراتيجية / strategy: ${plan.strategy}`,
    `  الفئة / class: ${FAILURE_CLASS_LABEL[plan.failureClass]}`,
    `  الموقع / location: ${loc}`,
    ...plan.instructions.map((i) => `  • ${i}`),
    ...(plan.commands.length > 0 ? [`  أوامر / commands:`, ...plan.commands.map((c) => `    $ ${c}`)] : []),
  ].join("\n")
}

// Persist a self-repair run summary to the SystemState table for observability.
export async function persistSelfRepairRun(result: SelfRepairResult): Promise<void> {
  try {
    const value = JSON.stringify({
      repaired: result.repaired,
      attempts: result.attempts.length,
      totalDurationMs: result.totalDurationMs,
      digest: result.digest,
      at: new Date().toISOString(),
    })
    await db.systemState.upsert({
      where: { key: "self_repair_last_run" },
      update: { value },
      create: {
        key: "self_repair_last_run",
        value,
      },
    })
  } catch {
    // best-effort
  }
}
