// MCP OS — Model Context Protocol plug-and-play integration layer.
// 12 operations, deterministic, bilingual (Arabic + English), persisted to SQLite.
//
// Design:
//   • McpServer (Prisma) — server registry: name, transport, endpoint, tools, scopes, perms, health
//   • McpSecret (Prisma) — encrypted secret storage (AES-256-GCM)
//   • McpAuditLog (Prisma) — every tool call logged
//   • Wraps the existing ecosystem/mcp-client.ts for the actual JSON-RPC transport
//   • In-memory cache for hot-path reads (60s TTL)
//
// 12 operations:
//   1.  mcpDiscoverServers      — scan a directory or registry URL for .mcp.json manifests
//   2.  mcpInstallServer       — register + persist a new server from a manifest
//   3.  mcpConfigureServer      — update endpoint, headers, args, env
//   4.  mcpHealthCheck          — ping the server + record latency + status
//   5.  mcpDiscoverTools        — list tools offered by a server (cached)
//   6.  mcpSetToolPermission    — allow / deny / ask per-tool
//   7.  mcpGrantScopes          — grant capability scopes (read/write/network/shell)
//   8.  mcpSetSecret            — store an encrypted secret (apiKey, token, password)
//   9.  mcpGetSecret            — retrieve a decrypted secret (server-side only)
//   10. mcpSetRateLimit         — per-server RPM + burst policy
//   11. mcpAuditLog             — write an audit entry (called by mcpCallTool)
//   12. mcpEnableServer / mcpDisableServer — toggle server status
//
// Plus the orchestrator: mcpCallTool — runs the full pipeline:
//   enable check → permission check → rate-limit check → secret inject → call → audit → cache

import { db } from "@/lib/db"
import { callMcpTool as rawCallMcpTool, listMcpTools as rawListMcpTools } from "@/lib/ecosystem/mcp-client"
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { readFile, readdir, stat } from "node:fs/promises"
import path from "node:path"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type McpTransport = "url" | "stdio" | "sse"

export type McpServerStatus = "discovered" | "installed" | "enabled" | "disabled" | "error"

export type CapabilityScope = "read" | "write" | "network" | "shell" | "subprocess" | "filesystem"

export type ToolPermission = "allow" | "deny" | "ask"

export type AuditAction =
  | "call"
  | "permission_denied"
  | "rate_limited"
  | "discovery"
  | "health"
  | "install"
  | "enable"
  | "disable"
  | "configure"

export type AuditStatus = "success" | "error" | "denied" | "skipped"

export type AuditCaller = "agent" | "user" | "system"

export interface McpToolSchema {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface McpServerManifest {
  name: string
  description?: string
  version?: string
  transport: McpTransport
  endpoint: string
  config?: Record<string, unknown>
  tools?: McpToolSchema[]
  scopes?: CapabilityScope[]
  rateLimit?: { rpm: number; burst: number }
}

export interface McpServerRecord {
  id: string
  name: string
  transport: McpTransport
  endpoint: string
  config: Record<string, unknown>
  status: McpServerStatus
  tools: McpToolSchema[]
  scopes: CapabilityScope[]
  permissions: Record<string, ToolPermission>
  rateLimit: { rpm: number; burst: number; lastWindowStart?: string; count?: number }
  health: { lastCheckAt?: string; ok: boolean; latencyMs?: number; error?: string }
  secretRefs: Record<string, string>
  description?: string | null
  version?: string | null
  installedAt?: Date | null
  lastUsedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface McpHealthResult {
  serverName: string
  ok: boolean
  latencyMs: number
  error?: string
  checkedAt: string
  toolCount: number
}

export interface McpCallResult {
  ok: boolean
  result?: string
  error?: string
  durationMs: number
  blockedReason?: "permission_denied" | "rate_limited" | "server_disabled" | "server_not_found"
  audited: boolean
}

export type McpOSResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string }

// ---------------------------------------------------------------------------
// Row → record mapper
// ---------------------------------------------------------------------------

interface McpServerRow {
  id: string
  name: string
  transport: string
  endpoint: string
  config: string
  status: string
  tools: string
  scopes: string
  permissions: string
  rateLimit: string
  health: string
  secretRefs: string
  description: string | null
  version: string | null
  installedAt: Date | null
  lastUsedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

function rowToRecord(row: McpServerRow): McpServerRecord {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport as McpTransport,
    endpoint: row.endpoint,
    config: safeParse(row.config, {}),
    status: row.status as McpServerStatus,
    tools: safeParse(row.tools, []),
    scopes: safeParse(row.scopes, []),
    permissions: safeParse(row.permissions, {}),
    rateLimit: safeParse(row.rateLimit, { rpm: 60, burst: 10 }),
    health: safeParse(row.health, { ok: false }),
    secretRefs: safeParse(row.secretRefs, {}),
    description: row.description,
    version: row.version,
    installedAt: row.installedAt,
    lastUsedAt: row.lastUsedAt,
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

// ---------------------------------------------------------------------------
// In-memory cache (60s TTL)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000
const cache = new Map<string, { data: unknown; expiresAt: number }>()

function cacheGet<T>(key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }
  return entry.data as T
}

function cacheSet<T>(key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS })
}

function cacheInvalidate(prefix: string): void {
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}

export function mcpClearCache(): number {
  const n = cache.size
  cache.clear()
  return n
}

// ---------------------------------------------------------------------------
// Secret encryption (AES-256-GCM)
// ---------------------------------------------------------------------------

function getSecretKey(): Buffer {
  const envKey = process.env.MCP_SECRET_KEY
  if (envKey && envKey.length >= 32) {
    return createHash("sha256").update(envKey).digest()
  }
  // Fallback: a per-workspace derived key (NOT secure for production — set MCP_SECRET_KEY).
  const fallback = "mimo-x-mcp-fallback-key-do-not-use-in-prod"
  return createHash("sha256").update(fallback).digest()
}

interface EncryptedValue {
  iv: string
  tag: string
  ciphertext: string
}

function encryptSecret(plaintext: string): EncryptedValue {
  const key = getSecretKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
  }
}

function decryptSecret(enc: EncryptedValue): string {
  const key = getSecretKey()
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(enc.iv, "hex"))
  decipher.setAuthTag(Buffer.from(enc.tag, "hex"))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(enc.ciphertext, "hex")),
    decipher.final(),
  ])
  return plaintext.toString("utf8")
}

// ---------------------------------------------------------------------------
// Audit log writer
// ---------------------------------------------------------------------------

interface AuditEntry {
  serverName: string
  toolName: string
  action: AuditAction
  status: AuditStatus
  args?: Record<string, unknown>
  result?: string
  durationMs?: number
  caller?: AuditCaller
  error?: string
}

async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.mcpAuditLog.create({
      data: {
        serverName: entry.serverName,
        toolName: entry.toolName,
        action: entry.action,
        status: entry.status,
        args: JSON.stringify(entry.args ?? {}).slice(0, 2000),
        result: entry.result?.slice(0, 2000),
        durationMs: entry.durationMs ?? 0,
        caller: entry.caller ?? "agent",
        error: entry.error?.slice(0, 1000),
      },
    })
  } catch {
    // best-effort — never let audit failure break the call
  }
}

// ---------------------------------------------------------------------------
// 1. Server Discovery — scan a directory for .mcp.json manifests,
//    or fetch a registry URL that returns an array of manifests.
// ---------------------------------------------------------------------------

export async function mcpDiscoverServers(
  source: string
): Promise<McpOSResult<{ found: McpServerManifest[]; source: string }>> {
  try {
    const manifests: McpServerManifest[] = []

    // URL source: fetch JSON array of manifests.
    if (/^https?:\/\//i.test(source)) {
      const res = await fetch(source, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) {
        return { ok: false, error: "fetch_failed", message: `❌ فشل الجلب / fetch failed: HTTP ${res.status}` }
      }
      const data = (await res.json()) as McpServerManifest[]
      if (!Array.isArray(data)) {
        return { ok: false, error: "bad_format", message: "❌ التنسيق غير صالح / invalid format (expected array)" }
      }
      manifests.push(...data)
    } else {
      // Directory source: scan for *.mcp.json files.
      const dir = path.isAbsolute(source) ? source : path.resolve(WORKSPACE_ROOT, source)
      const st = await stat(dir).catch(() => null)
      if (!st || !st.isDirectory()) {
        return { ok: false, error: "not_dir", message: `❌ ليس مجلداً / not a directory: ${source}` }
      }
      const entries = await readdir(dir)
      for (const ent of entries) {
        if (!ent.endsWith(".mcp.json") && ent !== "mcp.json") continue
        const full = path.join(dir, ent)
        try {
          const raw = await readFile(full, "utf-8")
          const manifest = JSON.parse(raw) as McpServerManifest
          if (!manifest.name || !manifest.endpoint) continue
          manifests.push(manifest)
        } catch {
          /* skip bad manifest */
        }
      }
    }

    // Persist each as "discovered" (idempotent — skip if already exists).
    let added = 0
    for (const m of manifests) {
      const existing = await db.mcpServer.findUnique({ where: { name: m.name } })
      if (existing) continue
      await db.mcpServer.create({
        data: {
          name: m.name,
          transport: m.transport ?? "url",
          endpoint: m.endpoint,
          config: JSON.stringify(m.config ?? {}),
          status: "discovered",
          tools: JSON.stringify(m.tools ?? []),
          scopes: JSON.stringify(m.scopes ?? []),
          description: m.description,
          version: m.version,
        },
      })
      added++
      await writeAudit({
        serverName: m.name,
        toolName: "(server)",
        action: "discovery",
        status: "success",
        caller: "system",
        args: { endpoint: m.endpoint, transport: m.transport },
      })
    }

    cacheInvalidate("servers:")
    return { ok: true, data: { found: manifests, source } }
  } catch (e) {
    return {
      ok: false,
      error: "discovery_failed",
      message: `❌ فشل الاكتشاف / discovery failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Server Installation — register a new server from a manifest
// ---------------------------------------------------------------------------

export async function mcpInstallServer(
  manifest: McpServerManifest
): Promise<McpOSResult<McpServerRecord>> {
  try {
    if (!manifest.name || !manifest.endpoint) {
      return { ok: false, error: "bad_manifest", message: "❌ البيان غير مكتمل / incomplete manifest (name + endpoint required)" }
    }
    const row = await db.mcpServer.upsert({
      where: { name: manifest.name },
      update: {
        transport: manifest.transport ?? "url",
        endpoint: manifest.endpoint,
        config: JSON.stringify(manifest.config ?? {}),
        description: manifest.description,
        version: manifest.version,
        scopes: JSON.stringify(manifest.scopes ?? []),
        status: "installed",
        installedAt: new Date(),
      },
      create: {
        name: manifest.name,
        transport: manifest.transport ?? "url",
        endpoint: manifest.endpoint,
        config: JSON.stringify(manifest.config ?? {}),
        description: manifest.description,
        version: manifest.version,
        scopes: JSON.stringify(manifest.scopes ?? []),
        tools: JSON.stringify(manifest.tools ?? []),
        status: "installed",
        installedAt: new Date(),
      },
    })
    await writeAudit({
      serverName: manifest.name,
      toolName: "(server)",
      action: "install",
      status: "success",
      caller: "user",
      args: { endpoint: manifest.endpoint, transport: manifest.transport },
    })
    cacheInvalidate("servers:")
    return { ok: true, data: rowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "install_failed",
      message: `❌ فشل التثبيت / install failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Server Configuration — update endpoint, headers, args, env
// ---------------------------------------------------------------------------

export interface ConfigurePatch {
  endpoint?: string
  transport?: McpTransport
  config?: Record<string, unknown>
  description?: string
  version?: string
}

export async function mcpConfigureServer(
  name: string,
  patch: ConfigurePatch
): Promise<McpOSResult<McpServerRecord>> {
  try {
    const existing = await db.mcpServer.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الخادم غير موجود / server not found: ${name}` }
    }
    const data: Record<string, unknown> = {}
    if (patch.endpoint !== undefined) data.endpoint = patch.endpoint
    if (patch.transport !== undefined) data.transport = patch.transport
    if (patch.config !== undefined) data.config = JSON.stringify(patch.config)
    if (patch.description !== undefined) data.description = patch.description
    if (patch.version !== undefined) data.version = patch.version
    const row = await db.mcpServer.update({ where: { name }, data })
    await writeAudit({
      serverName: name,
      toolName: "(server)",
      action: "configure",
      status: "success",
      caller: "user",
      args: patch as Record<string, unknown>,
    })
    cacheInvalidate("servers:")
    cacheInvalidate(`server:${name}:`)
    return { ok: true, data: rowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "configure_failed",
      message: `❌ فشل التهيئة / configure failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Health Check — ping the server + record latency + status
// ---------------------------------------------------------------------------

export async function mcpHealthCheck(name: string): Promise<McpOSResult<McpHealthResult>> {
  const start = Date.now()
  try {
    const existing = await db.mcpServer.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الخادم غير موجود / server not found: ${name}` }
    }
    let ok = false
    let error: string | undefined
    let toolCount = 0
    try {
      // Issue a lightweight initialize ping to verify reachability.
      const probe = await fetch(existing.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "mimo-x", version: "1.0.0" },
          },
        }),
        signal: AbortSignal.timeout(8000),
      })
      if (!probe.ok) {
        error = `HTTP ${probe.status}`
        ok = false
      } else {
        ok = true
        // Best-effort: list tools for the count.
        const tools = await rawListMcpTools(existing.endpoint)
        toolCount = Array.isArray(tools) ? tools.length : 0
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      ok = false
    }
    const latencyMs = Date.now() - start
    const health = {
      lastCheckAt: new Date().toISOString(),
      ok,
      latencyMs,
      error,
    }
    await db.mcpServer.update({
      where: { name },
      data: {
        health: JSON.stringify(health),
        status: ok ? "enabled" : "error",
      },
    })
    await writeAudit({
      serverName: name,
      toolName: "(server)",
      action: "health",
      status: ok ? "success" : "error",
      caller: "system",
      durationMs: latencyMs,
      error,
    })
    cacheInvalidate(`server:${name}:`)
    return {
      ok: true,
      data: { serverName: name, ok, latencyMs, error, checkedAt: health.lastCheckAt, toolCount },
    }
  } catch (e) {
    return {
      ok: false,
      error: "health_check_failed",
      message: `❌ فشل فحص الصحة / health check failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Tool Discovery — list tools offered by a server (cached)
// ---------------------------------------------------------------------------

export async function mcpDiscoverTools(
  name: string,
  opts: { refresh?: boolean } = {}
): Promise<McpOSResult<{ tools: McpToolSchema[]; total: number; cached: boolean }>> {
  try {
    if (!opts.refresh) {
      const cached = cacheGet<McpToolSchema[]>(`server:${name}:tools`)
      if (cached) {
        return { ok: true, data: { tools: cached, total: cached.length, cached: true } }
      }
    }
    const existing = await db.mcpServer.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الخادم غير موجود / server not found: ${name}` }
    }
    let tools: McpToolSchema[] = []
    try {
      // rawListMcpTools never throws — it returns [] on failure.
      const raw = await rawListMcpTools(existing.endpoint)
      tools = Array.isArray(raw) ? (raw as McpToolSchema[]) : []
      if (tools.length === 0) {
        // Fall back to stored tools if the server returned nothing.
        tools = safeParse<McpToolSchema[]>(existing.tools, [])
        if (tools.length === 0) {
          return {
            ok: false,
            error: "tools_unreachable",
            message: `❌ تعذر جلب الأدوات / cannot fetch tools (server returned no tools and none cached)`,
          }
        }
      }
    } catch (e) {
      // Fall back to stored tools if the server is unreachable.
      tools = safeParse<McpToolSchema[]>(existing.tools, [])
      if (tools.length === 0) {
        return {
          ok: false,
          error: "tools_unreachable",
          message: `❌ تعذر جلب الأدوات / cannot fetch tools: ${e instanceof Error ? e.message : String(e)}`,
        }
      }
    }
    await db.mcpServer.update({
      where: { name },
      data: { tools: JSON.stringify(tools) },
    })
    cacheSet(`server:${name}:tools`, tools)
    await writeAudit({
      serverName: name,
      toolName: "(server)",
      action: "discovery",
      status: "success",
      caller: "system",
      args: { toolCount: tools.length },
    })
    return { ok: true, data: { tools, total: tools.length, cached: false } }
  } catch (e) {
    return {
      ok: false,
      error: "tool_discovery_failed",
      message: `❌ فشل اكتشاف الأدوات / tool discovery failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Tool Permissions — allow / deny / ask per-tool
// ---------------------------------------------------------------------------

export async function mcpSetToolPermission(
  serverName: string,
  toolName: string,
  permission: ToolPermission
): Promise<McpOSResult<{ serverName: string; toolName: string; permission: ToolPermission }>> {
  try {
    const existing = await db.mcpServer.findUnique({ where: { name: serverName } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الخادم غير موجود / server not found: ${serverName}` }
    }
    const perms = safeParse<Record<string, ToolPermission>>(existing.permissions, {})
    perms[toolName] = permission
    await db.mcpServer.update({
      where: { name: serverName },
      data: { permissions: JSON.stringify(perms) },
    })
    cacheInvalidate(`server:${serverName}:`)
    await writeAudit({
      serverName,
      toolName,
      action: "configure",
      status: "success",
      caller: "user",
      args: { permission },
    })
    return { ok: true, data: { serverName, toolName, permission } }
  } catch (e) {
    return {
      ok: false,
      error: "permission_set_failed",
      message: `❌ فشل ضبط الإذن / permission set failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function mcpGetToolPermission(
  serverName: string,
  toolName: string
): Promise<ToolPermission> {
  const existing = await db.mcpServer.findUnique({ where: { name: serverName } })
  if (!existing) return "ask"
  const perms = safeParse<Record<string, ToolPermission>>(existing.permissions, {})
  return perms[toolName] ?? "ask"
}

// ---------------------------------------------------------------------------
// 7. Capability Scopes — grant scopes to a server
// ---------------------------------------------------------------------------

const VALID_SCOPES: CapabilityScope[] = ["read", "write", "network", "shell", "subprocess", "filesystem"]

export async function mcpGrantScopes(
  serverName: string,
  scopes: CapabilityScope[]
): Promise<McpOSResult<{ serverName: string; scopes: CapabilityScope[] }>> {
  try {
    const existing = await db.mcpServer.findUnique({ where: { name: serverName } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الخادم غير موجود / server not found: ${serverName}` }
    }
    const invalid = scopes.filter((s) => !VALID_SCOPES.includes(s))
    if (invalid.length > 0) {
      return {
        ok: false,
        error: "bad_scope",
        message: `❌ نطاقات غير صالحة / invalid scopes: ${invalid.join(", ")}. Valid: ${VALID_SCOPES.join(", ")}`,
      }
    }
    const existingScopes = safeParse<CapabilityScope[]>(existing.scopes, [])
    const merged = Array.from(new Set([...existingScopes, ...scopes]))
    await db.mcpServer.update({
      where: { name: serverName },
      data: { scopes: JSON.stringify(merged) },
    })
    cacheInvalidate(`server:${serverName}:`)
    await writeAudit({
      serverName,
      toolName: "(server)",
      action: "configure",
      status: "success",
      caller: "user",
      args: { granted: scopes, total: merged },
    })
    return { ok: true, data: { serverName, scopes: merged } }
  } catch (e) {
    return {
      ok: false,
      error: "scope_grant_failed",
      message: `❌ فشل منح النطاقات / scope grant failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function mcpRevokeScopes(
  serverName: string,
  scopes: CapabilityScope[]
): Promise<McpOSResult<{ serverName: string; scopes: CapabilityScope[] }>> {
  try {
    const existing = await db.mcpServer.findUnique({ where: { name: serverName } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الخادم غير موجود / server not found: ${serverName}` }
    }
    const current = safeParse<CapabilityScope[]>(existing.scopes, [])
    const next = current.filter((s) => !scopes.includes(s))
    await db.mcpServer.update({
      where: { name: serverName },
      data: { scopes: JSON.stringify(next) },
    })
    cacheInvalidate(`server:${serverName}:`)
    return { ok: true, data: { serverName, scopes: next } }
  } catch (e) {
    return {
      ok: false,
      error: "scope_revoke_failed",
      message: `❌ فشل سحب النطاقات / scope revoke failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 8 & 9. Secret Management — store + retrieve encrypted secrets
// ---------------------------------------------------------------------------

export async function mcpSetSecret(
  serverName: string,
  secretName: string,
  plaintextValue: string
): Promise<McpOSResult<{ serverName: string; secretName: string; secretId: string }>> {
  try {
    const existing = await db.mcpServer.findUnique({ where: { name: serverName } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الخادم غير موجود / server not found: ${serverName}` }
    }
    const enc = encryptSecret(plaintextValue)
    const existingSecret = await db.mcpSecret.findFirst({
      where: { name: secretName, serverId: existing.id },
    })
    let secretId: string
    if (existingSecret) {
      await db.mcpSecret.update({
        where: { id: existingSecret.id },
        data: { value: JSON.stringify(enc) },
      })
      secretId = existingSecret.id
    } else {
      const created = await db.mcpSecret.create({
        data: { name: secretName, value: JSON.stringify(enc), serverId: existing.id },
      })
      secretId = created.id
    }
    const secretRefs = safeParse<Record<string, string>>(existing.secretRefs, {})
    secretRefs[secretName] = secretId
    await db.mcpServer.update({
      where: { name: serverName },
      data: { secretRefs: JSON.stringify(secretRefs) },
    })
    await writeAudit({
      serverName,
      toolName: "(secret)",
      action: "configure",
      status: "success",
      caller: "user",
      args: { secretName },
    })
    return { ok: true, data: { serverName, secretName, secretId } }
  } catch (e) {
    return {
      ok: false,
      error: "secret_set_failed",
      message: `❌ فشل حفظ السرّ / secret set failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function mcpGetSecret(
  serverName: string,
  secretName: string
): Promise<McpOSResult<{ serverName: string; secretName: string; value: string }>> {
  try {
    const existing = await db.mcpServer.findUnique({ where: { name: serverName } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الخادم غير موجود / server not found: ${serverName}` }
    }
    const secretRefs = safeParse<Record<string, string>>(existing.secretRefs, {})
    const secretId = secretRefs[secretName]
    if (!secretId) {
      return { ok: false, error: "secret_not_found", message: `❌ السرّ غير موجود / secret not found: ${secretName}` }
    }
    const secret = await db.mcpSecret.findUnique({ where: { id: secretId } })
    if (!secret) {
      return { ok: false, error: "secret_not_found", message: `❌ السرّ محذوف / secret deleted` }
    }
    const enc = JSON.parse(secret.value) as EncryptedValue
    const value = decryptSecret(enc)
    await writeAudit({
      serverName,
      toolName: "(secret)",
      action: "call",
      status: "success",
      caller: "system",
      args: { secretName, action: "read" },
    })
    return { ok: true, data: { serverName, secretName, value } }
  } catch (e) {
    return {
      ok: false,
      error: "secret_get_failed",
      message: `❌ فشل قراءة السرّ / secret get failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function mcpDeleteSecret(
  serverName: string,
  secretName: string
): Promise<McpOSResult<{ deleted: boolean }>> {
  try {
    const existing = await db.mcpServer.findUnique({ where: { name: serverName } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الخادم غير موجود / server not found: ${serverName}` }
    }
    const secretRefs = safeParse<Record<string, string>>(existing.secretRefs, {})
    const secretId = secretRefs[secretName]
    if (!secretId) {
      return { ok: false, error: "secret_not_found", message: `❌ السرّ غير موجود / secret not found: ${secretName}` }
    }
    await db.mcpSecret.delete({ where: { id: secretId } }).catch(() => {})
    delete secretRefs[secretName]
    await db.mcpServer.update({
      where: { name: serverName },
      data: { secretRefs: JSON.stringify(secretRefs) },
    })
    return { ok: true, data: { deleted: true } }
  } catch (e) {
    return {
      ok: false,
      error: "secret_delete_failed",
      message: `❌ فشل حذف السرّ / secret delete failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 10. Rate Limiting — per-server RPM + burst policy
// ---------------------------------------------------------------------------

export interface RateLimitPolicy {
  rpm: number
  burst: number
}

interface StoredRateLimit extends RateLimitPolicy {
  lastWindowStart?: string
  count?: number
}

export async function mcpSetRateLimit(
  serverName: string,
  policy: RateLimitPolicy
): Promise<McpOSResult<{ serverName: string; policy: RateLimitPolicy }>> {
  try {
    const existing = await db.mcpServer.findUnique({ where: { name: serverName } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الخادم غير موجود / server not found: ${serverName}` }
    }
    const rl = safeParse<StoredRateLimit>(existing.rateLimit, { rpm: 60, burst: 10 })
    await db.mcpServer.update({
      where: { name: serverName },
      data: {
        rateLimit: JSON.stringify({
          rpm: policy.rpm,
          burst: policy.burst,
          lastWindowStart: rl.lastWindowStart,
          count: rl.count,
        } as StoredRateLimit),
      },
    })
    cacheInvalidate(`server:${serverName}:`)
    return { ok: true, data: { serverName, policy } }
  } catch (e) {
    return {
      ok: false,
      error: "rate_limit_set_failed",
      message: `❌ فشل ضبط حد المعدل / rate limit set failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

/**
 * Check if a call is allowed under the rate-limit policy.
 * Mutates the in-DB counter. Returns true if allowed.
 */
async function checkRateLimit(
  serverName: string
): Promise<{ allowed: boolean; remaining: number; reason?: string }> {
  const existing = await db.mcpServer.findUnique({ where: { name: serverName } })
  if (!existing) return { allowed: false, remaining: 0, reason: "server_not_found" }
  const rl = safeParse<StoredRateLimit>(existing.rateLimit, { rpm: 60, burst: 10 })
  const now = Date.now()
  const windowStart = rl.lastWindowStart ? new Date(rl.lastWindowStart).getTime() : now
  const elapsedMs = now - windowStart
  // Reset window every 60 seconds.
  if (elapsedMs >= 60_000) {
    rl.lastWindowStart = new Date(now).toISOString()
    rl.count = 1
  } else {
    rl.count = (rl.count ?? 0) + 1
    if (rl.count > rl.rpm) {
      return { allowed: false, remaining: 0, reason: "rate_limited" }
    }
  }
  await db.mcpServer.update({
    where: { name: serverName },
    data: { rateLimit: JSON.stringify(rl) },
  })
  return { allowed: true, remaining: Math.max(0, rl.rpm - (rl.count ?? 0)) }
}

// ---------------------------------------------------------------------------
// 11. Audit Log — write entries + query recent
// ---------------------------------------------------------------------------

export async function mcpAuditLog(
  entry: AuditEntry
): Promise<McpOSResult<{ logged: boolean }>> {
  try {
    await writeAudit(entry)
    return { ok: true, data: { logged: true } }
  } catch (e) {
    return {
      ok: false,
      error: "audit_log_failed",
      message: `❌ فشل تسجيل التدقيق / audit log failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export interface AuditQueryOpts {
  serverName?: string
  toolName?: string
  status?: AuditStatus
  action?: AuditAction
  since?: Date
  limit?: number
}

export interface AuditLogRow {
  id: string
  serverName: string
  toolName: string
  action: string
  status: string
  args: Record<string, unknown>
  result?: string | null
  durationMs: number
  caller: string
  error?: string | null
  createdAt: Date
}

export async function mcpQueryAuditLog(
  opts: AuditQueryOpts = {}
): Promise<McpOSResult<AuditLogRow[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.serverName) where.serverName = opts.serverName
    if (opts.toolName) where.toolName = opts.toolName
    if (opts.status) where.status = opts.status
    if (opts.action) where.action = opts.action
    if (opts.since) where.createdAt = { gte: opts.since }
    const rows = await db.mcpAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 100,
    })
    return {
      ok: true,
      data: rows.map((r) => ({
        ...r,
        args: safeParse(r.args, {}),
      })),
    }
  } catch (e) {
    return {
      ok: false,
      error: "audit_query_failed",
      message: `❌ فشل استعلام التدقيق / audit query failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 12. Enable / Disable Server
// ---------------------------------------------------------------------------

export async function mcpEnableServer(name: string): Promise<McpOSResult<McpServerRecord>> {
  try {
    const existing = await db.mcpServer.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الخادم غير موجود / server not found: ${name}` }
    }
    const row = await db.mcpServer.update({
      where: { name },
      data: { status: "enabled" },
    })
    await writeAudit({
      serverName: name,
      toolName: "(server)",
      action: "enable",
      status: "success",
      caller: "user",
    })
    cacheInvalidate("servers:")
    cacheInvalidate(`server:${name}:`)
    return { ok: true, data: rowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "enable_failed",
      message: `❌ فشل التفعيل / enable failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function mcpDisableServer(name: string): Promise<McpOSResult<McpServerRecord>> {
  try {
    const existing = await db.mcpServer.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الخادم غير موجود / server not found: ${name}` }
    }
    const row = await db.mcpServer.update({
      where: { name },
      data: { status: "disabled" },
    })
    await writeAudit({
      serverName: name,
      toolName: "(server)",
      action: "disable",
      status: "success",
      caller: "user",
    })
    cacheInvalidate("servers:")
    cacheInvalidate(`server:${name}:`)
    return { ok: true, data: rowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "disable_failed",
      message: `❌ فشل التعطيل / disable failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Listing + getters
// ---------------------------------------------------------------------------

export async function mcpListServers(): Promise<McpOSResult<McpServerRecord[]>> {
  try {
    const cached = cacheGet<McpServerRecord[]>("servers:list")
    if (cached) return { ok: true, data: cached }
    const rows = await db.mcpServer.findMany({ orderBy: { createdAt: "desc" } })
    const records = rows.map(rowToRecord)
    cacheSet("servers:list", records)
    return { ok: true, data: records }
  } catch (e) {
    return {
      ok: false,
      error: "list_failed",
      message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function mcpGetServer(name: string): Promise<McpOSResult<McpServerRecord>> {
  try {
    const cached = cacheGet<McpServerRecord>(`server:${name}:record`)
    if (cached) return { ok: true, data: cached }
    const row = await db.mcpServer.findUnique({ where: { name } })
    if (!row) {
      return { ok: false, error: "not_found", message: `❌ الخادم غير موجود / server not found: ${name}` }
    }
    const record = rowToRecord(row)
    cacheSet(`server:${name}:record`, record)
    return { ok: true, data: record }
  } catch (e) {
    return {
      ok: false,
      error: "get_failed",
      message: `❌ فشل الجلب / get failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function mcpUninstallServer(name: string): Promise<McpOSResult<{ deleted: boolean }>> {
  try {
    const existing = await db.mcpServer.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ الخادم غير موجود / server not found: ${name}` }
    }
    await db.mcpSecret.deleteMany({ where: { serverId: existing.id } })
    await db.mcpServer.delete({ where: { name } })
    cacheInvalidate("servers:")
    cacheInvalidate(`server:${name}:`)
    await writeAudit({
      serverName: name,
      toolName: "(server)",
      action: "disable",
      status: "success",
      caller: "user",
      args: { uninstalled: true },
    })
    return { ok: true, data: { deleted: true } }
  } catch (e) {
    return {
      ok: false,
      error: "uninstall_failed",
      message: `❌ فشل الإزالة / uninstall failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Orchestrator — mcpCallTool: runs the full pipeline
//   enable check → permission check → rate-limit check → secret inject → call → audit → cache
// ---------------------------------------------------------------------------

export interface McpCallOpts {
  serverName: string
  toolName: string
  args?: Record<string, unknown>
  caller?: AuditCaller
  /** Override the permission check (e.g. user explicitly approved). */
  approved?: boolean
}

export async function mcpCallTool(opts: McpCallOpts): Promise<McpCallResult> {
  const start = Date.now()
  try {
    // 1. Fetch the server.
    const serverRes = await mcpGetServer(opts.serverName)
    if (!serverRes.ok) {
      await writeAudit({
        serverName: opts.serverName,
        toolName: opts.toolName,
        action: "call",
        status: "error",
        caller: opts.caller ?? "agent",
        args: opts.args,
        error: "server_not_found",
        durationMs: Date.now() - start,
      })
      return { ok: false, error: "server_not_found", durationMs: Date.now() - start, blockedReason: "server_not_found", audited: true }
    }
    const server = serverRes.data

    // 2. Check enabled.
    if (server.status === "disabled") {
      await writeAudit({
        serverName: opts.serverName,
        toolName: opts.toolName,
        action: "call",
        status: "skipped",
        caller: opts.caller ?? "agent",
        args: opts.args,
        error: "server_disabled",
        durationMs: Date.now() - start,
      })
      return { ok: false, error: "server_disabled", durationMs: Date.now() - start, blockedReason: "server_disabled", audited: true }
    }

    // 3. Check permission.
    const perm = await mcpGetToolPermission(opts.serverName, opts.toolName)
    if (perm === "deny") {
      await writeAudit({
        serverName: opts.serverName,
        toolName: opts.toolName,
        action: "permission_denied",
        status: "denied",
        caller: opts.caller ?? "agent",
        args: opts.args,
        durationMs: Date.now() - start,
      })
      return { ok: false, error: "permission_denied", durationMs: Date.now() - start, blockedReason: "permission_denied", audited: true }
    }
    if (perm === "ask" && !opts.approved) {
      await writeAudit({
        serverName: opts.serverName,
        toolName: opts.toolName,
        action: "call",
        status: "skipped",
        caller: opts.caller ?? "agent",
        args: opts.args,
        error: "needs_approval",
        durationMs: Date.now() - start,
      })
      return { ok: false, error: "needs_approval", durationMs: Date.now() - start, audited: true }
    }

    // 4. Check rate limit.
    const rl = await checkRateLimit(opts.serverName)
    if (!rl.allowed) {
      await writeAudit({
        serverName: opts.serverName,
        toolName: opts.toolName,
        action: "rate_limited",
        status: "skipped",
        caller: opts.caller ?? "agent",
        args: opts.args,
        durationMs: Date.now() - start,
      })
      return { ok: false, error: "rate_limited", durationMs: Date.now() - start, blockedReason: "rate_limited", audited: true }
    }

    // 5. Inject secrets into args (replace ${secret:NAME} placeholders).
    const finalArgs = { ...(opts.args ?? {}) }
    for (const [k, v] of Object.entries(finalArgs)) {
      if (typeof v === "string" && v.startsWith("${secret:") && v.endsWith("}")) {
        const secretName = v.slice("${secret:".length, -1)
        const secretRes = await mcpGetSecret(opts.serverName, secretName)
        if (secretRes.ok) {
          finalArgs[k] = secretRes.data.value
        }
      }
    }

    // 6. Call the actual MCP server via the existing transport.
    // rawCallMcpTool signature: (serverUrl, toolName, args) → { ok, result, isError? }
    const callResult = await rawCallMcpTool(server.endpoint, opts.toolName, finalArgs)

    const durationMs = Date.now() - start

    // 7. Update lastUsedAt.
    await db.mcpServer.update({
      where: { name: opts.serverName },
      data: { lastUsedAt: new Date() },
    })

    // 8. Audit the call.
    if (callResult.ok) {
      await writeAudit({
        serverName: opts.serverName,
        toolName: opts.toolName,
        action: "call",
        status: "success",
        caller: opts.caller ?? "agent",
        args: finalArgs,
        result: callResult.result,
        durationMs,
      })
      return { ok: true, result: callResult.result, durationMs, audited: true }
    } else {
      await writeAudit({
        serverName: opts.serverName,
        toolName: opts.toolName,
        action: "call",
        status: "error",
        caller: opts.caller ?? "agent",
        args: finalArgs,
        error: callResult.result || "call_failed",
        durationMs,
      })
      return { ok: false, error: callResult.result || "call_failed", durationMs, audited: true }
    }
  } catch (e) {
    const durationMs = Date.now() - start
    const error = e instanceof Error ? e.message : String(e)
    await writeAudit({
      serverName: opts.serverName,
      toolName: opts.toolName,
      action: "call",
      status: "error",
      caller: opts.caller ?? "agent",
      args: opts.args,
      error,
      durationMs,
    })
    return { ok: false, error, durationMs, audited: true }
  }
}

// ---------------------------------------------------------------------------
// Formatter — turn any McpOSResult into a bilingual string for the agent.
// ---------------------------------------------------------------------------

export function formatMcpResult<T>(result: McpOSResult<T> | McpCallResult): string {
  // McpCallResult has the "audited" field; McpOSResult does not.
  const isCallResult = (r: unknown): r is McpCallResult =>
    typeof r === "object" && r !== null && "audited" in r

  if (isCallResult(result)) {
    if (result.ok) {
      return `✅ نجح استدعاء MCP (${result.durationMs}ms)\n${result.result ?? ""}`
    }
    const reason = result.blockedReason ? ` [${result.blockedReason}]` : ""
    return `❌ فشل استدعاء MCP${reason} (${result.durationMs}ms)\n${result.error ?? ""}`
  }

  const r = result as McpOSResult<T>
  if (!r.ok) {
    return `${r.message}\n[error: ${r.error}]`
  }
  const data = r.data as unknown
  if (data === null || data === undefined) return "✅ OK"
  if (typeof data === "string") return data
  if (typeof data === "number" || typeof data === "boolean") return String(data)
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

// ---------------------------------------------------------------------------
// Snapshot — for observability: returns the whole MCP OS state in one call.
// ---------------------------------------------------------------------------

export interface McpSnapshot {
  servers: McpServerRecord[]
  totalTools: number
  enabledCount: number
  disabledCount: number
  errorCount: number
  totalCalls: number
  deniedCalls: number
  recentErrors: Array<{ serverName: string; toolName: string; error: string; createdAt: Date }>
}

export async function mcpSnapshot(): Promise<McpOSResult<McpSnapshot>> {
  try {
    const serversRes = await mcpListServers()
    const servers = serversRes.ok ? serversRes.data : []
    const enabledCount = servers.filter((s) => s.status === "enabled").length
    const disabledCount = servers.filter((s) => s.status === "disabled").length
    const errorCount = servers.filter((s) => s.status === "error").length
    const totalTools = servers.reduce((sum, s) => sum + s.tools.length, 0)
    const auditRes = await mcpQueryAuditLog({ limit: 1000 })
    const audit = auditRes.ok ? auditRes.data : []
    const totalCalls = audit.filter((a) => a.action === "call").length
    const deniedCalls = audit.filter((a) => a.action === "permission_denied").length
    const recentErrors = audit
      .filter((a) => a.status === "error" && a.error)
      .slice(0, 10)
      .map((a) => ({
        serverName: a.serverName,
        toolName: a.toolName,
        error: a.error ?? "",
        createdAt: a.createdAt,
      }))
    return {
      ok: true,
      data: {
        servers,
        totalTools,
        enabledCount,
        disabledCount,
        errorCount,
        totalCalls,
        deniedCalls,
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
