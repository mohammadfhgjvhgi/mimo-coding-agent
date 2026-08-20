// Skills — reusable, declarative knowledge + capability bundles.
// 8 operations, deterministic, bilingual (Arabic + English), persisted to SQLite.
//
// Design:
//   • Skill (Prisma) — registry: name, triggers, prompt fragment, tool allowlist, deps
//   • SkillExecution (Prisma) — every activation/use logged for memory + routing improvement
//   • Lazy loading: skills are NOT in memory until matched against user message
//   • Routing: deterministic trigger-matching with priority + auto-activation
//   • Memory: per-skill use count, success rate, last context
//
// 8 operations:
//   1. skillRegister           — declare a skill (prompt fragment + triggers + tools)
//   2. skillDiscover           — match a user message against skill triggers, return ranked matches
//   3. skillVersion             — bump version + track version history
//   4. skillCheckDependencies   — verify all deps are registered + active
//   5. skillLazyLoad            — load a skill's prompt fragment on-demand (cached)
//   6. skillRoute                — pick the best skill for a message (top-1 from discover)
//   7. skillUpdateMemory         — record execution outcome (success/fail) for routing improvement
//   8. skillValidate             — validate a skill's manifest (triggers are valid regex, deps exist)
//
// Plus the orchestrator: skillActivate — runs discover → route → lazyLoad → deps check →
// returns the assembled prompt fragment + tool allowlist for the agent to use.
//
// Ships with 11 example skills seeded by skillSeedDefaults():
//   nextjs, react, python, plc-automation, automation, research,
//   academic-writing, git, security, testing, debugging

import { db } from "@/lib/db"
import { createHash } from "node:crypto"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SkillCategory =
  | "web"
  | "systems"
  | "automation"
  | "research"
  | "writing"
  | "vcs"
  | "security"
  | "testing"
  | "debugging"
  | "general"

export type SkillStatus = "active" | "disabled" | "deprecated"

export interface SkillRouting {
  /** Higher = preferred when multiple match. Default 50. */
  priority: number
  /** If true, auto-activate on match (no /skill command needed). Default true. */
  autoActivate: boolean
  /** Max tokens the prompt fragment can occupy. Default 2000. */
  maxTokens: number
}

export interface SkillMemory {
  lastUsedAt?: string
  useCount: number
  successCount: number
  failureCount: number
  successRate: number
  lastContext?: Record<string, unknown>
}

export interface SkillRecord {
  id: string
  name: string
  displayName: string
  description: string
  category: SkillCategory
  version: string
  versionCompat: Record<string, unknown>
  triggers: string[] // regex strings
  tags: string[]
  dependencies: string[]
  promptFragment: string
  toolAllowlist: string[] | null
  routing: SkillRouting
  memory: SkillMemory
  status: SkillStatus
  checksum: string | null
  loadedAt: Date | null
  lastUsedAt: Date | null
  useCount: number
  createdAt: Date
  updatedAt: Date
}

export interface SkillMatch {
  name: string
  displayName: string
  category: SkillCategory
  priority: number
  matchedTriggers: string[]
  score: number // 0-100, higher = better
}

export interface SkillExecutionEntry {
  id: string
  skillName: string
  action: string
  trigger: string | null
  status: string
  context: Record<string, unknown>
  durationMs: number
  error: string | null
  createdAt: Date
}

export type SkillResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string }

export interface SkillActivationResult {
  activated: SkillRecord[]
  depsResolved: string[]
  promptFragment: string
  toolAllowlist: string[] | null
  totalTokensEstimate: number
  matchedTriggers: string[]
}

// ---------------------------------------------------------------------------
// Row → record mapper
// ---------------------------------------------------------------------------

interface SkillRow {
  id: string
  name: string
  displayName: string
  description: string
  category: string
  version: string
  versionCompat: string
  triggers: string
  tags: string
  dependencies: string
  promptFragment: string
  toolAllowlist: string | null
  routing: string
  memory: string
  status: string
  checksum: string | null
  loadedAt: Date | null
  lastUsedAt: Date | null
  useCount: number
  createdAt: Date
  updatedAt: Date
}

const DEFAULT_ROUTING: SkillRouting = {
  priority: 50,
  autoActivate: true,
  maxTokens: 2000,
}

const DEFAULT_MEMORY: SkillMemory = {
  useCount: 0,
  successCount: 0,
  failureCount: 0,
  successRate: 0,
}

function rowToRecord(row: SkillRow): SkillRecord {
  return {
    id: row.id,
    name: row.name,
    displayName: row.displayName,
    description: row.description,
    category: row.category as SkillCategory,
    version: row.version,
    versionCompat: safeParse(row.versionCompat, {}),
    triggers: safeParse(row.triggers, []),
    tags: safeParse(row.tags, []),
    dependencies: safeParse(row.dependencies, []),
    promptFragment: row.promptFragment,
    toolAllowlist: row.toolAllowlist ? safeParse<string[]>(row.toolAllowlist, []) : null,
    routing: safeParse(row.routing, DEFAULT_ROUTING),
    memory: safeParse(row.memory, DEFAULT_MEMORY),
    status: row.status as SkillStatus,
    checksum: row.checksum,
    loadedAt: row.loadedAt,
    lastUsedAt: row.lastUsedAt,
    useCount: row.useCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

function computeChecksum(s: string): string {
  return createHash("sha256").update(s).digest("hex")
}

// ---------------------------------------------------------------------------
// In-memory lazy-load cache: loaded prompt fragments
// ---------------------------------------------------------------------------

const loaded = new Map<string, { fragment: string; loadedAt: string; checksum: string }>()

function invalidate(name: string): void {
  loaded.delete(name)
}

// ---------------------------------------------------------------------------
// Execution logger
// ---------------------------------------------------------------------------

interface ExecutionOpts {
  skillName: string
  action: "activate" | "use" | "deactivate" | "validate" | "fail"
  trigger?: string
  status: "success" | "error" | "skipped"
  context?: Record<string, unknown>
  durationMs?: number
  error?: string
}

async function logExecution(opts: ExecutionOpts): Promise<void> {
  try {
    await db.skillExecution.create({
      data: {
        skillName: opts.skillName,
        action: opts.action,
        trigger: opts.trigger?.slice(0, 500),
        status: opts.status,
        context: JSON.stringify(opts.context ?? {}).slice(0, 2000),
        durationMs: opts.durationMs ?? 0,
        error: opts.error?.slice(0, 1000),
      },
    })
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// 1. Skill Registry — register a skill
// ---------------------------------------------------------------------------

export interface SkillRegisterInput {
  name: string
  displayName: string
  description: string
  category: SkillCategory
  version?: string
  triggers: string[] // regex strings matched against user message
  tags?: string[]
  dependencies?: string[]
  promptFragment: string
  toolAllowlist?: string[] | null
  routing?: Partial<SkillRouting>
  autoActivate?: boolean
}

export async function skillRegister(input: SkillRegisterInput): Promise<SkillResult<SkillRecord>> {
  try {
    if (!input.name || !input.displayName || !input.promptFragment) {
      return {
        ok: false,
        error: "bad_input",
        message: "❌ المدخلات غير مكتملة / incomplete input (name + displayName + promptFragment required)",
      }
    }
    // Validate triggers are valid regex.
    for (const t of input.triggers) {
      try {
        new RegExp(t)
      } catch {
        return {
          ok: false,
          error: "bad_trigger",
          message: `❌ محفّز غير صالح / invalid trigger regex: ${t}`,
        }
      }
    }
    const checksum = computeChecksum(input.promptFragment)
    const routing: SkillRouting = { ...DEFAULT_ROUTING, ...input.routing }
    if (input.autoActivate !== undefined) routing.autoActivate = input.autoActivate

    const row = await db.skill.upsert({
      where: { name: input.name },
      update: {
        displayName: input.displayName,
        description: input.description,
        category: input.category,
        version: input.version ?? "1.0.0",
        triggers: JSON.stringify(input.triggers),
        tags: JSON.stringify(input.tags ?? []),
        dependencies: JSON.stringify(input.dependencies ?? []),
        promptFragment: input.promptFragment,
        toolAllowlist: input.toolAllowlist ? JSON.stringify(input.toolAllowlist) : null,
        routing: JSON.stringify(routing),
        checksum,
        status: "active",
      },
      create: {
        name: input.name,
        displayName: input.displayName,
        description: input.description,
        category: input.category,
        version: input.version ?? "1.0.0",
        triggers: JSON.stringify(input.triggers),
        tags: JSON.stringify(input.tags ?? []),
        dependencies: JSON.stringify(input.dependencies ?? []),
        promptFragment: input.promptFragment,
        toolAllowlist: input.toolAllowlist ? JSON.stringify(input.toolAllowlist) : null,
        routing: JSON.stringify(routing),
        checksum,
        status: "active",
      },
    })
    invalidate(input.name)
    await logExecution({
      skillName: input.name,
      action: "activate",
      status: "success",
      context: { version: input.version ?? "1.0.0", triggerCount: input.triggers.length },
    })
    return { ok: true, data: rowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "register_failed",
      message: `❌ فشل التسجيل / register failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Skill Discovery — match a user message against triggers, return ranked matches
// ---------------------------------------------------------------------------

export async function skillDiscover(
  message: string,
  opts: { limit?: number; onlyAutoActivate?: boolean } = {}
): Promise<SkillResult<SkillMatch[]>> {
  try {
    const where: Record<string, unknown> = { status: "active" }
    const rows = await db.skill.findMany({ where, orderBy: { createdAt: "desc" } })
    const matches: SkillMatch[] = []
    for (const row of rows) {
      const triggers = safeParse<string[]>(row.triggers, [])
      const routing = safeParse<SkillRouting>(row.routing, DEFAULT_ROUTING)
      if (opts.onlyAutoActivate && !routing.autoActivate) continue
      const matchedTriggers: string[] = []
      let matchScore = 0
      const lowerMsg = message.toLowerCase()
      for (const t of triggers) {
        try {
          const re = new RegExp(t, "i")
          if (re.test(message)) {
            matchedTriggers.push(t)
            matchScore += 10
          }
        } catch {
          /* invalid regex — skip */
        }
      }
      // Tag-based fuzzy match (lower weight).
      const tags = safeParse<string[]>(row.tags, [])
      for (const tag of tags) {
        if (lowerMsg.includes(tag.toLowerCase())) {
          matchScore += 5
          if (!matchedTriggers.includes(`tag:${tag}`)) matchedTriggers.push(`tag:${tag}`)
        }
      }
      if (matchedTriggers.length === 0) continue
      // Priority-weighted score.
      const finalScore = Math.min(100, matchScore + routing.priority / 5)
      matches.push({
        name: row.name,
        displayName: row.displayName,
        category: row.category as SkillCategory,
        priority: routing.priority,
        matchedTriggers,
        score: finalScore,
      })
    }
    // Sort by score desc, then priority desc.
    matches.sort((a, b) => b.score - a.score || b.priority - a.priority)
    const limit = opts.limit ?? 5
    return { ok: true, data: matches.slice(0, limit) }
  } catch (e) {
    return {
      ok: false,
      error: "discover_failed",
      message: `❌ فشل الاكتشاف / discover failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Skill Versioning — bump version + track history
// ---------------------------------------------------------------------------

export async function skillVersion(
  name: string,
  newVersion: string,
  opts: { promptFragment?: string; triggers?: string[] } = {}
): Promise<SkillResult<SkillRecord>> {
  try {
    const existing = await db.skill.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ المهارة غير موجودة / skill not found: ${name}` }
    }
    const promptFragment = opts.promptFragment ?? existing.promptFragment
    const triggers = opts.triggers ? JSON.stringify(opts.triggers) : existing.triggers
    const checksum = computeChecksum(promptFragment)
    const row = await db.skill.update({
      where: { name },
      data: {
        version: newVersion,
        promptFragment,
        triggers,
        checksum,
      },
    })
    invalidate(name)
    await logExecution({
      skillName: name,
      action: "validate",
      status: "success",
      context: { from: existing.version, to: newVersion },
    })
    return { ok: true, data: rowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "version_failed",
      message: `❌ فشل تحديث الإصدار / version failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Skill Dependencies — verify all deps are registered + active
// ---------------------------------------------------------------------------

export async function skillCheckDependencies(name: string): Promise<SkillResult<{
  name: string
  deps: string[]
  missing: string[]
  inactive: string[]
  ok: boolean
}>> {
  try {
    const existing = await db.skill.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ المهارة غير موجودة / skill not found: ${name}` }
    }
    const deps = safeParse<string[]>(existing.dependencies, [])
    if (deps.length === 0) {
      return { ok: true, data: { name, deps: [], missing: [], inactive: [], ok: true } }
    }
    const missing: string[] = []
    const inactive: string[] = []
    for (const depName of deps) {
      const dep = await db.skill.findUnique({ where: { name: depName } })
      if (!dep) {
        missing.push(depName)
      } else if (dep.status !== "active") {
        inactive.push(depName)
      }
    }
    return {
      ok: true,
      data: {
        name,
        deps,
        missing,
        inactive,
        ok: missing.length === 0 && inactive.length === 0,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "deps_failed",
      message: `❌ فشل فحص الاعتماديات / deps failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Skill Lazy Loading — load a skill's prompt fragment on-demand (cached)
// ---------------------------------------------------------------------------

export async function skillLazyLoad(name: string, opts: { refresh?: boolean } = {}): Promise<SkillResult<{
  name: string
  fragment: string
  loaded: boolean
  cached: boolean
  tokensEstimate: number
}>> {
  try {
    if (!opts.refresh) {
      const cached = loaded.get(name)
      if (cached) {
        return {
          ok: true,
          data: {
            name,
            fragment: cached.fragment,
            loaded: true,
            cached: true,
            tokensEstimate: Math.ceil(cached.fragment.length / 4),
          },
        }
      }
    }
    const existing = await db.skill.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ المهارة غير موجودة / skill not found: ${name}` }
    }
    if (existing.status !== "active") {
      return { ok: false, error: "inactive", message: `❌ المهارة غير نشطة / skill is not active: ${name}` }
    }
    // Verify checksum (tamper detection).
    const currentChecksum = computeChecksum(existing.promptFragment)
    if (existing.checksum && currentChecksum !== existing.checksum) {
      await logExecution({
        skillName: name,
        action: "fail",
        status: "error",
        error: "checksum_mismatch",
        context: { expected: existing.checksum, actual: currentChecksum },
      })
      return {
        ok: false,
        error: "checksum_mismatch",
        message: `❌ عدم تطابق الـ checksum — قد تم التلاعب / checksum mismatch — may be tampered`,
      }
    }
    loaded.set(name, {
      fragment: existing.promptFragment,
      loadedAt: new Date().toISOString(),
      checksum: currentChecksum,
    })
    await db.skill.update({
      where: { name },
      data: { loadedAt: new Date() },
    })
    return {
      ok: true,
      data: {
        name,
        fragment: existing.promptFragment,
        loaded: true,
        cached: false,
        tokensEstimate: Math.ceil(existing.promptFragment.length / 4),
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "lazy_load_failed",
      message: `❌ فشل التحميل الكسول / lazy load failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export function skillUnload(name: string): boolean {
  return loaded.delete(name)
}

// ---------------------------------------------------------------------------
// 6. Skill Routing — pick the best skill for a message (top-1 from discover)
// ---------------------------------------------------------------------------

export async function skillRoute(message: string): Promise<SkillResult<SkillMatch | null>> {
  try {
    const disc = await skillDiscover(message, { limit: 1, onlyAutoActivate: true })
    if (!disc.ok || disc.data.length === 0) {
      return { ok: true, data: null }
    }
    return { ok: true, data: disc.data[0] }
  } catch (e) {
    return {
      ok: false,
      error: "route_failed",
      message: `❌ فشل التوجيه / route failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Skill Memory — record execution outcome for routing improvement
// ---------------------------------------------------------------------------

export async function skillUpdateMemory(
  name: string,
  outcome: { success: boolean; context?: Record<string, unknown>; durationMs?: number }
): Promise<SkillResult<SkillMemory>> {
  try {
    const existing = await db.skill.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ المهارة غير موجودة / skill not found: ${name}` }
    }
    const mem = safeParse<SkillMemory>(existing.memory, DEFAULT_MEMORY)
    mem.useCount = (existing.useCount ?? 0) + 1
    mem.lastUsedAt = new Date().toISOString()
    mem.lastContext = outcome.context
    if (outcome.success) {
      mem.successCount += 1
    } else {
      mem.failureCount += 1
    }
    mem.successRate = mem.useCount > 0 ? mem.successCount / mem.useCount : 0
    const row = await db.skill.update({
      where: { name },
      data: {
        memory: JSON.stringify(mem),
        useCount: mem.useCount,
        lastUsedAt: new Date(),
      },
    })
    await logExecution({
      skillName: name,
      action: "use",
      status: outcome.success ? "success" : "error",
      durationMs: outcome.durationMs,
      context: outcome.context,
    })
    return { ok: true, data: safeParse<SkillMemory>(row.memory, DEFAULT_MEMORY) }
  } catch (e) {
    return {
      ok: false,
      error: "memory_failed",
      message: `❌ فشل تحديث الذاكرة / memory failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 8. Skill Validation — validate a skill's manifest
// ---------------------------------------------------------------------------

export async function skillValidate(name: string): Promise<SkillResult<{
  name: string
  valid: boolean
  errors: string[]
  warnings: string[]
}>> {
  try {
    const existing = await db.skill.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ المهارة غير موجودة / skill not found: ${name}` }
    }
    const errors: string[] = []
    const warnings: string[] = []
    // Validate triggers.
    const triggers = safeParse<string[]>(existing.triggers, [])
    if (triggers.length === 0) {
      warnings.push("no triggers — skill will only match via tags or explicit activation")
    }
    for (const t of triggers) {
      try {
        new RegExp(t)
      } catch {
        errors.push(`invalid trigger regex: ${t}`)
      }
    }
    // Validate prompt fragment.
    if (!existing.promptFragment || existing.promptFragment.length === 0) {
      errors.push("empty prompt fragment")
    }
    if (existing.promptFragment.length > 8000) {
      warnings.push(`prompt fragment is large (${existing.promptFragment.length} chars) — may exceed maxTokens`)
    }
    // Validate deps.
    const deps = safeParse<string[]>(existing.dependencies, [])
    for (const dep of deps) {
      const depRow = await db.skill.findUnique({ where: { name: dep } })
      if (!depRow) {
        errors.push(`missing dependency: ${dep}`)
      } else if (depRow.status !== "active") {
        warnings.push(`dependency is not active: ${dep} (status=${depRow.status})`)
      }
    }
    // Checksum verification.
    const currentChecksum = computeChecksum(existing.promptFragment)
    if (existing.checksum && currentChecksum !== existing.checksum) {
      errors.push("checksum mismatch — prompt fragment may have been tampered")
    }
    await logExecution({
      skillName: name,
      action: "validate",
      status: errors.length === 0 ? "success" : "error",
      context: { errors, warnings },
    })
    return {
      ok: true,
      data: {
        name,
        valid: errors.length === 0,
        errors,
        warnings,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "validate_failed",
      message: `❌ فشل التحقق / validate failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Orchestrator — skillActivate: discover → route → lazyLoad → deps → assemble
// ---------------------------------------------------------------------------

export async function skillActivate(
  message: string,
  opts: { maxSkills?: number } = {}
): Promise<SkillResult<SkillActivationResult>> {
  try {
    const maxSkills = opts.maxSkills ?? 3
    const disc = await skillDiscover(message, { limit: maxSkills, onlyAutoActivate: true })
    if (!disc.ok || disc.data.length === 0) {
      return {
        ok: true,
        data: {
          activated: [],
          depsResolved: [],
          promptFragment: "",
          toolAllowlist: null,
          totalTokensEstimate: 0,
          matchedTriggers: [],
        },
      }
    }
    const activated: SkillRecord[] = []
    const depsResolved = new Set<string>()
    const allMatchedTriggers: string[] = []
    let fragmentParts: string[] = []
    let totalTokens = 0
    let mergedAllowlist: string[] | null = null

    for (const match of disc.data) {
      // Check deps.
      const depsRes = await skillCheckDependencies(match.name)
      if (depsRes.ok && !depsRes.data.ok) {
        // Skip skills with unresolved deps.
        await logExecution({
          skillName: match.name,
          action: "fail",
          status: "skipped",
          error: `unresolved deps: missing=${depsRes.data.missing.join(",")} inactive=${depsRes.data.inactive.join(",")}`,
        })
        continue
      }
      if (depsRes.ok) depsRes.data.deps.forEach((d) => depsResolved.add(d))
      // Lazy load.
      const loadRes = await skillLazyLoad(match.name)
      if (!loadRes.ok) {
        await logExecution({
          skillName: match.name,
          action: "fail",
          status: "error",
          error: loadRes.message,
        })
        continue
      }
      // Fetch the record.
      const recordRes = await skillGet(match.name)
      if (!recordRes.ok) continue
      activated.push(recordRes.data)
      fragmentParts.push(`## ${recordRes.data.displayName}\n${loadRes.data.fragment}`)
      totalTokens += loadRes.data.tokensEstimate
      allMatchedTriggers.push(...match.matchedTriggers)
      // Merge allowlist (intersection if both have, union if null).
      const allow = recordRes.data.toolAllowlist
      if (allow === null) {
        // null = all tools allowed
        mergedAllowlist = null
      } else if (mergedAllowlist === null) {
        // already all-allowed
      } else if (mergedAllowlist === undefined || mergedAllowlist.length === 0) {
        mergedAllowlist = allow
      } else {
        mergedAllowlist = mergedAllowlist.filter((t) => allow.includes(t))
      }
    }

    return {
      ok: true,
      data: {
        activated,
        depsResolved: Array.from(depsResolved),
        promptFragment: fragmentParts.join("\n\n"),
        toolAllowlist: mergedAllowlist ?? null,
        totalTokensEstimate: totalTokens,
        matchedTriggers: allMatchedTriggers,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "activate_failed",
      message: `❌ فشل التفعيل / activate failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Listing + getters
// ---------------------------------------------------------------------------

export async function skillList(opts: { category?: SkillCategory; status?: SkillStatus } = {}): Promise<SkillResult<SkillRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.category) where.category = opts.category
    if (opts.status) where.status = opts.status
    const rows = await db.skill.findMany({ where, orderBy: { createdAt: "desc" } })
    return { ok: true, data: rows.map(rowToRecord) }
  } catch (e) {
    return {
      ok: false,
      error: "list_failed",
      message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function skillGet(name: string): Promise<SkillResult<SkillRecord>> {
  try {
    const row = await db.skill.findUnique({ where: { name } })
    if (!row) {
      return { ok: false, error: "not_found", message: `❌ المهارة غير موجودة / skill not found: ${name}` }
    }
    return { ok: true, data: rowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "get_failed",
      message: `❌ فشل الجلب / get failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function skillDisable(name: string): Promise<SkillResult<SkillRecord>> {
  try {
    const existing = await db.skill.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ المهارة غير موجودة / skill not found: ${name}` }
    }
    invalidate(name)
    const row = await db.skill.update({ where: { name }, data: { status: "disabled" } })
    return { ok: true, data: rowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "disable_failed",
      message: `❌ فشل التعطيل / disable failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function skillEnable(name: string): Promise<SkillResult<SkillRecord>> {
  try {
    const existing = await db.skill.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ المهارة غير موجودة / skill not found: ${name}` }
    }
    const row = await db.skill.update({ where: { name }, data: { status: "active" } })
    return { ok: true, data: rowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "enable_failed",
      message: `❌ فشل التفعيل / enable failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function skillDelete(name: string): Promise<SkillResult<{ deleted: boolean }>> {
  try {
    const existing = await db.skill.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ المهارة غير موجودة / skill not found: ${name}` }
    }
    invalidate(name)
    await db.skillExecution.deleteMany({ where: { skillName: name } })
    await db.skill.delete({ where: { name } })
    return { ok: true, data: { deleted: true } }
  } catch (e) {
    return {
      ok: false,
      error: "delete_failed",
      message: `❌ فشل الحذف / delete failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Query executions
// ---------------------------------------------------------------------------

export async function skillQueryExecutions(
  opts: { skillName?: string; action?: string; status?: string; limit?: number } = {}
): Promise<SkillResult<SkillExecutionEntry[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.skillName) where.skillName = opts.skillName
    if (opts.action) where.action = opts.action
    if (opts.status) where.status = opts.status
    const rows = await db.skillExecution.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 100,
    })
    return {
      ok: true,
      data: rows.map((r) => ({
        ...r,
        context: safeParse(r.context, {}),
      })),
    }
  } catch (e) {
    return {
      ok: false,
      error: "query_failed",
      message: `❌ فشل الاستعلام / query failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface SkillSnapshot {
  total: number
  active: number
  disabled: number
  byCategory: Record<string, number>
  loadedInMemory: number
  totalActivations: number
  recentErrors: Array<{ skillName: string; error: string; createdAt: Date }>
}

export async function skillSnapshot(): Promise<SkillResult<SkillSnapshot>> {
  try {
    const listRes = await skillList()
    const skills = listRes.ok ? listRes.data : []
    const active = skills.filter((s) => s.status === "active").length
    const disabled = skills.filter((s) => s.status === "disabled").length
    const byCategory: Record<string, number> = {}
    for (const s of skills) {
      byCategory[s.category] = (byCategory[s.category] ?? 0) + 1
    }
    const execRes = await skillQueryExecutions({ action: "activate", limit: 1000 })
    const totalActivations = execRes.ok ? execRes.data.length : 0
    const errRes = await skillQueryExecutions({ status: "error", limit: 10 })
    const recentErrors = errRes.ok
      ? errRes.data.map((e) => ({ skillName: e.skillName, error: e.error ?? "", createdAt: e.createdAt }))
      : []
    return {
      ok: true,
      data: {
        total: skills.length,
        active,
        disabled,
        byCategory,
        loadedInMemory: loaded.size,
        totalActivations,
        recentErrors,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "snapshot_failed",
      message: `❌ فشل اللقطة / snapshot failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 11 Default Skills — seeded once via skillSeedDefaults()
// ---------------------------------------------------------------------------

const DEFAULT_SKILLS: SkillRegisterInput[] = [
  {
    name: "nextjs",
    displayName: "Next.js",
    description: "Next.js 16 App Router + Turbopack + Server Components best practices",
    category: "web",
    version: "1.0.0",
    triggers: ["next\\.?js", "app router", "server component", "use client", "page\\.tsx", "layout\\.tsx"],
    tags: ["react", "ssr", "rsc", "turbopack", "vercel"],
    dependencies: ["react"],
    promptFragment: `You are a Next.js 16 expert. Default to:
- App Router (not Pages Router) — src/app/page.tsx is the only user route
- Server Components by default; add 'use client' only for interactivity
- Turbopack for dev (faster than webpack)
- File-based routing: page.tsx, layout.tsx, loading.tsx, error.tsx
- API routes in app/api/<route>/route.ts (not pages/api)
- Use Server Actions sparingly — prefer /api routes for separation
- Streaming: use Suspense boundaries + use() hook for promises
- TypeScript strict mode is ON`,
    toolAllowlist: ["write_file", "read_file", "edit_file", "run_terminal_command", "find_symbol"],
    routing: { priority: 80, autoActivate: true, maxTokens: 1500 },
  },
  {
    name: "react",
    displayName: "React",
    description: "React 19 + hooks + Server Components + concurrent features",
    category: "web",
    version: "1.0.0",
    triggers: ["\\breact\\b", "usestate", "useeffect", "usememo", "usecallback", "jsx", "tsx"],
    tags: ["hooks", "components", "jsx", "frontend"],
    promptFragment: `You are a React 19 expert. Default to:
- Function components only (no class components)
- Hooks: useState, useEffect, useMemo, useCallback, useRef, useReducer
- Server Components by default; mark interactive ones 'use client'
- Concurrent features: useTransition, useDeferredValue, use()
- Don't over-memoize — only memoize expensive computations or referential-equality deps
- Keys must be stable (not array index) when list can reorder
- Effects should return cleanup functions to prevent memory leaks`,
    toolAllowlist: ["write_file", "read_file", "edit_file", "find_symbol"],
    routing: { priority: 70, autoActivate: true, maxTokens: 1200 },
  },
  {
    name: "python",
    displayName: "Python",
    description: "Python 3.12+ idioms, typing, async, packaging",
    category: "systems",
    version: "1.0.0",
    triggers: ["\\bpython\\b", "\\.py$", "pip install", "poetry", "uv sync", "venv", "asyncio"],
    tags: ["scripting", "data", "backend", "automation"],
    promptFragment: `You are a Python 3.12 expert. Default to:
- Type hints everywhere (use typing module + built-in generics: list[str], dict[str, int])
- pathlib for paths (not os.path)
- f-strings for formatting
- dataclasses or pydantic for structured data
- async/await with asyncio for I/O-bound work
- 'uv' for fast dependency management; 'ruff' for lint+format
- Context managers (with) for resource cleanup
- Don't use mutable default args (def f(x=[]) is a footgun)`,
    toolAllowlist: ["write_file", "read_file", "edit_file", "run_terminal_command"],
    routing: { priority: 70, autoActivate: true, maxTokens: 1200 },
  },
  {
    name: "plc-automation",
    displayName: "PLC & Industrial Automation",
    description: "PLC programming (ladder logic, ST), SCADA, industrial protocols",
    category: "automation",
    version: "1.0.0",
    triggers: ["\\bplc\\b", "ladder logic", "structured text", "\\bst\\b program", "scada", "modbus", "profibus", "opc ua", "iec 61131"],
    tags: ["industrial", "ladder", "siemens", "rockwell", "schneider"],
    promptFragment: `You are an industrial automation expert. Default to:
- IEC 61131-3 languages: LD (Ladder), ST (Structured Text), FBD, SFC, IL
- PLC brands: Siemens (TIA Portal), Rockwell (RSLogix), Schneider (Unity Pro)
- Communication: Modbus TCP/RTU, Profinet, EtherCAT, OPC UA
- Scan cycle: read inputs → execute logic → write outputs → housekeeping
- Always implement fail-safe states (outputs OFF on comms loss)
- Use TON/TOF/TP timers; avoid self-resetting timers in main OB
- Document symbol addresses (I0.0, Q0.0, M0.0, DB1.DBX0.0)`,
    toolAllowlist: ["write_file", "read_file", "edit_file"],
    routing: { priority: 85, autoActivate: true, maxTokens: 1800 },
  },
  {
    name: "automation",
    displayName: "General Automation",
    description: "Scripts, cron jobs, batch processing, workflow automation",
    category: "automation",
    version: "1.0.0",
    triggers: ["automate", "cron", "schedule", "batch process", "workflow", "scripts? to run"],
    tags: ["cron", "bash", "powershell", "python-script", "node-script"],
    promptFragment: `You are an automation expert. Default to:
- Idempotent scripts (safe to re-run)
- Logging with timestamps + log levels (INFO/WARN/ERROR)
- Exit codes: 0=success, non-zero=failure (with specific codes per failure mode)
- Timeouts on every external call (network, subprocess)
- Retry with exponential backoff for transient failures
- Dry-run mode for destructive operations
- Configuration via env vars (12-factor app)`,
    toolAllowlist: ["write_file", "read_file", "edit_file", "run_terminal_command"],
    routing: { priority: 60, autoActivate: true, maxTokens: 1000 },
  },
  {
    name: "research",
    displayName: "Research",
    description: "Web research, source synthesis, citation tracking",
    category: "research",
    version: "1.0.0",
    triggers: ["research", "investigate", "find sources", "literature review", "synthesize"],
    tags: ["web-search", "citations", "synthesis", "academic"],
    dependencies: [],
    promptFragment: `You are a research assistant. Default to:
- Search multiple sources (web search, web reader)
- Triangulate claims from ≥2 independent sources
- Cite sources inline [1], [2] with full URL + access date
- Distinguish: fact (cited) vs inference (marked) vs opinion (marked)
- Note source credibility (peer-reviewed > news > blog > social)
- Refuse to fabricate citations — if unsure, say "no source found"
- Produce a synthesis section at the end with key findings`,
    toolAllowlist: ["web_search", "read_web_page", "save_memory", "recall_memory"],
    routing: { priority: 75, autoActivate: true, maxTokens: 1500 },
  },
  {
    name: "academic-writing",
    displayName: "Academic Writing",
    description: "Papers, theses, formal academic prose, citation styles",
    category: "writing",
    version: "1.0.0",
    triggers: ["academic", "thesis", "paper", "abstract", "citations?", "apa", "mla", "chicago", "bibtex"],
    tags: ["latex", "citation", "peer-review", "formal"],
    promptFragment: `You are an academic writing expert. Default to:
- IMRAD structure for empirical papers (Intro/Methods/Results/Discussion)
- Active voice for methods ("we measured" not "was measured")
- Citations: APA 7 by default; switch to MLA/Chicago if requested
- Avoid weasel words ("some", "many", "experts say") — quantify
- Each paragraph: one claim + one piece of evidence + one analysis
- Abstract: 150-250 words, no citations
- Use BibTeX (.bib) for references; consistent cite keys (Author2024keyword)`,
    toolAllowlist: ["write_file", "read_file", "edit_file", "save_memory"],
    routing: { priority: 80, autoActivate: true, maxTokens: 1500 },
  },
  {
    name: "git",
    displayName: "Git",
    description: "Version control, branching strategies, commit conventions",
    category: "vcs",
    version: "1.0.0",
    triggers: ["\\bgit\\b", "commit", "branch", "merge", "rebase", "pull request", "pr review"],
    tags: ["github", "version-control", "conventional-commits"],
    promptFragment: `You are a Git expert. Default to:
- Conventional Commits: feat: / fix: / docs: / chore: / refactor: / test:
- Branch naming: feat/<slug>, fix/<issue>, chore/<task>
- Small, atomic commits (one logical change per commit)
- Commit AFTER verification passes (lint + typecheck)
- Never force-push to main/master
- Rebase before merge to keep history linear (or squash if team prefers)
- Use .gitignore for: node_modules/, .env, .next/, dist/, *.log`,
    toolAllowlist: ["run_terminal_command", "read_file", "write_file"],
    routing: { priority: 65, autoActivate: true, maxTokens: 1200 },
  },
  {
    name: "security",
    displayName: "Security",
    description: "Secure coding, secrets, OWASP, threat modeling",
    category: "security",
    version: "1.0.0",
    triggers: ["security", "vulnerabilit", "cve", "owasp", "xss", "sqli", "csrf", "secrets?", "api key"],
    tags: ["pentest", "hardening", "encryption", "audit"],
    promptFragment: `You are a security expert. Default to:
- Never hardcode secrets (API keys, passwords, tokens) — use env vars + secret manager
- Validate ALL user input (whitelist > blacklist)
- Parameterized queries only (no string concat SQL)
- Output encoding for XSS prevention (context-aware: HTML, JS, URL)
- CSRF tokens for state-changing requests
- Use bcrypt/argon2 for password hashing (never MD5/SHA1)
- TLS 1.3 minimum; HSTS headers
- OWASP Top 10 as a checklist for any new endpoint
- Audit dependencies: npm audit / pip-audit / bun audit quarterly`,
    toolAllowlist: ["read_file", "find_symbol", "run_terminal_command"],
    routing: { priority: 90, autoActivate: true, maxTokens: 1800 },
  },
  {
    name: "testing",
    displayName: "Testing",
    description: "Unit, integration, E2E testing strategies + frameworks",
    category: "testing",
    version: "1.0.0",
    triggers: ["\\btest\\b", "unit test", "integration test", "e2e", "vitest", "jest", "playwright", "coverage"],
    tags: ["tdd", "bdd", "mocking", "fixtures"],
    promptFragment: `You are a testing expert. Default to:
- Test pyramid: many unit tests > some integration > few E2E
- AAA pattern: Arrange / Act / Assert
- One assertion per test (or one logical concept)
- Test behavior, not implementation
- Use real fakes over mocks where possible (in-memory DB > mock DB)
- Descriptive test names: "should X when Y"
- Coverage target: 80% line, 70% branch (don't chase 100%)
- Run tests in CI on every PR; block merge on failure
- Bun test for speed; Playwright for E2E`,
    toolAllowlist: ["write_file", "read_file", "edit_file", "run_terminal_command"],
    routing: { priority: 75, autoActivate: true, maxTokens: 1300 },
  },
  {
    name: "debugging",
    displayName: "Debugging",
    description: "Systematic debugging, root cause analysis, post-mortem",
    category: "debugging",
    version: "1.0.0",
    triggers: ["debug", "bug", "error", "stack trace", "crash", "exception", "why doesn't", "not working"],
    tags: ["root-cause", "postmortem", "bisect"],
    promptFragment: `You are a debugging expert. Default to:
- Reproduce FIRST (can't fix what you can't reproduce)
- Read the FULL error message + stack trace (don't skim)
- Bisect: git bisect to find the exact commit that introduced the bug
- Form a hypothesis BEFORE changing code
- Change ONE thing at a time; re-test after each change
- Add a regression test before fixing (proves the bug, prevents recurrence)
- Root cause > symptom: fix the underlying issue, not the surface
- Document the post-mortem: what happened, why, how to prevent`,
    toolAllowlist: ["read_file", "find_symbol", "get_references", "run_terminal_command", "edit_file"],
    routing: { priority: 85, autoActivate: true, maxTokens: 1500 },
  },
]

/**
 * Seed the 11 default skills. Idempotent — skips skills that already exist.
 */
export async function skillSeedDefaults(): Promise<SkillResult<{ seeded: string[]; skipped: string[] }>> {
  try {
    const seeded: string[] = []
    const skipped: string[] = []
    for (const input of DEFAULT_SKILLS) {
      const existing = await db.skill.findUnique({ where: { name: input.name } })
      if (existing) {
        skipped.push(input.name)
        continue
      }
      const res = await skillRegister(input)
      if (res.ok) seeded.push(input.name)
    }
    return { ok: true, data: { seeded, skipped } }
  } catch (e) {
    return {
      ok: false,
      error: "seed_failed",
      message: `❌ فشل البذر / seed failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

export function formatSkillResult<T>(result: SkillResult<T>): string {
  if (!result.ok) {
    return `${result.message}\n[error: ${result.error}]`
  }
  const data = result.data as unknown
  if (data === null || data === undefined) return "✅ OK"
  if (typeof data === "string") return data
  if (typeof data === "number" || typeof data === "boolean") return String(data)
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}
