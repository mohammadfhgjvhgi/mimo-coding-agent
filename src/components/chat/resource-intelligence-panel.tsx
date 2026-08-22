"use client"

/**
 * ResourceIntelligencePanel — Resource Intelligence OS UI (spec section 33, features 445-453).
 *
 * 3 tabs:
 *  1. Pressure    — RAM (447) + VRAM (448) + Memory Pressure Modes (453)
 *  2. Adaptive     — Threads (445) + Context (446) + Throttling (451)
 *  3. Processes     — Process Manager (449) + Idle Killer (450) + Indexing (452)
 */

import * as React from "react"
import {
  Cpu, MemoryStick, Zap, Activity, Snowflake, Clock, RefreshCw,
  Check, X, AlertTriangle, Loader2, Flame, Gauge, ListChecks, Trash2, Plus,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

const MODE_COLORS: Record<string, string> = {
  GREEN: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  YELLOW: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  ORANGE: "bg-orange-500/10 text-orange-600 border-orange-500/30",
  RED: "bg-red-500/10 text-red-600 border-red-500/30",
}

const LEVEL_COLORS: Record<string, string> = {
  green: "text-emerald-500",
  yellow: "text-amber-500",
  orange: "text-orange-500",
  red: "text-red-500",
  unknown: "text-muted-foreground",
}

export function ResourceIntelligencePanel() {
  const [tab, setTab] = React.useState("pressure")
  const [snapshot, setSnapshot] = React.useState<any>(null)
  const [loadingSnapshot, setLoadingSnapshot] = React.useState(true)

  const loadSnapshot = React.useCallback(async () => {
    setLoadingSnapshot(true)
    try {
      const res = await fetch("/api/resource-intelligence?mode=snapshot")
      const data = await res.json()
      setSnapshot(data)
    } catch (err) {
      console.error("[ResourceIntel] snapshot failed", err)
    } finally {
      setLoadingSnapshot(false)
    }
  }, [])

  React.useEffect(() => { loadSnapshot() }, [loadSnapshot])

  // Auto-refresh every 5s
  React.useEffect(() => {
    const interval = setInterval(loadSnapshot, 5000)
    return () => clearInterval(interval)
  }, [loadSnapshot])

  const mode = snapshot?.mode ?? "GREEN"

  return (
    <div className="flex h-full flex-col" dir="rtl">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">ذكاء الموارد / Resource Intelligence</span>
        </div>
        <div className={cn("rounded-md border px-2 py-0.5 text-xs font-bold", MODE_COLORS[mode] ?? MODE_COLORS.GREEN)}>
          {mode}
        </div>
      </div>

      {/* Live stats */}
      {snapshot && (
        <div className="grid grid-cols-3 gap-1.5 border-b border-border/60 bg-muted/30 px-3 py-2 text-center text-[0.65rem]">
          <Stat icon={<MemoryStick className={cn("h-3 w-3", LEVEL_COLORS[snapshot.ramUsagePct > 75 ? "red" : snapshot.ramUsagePct > 60 ? "amber" : "green"])} />} label="RAM" value={`${snapshot.ramUsagePct}%`} tone={snapshot.ramUsagePct > 75 ? "red" : "emerald"} />
          <Stat icon={<Cpu className="h-3 w-3 text-blue-500" />} label="CPU" value={`${snapshot.cpuLoad}`} tone="blue" />
          <Stat icon={<Zap className="h-3 w-3 text-purple-500" />} label="خيوط" value={snapshot.recommendedThreads} tone="purple" />
          <Stat icon={<Activity className="h-3 w-3" />} label="Process" value={`${snapshot.processRamMb}MB`} tone="default" />
          <Stat icon={<Clock className="h-3 w-3 text-amber-500" />} label="فهرسة" value={snapshot.indexingJobs} tone="amber" />
          <Stat icon={<Flame className={cn("h-3 w-3", LEVEL_COLORS[snapshot.vramLevel])} />} label="VRAM" value={snapshot.vramLevel} tone="default" />
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 min-h-0 flex-col">
        <TabsList className="grid w-full grid-cols-3 rounded-none border-b border-border bg-transparent p-0">
          <TabsTrigger value="pressure" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">ضغط</TabsTrigger>
          <TabsTrigger value="adaptive" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">تكيّف</TabsTrigger>
          <TabsTrigger value="processes" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">عمليات</TabsTrigger>
        </TabsList>

        <TabsContent value="pressure" className="m-0 flex-1 min-h-0 overflow-hidden"><PressureTab /></TabsContent>
        <TabsContent value="adaptive" className="m-0 flex-1 min-h-0 overflow-hidden"><AdaptiveTab /></TabsContent>
        <TabsContent value="processes" className="m-0 flex-1 min-h-0 overflow-hidden"><ProcessesTab /></TabsContent>
      </Tabs>
    </div>
  )
}

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string | number; tone: string }) {
  const toneClass: Record<string, string> = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    red: "text-red-600 dark:text-red-400",
    blue: "text-blue-600 dark:text-blue-400",
    purple: "text-purple-600 dark:text-purple-400",
    default: "text-foreground",
  }
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className={cn("flex items-center gap-1 font-mono font-bold", toneClass[tone] ?? toneClass.default)}>
        {icon}<span>{value}</span>
      </div>
      <span className="text-muted-foreground">{label}</span>
    </div>
  )
}

async function apiCall(action: string, body: Record<string, unknown> = {}) {
  const res = await fetch("/api/resource-intelligence", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "فشل الشبكة" }))
    throw new Error(err.message ?? `HTTP ${res.status}`)
  }
  return res.json()
}

// ─── Tab 1: Pressure (447, 448, 453) ───

function PressureTab() {
  const [ram, setRam] = React.useState<any>(null)
  const [vram, setVram] = React.useState<any>(null)
  const [modes, setModes] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [r, v, m] = await Promise.all([
        apiCall("ram_pressure"),
        apiCall("vram_pressure"),
        apiCall("pressure_modes"),
      ])
      setRam(r); setVram(v); setModes(m)
    } catch (e) { toast.error((e as Error).message) }
    finally { setLoading(false) }
  }, [])

  React.useEffect(() => { load() }, [load])

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        {/* Memory Pressure Modes (453) */}
        {modes && (
          <div className={cn("rounded-md border p-3", MODE_COLORS[modes.mode] ?? MODE_COLORS.GREEN)}>
            <div className="flex items-center gap-2 mb-2">
              <Gauge className="h-4 w-4" />
              <span className="text-sm font-semibold">Memory Pressure Mode (453)</span>
              <Badge variant="outline" className={cn("text-[0.6rem] py-0 ml-auto font-bold", MODE_COLORS[modes.mode])}>{modes.mode}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[0.7rem] mb-2">
              <div className="flex justify-between"><span className="text-muted-foreground">RAM:</span><span className="font-mono">{modes.ramLevel}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">VRAM:</span><span className="font-mono">{modes.vramLevel}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">CPU Load:</span><span className="font-mono">{modes.cpuLoad}%</span></div>
            </div>
            {modes.recommendations?.map((r: string, i: number) => (
              <p key={i} className="text-[0.7rem] mt-0.5">💡 {r}</p>
            ))}
            {modes.autoActions?.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border/40">
                <p className="text-[0.65rem] font-semibold text-muted-foreground mb-0.5">إجراءات تلقائية:</p>
                {modes.autoActions.map((a: string, i: number) => (
                  <Badge key={i} variant="outline" className="text-[0.55rem] py-0 mr-1">{a}</Badge>
                ))}
              </div>
            )}
          </div>
        )}

        {/* RAM Pressure (447) */}
        {ram && (
          <div className={cn("rounded-md border p-3", MODE_COLORS[ram.level?.toUpperCase()] ?? MODE_COLORS.GREEN)}>
            <div className="flex items-center gap-2 mb-2">
              <MemoryStick className="h-4 w-4" />
              <span className="text-sm font-semibold">RAM Pressure (447)</span>
              <Badge variant="outline" className={cn("text-[0.6rem] py-0 ml-auto font-bold", MODE_COLORS[ram.level?.toUpperCase()])}>{ram.level?.toUpperCase()}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[0.7rem]">
              <div className="flex justify-between"><span className="text-muted-foreground">الاستخدام:</span><span className="font-mono font-bold">{ram.usagePct}%</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">مستخدم:</span><span className="font-mono">{ram.usedMb}MB</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">إجمالي:</span><span className="font-mono">{ram.totalMb}MB</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">حر:</span><span className="font-mono">{ram.freeMb}MB</span></div>
            </div>
            <p className="text-[0.7rem] mt-2">{ram.recommendation}</p>
          </div>
        )}

        {/* VRAM Pressure (448) */}
        {vram && (
          <div className={cn("rounded-md border p-3", vram.level === "unknown" ? "border-border/60 bg-card/50" : MODE_COLORS[vram.level?.toUpperCase()] ?? MODE_COLORS.GREEN)}>
            <div className="flex items-center gap-2 mb-2">
              <Flame className="h-4 w-4" />
              <span className="text-sm font-semibold">VRAM Pressure (448)</span>
              <Badge variant="outline" className={cn("text-[0.6rem] py-0 ml-auto font-bold", vram.level === "unknown" ? "border-border" : MODE_COLORS[vram.level?.toUpperCase()])}>{vram.level?.toUpperCase()}</Badge>
            </div>
            {vram.level !== "unknown" ? (
              <div className="grid grid-cols-2 gap-2 text-[0.7rem]">
                <div className="flex justify-between"><span className="text-muted-foreground">الاستخدام:</span><span className="font-mono font-bold">{vram.usagePct}%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">مستخدم:</span><span className="font-mono">{vram.vramUsedMb}MB</span></div>
              </div>
            ) : null}
            <p className="text-[0.7rem] mt-2">{vram.recommendation}</p>
          </div>
        )}

        <Button onClick={load} disabled={loading} variant="outline" size="sm" className="w-full h-7 text-xs">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          تحديث
        </Button>
      </div>
    </ScrollArea>
  )
}

// ─── Tab 2: Adaptive (445, 446, 451) ───

function AdaptiveTab() {
  const [data, setData] = React.useState<any>({})
  const [loading, setLoading] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [threads, ctx, throttle] = await Promise.all([
        apiCall("adaptive_threads"),
        apiCall("adaptive_context"),
        apiCall("bg_throttle"),
      ])
      setData({ threads, ctx, throttle })
    } catch (e) { toast.error((e as Error).message) }
    finally { setLoading(false) }
  }, [])

  React.useEffect(() => { load() }, [load])

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        {/* Adaptive Threads (445) */}
        {data.threads && (
          <div className="rounded-md border border-border/60 bg-card/50 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Cpu className="h-4 w-4 text-blue-500" />
              <span className="text-sm font-semibold">Adaptive Threads (445)</span>
              <Badge variant="outline" className="text-[0.55rem] py-0 ml-auto">#445</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[0.7rem]">
              <div className="flex justify-between"><span className="text-muted-foreground">موصى:</span><span className="font-mono font-bold text-blue-500">{data.threads.recommendedThreads}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">أقصى:</span><span className="font-mono">{data.threads.maxThreads}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Load:</span><span className="font-mono">{data.threads.currentLoad}%</span></div>
            </div>
            <p className="text-[0.7rem] mt-1 text-muted-foreground">{data.threads.reason}</p>
            {data.threads.adjustments?.map((a: string, i: number) => (
              <p key={i} className="text-[0.65rem] text-amber-500">→ {a}</p>
            ))}
          </div>
        )}

        {/* Adaptive Context (446) */}
        {data.ctx && (
          <div className="rounded-md border border-border/60 bg-card/50 p-3">
            <div className="flex items-center gap-2 mb-2">
              <MemoryStick className="h-4 w-4 text-purple-500" />
              <span className="text-sm font-semibold">Adaptive Context (446)</span>
              <Badge variant="outline" className="text-[0.55rem] py-0 ml-auto">#446</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[0.7rem]">
              <div className="flex justify-between"><span className="text-muted-foreground">موصى:</span><span className="font-mono font-bold">{data.ctx.recommendedContextTokens.toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">أصلي:</span><span className="font-mono">{data.ctx.originalLimit.toLocaleString()}</span></div>
              {data.ctx.reductionPct > 0 && (
                <div className="flex justify-between"><span className="text-muted-foreground">تقليل:</span><span className="font-mono text-amber-500">{data.ctx.reductionPct}%</span></div>
              )}
              <div className="flex justify-between"><span className="text-muted-foreground">RAM حر:</span><span className="font-mono">{data.ctx.availableRamMb}MB</span></div>
            </div>
            <p className="text-[0.7rem] mt-1 text-muted-foreground">{data.ctx.reason}</p>
          </div>
        )}

        {/* Background Throttling (451) */}
        {data.throttle && (
          <div className={cn("rounded-md border p-3", MODE_COLORS[data.throttle.throttleLevel?.toUpperCase()] ?? "border-border/60 bg-card/50")}>
            <div className="flex items-center gap-2 mb-2">
              <Zap className="h-4 w-4" />
              <span className="text-sm font-semibold">Background Throttling (451)</span>
              <Badge variant="outline" className={cn("text-[0.55rem] py-0 ml-auto", MODE_COLORS[data.throttle.throttleLevel?.toUpperCase()])}>{data.throttle.throttleLevel}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[0.7rem]">
              <div className="flex justify-between"><span className="text-muted-foreground">تأخير:</span><span className="font-mono">{data.throttle.delayMs}ms</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">مهام:</span><span className="font-mono">{data.throttle.activeTasks}</span></div>
            </div>
            <p className="text-[0.7rem] mt-1 text-muted-foreground">{data.throttle.reason}</p>
            {data.throttle.throttledTasks?.length > 0 && (
              <div className="mt-1">
                <p className="text-[0.55rem] text-muted-foreground">مهام مُبطّأة:</p>
                {data.throttle.throttledTasks.map((t: string, i: number) => (
                  <Badge key={i} variant="outline" className="text-[0.5rem] py-0 mr-1 text-amber-500">{t}</Badge>
                ))}
              </div>
            )}
          </div>
        )}

        <Button onClick={load} disabled={loading} variant="outline" size="sm" className="w-full h-7 text-xs">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          تحديث
        </Button>
      </div>
    </ScrollArea>
  )
}

// ─── Tab 3: Processes (449, 450, 452) ───

function ProcessesTab() {
  const [procs, setProcs] = React.useState<any>(null)
  const [indexing, setIndexing] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [p, idx] = await Promise.all([
        apiCall("process_manager"),
        apiCall("indexing_list"),
      ])
      setProcs(p); setIndexing(idx)
    } catch (e) { toast.error((e as Error).message) }
    finally { setLoading(false) }
  }, [])

  React.useEffect(() => { load() }, [load])

  const handleKill = async () => {
    try {
      const data = await apiCall("idle_killer")
      toast.success(data.reason)
      load()
    } catch (e) { toast.error((e as Error).message) }
  }

  const handleSchedule = async () => {
    try {
      const data = await apiCall("indexing_schedule", { type: "incremental", delayMs: 60000 })
      toast.success(data.reason)
      load()
    } catch (e) { toast.error((e as Error).message) }
  }

  const handleRunDue = async () => {
    try {
      const data = await apiCall("indexing_run_due")
      toast.success(data.reason)
      load()
    } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold">العمليات / Processes</span>
        <div className="flex gap-1">
          <Button onClick={handleKill} variant="outline" size="sm" className="h-6 gap-1 text-[0.65rem]">
            <Snowflake className="h-3 w-3" /> Kill Idle (450)
          </Button>
          <Button onClick={load} variant="ghost" size="sm" className="h-6 w-6 p-0">
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-2">
          {/* Process Manager (449) */}
          {procs && (
            <div className="rounded-md border border-border/60 bg-card/50 p-2">
              <p className="text-xs font-semibold mb-1 flex items-center gap-1">
                <Activity className="h-3 w-3" /> Process Manager (449)
                <Badge variant="outline" className="text-[0.5rem] py-0 ml-auto">{procs.totalProcesses} عمليات</Badge>
              </p>
              {procs.processes?.map((p: any, i: number) => (
                <div key={i} className="border-t border-border/40 pt-1 mt-1 first:border-0 first:mt-0 first:pt-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {p.status === "running" ? <Check className="h-3 w-3 text-emerald-500" /> : <Clock className="h-3 w-3 text-amber-500" />}
                    <span className="text-[0.7rem] font-medium flex-1 truncate">{p.name}</span>
                    <Badge variant="outline" className="text-[0.5rem] py-0">{p.ramMb}MB</Badge>
                    <Badge variant="outline" className="text-[0.5rem] py-0">{p.cpuPercent}%</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Indexing Scheduler (452) */}
          {indexing && (
            <div className="rounded-md border border-border/60 bg-card/50 p-2">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-semibold flex items-center gap-1">
                  <ListChecks className="h-3 w-3" /> Indexing Scheduler (452)
                </p>
                <div className="flex gap-1">
                  <Button onClick={handleSchedule} size="sm" className="h-5 gap-1 text-[0.55rem] px-1">
                    <Plus className="h-2.5 w-2.5" /> جدول
                  </Button>
                  <Button onClick={handleRunDue} variant="outline" size="sm" className="h-5 gap-1 text-[0.55rem] px-1">
                    <Zap className="h-2.5 w-2.5" /> نفّذ المستحق
                  </Button>
                </div>
              </div>
              {indexing.jobs?.length > 0 ? (
                <div className="space-y-0.5 max-h-32 overflow-y-auto">
                  {indexing.jobs.slice(-5).map((job: any, i: number) => (
                    <div key={i} className="flex items-center gap-1.5 text-[0.65rem]">
                      {job.status === "scheduled" ? <Clock className="h-2.5 w-2.5 text-amber-500" /> : job.status === "completed" ? <Check className="h-2.5 w-2.5 text-emerald-500" /> : <X className="h-2.5 w-2.5 text-red-500" />}
                      <span className="flex-1 truncate">{job.type}</span>
                      <Badge variant="outline" className="text-[0.5rem] py-0">{job.status}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[0.65rem] text-muted-foreground">لا فهرسة مجدولة</p>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
