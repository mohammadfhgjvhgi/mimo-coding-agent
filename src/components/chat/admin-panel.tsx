"use client"

/**
 * AdminPanel — Administration & Operations OS UI (spec section 30, features 415-425).
 *
 * 4 tabs:
 *  1. Managers   — providers (415), models (416), MCP (417), plugins (418), skills (419)
 *  2. System      — workspace (420), storage (421), health (424)
 *  3. Backup      — backup manager (422), import/export (423)
 *  4. Logs        — log viewer (425)
 */

import * as React from "react"
import {
  Settings, Cpu, Server, Puzzle, Zap, FolderTree, HardDrive, Database,
  Download, Upload, Activity, FileText, Check, X, AlertTriangle,
  RefreshCw, Plus, Trash2, Loader2, Shield, Clock, ArrowRight, Copy,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─────────────────────────────────────────────────────────────────────────
// Main panel
// ─────────────────────────────────────────────────────────────────────────

export function AdminPanel() {
  const [tab, setTab] = React.useState("managers")
  const [snapshot, setSnapshot] = React.useState<any>(null)
  const [loadingSnapshot, setLoadingSnapshot] = React.useState(true)

  const loadSnapshot = React.useCallback(async () => {
    setLoadingSnapshot(true)
    try {
      const res = await fetch("/api/admin-os?mode=snapshot")
      const data = await res.json()
      setSnapshot(data)
    } catch (err) {
      console.error("[AdminPanel] snapshot failed", err)
    } finally {
      setLoadingSnapshot(false)
    }
  }, [])

  React.useEffect(() => { loadSnapshot() }, [loadSnapshot])

  return (
    <div className="flex h-full flex-col" dir="rtl">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">الإدارة / Admin & Ops</span>
        </div>
        <Button variant="ghost" size="sm" onClick={loadSnapshot} className="h-7 gap-1 px-2 text-xs" disabled={loadingSnapshot}>
          <RefreshCw className={cn("h-3 w-3", loadingSnapshot && "animate-spin")} />
          تحديث
        </Button>
      </div>

      {/* Stats */}
      {snapshot && (
        <div className="grid grid-cols-3 gap-1.5 border-b border-border/60 bg-muted/30 px-3 py-2 text-center text-[0.65rem]">
          <Stat icon={<Server className="h-3 w-3 text-blue-500" />} label="مزودين" value={`${snapshot.providers?.enabled ?? 0}/${snapshot.providers?.total ?? 0}`} tone="blue" />
          <Stat icon={<Cpu className="h-3 w-3 text-purple-500" />} label="نماذج" value={snapshot.models?.total ?? 0} tone="purple" />
          <Stat icon={<Puzzle className="h-3 w-3 text-amber-500" />} label="MCP" value={`${snapshot.mcp?.enabled ?? 0}/${snapshot.mcp?.total ?? 0}`} tone="amber" />
          <Stat icon={<Zap className="h-3 w-3 text-emerald-500" />} label="إضافات" value={`${snapshot.plugins?.enabled ?? 0}/${snapshot.plugins?.total ?? 0}`} tone="emerald" />
          <Stat icon={<Activity className="h-3 w-3" />} label="الصحة" value={snapshot.health?.status ?? "—"} tone={snapshot.health?.status === "healthy" ? "emerald" : "amber"} />
          <Stat icon={<Database className="h-3 w-3 text-blue-500" />} label="DB" value={`${snapshot.storage?.dbSizeMb ?? 0}MB`} tone="blue" />
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 min-h-0 flex-col">
        <TabsList className="grid w-full grid-cols-4 rounded-none border-b border-border bg-transparent p-0">
          <TabsTrigger value="managers" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            المدراء
          </TabsTrigger>
          <TabsTrigger value="system" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            النظام
          </TabsTrigger>
          <TabsTrigger value="backup" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            نسخ احتياطي
          </TabsTrigger>
          <TabsTrigger value="logs" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            سجلات
          </TabsTrigger>
        </TabsList>

        <TabsContent value="managers" className="m-0 flex-1 min-h-0 overflow-hidden">
          <ManagersTab />
        </TabsContent>
        <TabsContent value="system" className="m-0 flex-1 min-h-0 overflow-hidden">
          <SystemTab />
        </TabsContent>
        <TabsContent value="backup" className="m-0 flex-1 min-h-0 overflow-hidden">
          <BackupTab onChange={loadSnapshot} />
        </TabsContent>
        <TabsContent value="logs" className="m-0 flex-1 min-h-0 overflow-hidden">
          <LogsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Stat({ icon, label, value, tone }: {
  icon: React.ReactNode; label: string; value: string | number; tone: "emerald" | "amber" | "red" | "blue" | "purple" | "default"
}) {
  const toneClass = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    red: "text-red-600 dark:text-red-400",
    blue: "text-blue-600 dark:text-blue-400",
    purple: "text-purple-600 dark:text-purple-400",
    default: "text-foreground",
  }[tone]
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className={cn("flex items-center gap-1 font-mono font-bold", toneClass)}>
        {icon}
        <span>{value}</span>
      </div>
      <span className="text-muted-foreground">{label}</span>
    </div>
  )
}

async function apiGet(mode: string) {
  const res = await fetch(`/api/admin-os?mode=${mode}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function apiCall(action: string, body: Record<string, unknown> = {}) {
  const res = await fetch("/api/admin-os", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "فشل الشبكة" }))
    throw new Error(err.message ?? `HTTP ${res.status}`)
  }
  return res.json()
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 1: Managers — 5 managers (415-419)
// ─────────────────────────────────────────────────────────────────────────

function ManagersTab() {
  const [active, setActive] = React.useState("providers")
  const [data, setData] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(false)

  const managers: Array<{ key: string; label: string; icon: React.ReactNode; feature: number }> = [
    { key: "providers", label: "Provider Manager", icon: <Server className="h-3.5 w-3.5" />, feature: 415 },
    { key: "models", label: "Model Manager", icon: <Cpu className="h-3.5 w-3.5" />, feature: 416 },
    { key: "mcp", label: "MCP Manager", icon: <Puzzle className="h-3.5 w-3.5" />, feature: 417 },
    { key: "plugins", label: "Plugin Manager", icon: <Zap className="h-3.5 w-3.5" />, feature: 418 },
    { key: "skills", label: "Skill Manager", icon: <Activity className="h-3.5 w-3.5" />, feature: 419 },
  ]

  const load = React.useCallback(async (key: string) => {
    setLoading(true)
    try {
      const result = await apiGet(key)
      setData(result)
    } catch (e) {
      toast.error((e as Error).message)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load(active) }, [active, load])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-2 py-1.5">
        <div className="flex flex-wrap gap-1">
          {managers.map(m => (
            <button
              key={m.key}
              onClick={() => setActive(m.key)}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-[0.65rem] font-medium transition-colors",
                active === m.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {m.icon}
              {m.label}
              <Badge variant="outline" className="text-[0.5rem] py-0 ml-1">#{m.feature}</Badge>
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1">
          {loading ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
              جارٍ التحميل…
            </div>
          ) : !data ? (
            <div className="text-center text-xs text-muted-foreground py-8">لا بيانات</div>
          ) : active === "providers" ? (
            <>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <MetricCard label="إجمالي" value={data.total} icon={<Server className="h-3 w-3" />} tone="blue" />
                <MetricCard label="مفعّل" value={data.enabled} icon={<Check className="h-3 w-3" />} tone="emerald" />
                <MetricCard label="بمفاتيح" value={data.withKeys} icon={<Shield className="h-3 w-3" />} tone="amber" />
              </div>
              {data.providers?.map((p: any, i: number) => (
                <div key={i} className="rounded-md border border-border/60 bg-card/50 p-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {p.enabled ? <Check className="h-3 w-3 text-emerald-500" /> : <X className="h-3 w-3 text-muted-foreground" />}
                    <span className="text-xs font-medium flex-1">{p.name}</span>
                    {p.isDefault && <Badge className="bg-primary/10 text-primary text-[0.55rem] py-0">افتراضي</Badge>}
                    {p.hasKey ? <Badge className="bg-emerald-500/10 text-emerald-600 text-[0.55rem] py-0">مفتاح ✓</Badge> : <Badge variant="outline" className="text-[0.55rem] py-0">لا مفتاح</Badge>}
                    <Badge variant="outline" className="text-[0.55rem] py-0">{p.modelCount} نماذج</Badge>
                  </div>
                  {p.baseURL && <code className="text-[0.6rem] font-mono text-muted-foreground block mt-0.5 truncate" dir="ltr">{p.baseURL}</code>}
                </div>
              ))}
            </>
          ) : active === "models" ? (
            <>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <MetricCard label="إجمالي النماذج" value={data.total} icon={<Cpu className="h-3 w-3" />} tone="purple" />
                <MetricCard label="مزودين" value={Object.keys(data.byProvider ?? {}).length} icon={<Server className="h-3 w-3" />} tone="blue" />
              </div>
              {data.models?.slice(0, 30).map((m: any, i: number) => (
                <div key={i} className="rounded-md border border-border/60 bg-card/50 p-1.5 flex items-center gap-2">
                  {m.enabled ? <Check className="h-3 w-3 text-emerald-500 shrink-0" /> : <X className="h-3 w-3 text-muted-foreground shrink-0" />}
                  <code className="text-[0.7rem] font-mono flex-1 truncate" dir="ltr">{m.name}</code>
                  <Badge variant="outline" className="text-[0.5rem] py-0">{m.provider}</Badge>
                  <span className="text-[0.55rem] text-muted-foreground">{(m.contextWindow / 1000).toFixed(0)}k</span>
                </div>
              ))}
            </>
          ) : active === "mcp" ? (
            <>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <MetricCard label="خوادم" value={data.total} icon={<Puzzle className="h-3 w-3" />} tone="amber" />
                <MetricCard label="مفعّل" value={data.enabled} icon={<Check className="h-3 w-3" />} tone="emerald" />
                <MetricCard label="أدوات" value={data.totalTools} icon={<Zap className="h-3 w-3" />} tone="blue" />
              </div>
              {data.servers?.map((s: any, i: number) => (
                <div key={i} className="rounded-md border border-border/60 bg-card/50 p-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium flex-1">{s.name}</span>
                    <Badge variant="outline" className="text-[0.55rem] py-0">{s.status}</Badge>
                    <Badge variant="outline" className="text-[0.55rem] py-0">{s.tools?.length ?? 0} أدوات</Badge>
                  </div>
                </div>
              ))}
            </>
          ) : active === "plugins" ? (
            <>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <MetricCard label="إجمالي" value={data.total} icon={<Zap className="h-3 w-3" />} tone="emerald" />
                <MetricCard label="مفعّل" value={data.enabled} icon={<Check className="h-3 w-3" />} tone="emerald" />
              </div>
              {data.plugins?.map((p: any, i: number) => (
                <div key={i} className="rounded-md border border-border/60 bg-card/50 p-2">
                  <div className="flex items-center gap-1.5">
                    {p.enabled ? <Check className="h-3 w-3 text-emerald-500" /> : <X className="h-3 w-3 text-muted-foreground" />}
                    <span className="text-xs font-medium flex-1">{p.displayName}</span>
                    <Badge variant="outline" className="text-[0.55rem] py-0">v{p.version}</Badge>
                  </div>
                  {p.description && <p className="text-[0.65rem] text-muted-foreground mt-0.5">{p.description}</p>}
                </div>
              ))}
            </>
          ) : active === "skills" ? (
            <>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <MetricCard label="إجمالي" value={data.total} icon={<Activity className="h-3 w-3" />} tone="blue" />
                <MetricCard label="مدمجة" value={data.builtin} icon={<Check className="h-3 w-3" />} tone="emerald" />
              </div>
              {data.skills?.map((s: any, i: number) => (
                <div key={i} className="rounded-md border border-border/60 bg-card/50 p-2">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[0.55rem] py-0">{s.skillType}</Badge>
                    {s.builtin && <Badge variant="outline" className="text-[0.55rem] py-0 text-blue-500 border-blue-500/30">مدمج</Badge>}
                    <span className="text-xs font-medium flex-1">{s.name}</span>
                  </div>
                  <p className="text-[0.65rem] text-muted-foreground mt-0.5">{s.description}</p>
                </div>
              ))}
            </>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  )
}

function MetricCard({ label, value, icon, tone }: {
  label: string; value: string | number; icon: React.ReactNode; tone: "emerald" | "amber" | "red" | "blue" | "purple" | "default"
}) {
  const toneClass = {
    emerald: "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400",
    amber: "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400",
    red: "border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400",
    blue: "border-blue-500/30 bg-blue-500/5 text-blue-600 dark:text-blue-400",
    purple: "border-purple-500/30 bg-purple-500/5 text-purple-600 dark:text-purple-400",
    default: "border-border/60 bg-card/50",
  }[tone]
  return (
    <div className={cn("rounded-md border p-2", toneClass)}>
      <div className="flex items-center gap-1 text-[0.65rem] text-muted-foreground mb-0.5">{icon}{label}</div>
      <div className="text-sm font-mono font-bold">{value}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 2: System — workspace (420), storage (421), health (424)
// ─────────────────────────────────────────────────────────────────────────

function SystemTab() {
  const [data, setData] = React.useState<{ workspace: any; storage: any; health: any } | null>(null)
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [ws, storage, health] = await Promise.all([
        apiGet("workspace"), apiGet("storage"), apiGet("health"),
      ])
      setData({ workspace: ws, storage, health })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  if (loading || !data) {
    return <div className="text-center text-xs text-muted-foreground py-8"><RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" /></div>
  }

  const h = data.health
  const statusTone = h.status === "healthy" ? "emerald" : h.status === "degraded" ? "amber" : "red"
  const statusLabel = h.status === "healthy" ? "سليم ✅" : h.status === "degraded" ? "متدهور ⚠️" : "حرج 🔴"

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        {/* Health (424) */}
        <div className={cn("rounded-md border p-3", `border-${statusTone}-500/30 bg-${statusTone}-500/5`)}>
          <div className="flex items-center gap-2 mb-2">
            <Activity className={cn("h-4 w-4", `text-${statusTone}-500`)} />
            <span className="text-sm font-semibold">System Health (424)</span>
            <Badge variant="outline" className={cn("text-[0.6rem] py-0 ml-auto", `border-${statusTone}-500/30 text-${statusTone}-600`)}>{statusLabel}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[0.7rem]">
            <div className="flex justify-between"><span className="text-muted-foreground">RAM:</span><span className="font-mono">{h.memory.usagePct}%</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Process:</span><span className="font-mono">{h.memory.processMb}MB</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">CPU:</span><span className="font-mono">{h.cpu.cores} cores</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Load:</span><span className="font-mono">{h.cpu.loadAvg[0].toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Uptime:</span><span className="font-mono">{Math.round(h.uptime.process / 60)}min</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">DB:</span><span className="font-mono">{h.database.sizeMb}MB</span></div>
          </div>
          <div className="mt-2 pt-2 border-t border-border/40 space-y-0.5">
            {h.checks?.map((c: any, i: number) => (
              <div key={i} className="flex items-center gap-1.5 text-[0.65rem]">
                {c.status === "pass" ? <Check className="h-3 w-3 text-emerald-500" /> : c.status === "warn" ? <AlertTriangle className="h-3 w-3 text-amber-500" /> : <X className="h-3 w-3 text-red-500" />}
                <span className="text-muted-foreground">{c.name}:</span>
                <span>{c.message}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Workspace (420) */}
        <div className="rounded-md border border-border/60 bg-card/50 p-3">
          <div className="flex items-center gap-2 mb-2">
            <FolderTree className="h-4 w-4 text-blue-500" />
            <span className="text-sm font-semibold">Workspace Manager (420)</span>
          </div>
          <code className="text-[0.65rem] font-mono text-muted-foreground block break-all mb-2" dir="ltr">{data.workspace.root}</code>
          <div className="grid grid-cols-3 gap-2 text-[0.7rem]">
            <div className="flex justify-between"><span className="text-muted-foreground">ملفات:</span><span className="font-mono">{data.workspace.totalFiles}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">مجلدات:</span><span className="font-mono">{data.workspace.totalDirs}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">حجم:</span><span className="font-mono">{data.workspace.sizeMb}MB</span></div>
          </div>
        </div>

        {/* Storage (421) */}
        <div className="rounded-md border border-border/60 bg-card/50 p-3">
          <div className="flex items-center gap-2 mb-2">
            <HardDrive className="h-4 w-4 text-purple-500" />
            <span className="text-sm font-semibold">Storage Manager (421)</span>
          </div>
          <div className="space-y-1 text-[0.7rem]">
            <div className="flex justify-between"><span className="text-muted-foreground">Disk:</span><span className="font-mono">{data.storage.disk.usagePct}% used</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Database:</span><span className="font-mono">{data.storage.database.sizeMb}MB</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Uploads:</span><span className="font-mono">{data.storage.uploads.fileCount} files ({data.storage.uploads.sizeMb}MB)</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Logs:</span><span className="font-mono">{data.storage.logs.sizeMb}MB</span></div>
          </div>
        </div>

        <Button onClick={load} variant="outline" size="sm" className="w-full h-7 text-xs">
          <RefreshCw className="h-3 w-3" /> تحديث
        </Button>
      </div>
    </ScrollArea>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 3: Backup — backup manager (422), import/export (423)
// ─────────────────────────────────────────────────────────────────────────

function BackupTab({ onChange }: { onChange: () => void }) {
  const [backups, setBackups] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)
  const [creating, setCreating] = React.useState(false)
  const [exporting, setExporting] = React.useState(false)
  const [exportData, setExportData] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiCall("backup_list")
      setBackups(data ?? [])
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    setCreating(true)
    try {
      const data = await apiCall("backup_create")
      toast.success(`تم إنشاء نسخة احتياطية (${data.sizeMb}MB)`)
      load()
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const handleRestore = async (backupId: string) => {
    if (!confirm("استعادة هذه النسخة؟ سيتم استبدال DB الحالي.")) return
    try {
      await apiCall("backup_restore", { backupId })
      toast.success("تمت الاستعادة")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleDelete = async (backupId: string) => {
    if (!confirm("حذف هذه النسخة؟")) return
    try {
      await apiCall("backup_delete", { backupId })
      toast.success("حُذفت")
      load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const data = await apiCall("export")
      const json = JSON.stringify(data, null, 2)
      setExportData(json)
      toast.success(`تم التصدير: ${data.stats.conversations} محادثة، ${data.stats.memories} ذاكرة`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  const handleImport = async () => {
    const data = prompt("الصق JSON المستورد:")
    if (!data) return
    try {
      const result = await apiCall("import", { data })
      toast.success(`تم استيراد ${result.imported} عنصر`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleCopyExport = () => {
    if (exportData) {
      navigator.clipboard.writeText(exportData)
      toast.success("نُسخ")
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        {/* Backup Manager (422) */}
        <div className="rounded-md border border-border/60 bg-card/50 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-blue-500" />
            <span className="text-sm font-semibold">Backup Manager (422)</span>
          </div>
          <Button onClick={handleCreate} disabled={creating} size="sm" className="w-full h-7 text-xs">
            {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            إنشاء نسخة احتياطية
          </Button>
          <div className="space-y-1">
            {loading ? (
              <div className="text-center text-xs text-muted-foreground py-4"><RefreshCw className="h-3 w-3 animate-spin mx-auto" /></div>
            ) : backups.length === 0 ? (
              <div className="text-center text-xs text-muted-foreground py-4">لا نسخ احتياطية</div>
            ) : (
              backups.map((b, i) => (
                <div key={i} className="rounded-md border border-border/40 p-1.5 flex items-center gap-2">
                  <Database className="h-3 w-3 text-blue-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <code className="text-[0.6rem] font-mono block truncate" dir="ltr">{b.backupId}</code>
                    <span className="text-[0.55rem] text-muted-foreground">{b.sizeMb}MB — {new Date(b.createdAt).toLocaleString("ar-SA")}</span>
                  </div>
                  <Button onClick={() => handleRestore(b.backupId)} variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-emerald-500" title="استعادة">
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                  <Button onClick={() => handleDelete(b.backupId)} variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-red-500" title="حذف">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Import/Export (423) */}
        <div className="rounded-md border border-border/60 bg-card/50 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-purple-500" />
            <span className="text-sm font-semibold">Import/Export (423)</span>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleExport} disabled={exporting} size="sm" className="h-7 gap-1 text-xs flex-1">
              {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
              تصدير
            </Button>
            <Button onClick={handleImport} variant="outline" size="sm" className="h-7 gap-1 text-xs flex-1">
              <Upload className="h-3 w-3" />
              استيراد
            </Button>
          </div>
          {exportData && (
            <div className="rounded-md border border-border/40 bg-muted/20 p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[0.65rem] font-semibold text-muted-foreground">البيانات المُصدّرة:</span>
                <Button onClick={handleCopyExport} variant="ghost" size="icon" className="h-5 w-5">
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <pre className="text-[0.55rem] font-mono max-h-32 overflow-y-auto whitespace-pre-wrap text-muted-foreground" dir="ltr">{exportData.slice(0, 500)}…</pre>
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 4: Logs — log viewer (425)
// ─────────────────────────────────────────────────────────────────────────

function LogsTab() {
  const [data, setData] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)
  const [level, setLevel] = React.useState("all")
  const [lines, setLines] = React.useState(100)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ mode: "logs", lines: String(lines) })
      if (level !== "all") params.set("level", level)
      const res = await fetch(`/api/admin-os?${params}`)
      const result = await res.json()
      setData(result)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [level, lines])

  React.useEffect(() => { load() }, [load])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-3 py-2 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            Log Viewer (425)
          </span>
          <Button onClick={load} variant="ghost" size="sm" className="h-7 w-7 p-0">
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          </Button>
        </div>
        <div className="flex gap-2">
          <Select value={level} onValueChange={setLevel}>
            <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              <SelectItem value="error">Errors فقط</SelectItem>
              <SelectItem value="warn">Warnings فقط</SelectItem>
              <SelectItem value="info">Info فقط</SelectItem>
            </SelectContent>
          </Select>
          <Select value={String(lines)} onValueChange={(v) => setLines(Number(v))}>
            <SelectTrigger className="h-7 text-xs w-20"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
              <SelectItem value="200">200</SelectItem>
              <SelectItem value="500">500</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {data && (
          <div className="flex items-center gap-2 text-[0.6rem] text-muted-foreground">
            <span>{data.totalLines} سطر</span>
            <span>•</span>
            <span>{data.sizeKb}KB</span>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-1 space-y-0.5">
          {loading ? (
            <div className="text-center text-xs text-muted-foreground py-8"><RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" /></div>
          ) : !data || data.lines.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-8">لا سجلات</div>
          ) : (
            data.lines.map((line: any, i: number) => (
              <div key={i} className={cn(
                "rounded px-2 py-0.5 text-[0.6rem] font-mono",
                line.level === "error" ? "bg-red-500/5 text-red-600 dark:text-red-400" :
                line.level === "warn" ? "bg-amber-500/5 text-amber-600 dark:text-amber-400" :
                "text-muted-foreground"
              )} dir="ltr">
                {line.message}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
