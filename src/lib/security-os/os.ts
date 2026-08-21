// Security OS — permissions, sandbox, secrets, injection detection, audit.
// 12 operations, deterministic, bilingual (Arabic + English), persisted to SQLite.
// Hash-chained audit log (SHA-256 chain — tamper-evident).
//
// 12 operations:
//   1.  permissionCheck       — check if a principal can access a resource
//   2.  approvalQueue          — pending approvals for "ask" actions
//   3.  pathSandbox            — validate a path is within workspace
//   4.  commandSanitizer       — sanitize shell commands (block dangerous patterns)
//   5.  secretDetect           — detect secrets in text/code
//   6.  secretRedact           — redact secrets from output
//   7.  promptInjectionDetect  — detect prompt injection patterns
//   8.  untrustedClassify      — classify content as trusted/untrusted
//   9.  pluginPermissionCheck  — check plugin tool access
//   10. mcpPermissionCheck     — check MCP tool access (delegates to MCP OS)
//   11. auditLog                — write to hash-chained audit log
//   12. auditVerify            — verify hash chain integrity

import { db } from "@/lib/db"
import { createHash } from "node:crypto"
import path from "node:path"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PermissionAction = "allow" | "deny" | "ask"
export type ResourceType = "file_read" | "file_write" | "shell_exec" | "mcp_call" | "plugin_call" | "network" | "secret_access"
export type Principal = "agent" | "user" | "system" | "plugin" | "mcp"

export interface PermissionRule {
  resource: ResourceType
  pattern: string // glob pattern for target
  action: PermissionAction
  principal?: Principal
}

export interface ApprovalRequest {
  id: string
  principal: Principal
  resource: ResourceType
  target: string
  reason: string
  status: "pending" | "approved" | "denied"
  createdAt: string
}

export interface SecretDetection {
  found: boolean
  secrets: Array<{ type: string; value: string; line: number; column: number }>
}

export interface InjectionDetection {
  isInjection: boolean
  confidence: number
  patterns: string[]
  sanitizedText: string
}

export type SecurityResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string }

// ---------------------------------------------------------------------------
// In-memory permission rules + approval queue
// ---------------------------------------------------------------------------

const permissionRules: PermissionRule[] = [
  // Default rules
  { resource: "file_read", pattern: "**/*", action: "allow", principal: "agent" },
  { resource: "file_write", pattern: "src/**", action: "allow", principal: "agent" },
  { resource: "file_write", pattern: "upload/**", action: "allow", principal: "agent" },
  { resource: "file_write", pattern: ".verification/**", action: "allow", principal: "agent" },
  { resource: "file_write", pattern: ".browser-profiles/**", action: "allow", principal: "agent" },
  { resource: "file_write", pattern: ".file-intel/**", action: "allow", principal: "agent" },
  { resource: "file_write", pattern: "prisma/**", action: "ask", principal: "agent" },
  { resource: "file_write", pattern: ".env*", action: "deny", principal: "agent" },
  { resource: "file_write", pattern: ".git/**", action: "deny", principal: "agent" },
  { resource: "file_write", pattern: "node_modules/**", action: "deny", principal: "agent" },
  { resource: "shell_exec", pattern: "git *", action: "allow", principal: "agent" },
  { resource: "shell_exec", pattern: "npm *", action: "allow", principal: "agent" },
  { resource: "shell_exec", pattern: "bun *", action: "allow", principal: "agent" },
  { resource: "shell_exec", pattern: "npx *", action: "allow", principal: "agent" },
  { resource: "shell_exec", pattern: "rm *", action: "ask", principal: "agent" },
  { resource: "shell_exec", pattern: "rm -rf *", action: "deny", principal: "agent" },
  { resource: "shell_exec", pattern: "sudo *", action: "deny", principal: "agent" },
  { resource: "shell_exec", pattern: "chmod *", action: "deny", principal: "agent" },
  { resource: "shell_exec", pattern: "curl * | bash", action: "deny", principal: "agent" },
  { resource: "shell_exec", pattern: "wget * | bash", action: "deny", principal: "agent" },
  { resource: "network", pattern: "*", action: "allow", principal: "agent" },
  { resource: "secret_access", pattern: "*", action: "ask", principal: "agent" },
]

const approvalQueue: ApprovalRequest[] = []

export function addPermissionRule(rule: PermissionRule): void {
  permissionRules.push(rule)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function globMatch(pattern: string, target: string): boolean {
  // Simple glob: ** → .*, * → [^/]*
  const regex = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "::DS::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DS::/g, ".*")
  return new RegExp(`^${regex}$`, "i").test(target)
}

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex")
}

// ---------------------------------------------------------------------------
// 1. Permission Check
// ---------------------------------------------------------------------------

export function permissionCheck(opts: {
  principal: Principal
  resource: ResourceType
  target: string
}): SecurityResult<{ action: PermissionAction; rule?: PermissionRule; reason: string }> {
  try {
    // Find matching rule (last match wins — more specific rules added later)
    let matched: PermissionRule | undefined
    for (const rule of permissionRules) {
      if (rule.resource === opts.resource && globMatch(rule.pattern, opts.target)) {
        if (rule.principal && rule.principal !== opts.principal) continue
        matched = rule
      }
    }
    if (!matched) {
      // Default: deny unknown
      return {
        ok: true,
        data: {
          action: "deny",
          reason: `❌ لا قاعدة مطابقة — مرفوض افتراضياً / no matching rule — denied by default`,
        },
      }
    }
    const reason = matched.action === "allow"
      ? `مسموح: ${matched.pattern} / allowed: ${matched.pattern}`
      : matched.action === "deny"
      ? `ممنوع: ${matched.pattern} / denied: ${matched.pattern}`
      : `يتطلب موافقة: ${matched.pattern} / requires approval: ${matched.pattern}`
    return {
      ok: true,
      data: { action: matched.action, rule: matched, reason },
    }
  } catch (e) {
    return { ok: false, error: "check_failed", message: `❌ فشل الفحص: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 2. Approval Queue
// ---------------------------------------------------------------------------

export function approvalQueueAdd(opts: {
  principal: Principal
  resource: ResourceType
  target: string
  reason: string
}): SecurityResult<ApprovalRequest> {
  try {
    const req: ApprovalRequest = {
      id: `appr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      principal: opts.principal,
      resource: opts.resource,
      target: opts.target,
      reason: opts.reason,
      status: "pending",
      createdAt: new Date().toISOString(),
    }
    approvalQueue.push(req)
    return { ok: true, data: req }
  } catch (e) {
    return { ok: false, error: "queue_failed", message: `❌ فشل الإضافة: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export function approvalQueueList(): SecurityResult<ApprovalRequest[]> {
  return { ok: true, data: approvalQueue.filter(a => a.status === "pending") }
}

export function approvalQueueResolve(id: string, approved: boolean): SecurityResult<ApprovalRequest> {
  const req = approvalQueue.find(a => a.id === id)
  if (!req) return { ok: false, error: "not_found", message: `❌ الطلب غير موجود: ${id}` }
  req.status = approved ? "approved" : "denied"
  return { ok: true, data: req }
}

// ---------------------------------------------------------------------------
// 3. Path Sandbox
// ---------------------------------------------------------------------------

export function pathSandbox(filePath: string): SecurityResult<{ safe: boolean; resolved: string; reason: string }> {
  try {
    const root = path.resolve(WORKSPACE_ROOT)
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath)
    const rel = path.relative(root, resolved)
    // Check for path traversal
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return {
        ok: true,
        data: { safe: false, resolved, reason: `❌ مسار خارج المساحة / path outside workspace: ${rel}` },
      }
    }
    // Block sensitive paths
    const blocked = [".env", ".git/config", "node_modules/.cache"]
    for (const b of blocked) {
      if (rel === b || rel.startsWith(b + "/")) {
        return {
          ok: true,
          data: { safe: false, resolved, reason: `❌ مسار حساس محظور / sensitive path blocked: ${b}` },
        }
      }
    }
    return {
      ok: true,
      data: { safe: true, resolved, reason: `✅ ضمن المساحة / within workspace: ${rel}` },
    }
  } catch (e) {
    return { ok: false, error: "sandbox_failed", message: `❌ فشل الفحص: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 4. Command Sanitizer
// ---------------------------------------------------------------------------

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; replacement: string; reason: string }> = [
  { pattern: /;\s*rm\s+-rf\s+\//gi, replacement: "; echo 'BLOCKED: rm -rf /'", reason: "rm -rf / blocked" },
  { pattern: /\|\s*(bash|sh|zsh)\b/gi, replacement: "| echo 'BLOCKED: pipe to shell'", reason: "pipe to shell blocked" },
  { pattern: /&&\s*(sudo|chmod|chown)\b/gi, replacement: "&& echo 'BLOCKED: priv escalation'", reason: "privilege escalation blocked" },
  { pattern: /\$\([^)]*\)/g, replacement: "'BLOCKED: command substitution'", reason: "command substitution blocked" },
  { pattern: /`[^`]*`/g, replacement: "'BLOCKED: backtick'", reason: "backtick execution blocked" },
  { pattern: /\b(curl|wget)\s+[^|]*\|\s*(bash|sh)/gi, replacement: "echo 'BLOCKED: remote script exec'", reason: "remote script execution blocked" },
]

export function commandSanitizer(command: string): SecurityResult<{ safe: boolean; sanitized: string; changes: string[] }> {
  try {
    let sanitized = command
    const changes: string[] = []
    for (const p of DANGEROUS_PATTERNS) {
      if (p.pattern.test(sanitized)) {
        sanitized = sanitized.replace(p.pattern, p.replacement)
        changes.push(p.reason)
      }
    }
    return {
      ok: true,
      data: { safe: changes.length === 0, sanitized, changes },
    }
  } catch (e) {
    return { ok: false, error: "sanitize_failed", message: `❌ فشل التنظيف: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 5. Secret Detection
// ---------------------------------------------------------------------------

const SECRET_PATTERNS: Array<{ type: string; pattern: RegExp }> = [
  { type: "AWS", pattern: /AKIA[0-9A-Z]{16}/g },
  { type: "OpenAI", pattern: /sk-[A-Za-z0-9]{20,}/g },
  { type: "GitHub", pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { type: "Slack", pattern: /xox[baprs]-[A-Za-z0-9-]+/g },
  { type: "PrivateKey", pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g },
  { type: "Generic", pattern: /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{8,}["']/gi },
]

export function secretDetect(text: string): SecurityResult<SecretDetection> {
  try {
    const secrets: Array<{ type: string; value: string; line: number; column: number }> = []
    const lines = text.split("\n")
    for (let i = 0; i < lines.length; i++) {
      for (const p of SECRET_PATTERNS) {
        p.pattern.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = p.pattern.exec(lines[i])) !== null) {
          secrets.push({
            type: p.type,
            value: m[0].slice(0, 20) + "...",
            line: i + 1,
            column: m.index + 1,
          })
        }
      }
    }
    return { ok: true, data: { found: secrets.length > 0, secrets } }
  } catch (e) {
    return { ok: false, error: "detect_failed", message: `❌ فشل الكشف: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 6. Secret Redaction
// ---------------------------------------------------------------------------

export function secretRedact(text: string): SecurityResult<{ redacted: string; count: number }> {
  try {
    let count = 0
    let redacted = text
    for (const p of SECRET_PATTERNS) {
      redacted = redacted.replace(p.pattern, () => {
        count++
        return `[REDACTED:${p.type}]`
      })
    }
    return { ok: true, data: { redacted, count } }
  } catch (e) {
    return { ok: false, error: "redact_failed", message: `❌ فشل الإخفاء: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 7. Prompt Injection Detection
// ---------------------------------------------------------------------------

const INJECTION_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /ignore\s+(previous|prior|above)\s+(instructions?|prompts?)/gi, name: "ignore_instructions" },
  { pattern: /disregard\s+(all|previous)\s+(instructions?|rules?)/gi, name: "disregard_instructions" },
  { pattern: /you\s+are\s+(now|actually)\s+(a|an)\s+/gi, name: "role_hijack" },
  { pattern: /system\s*:\s*/gi, name: "system_prefix" },
  { pattern: /\[SYSTEM\]|\[ADMIN\]|\[ROOT\]/gi, name: "fake_system_tag" },
  { pattern: /reveal\s+(your|the)\s+(system\s+)?prompt/gi, name: "prompt_extraction" },
  { pattern: /override\s+(safety|content|filter)/gi, name: "safety_override" },
  { pattern: /act\s+as\s+(if\s+you\s+(are|were)\s+)?(jailbreak|dan|developer)/gi, name: "jailbreak_attempt" },
  { pattern: /do\s+anything\s+now/gi, name: "dan_attempt" },
  { pattern: /\bexec\s*\(|\beval\s*\(/gi, name: "code_injection" },
]

export function promptInjectionDetect(text: string): SecurityResult<InjectionDetection> {
  try {
    const matched: string[] = []
    let sanitized = text
    for (const p of INJECTION_PATTERNS) {
      if (p.pattern.test(text)) {
        matched.push(p.name)
        sanitized = sanitized.replace(p.pattern, "[BLOCKED]")
      }
    }
    const isInjection = matched.length > 0
    const confidence = isInjection ? Math.min(1, matched.length / 3) : 0
    return {
      ok: true,
      data: { isInjection, confidence, patterns: matched, sanitizedText: sanitized },
    }
  } catch (e) {
    return { ok: false, error: "injection_failed", message: `❌ فشل الكشف: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 8. Untrusted Content Classification
// ---------------------------------------------------------------------------

export function untrustedClassify(content: string): SecurityResult<{
  trusted: boolean
  classification: "safe" | "caution" | "untrusted" | "malicious"
  reasons: string[]
}> {
  try {
    const reasons: string[] = []
    let level: "safe" | "caution" | "untrusted" | "malicious" = "safe"

    // Check for secrets
    const sec = secretDetect(content)
    if (sec.ok && sec.data.found) {
      reasons.push(`secrets found: ${sec.data.secrets.length}`)
      level = "untrusted"
    }

    // Check for injection
    const inj = promptInjectionDetect(content)
    if (inj.ok && inj.data.isInjection) {
      reasons.push(`injection patterns: ${inj.data.patterns.join(", ")}`)
      level = level === "untrusted" ? "malicious" : "untrusted"
    }

    // Check for dangerous code
    if (/\beval\s*\(|\bexec\s*\(|child_process|__proto__/i.test(content)) {
      reasons.push("dangerous code patterns")
      level = level === "safe" ? "caution" : level
    }

    // Check for external URLs (potential SSRF)
    const urls = content.match(/https?:\/\/(?!localhost|127\.0\.0\.1)/gi)
    if (urls && urls.length > 3) {
      reasons.push(`${urls.length} external URLs`)
      level = level === "safe" ? "caution" : level
    }

    return {
      ok: true,
      data: {
        trusted: level === "safe",
        classification: level,
        reasons: reasons.length > 0 ? reasons : ["no issues found"],
      },
    }
  } catch (e) {
    return { ok: false, error: "classify_failed", message: `❌ فشل التصنيف: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 9. Plugin Permission Check
// ---------------------------------------------------------------------------

export function pluginPermissionCheck(opts: {
  pluginName: string
  permission: string
  permissions: string[]
}): SecurityResult<{ allowed: boolean; reason: string }> {
  try {
    const allowed = opts.permissions.includes(opts.permission) || opts.permissions.includes("*")
    return {
      ok: true,
      data: {
        allowed,
        reason: allowed
          ? `✅ ${opts.permission} مسموح للبرنامج ${opts.pluginName}`
          : `❌ ${opts.permission} غير مسموح للبرنامج ${opts.pluginName}`,
      },
    }
  } catch (e) {
    return { ok: false, error: "plugin_perm_failed", message: `❌ فشل الفحص: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 10. MCP Permission Check (delegates to MCP OS)
// ---------------------------------------------------------------------------

export async function mcpPermissionCheck(opts: {
  serverName: string
  toolName: string
}): Promise<SecurityResult<{ permission: string; reason: string }>> {
  try {
    const { mcpGetToolPermission } = await import("@/lib/mcp/os")
    const perm = await mcpGetToolPermission(opts.serverName, opts.toolName)
    const reason = perm === "allow"
      ? `✅ ${opts.toolName} مسموح`
      : perm === "deny"
      ? `❌ ${opts.toolName} ممنوع`
      : `⚠️ ${opts.toolName} يتطلب موافقة`
    return { ok: true, data: { permission: perm, reason } }
  } catch (e) {
    return { ok: false, error: "mcp_perm_failed", message: `❌ فشل الفحص: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 11. Audit Log — hash-chained
// ---------------------------------------------------------------------------

export async function auditLog(opts: {
  action: string
  resource: string
  target: string
  principal?: Principal
  allowed: boolean
  reason?: string
}): Promise<SecurityResult<{ id: string; hash: string; prevHash: string | null }>> {
  try {
    // Get the last entry's hash
    const lastEntry = await db.auditEntry.findFirst({
      orderBy: { createdAt: "desc" },
      select: { hash: true },
    })
    const prevHash = lastEntry?.hash ?? null

    // Compute this entry's hash: SHA-256(prevHash + canonical data).
    // NOTE: deterministic canonical — no Date.now() here, otherwise auditVerify
    // (which reads createdAt back from DB) will compute a different hash and the
    // chain will always appear broken.
    const canonical = `${opts.action}|${opts.resource}|${opts.target}|${opts.principal ?? "agent"}|${opts.allowed}`
    const hash = sha256((prevHash ?? "genesis") + canonical)

    const entry = await db.auditEntry.create({
      data: {
        action: opts.action,
        resource: opts.resource,
        target: opts.target,
        principal: opts.principal ?? "agent",
        hash,
        prevHash,
        allowed: opts.allowed,
        reason: opts.reason,
      },
    })

    return { ok: true, data: { id: entry.id, hash, prevHash } }
  } catch (e) {
    return { ok: false, error: "audit_failed", message: `❌ فشل التدقيق: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 12. Audit Verify — verify hash chain integrity
// ---------------------------------------------------------------------------

export async function auditVerify(): Promise<SecurityResult<{
  verified: boolean
  totalEntries: number
  brokenAt: number | null
  brokenHash: string | null
}>> {
  try {
    const entries = await db.auditEntry.findMany({
      orderBy: { createdAt: "asc" },
    })

    if (entries.length === 0) {
      return { ok: true, data: { verified: true, totalEntries: 0, brokenAt: null, brokenHash: null } }
    }

    let prevHash: string | null = null
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      // Check prevHash linkage
      if (entry.prevHash !== prevHash) {
        return {
          ok: true,
          data: { verified: false, totalEntries: entries.length, brokenAt: i, brokenHash: entry.hash },
        }
      }
      // Recompute hash — must match auditLog's canonical exactly (no timestamp).
      const canonical = `${entry.action}|${entry.resource}|${entry.target}|${entry.principal}|${entry.allowed}`
      const expectedHash = sha256((prevHash ?? "genesis") + canonical)
      if (entry.hash !== expectedHash) {
        return {
          ok: true,
          data: { verified: false, totalEntries: entries.length, brokenAt: i, brokenHash: entry.hash },
        }
      }
      prevHash = entry.hash
    }

    return { ok: true, data: { verified: true, totalEntries: entries.length, brokenAt: null, brokenHash: null } }
  } catch (e) {
    return { ok: false, error: "verify_failed", message: `❌ فشل التحقق: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface SecuritySnapshot {
  totalAuditEntries: number
  allowCount: number
  denyCount: number
  askCount: number
  pendingApprovals: number
  permissionRules: number
  verified: boolean
}

export async function securitySnapshot(): Promise<SecurityResult<SecuritySnapshot>> {
  try {
    const entries = await db.auditEntry.findMany()
    const allowCount = entries.filter(e => e.action === "allow").length
    const denyCount = entries.filter(e => e.action === "deny").length
    const askCount = entries.filter(e => e.action === "ask").length
    const verifyRes = await auditVerify()
    return {
      ok: true,
      data: {
        totalAuditEntries: entries.length,
        allowCount,
        denyCount,
        askCount,
        pendingApprovals: approvalQueue.filter(a => a.status === "pending").length,
        permissionRules: permissionRules.length,
        verified: verifyRes.ok ? verifyRes.data.verified : false,
      },
    }
  } catch (e) {
    return { ok: false, error: "snapshot_failed", message: `❌ فشل اللقطة: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

export function formatSecurityResult<T>(result: SecurityResult<T>): string {
  if (!result.ok) return `${result.message}\n[error: ${result.error}]`
  const data = result.data as unknown
  if (data === null || data === undefined) return "✅ OK"
  if (typeof data === "string") return data
  if (typeof data === "number" || typeof data === "boolean") return String(data)
  try { return JSON.stringify(data, null, 2) } catch { return String(data) }
}
