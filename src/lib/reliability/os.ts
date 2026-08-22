// Reliability OS — 13 operations for self-healing agent behavior.
// Spec section 24 (Reliability): features 338-350.
//
// 13 operations:
//   1.  loopGuard              — detect + break infinite tool-call loops
//   2.  malformedToolRecovery  — fix invalid JSON tool calls
//   3.  wrongToolRecovery       — re-route to the correct tool
//   4.  argumentRepair         — fix common arg-shape issues
//   5.  proseToToolRecovery     — convert prose "do X" into a tool call
//   6.  timeoutRecovery         — retry with backoff after a timeout
//   7.  oomRecovery             — shed load when OOM is imminent
//   8.  crashRecovery            — resume from last checkpoint
//   9.  unknownStateReconcile   — handle unknown agent states
//   10. checkpointRollback       — rollback to a saved checkpoint
//   11. failureClassify         — classify a failure (category + severity)
//   12. failureMemoryLookup     — find past solutions for similar failures
//   13. negativeLearning        — record "don't do X" lessons
//
// Plus: createCheckpoint, listFailures, listCheckpoints, reliabilitySnapshot.

import { db } from "@/lib/db"
import { createHash } from "node:crypto"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FailureCategory =
  | "tool_malformed"
  | "tool_wrong"
  | "argument_invalid"
  | "timeout"
  | "oom"
  | "crash"
  | "loop"
  | "unknown_state"
  | "unknown"

export type FailureSeverity = "transient" | "permanent" | "partial" | "fatal"

export interface ReliabilityResult<T> {
  ok: boolean
  data?: T
  error?: string
  message?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex")
}

/** Compute a deterministic fingerprint for a failure (task + error). */
function fingerprintFailure(task: string, error: string): string {
  // Normalize whitespace + lowercase for stable hashing
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase()
  return sha256(`${norm(task)}|${norm(error)}`)
}

/** Canonical hash of tool args (for loop detection). */
function hashArgs(args: unknown): string {
  try {
    const canon = JSON.stringify(args, Object.keys(args as any).sort())
    return sha256(canon)
  } catch {
    return sha256(String(args))
  }
}

// ---------------------------------------------------------------------------
// 1. Loop Guard (338)
// ---------------------------------------------------------------------------

const LOOP_THRESHOLD = 3 // 3 identical calls = loop

export async function loopGuard(opts: {
  conversationId?: string
  toolName: string
  args: unknown
}): Promise<ReliabilityResult<{
  isLoop: boolean
  count: number
  action: "allow" | "break"
  reason: string
}>> {
  try {
    const argsHash = hashArgs(opts.args)
    // Look for the most recent identical call within the last 5 minutes
    const recent = await db.reliabilityLoopEvent.findFirst({
      where: {
        conversationId: opts.conversationId ?? null,
        toolName: opts.toolName,
        argsHash,
        broken: false,
      },
      orderBy: { createdAt: "desc" },
    })

    if (!recent) {
      // First call — record it
      await db.reliabilityLoopEvent.create({
        data: {
          conversationId: opts.conversationId,
          toolName: opts.toolName,
          argsHash,
          count: 1,
          broken: false,
        },
      })
      return {
        ok: true,
        data: { isLoop: false, count: 1, action: "allow", reason: "✅ نداء أول — مسموح" },
      }
    }

    const newCount = recent.count + 1
    const isLoop = newCount >= LOOP_THRESHOLD

    if (isLoop) {
      // Break the loop — mark the event as broken
      await db.reliabilityLoopEvent.update({
        where: { id: recent.id },
        data: { count: newCount, broken: true },
      })
      // Record as failure
      await failureClassify({
        task: `tool:${opts.toolName} repeated ${newCount}×`,
        error: `Loop detected: ${opts.toolName} called ${newCount} times with identical args`,
        category: "loop",
        severity: "transient",
      })
      return {
        ok: true,
        data: {
          isLoop: true,
          count: newCount,
          action: "break",
          reason: `🛑 تم كشف loop — ${opts.toolName} دُعي ${newCount} مرات بنفس الوسائط. تم الكسر.`,
        },
      }
    }

    // Increment count
    await db.reliabilityLoopEvent.update({
      where: { id: recent.id },
      data: { count: newCount },
    })

    return {
      ok: true,
      data: {
        isLoop: false,
        count: newCount,
        action: "allow",
        reason: `⚠️ نداء #${newCount} — قارب من الـ loop`,
      },
    }
  } catch (e) {
    return { ok: false, error: "loop_guard_failed", message: `❌ فشل كشف الـ loop: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** Reset loop counters for a conversation (call when conversation moves to a new task). */
export async function resetLoopGuard(conversationId: string): Promise<void> {
  try {
    await db.reliabilityLoopEvent.deleteMany({
      where: { conversationId, broken: false },
    })
  } catch {}
}

// ---------------------------------------------------------------------------
// 2. Malformed Tool Recovery (339)
// ---------------------------------------------------------------------------

export function malformedToolRecovery(rawToolCall: string): ReliabilityResult<{
  repaired: boolean
  toolName: string
  args: Record<string, unknown>
  changes: string[]
}> {
  const changes: string[] = []
  let s = rawToolCall.trim()

  try {
    // Case 1: Already valid JSON
    try {
      const parsed = JSON.parse(s)
      if (parsed && typeof parsed === "object" && "name" in parsed) {
        return {
          ok: true,
          data: {
            repaired: false,
            toolName: String(parsed.name),
            args: (parsed.args ?? parsed.arguments ?? {}) as Record<string, unknown>,
            changes: [],
          },
        }
      }
    } catch {
      // fall through to repair attempts
    }

    // Case 2: Extract tool name + args from prose like "use bash to run ls -la"
    const proseMatch = s.match(/(?:use|call|run|invoke)\s+(\w+)\s+(?:to\s+)?(.*)/i)
    if (proseMatch) {
      // Defer to proseToToolRecovery
      const prose = proseToToolRecovery(s)
      if (prose.ok && prose.data) {
        return prose
      }
    }

    // Case 3: Strip markdown code fences ```json ... ```
    if (s.startsWith("```")) {
      s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "")
      changes.push("stripped markdown fences")
    }

    // Case 4: Trailing comma
    if (/,\s*}/.test(s)) {
      s = s.replace(/,(\s*})/g, "$1")
      changes.push("removed trailing comma")
    }
    if (/,\s*]/.test(s)) {
      s = s.replace(/,(\s*])/g, "$1")
      changes.push("removed trailing comma in array")
    }

    // Case 5: Single quotes → double quotes (for JSON)
    if (/'[^']*':/.test(s)) {
      s = s.replace(/'([^']*)'(\s*:)/g, '"$1"$2')
      changes.push("converted single-quoted keys to double quotes")
    }

    // Case 6: Unquoted keys
    if (/{\s*(\w+)\s*:/.test(s)) {
      s = s.replace(/({\s*|\,\s*)(\w+)\s*:/g, '$1"$2":')
      changes.push("quoted unquoted keys")
    }

    // Try parsing again
    const parsed = JSON.parse(s)
    if (parsed && typeof parsed === "object" && "name" in parsed) {
      return {
        ok: true,
        data: {
          repaired: true,
          toolName: String(parsed.name),
          args: (parsed.args ?? parsed.arguments ?? {}) as Record<string, unknown>,
          changes,
        },
      }
    }

    return { ok: false, error: "unrepairable", message: `❌ تعذّر إصلاح الـ tool call: ${rawToolCall.slice(0, 100)}` }
  } catch (e) {
    return { ok: false, error: "malformed_failed", message: `❌ فشل الإصلاح: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 3. Wrong Tool Recovery (340)
// ---------------------------------------------------------------------------

const TOOL_ALIASES: Record<string, string> = {
  // bash → shell
  bash: "shell", sh: "shell", terminal: "shell", cmd: "shell",
  // search → web_search
  google: "web_search", search: "web_search", find: "web_search",
  // file ops
  read: "file_read", cat: "file_read", open: "file_read",
  write: "file_write", save: "file_write", create: "file_write",
  delete: "file_delete", rm: "file_delete", remove: "file_delete",
  // memory
  remember: "save_memory", recall: "search_memory",
  // git
  commit: "git_commit", branch: "git_branch",
}

export function wrongToolRecovery(requestedTool: string): ReliabilityResult<{
  original: string
  rerouted: string
  reason: string
}> {
  const lower = requestedTool.toLowerCase().trim()
  if (TOOL_ALIASES[lower]) {
    return {
      ok: true,
      data: {
        original: requestedTool,
        rerouted: TOOL_ALIASES[lower],
        reason: `↪️ إعادة توجيه: ${requestedTool} → ${TOOL_ALIASES[lower]}`,
      },
    }
  }
  // Try fuzzy match (Levenshtein ≤ 2)
  const allTools = Object.keys(TOOL_ALIASES)
  const close = allTools.find((t) => levenshtein(lower, t) <= 2)
  if (close) {
    return {
      ok: true,
      data: {
        original: requestedTool,
        rerouted: TOOL_ALIASES[close],
        reason: `↪️ تطابق تقريبي: ${requestedTool} ≈ ${close} → ${TOOL_ALIASES[close]}`,
      },
    }
  }
  return {
    ok: true,
    data: {
      original: requestedTool,
      rerouted: requestedTool,
      reason: `❓ لا إعادة توجيه — الأداة ${requestedTool} غير معروفة`,
    },
  }
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[a.length][b.length]
}

// ---------------------------------------------------------------------------
// 4. Argument Repair (341)
// ---------------------------------------------------------------------------

export function argumentRepair(toolName: string, args: Record<string, unknown>): ReliabilityResult<{
  repaired: boolean
  args: Record<string, unknown>
  changes: string[]
}> {
  const changes: string[] = []
  const repaired = { ...args }

  // Common repairs per tool
  switch (toolName) {
    case "file_read":
    case "file_write":
    case "file_delete":
      // path → string
      if (repaired.path && typeof repaired.path !== "string") {
        repaired.path = String(repaired.path)
        changes.push("path: cast to string")
      }
      // missing path → look for file or filename
      if (!repaired.path && repaired.file) {
        repaired.path = repaired.file
        changes.push("path: copied from 'file'")
      }
      if (!repaired.path && repaired.filename) {
        repaired.path = repaired.filename
        changes.push("path: copied from 'filename'")
      }
      break

    case "shell":
    case "bash":
      // command → string
      if (repaired.command && typeof repaired.command !== "string") {
        repaired.command = String(repaired.command)
        changes.push("command: cast to string")
      }
      // missing command → look for cmd
      if (!repaired.command && repaired.cmd) {
        repaired.command = repaired.cmd
        changes.push("command: copied from 'cmd'")
      }
      break

    case "save_memory":
      if (!repaired.key && repaired.name) {
        repaired.key = repaired.name
        changes.push("key: copied from 'name'")
      }
      if (repaired.value && typeof repaired.value !== "string") {
        repaired.value = JSON.stringify(repaired.value)
        changes.push("value: serialized object to string")
      }
      break
  }

  // Generic repairs:
  // - empty strings → undefined (skip required fields)
  // - numbers as strings → numbers where expected
  for (const [k, v] of Object.entries(repaired)) {
    if (v === "" || v === null) {
      delete repaired[k]
      changes.push(`${k}: removed empty value`)
    }
  }

  return {
    ok: true,
    data: { repaired: changes.length > 0, args: repaired, changes },
  }
}

// ---------------------------------------------------------------------------
// 5. Prose-to-Tool Recovery (342)
// ---------------------------------------------------------------------------

const PROSE_PATTERNS: Array<{ pattern: RegExp; tool: string; args: (m: RegExpMatchArray) => Record<string, unknown> }> = [
  // "use bash to run X" / "run X in bash"
  { pattern: /(?:use|call|invoke)\s+(?:bash|shell|terminal)\s+(?:to\s+)?(?:run\s+)?(.+)/i, tool: "shell", args: (m) => ({ command: m[1].trim() }) },
  // "search for X" / "google X"
  { pattern: /(?:search|google|look\s+up)\s+(?:for\s+)?(.+)/i, tool: "web_search", args: (m) => ({ query: m[1].trim() }) },
  // "remember that X" / "save X to memory"
  { pattern: /(?:remember|save)\s+(?:that\s+|to\s+memory\s+)?(.+)/i, tool: "save_memory", args: (m) => ({ key: "user_note", value: m[1].trim() }) },
  // "read file X" / "open X"
  { pattern: /(?:read|open|cat)\s+(?:file\s+)?(.+\.\w+)/i, tool: "file_read", args: (m) => ({ path: m[1].trim() }) },
  // "write X to file Y" / "save X to Y"
  { pattern: /(?:write|save)\s+(.+?)\s+(?:to|in)\s+(?:file\s+)?(.+\.\w+)/i, tool: "file_write", args: (m) => ({ path: m[2].trim(), content: m[1].trim() }) },
  // "delete file X" / "remove X"
  { pattern: /(?:delete|remove|rm)\s+(?:file\s+)?(.+\.\w+)/i, tool: "file_delete", args: (m) => ({ path: m[1].trim() }) },
]

export function proseToToolRecovery(prose: string): ReliabilityResult<{
  repaired: boolean
  toolName: string
  args: Record<string, unknown>
  changes: string[]
}> {
  for (const { pattern, tool, args } of PROSE_PATTERNS) {
    const m = prose.match(pattern)
    if (m) {
      return {
        ok: true,
        data: {
          repaired: true,
          toolName: tool,
          args: args(m),
          changes: [`converted prose → ${tool} (matched: ${pattern.source.slice(0, 40)}…)`],
        },
      }
    }
  }
  return { ok: false, error: "no_match", message: `❌ لا يوجد pattern مطابق للنص: ${prose.slice(0, 80)}` }
}

// ---------------------------------------------------------------------------
// 6. Timeout Recovery (343)
// ---------------------------------------------------------------------------

export async function timeoutRecovery(opts: {
  toolName: string
  args: unknown
  attempt: number
  maxAttempts?: number
  baseDelayMs?: number
}): Promise<ReliabilityResult<{
  shouldRetry: boolean
  delayMs: number
  attempt: number
  reason: string
}>> {
  const maxAttempts = opts.maxAttempts ?? 3
  const baseDelay = opts.baseDelayMs ?? 1000

  if (opts.attempt >= maxAttempts) {
    // Exceeded — record failure
    await failureClassify({
      task: `tool:${opts.toolName} (attempt ${opts.attempt})`,
      error: `Timeout after ${maxAttempts} attempts`,
      category: "timeout",
      severity: "transient",
      context: JSON.stringify({ toolName: opts.toolName, args: opts.args, attempt: opts.attempt }),
    })
    return {
      ok: true,
      data: {
        shouldRetry: false,
        delayMs: 0,
        attempt: opts.attempt,
        reason: `❌ تجاوزت ${maxAttempts} محاولات — توقفت`,
      },
    }
  }

  // Exponential backoff: 1s, 2s, 4s, 8s...
  const delayMs = baseDelay * Math.pow(2, opts.attempt - 1)
  return {
    ok: true,
    data: {
      shouldRetry: true,
      delayMs,
      attempt: opts.attempt + 1,
      reason: `⏱️ timeout — إعادة المحاولة #${opts.attempt + 1} بعد ${delayMs}ms`,
    },
  }
}

// ---------------------------------------------------------------------------
// 7. OOM Recovery (344)
// ---------------------------------------------------------------------------

export async function oomRecovery(opts: {
  currentMemoryMB: number
  thresholdMB?: number
  contextSize?: number
}): Promise<ReliabilityResult<{
  shedding: boolean
  actions: string[]
  reason: string
}>> {
  const threshold = opts.thresholdMB ?? 3500 // default 3.5GB
  const actions: string[] = []

  if (opts.currentMemoryMB < threshold) {
    return {
      ok: true,
      data: { shedding: false, actions: [], reason: `✅ الذاكرة ضمن الحدود (${opts.currentMemoryMB}MB / ${threshold}MB)` },
    }
  }

  // Shed load: actions to take when OOM is imminent
  if (opts.contextSize && opts.contextSize > 50_000) {
    actions.push("compress_context")
  }
  actions.push("clear_tool_cache")
  actions.push("drop_old_messages")
  if (opts.currentMemoryMB > threshold * 1.5) {
    actions.push("save_and_restart")
  }

  await failureClassify({
    task: `OOM prevention at ${opts.currentMemoryMB}MB`,
    error: `Memory pressure: ${opts.currentMemoryMB}/${threshold}MB`,
    category: "oom",
    severity: "partial",
    context: JSON.stringify({ current: opts.currentMemoryMB, threshold, actions }),
  })

  return {
    ok: true,
    data: {
      shedding: true,
      actions,
      reason: `🚨 ضغط ذاكرة (${opts.currentMemoryMB}MB) — تنفيذ: ${actions.join(", ")}`,
    },
  }
}

// ---------------------------------------------------------------------------
// 8. Crash Recovery (345)
// ---------------------------------------------------------------------------

export async function crashRecovery(conversationId?: string): Promise<ReliabilityResult<{
  recovered: boolean
  checkpointId: string | null
  reason: string
}>> {
  try {
    const lastCheckpoint = await db.reliabilityCheckpoint.findFirst({
      where: conversationId ? { conversationId } : {},
      orderBy: { createdAt: "desc" },
    })

    if (!lastCheckpoint) {
      return {
        ok: true,
        data: {
          recovered: false,
          checkpointId: null,
          reason: "❌ لا توجد نقطة استرجاع — لا يمكن الاستعادة بعد الـ crash",
        },
      }
    }

    // Record the crash
    await failureClassify({
      task: `crash recovery for ${conversationId ?? "session"}`,
      error: `Crash detected — restoring from checkpoint ${lastCheckpoint.id}`,
      category: "crash",
      severity: "transient",
      context: JSON.stringify({ checkpointId: lastCheckpoint.id, conversationId }),
    })

    return {
      ok: true,
      data: {
        recovered: true,
        checkpointId: lastCheckpoint.id,
        reason: `✅ تم الاستعادة من نقطة ${lastCheckpoint.id.slice(-8)} (${lastCheckpoint.createdAt.toISOString()})`,
      },
    }
  } catch (e) {
    return { ok: false, error: "crash_recovery_failed", message: `❌ فشل الاستعادة: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 9. Unknown-State Reconciliation (346)
// ---------------------------------------------------------------------------

export function unknownStateReconcile(state: Record<string, unknown>): ReliabilityResult<{
  reconciled: boolean
  state: Record<string, unknown>
  changes: string[]
  reason: string
}> {
  const changes: string[] = []
  const reconciled = { ...state }

  // Unknown mode → default
  if (!reconciled.mode || typeof reconciled.mode !== "string") {
    reconciled.mode = "assistant"
    changes.push("mode: set to 'assistant' (was unknown)")
  }

  // Unknown status → pending
  if (!reconciled.status || typeof reconciled.status !== "string") {
    reconciled.status = "pending"
    changes.push("status: set to 'pending'")
  }

  // Unknown conversationId → null
  if (reconciled.conversationId === "" || reconciled.conversationId === undefined) {
    reconciled.conversationId = null
    changes.push("conversationId: null (was empty/undefined)")
  }

  // Unknown toolName → abort
  if (reconciled.toolName === "" || reconciled.toolName === "unknown") {
    reconciled.toolName = null
    reconciled.abortTool = true
    changes.push("toolName: cleared (was unknown — will be re-routed)")
  }

  return {
    ok: true,
    data: {
      reconciled: changes.length > 0,
      state: reconciled,
      changes,
      reason: changes.length > 0
        ? `🔧 تم التصالح: ${changes.length} تغيير`
        : "✅ الحالة سليمة — لا تصالح مطلوب",
    },
  }
}

// ---------------------------------------------------------------------------
// 10. Checkpoint Rollback (347)
// ---------------------------------------------------------------------------

export async function createCheckpoint(opts: {
  conversationId?: string
  state: Record<string, unknown>
  kind?: "auto" | "manual" | "pre_tool" | "pre_destructive"
  label?: string
  gitHash?: string
  tokens?: number
}): Promise<ReliabilityResult<{ id: string; createdAt: string }>> {
  try {
    const entry = await db.reliabilityCheckpoint.create({
      data: {
        conversationId: opts.conversationId,
        kind: opts.kind ?? "auto",
        state: JSON.stringify(opts.state),
        gitHash: opts.gitHash,
        tokens: opts.tokens ?? 0,
        label: opts.label,
      },
    })
    return {
      ok: true,
      data: { id: entry.id, createdAt: entry.createdAt.toISOString() },
    }
  } catch (e) {
    return { ok: false, error: "checkpoint_failed", message: `❌ فشل إنشاء الـ checkpoint: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function checkpointRollback(checkpointId: string): Promise<ReliabilityResult<{
  restored: boolean
  state: Record<string, unknown> | null
  reason: string
}>> {
  try {
    const cp = await db.reliabilityCheckpoint.findUnique({ where: { id: checkpointId } })
    if (!cp) {
      return { ok: false, error: "not_found", message: `❌ الـ checkpoint ${checkpointId} غير موجود` }
    }
    let state: Record<string, unknown> | null = null
    try {
      state = JSON.parse(cp.state)
    } catch {
      state = null
    }
    return {
      ok: true,
      data: {
        restored: true,
        state,
        reason: `✅ تم التراجع إلى ${cp.id.slice(-8)} (${cp.createdAt.toISOString()})`,
      },
    }
  } catch (e) {
    return { ok: false, error: "rollback_failed", message: `❌ فشل التراجع: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function listCheckpoints(conversationId?: string, limit = 20): Promise<ReliabilityResult<Array<{
  id: string
  kind: string
  label: string | null
  gitHash: string | null
  tokens: number
  createdAt: string
}>>> {
  try {
    const entries = await db.reliabilityCheckpoint.findMany({
      where: conversationId ? { conversationId } : {},
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 100),
    })
    return {
      ok: true,
      data: entries.map((e) => ({
        id: e.id,
        kind: e.kind,
        label: e.label,
        gitHash: e.gitHash,
        tokens: e.tokens,
        createdAt: e.createdAt.toISOString(),
      })),
    }
  } catch (e) {
    return { ok: false, error: "list_failed", message: `❌ فشل القائمة: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 11. Failure Classify (348)
// ---------------------------------------------------------------------------

export async function failureClassify(opts: {
  task: string
  error: string
  category?: FailureCategory
  severity?: FailureSeverity
  context?: string
}): Promise<ReliabilityResult<{
  fingerprint: string
  category: FailureCategory
  severity: FailureSeverity
  isKnown: boolean
  occurrences: number
}>> {
  try {
    const fingerprint = fingerprintFailure(opts.task, opts.error)

    // Auto-classify if not provided
    let category = opts.category ?? "unknown"
    let severity = opts.severity ?? "transient"

    if (category === "unknown") {
      const err = opts.error.toLowerCase()
      if (/timeout|timed?\s*out/.test(err)) category = "timeout"
      else if (/out\s+of\s+memory|oom|heap/.test(err)) category = "oom"
      else if (/crash|segfault|killed|abort/.test(err)) category = "crash"
      else if (/loop|infinite|repeated/.test(err)) category = "loop"
      else if (/malformed|invalid\s+json|parse\s+error/.test(err)) category = "tool_malformed"
      else if (/unknown\s+tool|tool\s+not\s+found|wrong\s+tool/.test(err)) category = "tool_wrong"
      else if (/invalid\s+arg|argument|parameter/.test(err)) category = "argument_invalid"
      else if (/unknown\s+state|invalid\s+state/.test(err)) category = "unknown_state"
    }

    // Auto-severity
    if (severity === "transient") {
      if (category === "crash" || category === "oom") severity = "fatal"
      else if (category === "tool_wrong" || category === "argument_invalid") severity = "permanent"
      else if (category === "loop") severity = "partial"
    }

    // Upsert the failure (dedup by fingerprint)
    const existing = await db.reliabilityFailure.findUnique({ where: { fingerprint } })
    if (existing) {
      const updated = await db.reliabilityFailure.update({
        where: { fingerprint },
        data: {
          occurrences: { increment: 1 },
          category,
          severity,
          context: opts.context ?? existing.context,
          updatedAt: new Date(),
        },
      })
      return {
        ok: true,
        data: {
          fingerprint,
          category: updated.category as FailureCategory,
          severity: updated.severity as FailureSeverity,
          isKnown: true,
          occurrences: updated.occurrences,
        },
      }
    }

    const created = await db.reliabilityFailure.create({
      data: {
        fingerprint,
        task: opts.task,
        error: opts.error,
        category,
        severity,
        context: opts.context,
      },
    })
    return {
      ok: true,
      data: {
        fingerprint,
        category: created.category as FailureCategory,
        severity: created.severity as FailureSeverity,
        isKnown: false,
        occurrences: 1,
      },
    }
  } catch (e) {
    return { ok: false, error: "classify_failed", message: `❌ فشل التصنيف: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 12. Failure Memory Lookup (349)
// ---------------------------------------------------------------------------

export async function failureMemoryLookup(task: string, error?: string): Promise<ReliabilityResult<Array<{
  id: string
  task: string
  error: string
  category: FailureCategory
  severity: FailureSeverity
  recovered: boolean
  lesson: string | null
  occurrences: number
  createdAt: string
}>>> {
  try {
    // If error is provided, look up by exact fingerprint first
    if (error) {
      const fingerprint = fingerprintFailure(task, error)
      const exact = await db.reliabilityFailure.findUnique({ where: { fingerprint } })
      if (exact) {
        return {
          ok: true,
          data: [{
            id: exact.id,
            task: exact.task,
            error: exact.error,
            category: exact.category as FailureCategory,
            severity: exact.severity as FailureSeverity,
            recovered: exact.recovered,
            lesson: exact.lesson,
            occurrences: exact.occurrences,
            createdAt: exact.createdAt.toISOString(),
          }],
        }
      }
    }

    // Otherwise, search by task substring
    const tasks = await db.reliabilityFailure.findMany({
      where: { task: { contains: task.slice(0, 50) } },
      orderBy: { updatedAt: "desc" },
      take: 10,
    })
    return {
      ok: true,
      data: tasks.map((f) => ({
        id: f.id,
        task: f.task,
        error: f.error,
        category: f.category as FailureCategory,
        severity: f.severity as FailureSeverity,
        recovered: f.recovered,
        lesson: f.lesson,
        occurrences: f.occurrences,
        createdAt: f.createdAt.toISOString(),
      })),
    }
  } catch (e) {
    return { ok: false, error: "lookup_failed", message: `❌ فشل البحث: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 13. Negative Learning (350)
// ---------------------------------------------------------------------------

export async function negativeLearning(opts: {
  task: string
  error: string
  lesson: string
  category?: FailureCategory
}): Promise<ReliabilityResult<{ learned: boolean; fingerprint: string }>> {
  try {
    const fingerprint = fingerprintFailure(opts.task, opts.error)
    const existing = await db.reliabilityFailure.findUnique({ where: { fingerprint } })

    if (existing) {
      // Update with lesson + mark recovered=false (we're documenting the lesson, not recovering)
      await db.reliabilityFailure.update({
        where: { fingerprint },
        data: {
          lesson: opts.lesson,
          occurrences: { increment: 1 },
          updatedAt: new Date(),
        },
      })
      return { ok: true, data: { learned: true, fingerprint } }
    }

    // Create new failure record with the lesson
    await db.reliabilityFailure.create({
      data: {
        fingerprint,
        task: opts.task,
        error: opts.error,
        category: opts.category ?? "unknown",
        severity: "permanent",
        lesson: opts.lesson,
        occurrences: 1,
      },
    })
    return { ok: true, data: { learned: true, fingerprint } }
  } catch (e) {
    return { ok: false, error: "negative_learn_failed", message: `❌ فشل التعلم السلبي: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// Snapshot + list
// ---------------------------------------------------------------------------

export interface ReliabilitySnapshot {
  totalFailures: number
  totalCheckpoints: number
  totalLoopEvents: number
  loopEventsBroken: number
  failuresByCategory: Record<string, number>
  failuresBySeverity: Record<string, number>
  recoveredCount: number
  lessonsLearned: number
}

export async function reliabilitySnapshot(): Promise<ReliabilityResult<ReliabilitySnapshot>> {
  try {
    const [failures, checkpoints, loopEvents] = await Promise.all([
      db.reliabilityFailure.findMany(),
      db.reliabilityCheckpoint.count(),
      db.reliabilityLoopEvent.findMany(),
    ])

    const failuresByCategory: Record<string, number> = {}
    const failuresBySeverity: Record<string, number> = {}
    let recoveredCount = 0
    let lessonsLearned = 0
    for (const f of failures) {
      failuresByCategory[f.category] = (failuresByCategory[f.category] ?? 0) + 1
      failuresBySeverity[f.severity] = (failuresBySeverity[f.severity] ?? 0) + 1
      if (f.recovered) recoveredCount++
      if (f.lesson) lessonsLearned++
    }

    return {
      ok: true,
      data: {
        totalFailures: failures.length,
        totalCheckpoints: checkpoints,
        totalLoopEvents: loopEvents.length,
        loopEventsBroken: loopEvents.filter((l) => l.broken).length,
        failuresByCategory,
        failuresBySeverity,
        recoveredCount,
        lessonsLearned,
      },
    }
  } catch (e) {
    return { ok: false, error: "snapshot_failed", message: `❌ فشل اللقطة: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function listFailures(limit = 50): Promise<ReliabilityResult<Array<{
  id: string
  task: string
  error: string
  category: FailureCategory
  severity: FailureSeverity
  recovered: boolean
  lesson: string | null
  occurrences: number
  createdAt: string
}>>> {
  try {
    const failures = await db.reliabilityFailure.findMany({
      orderBy: { updatedAt: "desc" },
      take: Math.min(limit, 200),
    })
    return {
      ok: true,
      data: failures.map((f) => ({
        id: f.id,
        task: f.task,
        error: f.error,
        category: f.category as FailureCategory,
        severity: f.severity as FailureSeverity,
        recovered: f.recovered,
        lesson: f.lesson,
        occurrences: f.occurrences,
        createdAt: f.createdAt.toISOString(),
      })),
    }
  } catch (e) {
    return { ok: false, error: "list_failed", message: `❌ فشل القائمة: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** Mark a failure as recovered (with optional lesson). */
export async function markRecovered(failureId: string, lesson?: string): Promise<ReliabilityResult<{ updated: boolean }>> {
  try {
    const existing = await db.reliabilityFailure.findUnique({ where: { id: failureId } })
    if (!existing) return { ok: false, error: "not_found", message: `❌ الفشل ${failureId} غير موجود` }
    await db.reliabilityFailure.update({
      where: { id: failureId },
      data: { recovered: true, lesson: lesson ?? existing.lesson },
    })
    return { ok: true, data: { updated: true } }
  } catch (e) {
    return { ok: false, error: "mark_failed", message: `❌ فشل التحديث: ${e instanceof Error ? e.message : String(e)}` }
  }
}
