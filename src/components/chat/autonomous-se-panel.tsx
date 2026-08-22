"use client"

/**
 * AutonomousSEPanel — complete Autonomous Software Engineering OS UI.
 * Spec section 25 (20 features: 351-370).
 *
 * 4 tabs:
 *  1. Health Scan    — run all 10 detectors (health, architecture, dead code,
 *                      duplicates, coupling, cycles, missing tests, security,
 *                      tech debt, hotspots)
 *  2. Backlog         — generated items list with filter, prioritize, cooldown, supersede
 *  3. DAG             — task dependency graph + execute (sequential + parallel)
 *  4. Maintenance     — continuous health loop + autonomous maintenance
 */

import * as React from "react"
import {
  Activity, AlertTriangle, Bug, Check, X, RefreshCw, Search, Play, Pause,
  Cpu, GitBranch, Network, Shield, Zap, ListChecks, ChevronRight, Loader2,
  TrendingDown, Layers, Copy, Code2, FileWarning, Flame, Clock, Workflow,
  CircleDot, ArrowRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

interface Snapshot {
  totalItems: number
  pendingCount: number
  doneCount: number
  cooldownCount: number
  supersededCount: number
  byType: Record<string, number>
  bySeverity: Record<string, number>
  lastHealthScore: number | null
  totalScans: number
}

interface BacklogItem {
  id: string
  type: string
  severity: string
  targetPath: string
  description: string
  status: string
  priority: number
  dependencies: string[]
  supersededBy: string | null
  cooldownUntil: string | null
  occurrences: number
  estimatedMin: number | null
  createdAt: string
}

interface ScanResult {
  type: string
  count: number
  items: any[]
  reason: string
}

// ─────────────────────────────────────────────────────────────────────────
// Main panel
// ─────────────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  dead_code: "كود ميت",
  duplicate_logic: "تكرار منطق",
  coupling: "ترابط",
  import_cycle: "دورة استيراد",
  missing_test: "اختبار مفقود",
  security_debt: "دين أمني",
  tech_debt: "دين تقني",
  hotspot: "نقطة ساخنة",
  architecture: "بنية",
  health: "صحة",
}

const SEVERITY_TONES: Record<string, string> = {
  low: "border-blue-500/30 bg-blue-500/5 text-blue-600 dark:text-blue-400",
  medium: "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400",
  high: "border-orange-500/30 bg-orange-500/5 text-orange-600 dark:text-orange-400",
  critical: "border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400",
}

const STATUS_TONES: Record<string, string> = {
  pending: "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400",
  in_progress: "border-blue-500/30 bg-blue-500/5 text-blue-600 dark:text-blue-400",
  done: "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400",
  superseded: "border-muted bg-muted/30 text-muted-foreground",
  cooldown: "border-purple-500/30 bg-purple-500/5 text-purple-600 dark:text-purple-400",
  skipped: "border-muted bg-muted/30 text-muted-foreground",
}

export function AutonomousSEPanel() {
  const [tab, setTab] = React.useState("scan")
  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null)
  const [loadingSnapshot, setLoadingSnapshot] = React.useState(true)

  const loadSnapshot = React.useCallback(async () => {
    setLoadingSnapshot(true)
    try {
      const res = await fetch("/api/autonomous-se?mode=snapshot")
      const data = await res.json()
      setSnapshot(data)
    } catch (err) {
      console.error("[AutonomousSEPanel] snapshot failed", err)
    } finally {
      setLoadingSnapshot(false)
    }
  }, [])

  React.useEffect(() => { loadSnapshot() }, [loadSnapshot])

  return (
    <div className="flex h-full flex-col" dir="rtl">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <Workflow className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">هندسة ذاتية / Autonomous SE</span>
        </div>
        <Button variant="ghost" size="sm" onClick={loadSnapshot} className="h-7 gap-1 px-2 text-xs" disabled={loadingSnapshot}>
          <RefreshCw className={cn("h-3 w-3", loadingSnapshot && "animate-spin")} />
          تحديث
        </Button>
      </div>

      {/* Stats */}
      {snapshot && (
        <div className="grid grid-cols-3 gap-1.5 border-b border-border/60 bg-muted/30 px-3 py-2 text-center text-[0.65rem]">
          <Stat icon={<ListChecks className="h-3 w-3" />} label="إجمالي" value={snapshot.totalItems} tone="default" />
          <Stat icon={<Clock className="h-3 w-3 text-amber-500" />} label="معلّق" value={snapshot.pendingCount} tone="amber" />
          <Stat icon={<Check className="h-3 w-3 text-emerald-500" />} label="منجز" value={snapshot.doneCount} tone="emerald" />
          <Stat icon={<Pause className="h-3 w-3 text-purple-500" />} label="cooldown" value={snapshot.cooldownCount} tone="purple" />
          <Stat icon={<X className="h-3 w-3 text-muted-foreground" />} label="ملغى" value={snapshot.supersededCount} tone="default" />
          <Stat
            icon={snapshot.lastHealthScore !== null
              ? (snapshot.lastHealthScore >= 80 ? <Check className="h-3 w-3 text-emerald-500" /> : <TrendingDown className="h-3 w-3 text-amber-500" />)
              : <Activity className="h-3 w-3 text-muted-foreground" />}
            label="الصحة"
            value={snapshot.lastHealthScore !== null ? `${snapshot.lastHealthScore}%` : "—"}
            tone={snapshot.lastHealthScore !== null && snapshot.lastHealthScore >= 80 ? "emerald" : "amber"}
          />
        </div>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 min-h-0 flex-col">
        <TabsList className="grid w-full grid-cols-4 rounded-none border-b border-border bg-transparent p-0">
          <TabsTrigger value="scan" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            الفحص
          </TabsTrigger>
          <TabsTrigger value="backlog" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            المهام
          </TabsTrigger>
          <TabsTrigger value="dag" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            DAG
          </TabsTrigger>
          <TabsTrigger value="maintenance" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            صيانة
          </TabsTrigger>
        </TabsList>

        <TabsContent value="scan" className="m-0 flex-1 min-h-0 overflow-hidden">
          <ScanTab onChange={loadSnapshot} />
        </TabsContent>
        <TabsContent value="backlog" className="m-0 flex-1 min-h-0 overflow-hidden">
          <BacklogTab onChange={loadSnapshot} />
        </TabsContent>
        <TabsContent value="dag" className="m-0 flex-1 min-h-0 overflow-hidden">
          <DAGTab onChange={loadSnapshot} />
        </TabsContent>
        <TabsContent value="maintenance" className="m-0 flex-1 min-h-0 overflow-hidden">
          <MaintenanceTab onChange={loadSnapshot} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Stat({ icon, label, value, tone }: {
  icon: React.ReactNode; label: string; value: number | string; tone: "default" | "emerald" | "amber" | "purple"
}) {
  const toneClass = {
    default: "text-foreground",
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    purple: "text-purple-600 dark:text-purple-400",
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

async function apiCall(action: string, body: Record<string, unknown> = {}) {
  const res = await fetch("/api/autonomous-se", {
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
// Tab 1: Scan — 10 detectors with one-click "run all" + individual run
// ─────────────────────────────────────────────────────────────────────────

const SCANNERS: Array<{ key: string; label: string; icon: React.ReactNode; feature: number }> = [
  { key: "health_scan", label: "Repository Health Scan", icon: <Activity className="h-3.5 w-3.5" />, feature: 351 },
  { key: "architecture_scan", label: "Architecture Scan", icon: <Layers className="h-3.5 w-3.5" />, feature: 352 },
  { key: "dead_code", label: "Dead Code Detection", icon: <Bug className="h-3.5 w-3.5" />, feature: 353 },
  { key: "duplicate_logic", label: "Duplicate Logic", icon: <Copy className="h-3.5 w-3.5" />, feature: 354 },
  { key: "coupling", label: "Coupling Analysis", icon: <Network className="h-3.5 w-3.5" />, feature: 355 },
  { key: "import_cycle", label: "Import Cycle Detection", icon: <GitBranch className="h-3.5 w-3.5" />, feature: 356 },
  { key: "missing_test", label: "Missing Test Detection", icon: <FileWarning className="h-3.5 w-3.5" />, feature: 357 },
  { key: "security_debt", label: "Security Debt Scan", icon: <Shield className="h-3.5 w-3.5" />, feature: 358 },
  { key: "tech_debt", label: "Technical Debt Scan", icon: <Code2 className="h-3.5 w-3.5" />, feature: 359 },
  { key: "hotspot", label: "Hotspot Detection", icon: <Flame className="h-3.5 w-3.5" />, feature: 360 },
]

function ScanTab({ onChange }: { onChange: () => void }) {
  const [results, setResults] = React.useState<Record<string, any>>({})
  const [running, setRunning] = React.useState<string | null>(null)
  const [runningAll, setRunningAll] = React.useState(false)

  const runScan = async (key: string) => {
    setRunning(key)
    try {
      const data = await apiCall(key)
      setResults(prev => ({ ...prev, [key]: data }))
      const count = Array.isArray(data) ? data.length : (data.healthScore !== undefined ? `${data.healthScore}%` : "✓")
      toast.success(`${key}: ${count}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setRunning(null)
    }
  }

  const runAll = async () => {
    setRunningAll(true)
    let success = 0
    for (const s of SCANNERS) {
      try {
        const data = await apiCall(s.key)
        setResults(prev => ({ ...prev, [s.key]: data }))
        success++
      } catch (e) {
        console.error(s.key, e)
      }
    }
    toast.success(`تم تشغيل ${success}/${SCANNERS.length} فاحص`)
    onChange()
    setRunningAll(false)
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">الفحوصات / Scans (351-360)</h3>
            <p className="text-[0.7rem] text-muted-foreground">10 فاحصات حتمية بـ 0 LLM calls</p>
          </div>
          <Button onClick={runAll} disabled={runningAll || !!running} size="sm" className="h-7 gap-1 text-xs">
            {runningAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            شغّل الكل
          </Button>
        </div>

        <div className="space-y-1.5">
          {SCANNERS.map(s => {
            const data = results[s.key]
            const count = data ? (Array.isArray(data) ? data.length : (data.healthScore !== undefined ? `${data.healthScore}%` : Object.keys(data).length)) : null
            return (
              <div key={s.key} className="rounded-md border border-border/60 bg-card/50 p-2 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {s.icon}
                    <span className="text-xs font-medium">{s.label}</span>
                    <Badge variant="outline" className="text-[0.55rem] py-0">#{s.feature}</Badge>
                  </div>
                  {data && (
                    <p className="text-[0.65rem] text-muted-foreground mt-0.5">
                      {Array.isArray(data) && data.length > 0 && `${data.length} مشكلة مكتشفة`}
                      {Array.isArray(data) && data.length === 0 && "لا مشاكل ✅"}
                      {data.healthScore !== undefined && `Health score: ${data.healthScore}%`}
                      {data.layers && `${data.layers.length} طبقات، ${data.crossLayerDeps} اعتماد`}
                      {data.nodes && `${data.nodes.length} nodes`}
                    </p>
                  )}
                </div>
                <Button
                  onClick={() => runScan(s.key)}
                  disabled={runningAll}
                  variant="outline"
                  size="sm"
                  className="h-6 gap-1 text-xs"
                >
                  {running === s.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  {count !== null && <span className="font-mono">{count}</span>}
                </Button>
              </div>
            )
          })}
        </div>

        {/* Last result details */}
        {Object.keys(results).length > 0 && (
          <div className="border-t border-border/60 pt-2">
            <p className="text-xs font-semibold mb-1">آخر النتائج:</p>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {Object.entries(results).slice(-3).map(([key, data]) => (
                <div key={key} className="rounded-md border border-border/40 bg-muted/20 p-1.5 text-[0.65rem]">
                  <p className="font-mono font-semibold">{key}:</p>
                  <code className="font-mono block break-all mt-0.5 text-muted-foreground" dir="ltr">
                    {JSON.stringify(data).slice(0, 200)}{JSON.stringify(data).length > 200 ? "…" : ""}
                  </code>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 2: Backlog — generated items with filter, prioritize, cooldown
// ─────────────────────────────────────────────────────────────────────────

function BacklogTab({ onChange }: { onChange: () => void }) {
  const [items, setItems] = React.useState<BacklogItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [statusFilter, setStatusFilter] = React.useState<string>("pending")
  const [typeFilter, setTypeFilter] = React.useState<string>("all")
  const [generating, setGenerating] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/autonomous-se?mode=backlog&status=${statusFilter}&limit=100`)
      const data = await res.json()
      setItems(data ?? [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  React.useEffect(() => { load() }, [load])

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const data = await apiCall("backlog_generate")
      toast.success(`أُنشئت ${data.created} مهمة جديدة، ${data.deduplicated} مُدمجة`)
      load()
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setGenerating(false)
    }
  }

  const handlePrioritize = async () => {
    try {
      const data = await apiCall("backlog_prioritize")
      toast.success(`أُعيد ترتيب ${data.reprioritized} مهمة`)
      load()
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleDedup = async () => {
    try {
      const data = await apiCall("backlog_dedup")
      toast.success(`دُمجت ${data.merged} مهمة مكررة`)
      load()
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleCooldown = async (id: string) => {
    try {
      const data = await apiCall("backlog_cooldown", { itemIds: [id], hoursAhead: 24 })
      toast.success(`وُضعت ${data.cooledDown} مهمة في cooldown`)
      load()
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleSupersede = async (oldId: string) => {
    const newId = prompt("أدخل ID المهمة الجديدة التي تُلغي القديمة:")
    if (!newId) return
    try {
      await apiCall("task_supersede", { oldId, newId })
      toast.success("تم الإلغاء")
      load()
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const filtered = typeFilter === "all" ? items : items.filter(i => i.type === typeFilter)

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="border-b border-border/60 bg-muted/20 px-3 py-2 space-y-2">
        <div className="flex gap-1.5">
          <Button onClick={handleGenerate} disabled={generating} size="sm" className="h-7 gap-1 text-xs flex-1">
            {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            توليد (361)
          </Button>
          <Button onClick={handlePrioritize} variant="outline" size="sm" className="h-7 gap-1 text-xs flex-1">
            <ListChecks className="h-3 w-3" />
            رتّب (363)
          </Button>
          <Button onClick={handleDedup} variant="outline" size="sm" className="h-7 gap-1 text-xs flex-1">
            <Copy className="h-3 w-3" />
            دمج (362)
          </Button>
        </div>
        <div className="flex gap-1.5">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-7 text-xs flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">معلّق</SelectItem>
              <SelectItem value="in_progress">قيد التنفيذ</SelectItem>
              <SelectItem value="done">منجز</SelectItem>
              <SelectItem value="cooldown">cooldown</SelectItem>
              <SelectItem value="superseded">ملغى</SelectItem>
              <SelectItem value="all">الكل</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-7 text-xs flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأنواع</SelectItem>
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* List */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1">
          {loading ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
              جارٍ التحميل…
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <ListChecks className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              لا مهام. اضغط "توليد" لإنشائها.
            </div>
          ) : (
            filtered.map(item => (
              <BacklogCard
                key={item.id}
                item={item}
                onCooldown={() => handleCooldown(item.id)}
                onSupersede={() => handleSupersede(item.id)}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function BacklogCard({ item, onCooldown, onSupersede }: {
  item: BacklogItem; onCooldown: () => void; onSupersede: () => void
}) {
  const [expanded, setExpanded] = React.useState(false)
  const time = new Date(item.createdAt).toLocaleDateString("ar-SA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })

  return (
    <div className={cn("rounded-md border p-2", SEVERITY_TONES[item.severity] ?? "border-border/60 bg-card/50")}>
      <button onClick={() => setExpanded(!expanded)} className="w-full text-right">
        <div className="flex items-center gap-1.5 flex-wrap mb-1">
          <Badge variant="outline" className="text-[0.55rem] py-0">
            {TYPE_LABELS[item.type] ?? item.type}
          </Badge>
          <Badge variant="outline" className={cn("text-[0.55rem] py-0", STATUS_TONES[item.status])}>
            {item.status}
          </Badge>
          <Badge variant="outline" className="text-[0.55rem] py-0">
            P{item.priority}
          </Badge>
          {item.occurrences > 1 && (
            <Badge variant="outline" className="text-[0.55rem] py-0 text-purple-500 border-purple-500/30">
              ×{item.occurrences}
            </Badge>
          )}
          {item.estimatedMin && (
            <Badge variant="outline" className="text-[0.55rem] py-0 text-muted-foreground">
              {item.estimatedMin}min
            </Badge>
          )}
          <span className="text-[0.55rem] text-muted-foreground ml-auto">{time}</span>
        </div>
        <code className="text-[0.65rem] font-mono block truncate text-muted-foreground" dir="ltr">{item.targetPath}</code>
      </button>

      {expanded && (
        <div className="mt-2 pt-2 border-t border-border/40 space-y-1.5 text-[0.7rem]">
          <p>{item.description}</p>
          {item.dependencies.length > 0 && (
            <div>
              <span className="text-muted-foreground">الاعتماديات:</span>
              <code className="font-mono ml-1" dir="ltr">{item.dependencies.join(", ")}</code>
            </div>
          )}
          {item.cooldownUntil && (
            <p className="text-purple-500">cooldown حتى: {new Date(item.cooldownUntil).toLocaleString("ar-SA")}</p>
          )}
          <div className="flex gap-1.5 mt-2">
            <Button onClick={onCooldown} variant="outline" size="sm" className="h-6 gap-1 text-[0.65rem] flex-1">
              <Pause className="h-3 w-3" /> cooldown (364)
            </Button>
            <Button onClick={onSupersede} variant="outline" size="sm" className="h-6 gap-1 text-[0.65rem] flex-1">
              <X className="h-3 w-3" /> ألغِ (365)
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 3: DAG — task dependency graph + execute
// ─────────────────────────────────────────────────────────────────────────

function DAGTab({ onChange }: { onChange: () => void }) {
  const [dag, setDag] = React.useState<{ nodes: any[]; edges: any[]; readyToExecute: string[] } | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [executing, setExecuting] = React.useState<"sequential" | "parallel" | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiCall("task_dag")
      setDag(data)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  const handleSequential = async () => {
    if (!dag || dag.readyToExecute.length === 0) {
      toast.error("لا مهام جاهزة للتنفيذ")
      return
    }
    setExecuting("sequential")
    try {
      const data = await apiCall("sequential_execute", { itemIds: dag.readyToExecute })
      toast.success(`تم تنفيذ ${data.succeeded}/${data.executed} مهمة`)
      load()
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setExecuting(null)
    }
  }

  const handleParallel = async () => {
    setExecuting("parallel")
    try {
      const data = await apiCall("parallel_work")
      toast.success(`تم تنفيذ ${data.parallelJobs} مهمة بالتوازي`)
      load()
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setExecuting(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-3 py-2 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">اعتماديات المهام / Task DAG (366)</span>
          <Button onClick={load} variant="ghost" size="sm" className="h-7 w-7 p-0">
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          </Button>
        </div>
        <div className="flex gap-1.5">
          <Button onClick={handleSequential} disabled={!!executing || !dag?.readyToExecute.length} size="sm" className="h-7 gap-1 text-xs flex-1">
            {executing === "sequential" ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
            تسلسلي (367)
          </Button>
          <Button onClick={handleParallel} disabled={!!executing} variant="outline" size="sm" className="h-7 gap-1 text-xs flex-1">
            {executing === "parallel" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Cpu className="h-3 w-3" />}
            متوازي (368)
          </Button>
        </div>
        {dag && (
          <div className="grid grid-cols-3 gap-1 text-center text-[0.6rem]">
            <div className="rounded-md bg-muted/30 p-1">
              <div className="font-bold">{dag.nodes.length}</div>
              <div className="text-muted-foreground">عُقد</div>
            </div>
            <div className="rounded-md bg-muted/30 p-1">
              <div className="font-bold">{dag.edges.length}</div>
              <div className="text-muted-foreground">حواف</div>
            </div>
            <div className="rounded-md bg-emerald-500/10 p-1">
              <div className="font-bold text-emerald-600 dark:text-emerald-400">{dag.readyToExecute.length}</div>
              <div className="text-muted-foreground">جاهزة</div>
            </div>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1">
          {loading ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
              جارٍ التحميل…
            </div>
          ) : !dag || dag.nodes.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <Workflow className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              لا مهام. ولّدها من تبويب "المهام".
            </div>
          ) : (
            dag.nodes.map(node => {
              const isReady = dag.readyToExecute.includes(node.id)
              return (
                <div key={node.id} className={cn(
                  "rounded-md border p-2 flex items-center gap-2",
                  isReady ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/60 bg-card/50"
                )}>
                  <CircleDot className={cn("h-3 w-3 shrink-0", isReady ? "text-emerald-500" : "text-muted-foreground")} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[0.55rem] py-0">
                        {TYPE_LABELS[node.type] ?? node.type}
                      </Badge>
                      <Badge variant="outline" className="text-[0.55rem] py-0">P{node.priority}</Badge>
                      {isReady && <Badge className="bg-emerald-500/15 text-emerald-600 text-[0.55rem] py-0">جاهزة</Badge>}
                    </div>
                    <code className="text-[0.6rem] font-mono block truncate text-muted-foreground mt-0.5" dir="ltr">
                      {node.id.slice(-12)}
                    </code>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 4: Maintenance — continuous loop + autonomous maintenance
// ─────────────────────────────────────────────────────────────────────────

function MaintenanceTab({ onChange }: { onChange: () => void }) {
  const [running, setRunning] = React.useState<"loop" | "maintenance" | null>(null)
  const [lastLoop, setLastLoop] = React.useState<any>(null)
  const [lastMaintenance, setLastMaintenance] = React.useState<any>(null)

  const handleLoop = async () => {
    setRunning("loop")
    try {
      const data = await apiCall("continuous_health")
      setLastLoop(data)
      toast.success(`فحص دوري: ${data.newIssues} مشكلة جديدة، الصحة ${data.healthScore}%`)
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setRunning(null)
    }
  }

  const handleMaintenance = async () => {
    setRunning("maintenance")
    try {
      const data = await apiCall("autonomous_maintenance")
      setLastMaintenance(data)
      toast.success(`صيانة: ${data.autoFixed} مُصلح، ${data.cooldowns} cooldown، ${data.superseded} مُلغى`)
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setRunning(null)
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <RefreshCw className="h-4 w-4 text-primary" />
            الصيانة الذاتية / Autonomous Maintenance
          </h3>
          <p className="text-[0.7rem] text-muted-foreground mt-0.5">
            فحص دوري + إصلاح تلقائي للمهام البسيطة
          </p>
        </div>

        {/* Continuous Health Loop (369) */}
        <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 space-y-2">
          <div className="flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-blue-500" />
            <span className="text-xs font-semibold">Continuous Health Loop (369)</span>
          </div>
          <p className="text-[0.7rem] text-muted-foreground">
            يشغّل فحص الصحة كامل + يولّد backlog + دمج + ترتيب تلقائي
          </p>
          <Button onClick={handleLoop} disabled={!!running} size="sm" className="w-full h-8 text-xs">
            {running === "loop" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            شغّل دورة فحص
          </Button>
          {lastLoop && (
            <div className="rounded-md border border-border/40 p-1.5 text-[0.7rem] space-y-0.5">
              <div className="flex justify-between">
                <span>الصحة:</span>
                <span className="font-mono font-bold">{lastLoop.healthScore}%</span>
              </div>
              <div className="flex justify-between">
                <span>مشاكل جديدة:</span>
                <span className="font-mono">{lastLoop.newIssues}</span>
              </div>
            </div>
          )}
        </div>

        {/* Autonomous Maintenance (370) */}
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 space-y-2">
          <div className="flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-xs font-semibold">Autonomous Maintenance (370)</span>
          </div>
          <p className="text-[0.7rem] text-muted-foreground">
            cooldown للأولوية المنخفضة + دمج المكرر + تنفيذ متوازي للمستقل
          </p>
          <Button onClick={handleMaintenance} disabled={!!running} size="sm" variant="outline" className="w-full h-8 text-xs">
            {running === "maintenance" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            شغّل صيانة
          </Button>
          {lastMaintenance && (
            <div className="rounded-md border border-border/40 p-1.5 text-[0.7rem] space-y-0.5">
              <div className="flex justify-between">
                <span>مُصلح تلقائياً:</span>
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{lastMaintenance.autoFixed}</span>
              </div>
              <div className="flex justify-between">
                <span>cooldown:</span>
                <span className="font-mono">{lastMaintenance.cooldowns}</span>
              </div>
              <div className="flex justify-between">
                <span>مُلغى (مدمج):</span>
                <span className="font-mono">{lastMaintenance.superseded}</span>
              </div>
              <div className="flex justify-between border-t border-border/40 pt-0.5 mt-0.5">
                <span>متبقّي معلّق:</span>
                <span className="font-mono font-bold">{lastMaintenance.totalPending}</span>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[0.65rem] text-muted-foreground">
          <p className="font-semibold text-amber-600 dark:text-amber-400 mb-1">💡 ملاحظة</p>
          <p>التنفيذ التلقائي حالياً يعلّم المهام كـ "done" دون تعديل ملفات فعلية.
          في الإنتاج، يمكن ربطه بـ agents لتطبيق الإصلاحات تلقائياً.</p>
        </div>
      </div>
    </ScrollArea>
  )
}
