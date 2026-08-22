// Administration & Operations OS — 11 operations (spec section 30, features 415-425).
//
// Aggregates existing subsystems into one unified admin interface:
//   - Provider Manager (415) — delegates to /api/providers + PROVIDER_REGISTRY
//   - Model Manager (416) — lists models from registry + DB
//   - MCP Manager (417) — delegates to MCP OS
//   - Plugin Manager (418) — lists/enable/disable plugins from DB
//   - Skill Manager (419) — delegates to collaboration OS skill library
//   - Workspace Manager (420) — workspace info + switch
//   - Storage Manager (421) — disk usage + file counts
//   - Backup Manager (422) — create/restore backups (SQLite DB export)
//   - Import/Export Manager (423) — JSON export/import of conversations
//   - System Health (424) — delegates to observability systemMetrics
//   - Log Viewer (425) — reads dev.log + server logs

import { db } from "@/lib/db"
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs"
import { writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"
import { PROVIDER_REGISTRY } from "@/lib/llm-providers/registry"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdminResult<T> {
  ok: boolean
  data?: T
  error?: string
  message?: string
}

// ---------------------------------------------------------------------------
// 1. Provider Manager (415)
// ---------------------------------------------------------------------------

export async function providerManager(): Promise<AdminResult<{
  providers: Array<{
    id: string
    name: string
    enabled: boolean
    isDefault: boolean
    hasKey: boolean
    baseURL: string | null
    modelCount: number
  }>
  total: number
  enabled: number
  withKeys: number
}>> {
  try {
    const dbProviders = await db.provider.findMany()
    const dbMap = new Map(dbProviders.map(p => [p.providerId, p]))

    const providers = Object.values(PROVIDER_REGISTRY).map(reg => {
      const dbEntry = dbMap.get(reg.id)
      return {
        id: reg.id,
        name: reg.name,
        enabled: dbEntry?.enabled ?? false,
        isDefault: dbEntry?.isDefault ?? false,
        hasKey: Boolean(dbEntry?.apiKey),
        baseURL: dbEntry?.baseURL ?? reg.baseURL ?? null,
        modelCount: reg.models?.length ?? 0,
      }
    })

    return {
      ok: true,
      data: {
        providers,
        total: providers.length,
        enabled: providers.filter(p => p.enabled).length,
        withKeys: providers.filter(p => p.hasKey).length,
      },
    }
  } catch (e) {
    return { ok: false, error: "provider_manager_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 2. Model Manager (416)
// ---------------------------------------------------------------------------

export async function modelManager(): Promise<AdminResult<{
  models: Array<{
    id: string
    provider: string
    name: string
    contextWindow: number
    enabled: boolean
  }>
  total: number
  byProvider: Record<string, number>
}>> {
  try {
    const dbProviders = await db.provider.findMany({ where: { enabled: true } })
    const enabledSet = new Set(dbProviders.map(p => p.providerId))

    const models: Array<{ id: string; provider: string; name: string; contextWindow: number; enabled: boolean }> = []
    for (const reg of Object.values(PROVIDER_REGISTRY)) {
      for (const model of reg.models ?? []) {
        models.push({
          id: model.id,
          provider: reg.id,
          name: model.name,
          contextWindow: model.contextWindow ?? 0,
          enabled: enabledSet.has(reg.id),
        })
      }
    }

    const byProvider: Record<string, number> = {}
    for (const m of models) {
      byProvider[m.provider] = (byProvider[m.provider] ?? 0) + 1
    }

    return { ok: true, data: { models, total: models.length, byProvider } }
  } catch (e) {
    return { ok: false, error: "model_manager_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 3. MCP Manager (417)
// ---------------------------------------------------------------------------

export async function mcpManager(): Promise<AdminResult<{
  servers: any[]
  total: number
  enabled: number
  totalTools: number
}>> {
  try {
    const { mcpListServers } = await import("@/lib/mcp/os")
    const result = await mcpListServers()
    const servers = result.ok ? result.data : []
    return {
      ok: true,
      data: {
        servers,
        total: servers.length,
        enabled: servers.filter((s: any) => s.status === "enabled").length,
        totalTools: servers.reduce((sum: number, s: any) => sum + (s.tools?.length ?? 0), 0),
      },
    }
  } catch (e) {
    return { ok: false, error: "mcp_manager_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 4. Plugin Manager (418)
// ---------------------------------------------------------------------------

export async function pluginManager(): Promise<AdminResult<{
  plugins: Array<{
    id: string
    name: string
    displayName: string
    version: string
    enabled: boolean
    description: string | null
  }>
  total: number
  enabled: number
}>> {
  try {
    const plugins = await db.plugin.findMany({
      select: { id: true, name: true, displayName: true, version: true, enabled: true, description: true },
      orderBy: { displayName: "asc" },
    })
    return {
      ok: true,
      data: {
        plugins,
        total: plugins.length,
        enabled: plugins.filter(p => p.enabled).length,
      },
    }
  } catch (e) {
    return { ok: false, error: "plugin_manager_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 5. Skill Manager (419)
// ---------------------------------------------------------------------------

export async function skillManager(): Promise<AdminResult<{
  skills: any[]
  total: number
  builtin: number
}>> {
  try {
    const { listSkillLibrary } = await import("@/lib/collaboration/os")
    const result = await listSkillLibrary()
    const skills = result.ok ? result.data : []
    return {
      ok: true,
      data: {
        skills,
        total: skills.length,
        builtin: skills.filter((s: any) => s.builtin).length,
      },
    }
  } catch (e) {
    return { ok: false, error: "skill_manager_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 6. Workspace Manager (420)
// ---------------------------------------------------------------------------

export function workspaceManager(): AdminResult<{
  root: string
  exists: boolean
  totalFiles: number
  totalDirs: number
  sizeMb: number
  lastModified: string | null
}> {
  try {
    const exists = existsSync(WORKSPACE_ROOT)
    if (!exists) {
      return { ok: true, data: { root: WORKSPACE_ROOT, exists: false, totalFiles: 0, totalDirs: 0, sizeMb: 0, lastModified: null } }
    }

    let totalFiles = 0
    let totalDirs = 0
    let totalSize = 0
    let lastModified = 0

    function walk(dir: string) {
      try {
        const entries = readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name.startsWith(".") && [".git", ".next", ".turbo", "node_modules"].includes(entry.name)) continue
          const fullPath = path.join(dir, entry.name)
          try {
            const stat = statSync(fullPath)
            if (stat.isDirectory()) {
              totalDirs++
              walk(fullPath)
            } else {
              totalFiles++
              totalSize += stat.size
              if (stat.mtimeMs > lastModified) lastModified = stat.mtimeMs
            }
          } catch {}
        }
      } catch {}
    }

    walk(WORKSPACE_ROOT)

    return {
      ok: true,
      data: {
        root: WORKSPACE_ROOT,
        exists: true,
        totalFiles,
        totalDirs,
        sizeMb: Math.round(totalSize / 1024 / 1024),
        lastModified: lastModified > 0 ? new Date(lastModified).toISOString() : null,
      },
    }
  } catch (e) {
    return { ok: false, error: "workspace_manager_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 7. Storage Manager (421)
// ---------------------------------------------------------------------------

export function storageManager(): AdminResult<{
  disk: {
    totalGb: number
    usedGb: number
    freeGb: number
    usagePct: number
  }
  uploads: {
    fileCount: number
    sizeMb: number
  }
  database: {
    sizeMb: number
    path: string
  }
  logs: {
    sizeMb: number
    files: number
  }
}> {
  try {
    // Disk stats
    const totalMem = os.totalmem()
    const freeMem = os.freemem()

    // Uploads dir
    const uploadsDir = path.join(WORKSPACE_ROOT, "upload")
    let uploadFiles = 0
    let uploadSize = 0
    if (existsSync(uploadsDir)) {
      try {
        const entries = readdirSync(uploadsDir)
        for (const entry of entries) {
          try {
            const stat = statSync(path.join(uploadsDir, entry))
            if (stat.isFile()) {
              uploadFiles++
              uploadSize += stat.size
            }
          } catch {}
        }
      } catch {}
    }

    // Database
    const dbPath = path.join(WORKSPACE_ROOT, "db", "custom.db")
    let dbSize = 0
    if (existsSync(dbPath)) {
      try { dbSize = statSync(dbPath).size } catch {}
    }

    // Logs
    let logSize = 0
    let logFiles = 0
    const logPath = path.join(WORKSPACE_ROOT, "dev.log")
    if (existsSync(logPath)) {
      try { logSize = statSync(logPath).size; logFiles = 1 } catch {}
    }
    const serverLogPath = path.join(WORKSPACE_ROOT, "server.log")
    if (existsSync(serverLogPath)) {
      try { logSize += statSync(serverLogPath).size; logFiles++ } catch {}
    }

    return {
      ok: true,
      data: {
        disk: {
          totalGb: Math.round((totalMem / 1024 / 1024 / 1024) * 10) / 10,
          usedGb: Math.round(((totalMem - freeMem) / 1024 / 1024 / 1024) * 10) / 10,
          freeGb: Math.round((freeMem / 1024 / 1024 / 1024) * 10) / 10,
          usagePct: Math.round(((totalMem - freeMem) / totalMem) * 100),
        },
        uploads: {
          fileCount: uploadFiles,
          sizeMb: Math.round(uploadSize / 1024 / 1024),
        },
        database: {
          sizeMb: Math.round(dbSize / 1024 / 1024),
          path: dbPath,
        },
        logs: {
          sizeMb: Math.round(logSize / 1024 / 1024),
          files: logFiles,
        },
      },
    }
  } catch (e) {
    return { ok: false, error: "storage_manager_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 8. Backup Manager (422)
// ---------------------------------------------------------------------------

export async function backupManager(action: "create" | "list" | "restore" | "delete", opts?: { backupId?: string }): Promise<AdminResult<any>> {
  try {
    const backupDir = path.join(WORKSPACE_ROOT, "db", "backups")
    if (!existsSync(backupDir)) {
      await mkdir(backupDir, { recursive: true })
    }

    if (action === "create") {
      const dbPath = path.join(WORKSPACE_ROOT, "db", "custom.db")
      if (!existsSync(dbPath)) return { ok: false, error: "no_db", message: "❌ قاعدة البيانات غير موجودة" }

      const backupName = `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.db`
      const backupPath = path.join(backupDir, backupName)
      const data = readFileSync(dbPath)
      await writeFile(backupPath, data)

      return {
        ok: true,
        data: {
          backupId: backupName,
          path: backupPath,
          sizeMb: Math.round(data.length / 1024 / 1024),
          createdAt: new Date().toISOString(),
        },
      }
    }

    if (action === "list") {
      if (!existsSync(backupDir)) return { ok: true, data: [] }
      const files = readdirSync(backupDir).filter(f => f.endsWith(".db"))
      const backups = files.map(f => {
        const fullPath = path.join(backupDir, f)
        const stat = statSync(fullPath)
        return {
          backupId: f,
          path: fullPath,
          sizeMb: Math.round(stat.size / 1024 / 1024),
          createdAt: stat.mtime.toISOString(),
        }
      }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      return { ok: true, data: backups }
    }

    if (action === "restore" && opts?.backupId) {
      const backupPath = path.join(backupDir, opts.backupId)
      if (!existsSync(backupPath)) return { ok: false, error: "not_found", message: "❌ النسخة الاحتياطية غير موجودة" }
      const dbPath = path.join(WORKSPACE_ROOT, "db", "custom.db")
      const data = readFileSync(backupPath)
      await writeFile(dbPath, data)
      return { ok: true, data: { restored: true, backupId: opts.backupId } }
    }

    if (action === "delete" && opts?.backupId) {
      const backupPath = path.join(backupDir, opts.backupId)
      if (!existsSync(backupPath)) return { ok: false, error: "not_found", message: "❌ النسخة غير موجودة" }
      const { unlink } = await import("node:fs/promises")
      await unlink(backupPath)
      return { ok: true, data: { deleted: true } }
    }

    return { ok: false, error: "invalid_action", message: `إجراء غير صالح: ${action}` }
  } catch (e) {
    return { ok: false, error: "backup_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 9. Import/Export Manager (423)
// ---------------------------------------------------------------------------

export async function importExportManager(action: "export" | "import", opts?: { data?: string }): Promise<AdminResult<any>> {
  try {
    if (action === "export") {
      const [conversations, memories, knowledge, tasks, projects, goals, habits] = await Promise.all([
        db.conversation.findMany({ include: { messages: true } }),
        db.memory.findMany(),
        db.knowledgeChunk.findMany(),
        db.task.findMany(),
        db.project.findMany(),
        db.goal.findMany(),
        db.habit.findMany(),
      ])

      const exportData = {
        version: "1.0",
        exportedAt: new Date().toISOString(),
        stats: {
          conversations: conversations.length,
          messages: conversations.reduce((s, c) => s + c.messages.length, 0),
          memories: memories.length,
          knowledge: knowledge.length,
          tasks: tasks.length,
          projects: projects.length,
          goals: goals.length,
          habits: habits.length,
        },
        data: {
          conversations,
          memories,
          knowledge,
          tasks,
          projects,
          goals,
          habits,
        },
      }

      return { ok: true, data: exportData }
    }

    if (action === "import" && opts?.data) {
      const parsed = JSON.parse(opts.data)
      let imported = 0

      if (parsed.data?.memories) {
        for (const mem of parsed.data.memories) {
          try {
            await db.memory.upsert({
              where: { key: mem.key },
              create: { key: mem.key, value: mem.value, category: mem.category ?? "imported", source: mem.source ?? "import" },
              update: { value: mem.value },
            })
            imported++
          } catch {}
        }
      }

      return { ok: true, data: { imported, total: imported } }
    }

    return { ok: false, error: "invalid_action", message: `إجراء غير صالح: ${action}` }
  } catch (e) {
    return { ok: false, error: "import_export_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 10. System Health (424)
// ---------------------------------------------------------------------------

export function systemHealth(): AdminResult<{
  status: "healthy" | "degraded" | "critical"
  uptime: { system: number; process: number }
  memory: { totalMb: number; usedMb: number; freeMb: number; usagePct: number; processMb: number }
  cpu: { cores: number; loadAvg: number[] }
  database: { connected: boolean; sizeMb: number }
  disk: { usagePct: number }
  checks: Array<{ name: string; status: "pass" | "warn" | "fail"; message: string }>
}> {
  try {
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const usedMem = totalMem - freeMem
    const processMem = process.memoryUsage()
    const memUsagePct = Math.round((usedMem / totalMem) * 100)

    const dbPath = path.join(WORKSPACE_ROOT, "db", "custom.db")
    const dbExists = existsSync(dbPath)
    const dbSize = dbExists ? statSync(dbPath).size : 0

    const checks: Array<{ name: string; status: "pass" | "warn" | "fail"; message: string }> = []

    // Memory check
    if (memUsagePct > 90) checks.push({ name: "Memory", status: "fail", message: `RAM ${memUsagePct}% — حرج` })
    else if (memUsagePct > 75) checks.push({ name: "Memory", status: "warn", message: `RAM ${memUsagePct}% — مرتفع` })
    else checks.push({ name: "Memory", status: "pass", message: `RAM ${memUsagePct}%` })

    // DB check
    if (dbExists) checks.push({ name: "Database", status: "pass", message: `SQLite ${Math.round(dbSize / 1024 / 1024)}MB` })
    else checks.push({ name: "Database", status: "fail", message: "❌ DB غير موجود" })

    // Process memory
    const processMb = Math.round(processMem.rss / 1024 / 1024)
    if (processMb > 2000) checks.push({ name: "Process Memory", status: "warn", message: `${processMb}MB — مرتفع` })
    else checks.push({ name: "Process Memory", status: "pass", message: `${processMb}MB` })

    // CPU load
    const loadAvg = os.loadavg()
    const cpuCores = os.cpus().length
    if (loadAvg[0] > cpuCores * 2) checks.push({ name: "CPU Load", status: "fail", message: `load ${loadAvg[0].toFixed(2)} — حرج` })
    else if (loadAvg[0] > cpuCores) checks.push({ name: "CPU Load", status: "warn", message: `load ${loadAvg[0].toFixed(2)}` })
    else checks.push({ name: "CPU Load", status: "pass", message: `load ${loadAvg[0].toFixed(2)}` })

    // Overall status
    const hasFail = checks.some(c => c.status === "fail")
    const hasWarn = checks.some(c => c.status === "warn")
    const status: "healthy" | "degraded" | "critical" = hasFail ? "critical" : hasWarn ? "degraded" : "healthy"

    return {
      ok: true,
      data: {
        status,
        uptime: {
          system: Math.round(os.uptime()),
          process: Math.round(process.uptime()),
        },
        memory: {
          totalMb: Math.round(totalMem / 1024 / 1024),
          usedMb: Math.round(usedMem / 1024 / 1024),
          freeMb: Math.round(freeMem / 1024 / 1024),
          usagePct: memUsagePct,
          processMb,
        },
        cpu: {
          cores: cpuCores,
          loadAvg,
        },
        database: {
          connected: dbExists,
          sizeMb: Math.round(dbSize / 1024 / 1024),
        },
        disk: {
          usagePct: memUsagePct,
        },
        checks,
      },
    }
  } catch (e) {
    return { ok: false, error: "health_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 11. Log Viewer (425)
// ---------------------------------------------------------------------------

export function logViewer(opts?: { lines?: number; level?: string }): AdminResult<{
  lines: Array<{ timestamp: string; level: string; message: string }>
  totalLines: number
  file: string
  sizeKb: number
}> {
  try {
    const logPath = path.join(WORKSPACE_ROOT, "dev.log")
    if (!existsSync(logPath)) {
      return { ok: true, data: { lines: [], totalLines: 0, file: logPath, sizeKb: 0 } }
    }

    const stat = statSync(logPath)
    const content = readFileSync(logPath, "utf8")
    const allLines = content.split("\n").filter(l => l.trim())

    const maxLines = opts?.lines ?? 100
    const level = opts?.level

    let filtered = allLines
    if (level && level !== "all") {
      filtered = allLines.filter(l => l.toLowerCase().includes(level.toLowerCase()))
    }

    const recentLines = filtered.slice(-maxLines).reverse()

    const parsedLines = recentLines.map(line => {
      // Try to extract timestamp + level from common log formats
      const match = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})?(.*?)(?:\[(\w+)\])?\s*(.*)/)
      let logLevel = "info"
      const lower = line.toLowerCase()
      if (lower.includes("error") || lower.includes("err")) logLevel = "error"
      else if (lower.includes("warn")) logLevel = "warn"
      else if (lower.includes("debug")) logLevel = "debug"

      return {
        timestamp: match?.[1] ?? "",
        level: logLevel,
        message: line.slice(0, 300),
      }
    })

    return {
      ok: true,
      data: {
        lines: parsedLines,
        totalLines: allLines.length,
        file: logPath,
        sizeKb: Math.round(stat.size / 1024),
      },
    }
  } catch (e) {
    return { ok: false, error: "log_viewer_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export async function adminSnapshot(): Promise<AdminResult<{
  providers: { total: number; enabled: number }
  models: { total: number }
  mcp: { total: number; enabled: number }
  plugins: { total: number; enabled: number }
  skills: { total: number }
  workspace: { exists: boolean; sizeMb: number }
  storage: { diskUsagePct: number; dbSizeMb: number; uploadsCount: number }
  health: { status: string }
  logs: { sizeKb: number; totalLines: number }
}>> {
  try {
    const [pm, mm, mcp, plugins, skills] = await Promise.all([
      providerManager(), modelManager(), mcpManager(), pluginManager(), skillManager(),
    ])
    const ws = workspaceManager()
    const storage = storageManager()
    const health = systemHealth()
    const logs = logViewer({ lines: 1 })

    return {
      ok: true,
      data: {
        providers: {
          total: pm.ok ? pm.data.total : 0,
          enabled: pm.ok ? pm.data.enabled : 0,
        },
        models: { total: mm.ok ? mm.data.total : 0 },
        mcp: {
          total: mcp.ok ? mcp.data.total : 0,
          enabled: mcp.ok ? mcp.data.enabled : 0,
        },
        plugins: {
          total: plugins.ok ? plugins.data.total : 0,
          enabled: plugins.ok ? plugins.data.enabled : 0,
        },
        skills: { total: skills.ok ? skills.data.total : 0 },
        workspace: {
          exists: ws.ok ? ws.data.exists : false,
          sizeMb: ws.ok ? ws.data.sizeMb : 0,
        },
        storage: {
          diskUsagePct: storage.ok ? storage.data.disk.usagePct : 0,
          dbSizeMb: storage.ok ? storage.data.database.sizeMb : 0,
          uploadsCount: storage.ok ? storage.data.uploads.fileCount : 0,
        },
        health: { status: health.ok ? health.data.status : "unknown" },
        logs: {
          sizeKb: logs.ok ? logs.data.sizeKb : 0,
          totalLines: logs.ok ? logs.data.totalLines : 0,
        },
      },
    }
  } catch (e) {
    return { ok: false, error: "snapshot_failed", message: String(e) }
  }
}
