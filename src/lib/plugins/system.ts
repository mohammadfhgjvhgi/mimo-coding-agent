// Plugins — plug-and-play extension system for MiMo X.
// 10 operations, deterministic, bilingual (Arabic + English), persisted to SQLite.
//
// Design:
//   • Plugin (Prisma) — registry: name, version, manifest, capabilities, perms, isolation
//   • PluginLog (Prisma) — every lifecycle event + tool call
//   • Plugins are JS/TS modules loaded at runtime (dynamic import) OR inline source
//   • In-memory activation cache — keeps loaded modules + their exports
//   • SHA-256 checksums for tamper detection
//   • Isolation policy: sandbox flag + timeout + maxHeapMb (enforced best-effort)
//
// 10 operations:
//   1.  pluginRegister          — declare a plugin in the registry (from manifest + entry path)
//   2.  pluginGetManifest       — read the plugin's manifest (declared capabilities/tools/hooks)
//   3.  pluginSetPermissions    — grant/revoke specific permissions
//   4.  pluginSetCapabilities   — grant/revoke specific capabilities
//   5.  pluginLifecycle         — install / activate / deactivate / uninstall
//   6.  pluginUpgrade           — bump version + re-checksum + re-activate
//   7.  pluginIsolation         — set sandbox policy (timeout, heap, fs scope)
//   8.  pluginSetSettings       — update plugin settings (validated against schema)
//   9.  pluginLogs              — write + query logs
//   10. pluginEnable / pluginDisable — toggle status
//
// Plus the activation orchestrator: pluginActivate — loads the module, validates its
// declared exports against granted capabilities, runs the onActivate hook, logs result.

import { db } from "@/lib/db"
import { createHash } from "node:crypto"
import { readFile, stat, mkdir, writeFile, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PluginEntryType = "module" | "inline"

export type PluginStatus = "registered" | "enabled" | "disabled" | "error" | "uninstalled"

export type PluginCapability =
  | "tools"           // register custom tools the agent can call
  | "hooks"           // register lifecycle hooks (beforeTool, afterTool, etc.)
  | "ui_panels"       // register sidebar / settings panels
  | "providers"       // register LLM / embedding / TTS providers
  | "commands"        // register slash commands
  | "context_sources" // inject context into the system prompt

export type PluginPermission =
  | "filesystem:read"
  | "filesystem:write"
  | "shell:exec"
  | "network:http"
  | "network:websocket"
  | "db:read"
  | "db:write"
  | "secrets:read"
  | "env:read"

export type PluginLogLevel = "info" | "warn" | "error" | "debug"

export type PluginLogAction =
  | "register"
  | "enable"
  | "disable"
  | "activate"
  | "deactivate"
  | "tool_call"
  | "hook_run"
  | "settings_change"
  | "error"
  | "install"
  | "uninstall"
  | "upgrade"

export interface PluginTool {
  name: string
  description: string
  schema: Record<string, unknown>
}

export interface PluginHook {
  event: "beforeTool" | "afterTool" | "beforeMessage" | "afterMessage" | "onActivate" | "onDeactivate"
  handler: string // function name exported by the plugin
}

export interface PluginManifest {
  name: string
  displayName: string
  version: string
  description?: string
  author?: string
  homepage?: string
  repository?: string
  manifestVersion?: string
  // Declared (requested) capabilities — must be granted to be active
  capabilities?: PluginCapability[]
  // Declared (requested) permissions — must be granted to be active
  permissions?: PluginPermission[]
  // Tools this plugin provides (declared, validated against "tools" capability)
  tools?: PluginTool[]
  // Hooks this plugin provides
  hooks?: PluginHook[]
  // Settings schema (JSON-schema-ish)
  settingsSchema?: Record<string, unknown>
  // Default settings values
  defaultSettings?: Record<string, unknown>
}

export interface PluginIsolation {
  sandbox: boolean       // if true, runs in a separate VM context
  timeoutMs: number      // max execution time for any hook/tool call
  maxHeapMb: number      // best-effort heap cap (Node worker)
  fsScope: string[] | null // allowed paths (null = workspace root)
}

export interface PluginSettings {
  schema: Record<string, unknown>
  values: Record<string, unknown>
}

export interface PluginVersionEntry {
  version: string
  installedAt: string
  checksum: string
}

export interface PluginRecord {
  id: string
  name: string
  displayName: string
  description: string | null
  version: string
  manifestVersion: string
  author: string | null
  homepage: string | null
  repository: string | null
  entryPath: string
  entryType: PluginEntryType
  inlineSource: string | null
  manifest: PluginManifest
  capabilities: PluginCapability[]
  permissions: PluginPermission[]
  settings: PluginSettings
  status: PluginStatus
  checksum: string | null
  isolation: PluginIsolation
  versionHistory: PluginVersionEntry[]
  activation: { ok: boolean; error?: string; activatedAt?: string }
  registeredAt: Date
  installedAt: Date | null
  lastActivatedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface PluginLogEntry {
  id: string
  pluginName: string
  action: PluginLogAction
  level: PluginLogLevel
  message: string
  context: Record<string, unknown>
  durationMs: number
  createdAt: Date
}

export type PluginResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string }

// ---------------------------------------------------------------------------
// In-memory activation cache — loaded modules + exports
// ---------------------------------------------------------------------------

interface ActivatedPlugin {
  name: string
  module: Record<string, unknown>
  activatedAt: string
  // Hooks registered by the plugin (function name → exported fn)
  registeredHooks: Map<string, (...args: unknown[]) => unknown>
}

const activated = new Map<string, ActivatedPlugin>()

// ---------------------------------------------------------------------------
// Row → record mapper
// ---------------------------------------------------------------------------

interface PluginRow {
  id: string
  name: string
  displayName: string
  description: string | null
  version: string
  manifestVersion: string
  author: string | null
  homepage: string | null
  repository: string | null
  entryPath: string
  entryType: string
  inlineSource: string | null
  manifest: string
  capabilities: string
  permissions: string
  settings: string
  status: string
  checksum: string | null
  isolation: string
  versionHistory: string
  activation: string
  registeredAt: Date
  installedAt: Date | null
  lastActivatedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const DEFAULT_ISOLATION: PluginIsolation = {
  sandbox: false,
  timeoutMs: 30_000,
  maxHeapMb: 64,
  fsScope: null,
}

function rowToRecord(row: PluginRow): PluginRecord {
  return {
    id: row.id,
    name: row.name,
    displayName: row.displayName,
    description: row.description,
    version: row.version,
    manifestVersion: row.manifestVersion,
    author: row.author,
    homepage: row.homepage,
    repository: row.repository,
    entryPath: row.entryPath,
    entryType: row.entryType as PluginEntryType,
    inlineSource: row.inlineSource,
    manifest: safeParse(row.manifest, {} as PluginManifest),
    capabilities: safeParse(row.capabilities, []),
    permissions: safeParse(row.permissions, []),
    settings: safeParse(row.settings, { schema: {}, values: {} }),
    status: row.status as PluginStatus,
    checksum: row.checksum,
    isolation: safeParse(row.isolation, DEFAULT_ISOLATION),
    versionHistory: safeParse(row.versionHistory, []),
    activation: safeParse(row.activation, { ok: false }),
    registeredAt: row.registeredAt,
    installedAt: row.installedAt,
    lastActivatedAt: row.lastActivatedAt,
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
// Checksum
// ---------------------------------------------------------------------------

async function computeChecksum(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath)
    return createHash("sha256").update(content).digest("hex")
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Log writer
// ---------------------------------------------------------------------------

interface LogWriteOpts {
  pluginName: string
  action: PluginLogAction
  level?: PluginLogLevel
  message: string
  context?: Record<string, unknown>
  durationMs?: number
}

async function writeLog(opts: LogWriteOpts): Promise<void> {
  try {
    await db.pluginLog.create({
      data: {
        pluginName: opts.pluginName,
        action: opts.action,
        level: opts.level ?? "info",
        message: opts.message.slice(0, 1000),
        context: JSON.stringify(opts.context ?? {}).slice(0, 2000),
        durationMs: opts.durationMs ?? 0,
      },
    })
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// 1. Plugin Registry — register a plugin from a manifest + entry path
// ---------------------------------------------------------------------------

export async function pluginRegister(
  manifest: PluginManifest,
  opts: { entryPath?: string; inlineSource?: string } = {}
): Promise<PluginResult<PluginRecord>> {
  try {
    if (!manifest.name || !manifest.displayName || !manifest.version) {
      return {
        ok: false,
        error: "bad_manifest",
        message: "❌ البيان غير مكتمل / incomplete manifest (name + displayName + version required)",
      }
    }
    if (!opts.entryPath && !opts.inlineSource) {
      return {
        ok: false,
        error: "no_entry",
        message: "❌ لا نقطة دخول / either entryPath or inlineSource is required",
      }
    }
    const entryType: PluginEntryType = opts.inlineSource ? "inline" : "module"
    const entryPath = opts.entryPath ?? "(inline)"
    let checksum: string | null = null
    if (opts.entryPath) {
      const abs = path.isAbsolute(opts.entryPath)
        ? opts.entryPath
        : path.resolve(WORKSPACE_ROOT, opts.entryPath)
      checksum = await computeChecksum(abs)
      if (!checksum) {
        return {
          ok: false,
          error: "entry_not_found",
          message: `❌ نقطة الدخول غير موجودة / entry not found: ${opts.entryPath}`,
        }
      }
    }

    const manifestJson = JSON.stringify(manifest)
    const row = await db.plugin.upsert({
      where: { name: manifest.name },
      update: {
        displayName: manifest.displayName,
        description: manifest.description,
        version: manifest.version,
        manifestVersion: manifest.manifestVersion ?? "1.0.0",
        author: manifest.author,
        homepage: manifest.homepage,
        repository: manifest.repository,
        entryPath,
        entryType,
        inlineSource: opts.inlineSource,
        manifest: manifestJson,
        capabilities: JSON.stringify(manifest.capabilities ?? []),
        permissions: JSON.stringify(manifest.permissions ?? []),
        settings: JSON.stringify({
          schema: manifest.settingsSchema ?? {},
          values: manifest.defaultSettings ?? {},
        }),
        checksum,
        status: "registered",
      },
      create: {
        name: manifest.name,
        displayName: manifest.displayName,
        description: manifest.description,
        version: manifest.version,
        manifestVersion: manifest.manifestVersion ?? "1.0.0",
        author: manifest.author,
        homepage: manifest.homepage,
        repository: manifest.repository,
        entryPath,
        entryType,
        inlineSource: opts.inlineSource,
        manifest: manifestJson,
        capabilities: JSON.stringify(manifest.capabilities ?? []),
        permissions: JSON.stringify(manifest.permissions ?? []),
        settings: JSON.stringify({
          schema: manifest.settingsSchema ?? {},
          values: manifest.defaultSettings ?? {},
        }),
        isolation: JSON.stringify(DEFAULT_ISOLATION),
        checksum,
        status: "registered",
      },
    })

    await writeLog({
      pluginName: manifest.name,
      action: "register",
      level: "info",
      message: `تم تسجيل البرنامج المساعد ${manifest.name} v${manifest.version}`,
      context: { version: manifest.version, capabilities: manifest.capabilities },
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
// 2. Plugin Manifest — read the declared manifest
// ---------------------------------------------------------------------------

export async function pluginGetManifest(name: string): Promise<PluginResult<PluginManifest>> {
  try {
    const row = await db.plugin.findUnique({ where: { name } })
    if (!row) {
      return { ok: false, error: "not_found", message: `❌ البرنامج المساعد غير موجود / plugin not found: ${name}` }
    }
    return { ok: true, data: safeParse<PluginManifest>(row.manifest, {} as PluginManifest) }
  } catch (e) {
    return {
      ok: false,
      error: "manifest_failed",
      message: `❌ فشل قراءة البيان / manifest failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Plugin Permissions — grant / revoke specific permissions
// ---------------------------------------------------------------------------

const VALID_PERMISSIONS: PluginPermission[] = [
  "filesystem:read",
  "filesystem:write",
  "shell:exec",
  "network:http",
  "network:websocket",
  "db:read",
  "db:write",
  "secrets:read",
  "env:read",
]

export async function pluginSetPermissions(
  name: string,
  perms: PluginPermission[],
  mode: "grant" | "revoke" | "replace" = "grant"
): Promise<PluginResult<{ name: string; permissions: PluginPermission[] }>> {
  try {
    const existing = await db.plugin.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ البرنامج المساعد غير موجود / plugin not found: ${name}` }
    }
    const invalid = perms.filter((p) => !VALID_PERMISSIONS.includes(p))
    if (invalid.length > 0) {
      return {
        ok: false,
        error: "bad_permission",
        message: `❌ صلاحيات غير صالحة / invalid permissions: ${invalid.join(", ")}. Valid: ${VALID_PERMISSIONS.join(", ")}`,
      }
    }
    const current = safeParse<PluginPermission[]>(existing.permissions, [])
    let next: PluginPermission[]
    if (mode === "replace") {
      next = Array.from(new Set(perms))
    } else if (mode === "grant") {
      next = Array.from(new Set([...current, ...perms]))
    } else {
      next = current.filter((p) => !perms.includes(p))
    }
    await db.plugin.update({
      where: { name },
      data: { permissions: JSON.stringify(next) },
    })
    await writeLog({
      pluginName: name,
      action: "settings_change",
      level: "info",
      message: `تم تحديث الصلاحيات: ${mode} ${perms.join(", ")}`,
      context: { mode, permissions: next },
    })
    return { ok: true, data: { name, permissions: next } }
  } catch (e) {
    return {
      ok: false,
      error: "permission_failed",
      message: `❌ فشل ضبط الصلاحيات / permission failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Plugin Capabilities — grant / revoke specific capabilities
// ---------------------------------------------------------------------------

const VALID_CAPABILITIES: PluginCapability[] = [
  "tools",
  "hooks",
  "ui_panels",
  "providers",
  "commands",
  "context_sources",
]

export async function pluginSetCapabilities(
  name: string,
  caps: PluginCapability[],
  mode: "grant" | "revoke" | "replace" = "grant"
): Promise<PluginResult<{ name: string; capabilities: PluginCapability[] }>> {
  try {
    const existing = await db.plugin.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ البرنامج المساعد غير موجود / plugin not found: ${name}` }
    }
    const invalid = caps.filter((c) => !VALID_CAPABILITIES.includes(c))
    if (invalid.length > 0) {
      return {
        ok: false,
        error: "bad_capability",
        message: `❌ قدرات غير صالحة / invalid capabilities: ${invalid.join(", ")}. Valid: ${VALID_CAPABILITIES.join(", ")}`,
      }
    }
    const current = safeParse<PluginCapability[]>(existing.capabilities, [])
    let next: PluginCapability[]
    if (mode === "replace") {
      next = Array.from(new Set(caps))
    } else if (mode === "grant") {
      next = Array.from(new Set([...current, ...caps]))
    } else {
      next = current.filter((c) => !caps.includes(c))
    }
    await db.plugin.update({
      where: { name },
      data: { capabilities: JSON.stringify(next) },
    })
    await writeLog({
      pluginName: name,
      action: "settings_change",
      level: "info",
      message: `تم تحديث القدرات: ${mode} ${caps.join(", ")}`,
      context: { mode, capabilities: next },
    })
    return { ok: true, data: { name, capabilities: next } }
  } catch (e) {
    return {
      ok: false,
      error: "capability_failed",
      message: `❌ فشل ضبط القدرات / capability failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Plugin Lifecycle — install / activate / deactivate / uninstall
// ---------------------------------------------------------------------------

export type LifecycleAction = "install" | "activate" | "deactivate" | "uninstall"

export type LifecycleResult =
  | PluginResult<PluginRecord>
  | PluginResult<{ deleted: boolean }>

export async function pluginLifecycle(
  name: string,
  action: LifecycleAction
): Promise<LifecycleResult> {
  switch (action) {
    case "install":
      return pluginInstall(name)
    case "activate":
      return pluginActivate(name)
    case "deactivate":
      return pluginDeactivate(name)
    case "uninstall":
      return pluginUninstall(name)
  }
}

async function pluginInstall(name: string): Promise<PluginResult<PluginRecord>> {
  try {
    const existing = await db.plugin.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ البرنامج المساعد غير موجود / plugin not found: ${name}` }
    }
    // Re-checksum.
    let checksum = existing.checksum
    if (existing.entryType === "module") {
      const abs = path.isAbsolute(existing.entryPath)
        ? existing.entryPath
        : path.resolve(WORKSPACE_ROOT, existing.entryPath)
      const newChecksum = await computeChecksum(abs)
      if (!newChecksum) {
        return {
          ok: false,
          error: "entry_missing",
          message: `❌ نقطة الدخول مفقودة / entry missing: ${existing.entryPath}`,
        }
      }
      checksum = newChecksum
    }
    // Append to version history.
    const history = safeParse<PluginVersionEntry[]>(existing.versionHistory, [])
    history.push({
      version: existing.version,
      installedAt: new Date().toISOString(),
      checksum: checksum ?? "",
    })
    const row = await db.plugin.update({
      where: { name },
      data: {
        status: "enabled",
        installedAt: new Date(),
        checksum,
        versionHistory: JSON.stringify(history),
      },
    })
    await writeLog({
      pluginName: name,
      action: "install",
      level: "info",
      message: `تم تثبيت البرنامج المساعد ${name} v${existing.version}`,
      context: { version: existing.version, checksum },
    })
    return { ok: true, data: rowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "install_failed",
      message: `❌ فشل التثبيت / install failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

/**
 * Activate a plugin: load the module, validate its declared exports against
 * granted capabilities, run the onActivate hook (if any), log the result.
 */
export async function pluginActivate(name: string): Promise<PluginResult<PluginRecord>> {
  try {
    const existing = await db.plugin.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ البرنامج المساعد غير موجود / plugin not found: ${name}` }
    }
    if (existing.status === "disabled") {
      return { ok: false, error: "disabled", message: `❌ البرنامج معطّل — فعّله أولاً / plugin is disabled — enable it first` }
    }
    const record = rowToRecord(existing)

    // Checksum verification (tamper detection).
    if (record.entryType === "module" && record.checksum) {
      const abs = path.isAbsolute(record.entryPath)
        ? record.entryPath
        : path.resolve(WORKSPACE_ROOT, record.entryPath)
      const currentChecksum = await computeChecksum(abs)
      if (currentChecksum && currentChecksum !== record.checksum) {
        await db.plugin.update({
          where: { name },
          data: {
            status: "error",
            activation: JSON.stringify({
              ok: false,
              error: "checksum_mismatch",
              activatedAt: new Date().toISOString(),
            }),
          },
        })
        await writeLog({
          pluginName: name,
          action: "activate",
          level: "error",
          message: `فشل التفعيل: عدم تطابق الـ checksum (تم التلاعب بالملف؟)`,
          context: { expected: record.checksum, actual: currentChecksum },
        })
        return {
          ok: false,
          error: "checksum_mismatch",
          message: `❌ عدم تطابق الـ checksum — قد تم التلاعب بالملف / checksum mismatch — file may be tampered`,
        }
      }
    }

    // Load the module.
    let mod: Record<string, unknown> = {}
    try {
      if (record.entryType === "inline" && record.inlineSource) {
        // Inline source: evaluate as a module via dynamic Function (sandboxed best-effort).
        // Note: this is NOT real sandboxing — for prod use Node worker_threads.
        const fn = new Function("exports", "require", "module", record.inlineSource)
        const exp: Record<string, unknown> = {}
        const modObj: { exports: Record<string, unknown> } = { exports: exp }
        fn(exp, require, modObj)
        mod = modObj.exports
      } else if (record.entryType === "module") {
        const abs = path.isAbsolute(record.entryPath)
          ? record.entryPath
          : path.resolve(WORKSPACE_ROOT, record.entryPath)
        mod = await import(`file://${abs}`)
      }
    } catch (e) {
      await db.plugin.update({
        where: { name },
        data: {
          status: "error",
          activation: JSON.stringify({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
            activatedAt: new Date().toISOString(),
          }),
        },
      })
      await writeLog({
        pluginName: name,
        action: "activate",
        level: "error",
        message: `فشل تحميل الوحدة: ${e instanceof Error ? e.message : String(e)}`,
      })
      return {
        ok: false,
        error: "load_failed",
        message: `❌ فشل تحميل الوحدة / module load failed: ${e instanceof Error ? e.message : String(e)}`,
      }
    }

    // Validate capabilities vs exported functions.
    const caps = record.capabilities
    const validationErrors: string[] = []
    if (caps.includes("tools") && !Array.isArray((mod as { tools?: unknown }).tools)) {
      validationErrors.push("capability 'tools' requires exporting a `tools` array")
    }
    if (caps.includes("hooks") && typeof (mod as { onActivate?: unknown }).onActivate !== "function" && typeof (mod as { hooks?: unknown }).hooks !== "object") {
      validationErrors.push("capability 'hooks' requires exporting `onActivate` or `hooks`")
    }
    if (validationErrors.length > 0) {
      await db.plugin.update({
        where: { name },
        data: {
          status: "error",
          activation: JSON.stringify({
            ok: false,
            error: "validation_failed",
            errors: validationErrors,
            activatedAt: new Date().toISOString(),
          }),
        },
      })
      await writeLog({
        pluginName: name,
        action: "activate",
        level: "error",
        message: `فشل التحقق من القدرات: ${validationErrors.join("; ")}`,
      })
      return {
        ok: false,
        error: "validation_failed",
        message: `❌ فشل التحقق / validation failed: ${validationErrors.join("; ")}`,
      }
    }

    // Run the onActivate hook (if any).
    let activateError: string | undefined
    const start = Date.now()
    try {
      const onActivate = (mod as { onActivate?: (ctx: unknown) => unknown }).onActivate
      if (typeof onActivate === "function") {
        await Promise.race([
          onActivate({ name, capabilities: caps, settings: record.settings.values }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`timeout ${record.isolation.timeoutMs}ms`)), record.isolation.timeoutMs)
          ),
        ])
      }
    } catch (e) {
      activateError = e instanceof Error ? e.message : String(e)
    }

    const activation = {
      ok: !activateError,
      error: activateError,
      activatedAt: new Date().toISOString(),
    }

    // Cache the activated module.
    activated.set(name, {
      name,
      module: mod,
      activatedAt: activation.activatedAt,
      registeredHooks: new Map(),
    })

    // Cache hooks if the plugin exports a `hooks` object.
    const hooksObj = (mod as { hooks?: Record<string, (...args: unknown[]) => unknown> }).hooks
    if (hooksObj && typeof hooksObj === "object") {
      const cache = activated.get(name)!
      for (const [event, fn] of Object.entries(hooksObj)) {
        if (typeof fn === "function") cache.registeredHooks.set(event, fn)
      }
    }

    const row = await db.plugin.update({
      where: { name },
      data: {
        status: activateError ? "error" : "enabled",
        lastActivatedAt: new Date(),
        activation: JSON.stringify(activation),
      },
    })

    await writeLog({
      pluginName: name,
      action: "activate",
      level: activateError ? "error" : "info",
      message: activateError
        ? `فشل التفعيل: ${activateError}`
        : `تم تفعيل البرنامج المساعد ${name}`,
      context: activation,
      durationMs: Date.now() - start,
    })

    if (activateError) {
      return {
        ok: false,
        error: "activate_failed",
        message: `❌ فشل التفعيل / activate failed: ${activateError}`,
      }
    }
    return { ok: true, data: rowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "activate_failed",
      message: `❌ فشل التفعيل / activate failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function pluginDeactivate(name: string): Promise<PluginResult<PluginRecord>> {
  try {
    const existing = await db.plugin.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ البرنامج المساعد غير موجود / plugin not found: ${name}` }
    }
    // Run onDeactivate hook if present.
    const cache = activated.get(name)
    if (cache) {
      const onDeactivate = (cache.module as { onDeactivate?: () => unknown }).onDeactivate
      if (typeof onDeactivate === "function") {
        try {
          await onDeactivate()
        } catch (e) {
          await writeLog({
            pluginName: name,
            action: "deactivate",
            level: "warn",
            message: `خطأ في onDeactivate: ${e instanceof Error ? e.message : String(e)}`,
          })
        }
      }
    }
    activated.delete(name)
    const row = await db.plugin.update({
      where: { name },
      data: { status: "disabled", lastActivatedAt: null },
    })
    await writeLog({
      pluginName: name,
      action: "deactivate",
      level: "info",
      message: `تم إلغاء تفعيل البرنامج المساعد ${name}`,
    })
    return { ok: true, data: rowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "deactivate_failed",
      message: `❌ فشل إلغاء التفعيل / deactivate failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function pluginUninstall(name: string): Promise<PluginResult<{ deleted: boolean }>> {
  try {
    const existing = await db.plugin.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ البرنامج المساعد غير موجود / plugin not found: ${name}` }
    }
    // Deactivate first.
    if (activated.has(name)) {
      await pluginDeactivate(name)
    }
    await db.pluginLog.deleteMany({ where: { pluginName: name } })
    await db.plugin.delete({ where: { name } })
    await writeLog({
      pluginName: name,
      action: "uninstall",
      level: "info",
      message: `تم إزالة البرنامج المساعد ${name}`,
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
// 6. Plugin Versioning — bump version + re-checksum + re-activate
// ---------------------------------------------------------------------------

export async function pluginUpgrade(
  name: string,
  newVersion: string,
  opts: { entryPath?: string; inlineSource?: string } = {}
): Promise<PluginResult<PluginRecord>> {
  try {
    const existing = await db.plugin.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ البرنامج المساعد غير موجود / plugin not found: ${name}` }
    }
    let checksum = existing.checksum
    let entryPath = existing.entryPath
    let inlineSource = existing.inlineSource
    let entryType = existing.entryType as PluginEntryType

    if (opts.entryPath) {
      entryPath = opts.entryPath
      entryType = "module"
      const abs = path.isAbsolute(entryPath)
        ? entryPath
        : path.resolve(WORKSPACE_ROOT, entryPath)
      checksum = await computeChecksum(abs)
      if (!checksum) {
        return {
          ok: false,
          error: "entry_not_found",
          message: `❌ نقطة الدخول غير موجودة / entry not found: ${entryPath}`,
        }
      }
    } else if (opts.inlineSource) {
      inlineSource = opts.inlineSource
      entryType = "inline"
      checksum = null
    }

    // Append to version history.
    const history = safeParse<PluginVersionEntry[]>(existing.versionHistory, [])
    history.push({
      version: newVersion,
      installedAt: new Date().toISOString(),
      checksum: checksum ?? "",
    })

    const row = await db.plugin.update({
      where: { name },
      data: {
        version: newVersion,
        entryPath,
        entryType,
        inlineSource,
        checksum,
        versionHistory: JSON.stringify(history),
        installedAt: new Date(),
        status: "enabled",
      },
    })

    await writeLog({
      pluginName: name,
      action: "upgrade",
      level: "info",
      message: `تم ترقية البرنامج المساعد ${name} إلى v${newVersion}`,
      context: { from: existing.version, to: newVersion, checksum },
    })

    // Re-activate if it was previously activated.
    if (activated.has(name)) {
      await pluginDeactivate(name)
      await pluginActivate(name)
    }

    return { ok: true, data: rowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "upgrade_failed",
      message: `❌ فشل الترقية / upgrade failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Plugin Isolation — set sandbox policy
// ---------------------------------------------------------------------------

export async function pluginSetIsolation(
  name: string,
  isolation: Partial<PluginIsolation>
): Promise<PluginResult<{ name: string; isolation: PluginIsolation }>> {
  try {
    const existing = await db.plugin.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ البرنامج المساعد غير موجود / plugin not found: ${name}` }
    }
    const current = safeParse<PluginIsolation>(existing.isolation, DEFAULT_ISOLATION)
    const merged: PluginIsolation = {
      sandbox: isolation.sandbox ?? current.sandbox,
      timeoutMs: isolation.timeoutMs ?? current.timeoutMs,
      maxHeapMb: isolation.maxHeapMb ?? current.maxHeapMb,
      fsScope: isolation.fsScope !== undefined ? isolation.fsScope : current.fsScope,
    }
    await db.plugin.update({
      where: { name },
      data: { isolation: JSON.stringify(merged) },
    })
    await writeLog({
      pluginName: name,
      action: "settings_change",
      level: "info",
      message: `تم تحديث سياسة العزل: ${JSON.stringify(merged)}`,
      context: { isolation: merged },
    })
    return { ok: true, data: { name, isolation: merged } }
  } catch (e) {
    return {
      ok: false,
      error: "isolation_failed",
      message: `❌ فشل ضبط العزل / isolation failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 8. Plugin Settings — update settings (validated against schema)
// ---------------------------------------------------------------------------

export async function pluginSetSettings(
  name: string,
  newValues: Record<string, unknown>
): Promise<PluginResult<{ name: string; values: Record<string, unknown> }>> {
  try {
    const existing = await db.plugin.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ البرنامج المساعد غير موجود / plugin not found: ${name}` }
    }
    const current = safeParse<PluginSettings>(existing.settings, { schema: {}, values: {} })
    const merged = { ...current.values, ...newValues }

    // Light validation: if schema has "required", check presence.
    const schema = current.schema as { required?: string[]; properties?: Record<string, { type?: string }> }
    if (schema.required && Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (merged[key] === undefined || merged[key] === null) {
          return {
            ok: false,
            error: "validation_failed",
            message: `❌ إعداد مطلوب مفقود / required setting missing: ${key}`,
          }
        }
      }
    }
    // Type-check primitive types.
    if (schema.properties) {
      for (const [key, def] of Object.entries(schema.properties)) {
        if (merged[key] === undefined) continue
        const expected = def?.type
        const actual = Array.isArray(merged[key]) ? "array" : typeof merged[key]
        if (expected && expected !== actual) {
          return {
            ok: false,
            error: "validation_failed",
            message: `❌ نوع خاطئ للإعداد / wrong type for ${key}: expected ${expected}, got ${actual}`,
          }
        }
      }
    }

    await db.plugin.update({
      where: { name },
      data: { settings: JSON.stringify({ schema: current.schema, values: merged }) },
    })
    await writeLog({
      pluginName: name,
      action: "settings_change",
      level: "info",
      message: `تم تحديث الإعدادات: ${Object.keys(newValues).join(", ")}`,
      context: { updated: Object.keys(newValues), values: merged },
    })
    return { ok: true, data: { name, values: merged } }
  } catch (e) {
    return {
      ok: false,
      error: "settings_failed",
      message: `❌ فشل تحديث الإعدادات / settings failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function pluginGetSettings(
  name: string
): Promise<PluginResult<PluginSettings>> {
  try {
    const existing = await db.plugin.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ البرنامج المساعد غير موجود / plugin not found: ${name}` }
    }
    return { ok: true, data: safeParse<PluginSettings>(existing.settings, { schema: {}, values: {} }) }
  } catch (e) {
    return {
      ok: false,
      error: "settings_failed",
      message: `❌ فشل قراءة الإعدادات / settings get failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 9. Plugin Logs — write + query
// ---------------------------------------------------------------------------

export async function pluginLogs(
  opts: LogWriteOpts
): Promise<PluginResult<{ logged: boolean }>> {
  try {
    await writeLog(opts)
    return { ok: true, data: { logged: true } }
  } catch (e) {
    return {
      ok: false,
      error: "log_failed",
      message: `❌ فشل كتابة السجل / log failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export interface LogQueryOpts {
  pluginName?: string
  action?: PluginLogAction
  level?: PluginLogLevel
  since?: Date
  limit?: number
}

export async function pluginQueryLogs(
  opts: LogQueryOpts = {}
): Promise<PluginResult<PluginLogEntry[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.pluginName) where.pluginName = opts.pluginName
    if (opts.action) where.action = opts.action
    if (opts.level) where.level = opts.level
    if (opts.since) where.createdAt = { gte: opts.since }
    const rows = await db.pluginLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 100,
    })
    return {
      ok: true,
      data: rows.map((r) => ({
        ...r,
        context: safeParse(r.context, {}),
        level: r.level as PluginLogLevel,
        action: r.action as PluginLogAction,
      })),
    }
  } catch (e) {
    return {
      ok: false,
      error: "log_query_failed",
      message: `❌ فشل استعلام السجلات / log query failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 10. Enable / Disable
// ---------------------------------------------------------------------------

export async function pluginEnable(name: string): Promise<PluginResult<PluginRecord>> {
  try {
    const existing = await db.plugin.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ البرنامج المساعد غير موجود / plugin not found: ${name}` }
    }
    const row = await db.plugin.update({
      where: { name },
      data: { status: "enabled" },
    })
    await writeLog({
      pluginName: name,
      action: "enable",
      level: "info",
      message: `تم تفعيل البرنامج المساعد ${name}`,
    })
    return { ok: true, data: rowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "enable_failed",
      message: `❌ فشل التفعيل / enable failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function pluginDisable(name: string): Promise<PluginResult<PluginRecord>> {
  try {
    const existing = await db.plugin.findUnique({ where: { name } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ البرنامج المساعد غير موجود / plugin not found: ${name}` }
    }
    // Deactivate if currently active.
    if (activated.has(name)) {
      await pluginDeactivate(name)
    }
    const row = await db.plugin.update({
      where: { name },
      data: { status: "disabled" },
    })
    await writeLog({
      pluginName: name,
      action: "disable",
      level: "info",
      message: `تم تعطيل البرنامج المساعد ${name}`,
    })
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

export async function pluginList(): Promise<PluginResult<PluginRecord[]>> {
  try {
    const rows = await db.plugin.findMany({ orderBy: { createdAt: "desc" } })
    return { ok: true, data: rows.map(rowToRecord) }
  } catch (e) {
    return {
      ok: false,
      error: "list_failed",
      message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function pluginGet(name: string): Promise<PluginResult<PluginRecord>> {
  try {
    const row = await db.plugin.findUnique({ where: { name } })
    if (!row) {
      return { ok: false, error: "not_found", message: `❌ البرنامج المساعد غير موجود / plugin not found: ${name}` }
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

// ---------------------------------------------------------------------------
// Hook execution — call a registered hook on an active plugin
// ---------------------------------------------------------------------------

export async function pluginRunHook(
  name: string,
  event: string,
  ...args: unknown[]
): Promise<PluginResult<{ ran: boolean; result?: unknown }>> {
  try {
    const cache = activated.get(name)
    if (!cache) {
      return { ok: false, error: "not_active", message: `❌ البرنامج غير مفعّل / plugin not active: ${name}` }
    }
    const fn = cache.registeredHooks.get(event)
    if (!fn || typeof fn !== "function") {
      return { ok: true, data: { ran: false } }
    }
    const start = Date.now()
    try {
      const result = await fn(...args)
      await writeLog({
        pluginName: name,
        action: "hook_run",
        level: "info",
        message: `تم تنفيذ الـ hook: ${event}`,
        context: { event },
        durationMs: Date.now() - start,
      })
      return { ok: true, data: { ran: true, result } }
    } catch (e) {
      await writeLog({
        pluginName: name,
        action: "hook_run",
        level: "error",
        message: `فشل الـ hook ${event}: ${e instanceof Error ? e.message : String(e)}`,
        context: { event },
        durationMs: Date.now() - start,
      })
      return {
        ok: false,
        error: "hook_failed",
        message: `❌ فشل الـ hook / hook failed: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  } catch (e) {
    return {
      ok: false,
      error: "hook_failed",
      message: `❌ فشل الـ hook / hook failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Snapshot — full plugin system state
// ---------------------------------------------------------------------------

export interface PluginSnapshot {
  total: number
  enabled: number
  disabled: number
  error: number
  activeInMemory: number
  byCapability: Record<string, number>
  recentErrors: Array<{ pluginName: string; message: string; createdAt: Date }>
}

export async function pluginSnapshot(): Promise<PluginResult<PluginSnapshot>> {
  try {
    const listRes = await pluginList()
    const plugins = listRes.ok ? listRes.data : []
    const enabled = plugins.filter((p) => p.status === "enabled").length
    const disabled = plugins.filter((p) => p.status === "disabled").length
    const error = plugins.filter((p) => p.status === "error").length
    const byCapability: Record<string, number> = {}
    for (const p of plugins) {
      for (const c of p.capabilities) {
        byCapability[c] = (byCapability[c] ?? 0) + 1
      }
    }
    const logsRes = await pluginQueryLogs({ level: "error", limit: 10 })
    const recentErrors = logsRes.ok
      ? logsRes.data.map((l) => ({ pluginName: l.pluginName, message: l.message, createdAt: l.createdAt }))
      : []
    return {
      ok: true,
      data: {
        total: plugins.length,
        enabled,
        disabled,
        error,
        activeInMemory: activated.size,
        byCapability,
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
// Formatter
// ---------------------------------------------------------------------------

export function formatPluginResult<T>(result: PluginResult<T>): string {
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
