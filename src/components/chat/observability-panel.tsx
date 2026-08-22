"use client"

/**
 * ObservabilityPanel — Observability OS UI (spec section 27, features 381-392).
 *
 * 4 tabs:
 *  1. Timelines    — task/agent/tool/model/memory timelines (381-385)
 *  2. Analytics    — token/latency/RAM/VRAM/CPU analytics (386-390)
 *  3. Failures     — failure + recovery dashboards (391-392)
 *  4. System        — live system metrics + replay
 */

import * as React from "react"
import {
  Activity, Clock, Cpu, Database, AlertTriangle, Check, X, RefreshCw,
  TrendingDown, TrendingUp, Zap, ChevronRight, Loader2, Play,
  Layers, History, Brain, Bug, ShieldAlert, BarChart3, Flame,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─────────────────────────────────────────────────────────────────────────
// Main panel
// ─────────────────────────────────────────────────────────────────────────

export function ObservabilityPanel() {
  const [tab, setTab] = React.useState("timelines")

  return (
    <div className="flex h-full flex-col" dir="rtl">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">المراقبة / Observability</span>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 min-h-0 flex-col">
        <TabsList className="grid w-full grid-cols-4 rounded-none border-b border-border bg-transparent p-0">
          <TabsTrigger value="timelines" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            الخطوط
          </TabsTrigger>
          <TabsTrigger value="analytics" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            تحليلات
          </TabsTrigger>
          <TabsTrigger value="failures" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            إخفاقات
          </TabsTrigger>
          <TabsTrigger value="system" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            النظام
          </TabsTrigger>
        </TabsList>

        <TabsContent value="timelines" className="m-0 flex-1 min-h-0 overflow-hidden">
          <TimelinesTab />
        </TabsContent>
        <TabsContent value="analytics" className="m-0 flex-1 min-h-0 overflow-hidden">
          <AnalyticsTab />
        </TabsContent>
        <TabsContent value="failures" className="m-0 flex-1 min-h-0 overflow-hidden">
          <FailuresTab />
        </TabsContent>
        <TabsContent value="system" className="m-0 flex-1 min-h-0 overflow-hidden">
          <SystemTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

async function apiGet(mode: string) {
  const res = await fetch(`/api/observability?mode=${mode}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "فشل الشبكة" }))
    throw new Error(err.message ?? `HTTP ${res.status}`)
  }
  return res.json()
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 1: Timelines — 5 timelines (381-385)
// ─────────────────────────────────────────────────────────────────────────

const TIMELINES: Array<{ key: string; label: string; icon: React.ReactNode; feature: number }> = [
  { key: "task_timeline", label: "Task Timeline", icon: <Check className="h-3.5 w-3.5" />, feature: 381 },
  { key: "agent_timeline", label: "Agent Timeline", icon: <Activity className="h-3.5 w-3.5" />, feature: 382 },
  { key: "tool_timeline", label: "Tool Timeline", icon: <Zap className="h-3.5 w-3.5" />, feature: 383 },
  { key: "model_timeline", label: "Model Timeline", icon: <Layers className="h-3.5 w-3.5" />, feature: 384 },
  { key: "memory_timeline", label: "Memory Timeline", icon: <Brain className="h-3.5 w-3.5" />, feature: 385 },
]

function TimelinesTab() {
  const [active, setActive] = React.useState("task_timeline")
  const [data, setData] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(false)

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

  const items = React.useMemo(() => {
    if (!data) return []
    if (Array.isArray(data)) return data
    if (Array.isArray(data.events)) return data.events
    return []
  }, [data])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-2 py-1.5">
        <div className="flex flex-wrap gap-1">
          {TIMELINES.map(t => (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-[0.65rem] font-medium transition-colors",
                active === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {t.icon}
              {t.label}
              <Badge variant="outline" className="text-[0.5rem] py-0 ml-1">#{t.feature}</Badge>
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
          ) : items.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <History className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              لا أحداث
            </div>
          ) : (
            items.slice(0, 50).map((item: any, i: number) => <TimelineCard key={i} item={item} type={active} />)
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function TimelineCard({ item, type }: { item: any; type: string }) {
  const time = React.useMemo(() => {
    const ts = item.timestamp ?? item.createdAt ?? item.lastUsedAt
    if (!ts) return ""
    return new Date(ts).toLocaleString("ar-SA", { dateStyle: "short", timeStyle: "short" })
  }, [item])

  const title = item.taskTitle ?? item.toolName ?? item.label ?? item.model ?? item.key ?? "event"
  const subtitle = item.status ?? item.type ?? item.action ?? ""
  const meta = item.durationMs ? `${item.durationMs}ms` : item.totalTokens ? `${item.totalTokens} tok` : item.totalCalls ? `${item.totalCalls} calls` : ""

  return (
    <div className="rounded-md border border-border/60 bg-card/50 p-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <Badge variant="outline" className="text-[0.55rem] py-0">{type.replace("_timeline", "")}</Badge>
        {subtitle && <Badge variant="outline" className="text-[0.55rem] py-0">{subtitle}</Badge>}
        {meta && <Badge variant="outline" className="text-[0.55rem] py-0 text-muted-foreground">{meta}</Badge>}
        <span className="text-[0.55rem] text-muted-foreground ml-auto">{time}</span>
      </div>
      <p className="text-[0.7rem] mt-1 truncate font-mono" dir="ltr">{String(title)}</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 2: Analytics — token/latency/RAM/VRAM/CPU (386-390)
// ─────────────────────────────────────────────────────────────────────────

const ANALYTICS: Array<{ key: string; label: string; icon: React.ReactNode; feature: number }> = [
  { key: "token_timeline", label: "Token Analytics", icon: <BarChart3 className="h-3.5 w-3.5" />, feature: 386 },
  { key: "latency", label: "Latency Analytics", icon: <Clock className="h-3.5 w-3.5" />, feature: 387 },
  { key: "resources", label: "RAM/VRAM/CPU", icon: <Cpu className="h-3.5 w-3.5" />, feature: 388 },
]

function AnalyticsTab() {
  const [active, setActive] = React.useState("resources")
  const [data, setData] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(false)

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
          {ANALYTICS.map(t => (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-[0.65rem] font-medium transition-colors",
                active === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {t.icon}
              {t.label}
              <Badge variant="outline" className="text-[0.5rem] py-0 ml-1">#{t.feature}</Badge>
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-2">
          {loading ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
              جارٍ التحميل…
            </div>
          ) : !data ? (
            <div className="text-center text-xs text-muted-foreground py-8">لا بيانات</div>
          ) : active === "resources" ? (
            <ResourceView data={data} />
          ) : active === "latency" ? (
            <LatencyView data={data} />
          ) : (
            <TokenView data={data} />
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function ResourceView({ data }: { data: any }) {
  const c = data.current ?? data
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <MetricCard
          label="RAM"
          value={`${c.ramUsagePct ?? c.ramUsagePct ?? 0}%`}
          sub={`${c.ramUsedMb ?? c.usedRamMb ?? 0} / ${c.ramTotalMb ?? c.totalRamMb ?? 0} MB`}
          icon={<Database className="h-3.5 w-3.5" />}
          tone={(c.ramUsagePct ?? 0) > 80 ? "red" : "emerald"}
        />
        <MetricCard
          label="Process Memory"
          value={`${c.processMemoryMb ?? 0} MB`}
          sub={`peak: ${data.peakRamUsageMb ?? 0} MB`}
          icon={<Cpu className="h-3.5 w-3.5" />}
          tone="blue"
        />
        <MetricCard
          label="CPU"
          value={`${c.cpuCount ?? 0} cores`}
          sub={`load: ${(c.cpuLoadAvg ?? [0])[0]?.toFixed(2) ?? 0}`}
          icon={<Activity className="h-3.5 w-3.5" />}
          tone="default"
        />
        <MetricCard
          label="VRAM"
          value={`${c.vramUsedMb ?? 0} MB`}
          sub={`/ ${c.vramTotalMb ?? 0} MB`}
          icon={<Layers className="h-3.5 w-3.5" />}
          tone={c.vramTotalMb > 0 ? "amber" : "default"}
        />
      </div>

      {data.history && data.history.length > 0 && (
        <div className="rounded-md border border-border/60 bg-card/50 p-2">
          <p className="text-xs font-semibold mb-1">آخر {data.history.length} عينة</p>
          <div className="space-y-0.5 max-h-32 overflow-y-auto">
            {data.history.slice(-10).reverse().map((h: any, i: number) => (
              <div key={i} className="flex justify-between text-[0.65rem] text-muted-foreground">
                <span>{new Date(h.timestamp).toLocaleTimeString("ar-SA")}</span>
                <span>RAM: {h.ramUsagePct}%</span>
                <span>CPU: {h.cpuLoadAvg1?.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2 text-[0.65rem]">
        <p className="font-semibold text-blue-600 dark:text-blue-400 mb-1">📊 متوسطات</p>
        <div className="flex justify-between"><span>متوسط RAM:</span><span className="font-mono">{data.avgRamUsagePct ?? 0}%</span></div>
        <div className="flex justify-between"><span>متوسط CPU:</span><span className="font-mono">{data.avgCpuLoad ?? 0}</span></div>
        <div className="flex justify-between"><span>أعلى RAM:</span><span className="font-mono">{data.peakRamUsageMb ?? 0} MB</span></div>
      </div>
    </div>
  )
}

function LatencyView({ data }: { data: any }) {
  return (
    <div className="space-y-2">
      <div className="rounded-md border border-border/60 bg-card/50 p-2">
        <p className="text-xs font-semibold mb-1">العمليات (مرتبة حسب p95)</p>
        <div className="space-y-1">
          {(data.operations ?? []).slice(0, 10).map((op: any, i: number) => (
            <div key={i} className="border-t border-border/40 pt-1 first:border-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <code className="text-[0.7rem] font-mono" dir="ltr">{op.type}</code>
                <Badge variant="outline" className="text-[0.55rem] py-0">{op.count} calls</Badge>
              </div>
              <div className="grid grid-cols-4 gap-1 mt-1 text-[0.65rem] text-muted-foreground">
                <span>avg: <span className="font-mono">{op.avgMs}ms</span></span>
                <span>p50: <span className="font-mono">{op.p50Ms}ms</span></span>
                <span className="text-amber-500">p95: <span className="font-mono">{op.p95Ms}ms</span></span>
                <span className="text-red-500">p99: <span className="font-mono">{op.p99Ms}ms</span></span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {(data.slowestOperations ?? []).length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
          <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-1">🐌 أبطأ العمليات (&gt;1s)</p>
          <div className="space-y-0.5">
            {data.slowestOperations.slice(0, 5).map((s: any, i: number) => (
              <div key={i} className="flex justify-between text-[0.65rem]">
                <code className="font-mono" dir="ltr">{s.type}</code>
                <span className="font-mono text-amber-600 dark:text-amber-400">{s.ms}ms</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function TokenView({ data }: { data: any }) {
  const items = Array.isArray(data) ? data : []
  const total = items.reduce((s: number, x: any) => s + (x.totalTokens ?? 0), 0)
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <MetricCard label="إجمالي Tokens" value={total.toLocaleString()} icon={<BarChart3 className="h-3.5 w-3.5" />} tone="blue" />
        <MetricCard label="محادثات" value={items.length} icon={<Layers className="h-3.5 w-3.5" />} tone="default" />
      </div>
      <div className="rounded-md border border-border/60 bg-card/50 p-2 space-y-1">
        <p className="text-xs font-semibold mb-1">أعلى استهلاك</p>
        {items.slice(0, 10).map((x: any, i: number) => (
          <div key={i} className="flex justify-between text-[0.65rem]">
            <code className="font-mono truncate" dir="ltr">{(x.conversationId ?? "").slice(-12)}</code>
            <span className="font-mono font-bold">{x.totalTokens ?? 0} tok</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MetricCard({ label, value, sub, icon, tone }: {
  label: string; value: string | number; sub?: string; icon: React.ReactNode
  tone: "emerald" | "red" | "amber" | "blue" | "default"
}) {
  const toneClass = {
    emerald: "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400",
    red: "border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400",
    amber: "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400",
    blue: "border-blue-500/30 bg-blue-500/5 text-blue-600 dark:text-blue-400",
    default: "border-border/60 bg-card/50",
  }[tone]
  return (
    <div className={cn("rounded-md border p-2", toneClass)}>
      <div className="flex items-center gap-1 text-[0.65rem] text-muted-foreground mb-0.5">
        {icon}
        {label}
      </div>
      <div className="text-sm font-mono font-bold">{value}</div>
      {sub && <div className="text-[0.6rem] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 3: Failures — failure + recovery dashboards (391-392)
// ─────────────────────────────────────────────────────────────────────────

function FailuresTab() {
  const [subtab, setSubtab] = React.useState<"failures" | "recovery">("failures")
  const [data, setData] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(false)

  const load = React.useCallback(async (key: string) => {
    setLoading(true)
    try {
      const result = await apiGet(key === "failures" ? "failure_dashboard" : "recovery_dashboard")
      setData(result)
    } catch (e) {
      toast.error((e as Error).message)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load(subtab) }, [subtab, load])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-2 py-1.5">
        <div className="flex gap-1">
          <button
            onClick={() => setSubtab("failures")}
            className={cn("flex items-center gap-1 rounded-md px-2 py-1 text-[0.65rem] font-medium transition-colors",
              subtab === "failures" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
          >
            <Bug className="h-3 w-3" />
            Failure Dashboard
            <Badge variant="outline" className="text-[0.5rem] py-0 ml-1">#391</Badge>
          </button>
          <button
            onClick={() => setSubtab("recovery")}
            className={cn("flex items-center gap-1 rounded-md px-2 py-1 text-[0.65rem] font-medium transition-colors",
              subtab === "recovery" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
          >
            <ShieldAlert className="h-3 w-3" />
            Recovery Dashboard
            <Badge variant="outline" className="text-[0.5rem] py-0 ml-1">#392</Badge>
          </button>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-2">
          {loading ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
              جارٍ التحميل…
            </div>
          ) : !data ? (
            <div className="text-center text-xs text-muted-foreground py-8">لا بيانات</div>
          ) : subtab === "failures" ? (
            <FailureView data={data} />
          ) : (
            <RecoveryView data={data} />
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function FailureView({ data }: { data: any }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <MetricCard label="إجمالي" value={data.totalFailures ?? 0} icon={<Bug className="h-3.5 w-3.5" />} tone="red" />
        <MetricCard label="معدل/ساعة" value={data.failureRate ?? 0} icon={<Clock className="h-3.5 w-3.5" />} tone="amber" />
        <MetricCard label="متكررة" value={(data.topRecurring ?? []).length} icon={<TrendingDown className="h-3.5 w-3.5" />} tone="default" />
      </div>

      {data.byCategory && Object.keys(data.byCategory).length > 0 && (
        <div className="rounded-md border border-border/60 bg-card/50 p-2">
          <p className="text-xs font-semibold mb-1">حسب الفئة</p>
          <div className="flex flex-wrap gap-1">
            {Object.entries(data.byCategory).map(([cat, count]) => (
              <Badge key={cat} variant="outline" className="text-[0.6rem]">
                {cat}: {count as number}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {data.recentFailures && data.recentFailures.length > 0 && (
        <div className="rounded-md border border-border/60 bg-card/50 p-2">
          <p className="text-xs font-semibold mb-1">أحدث الإخفاقات</p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {data.recentFailures.slice(0, 10).map((f: any, i: number) => (
              <div key={i} className="border-t border-border/40 pt-1 first:border-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant="outline" className="text-[0.55rem] py-0">{f.category}</Badge>
                  <Badge variant="outline" className="text-[0.55rem] py-0">{f.severity}</Badge>
                  {f.recovered && <Badge className="bg-emerald-500/10 text-emerald-600 text-[0.55rem] py-0">تعافى</Badge>}
                  {f.occurrences > 1 && <Badge variant="outline" className="text-[0.55rem] py-0 text-purple-500">×{f.occurrences}</Badge>}
                </div>
                <p className="text-[0.7rem] mt-0.5 truncate" dir="ltr">{f.task}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function RecoveryView({ data }: { data: any }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <MetricCard label="إجمالي" value={data.totalRecoveries ?? 0} icon={<ShieldAlert className="h-3.5 w-3.5" />} tone="blue" />
        <MetricCard label="ناجحة" value={data.successfulRecoveries ?? 0} icon={<Check className="h-3.5 w-3.5" />} tone="emerald" />
        <MetricCard label="معدل" value={`${data.recoveryRate ?? 0}%`} icon={<TrendingUp className="h-3.5 w-3.5" />} tone={(data.recoveryRate ?? 0) >= 80 ? "emerald" : "amber"} />
      </div>

      {data.avgRecoveryMs !== undefined && data.avgRecoveryMs > 0 && (
        <MetricCard label="متوسط زمن الاسترداد" value={`${data.avgRecoveryMs}ms`} icon={<Clock className="h-3.5 w-3.5" />} tone="default" />
      )}

      {data.byActionType && Object.keys(data.byActionType).length > 0 && (
        <div className="rounded-md border border-border/60 bg-card/50 p-2">
          <p className="text-xs font-semibold mb-1">حسب نوع الإجراء</p>
          <div className="space-y-1">
            {Object.entries(data.byActionType).map(([action, stat]: [string, any]) => (
              <div key={action} className="flex justify-between text-[0.7rem]">
                <code className="font-mono" dir="ltr">{action}</code>
                <span className="font-mono">{stat.succeeded}/{stat.attempted}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.recentRecoveries && data.recentRecoveries.length > 0 && (
        <div className="rounded-md border border-border/60 bg-card/50 p-2">
          <p className="text-xs font-semibold mb-1">أحدث الاستردادات</p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {data.recentRecoveries.slice(0, 10).map((r: any, i: number) => (
              <div key={i} className="flex items-center gap-1.5 text-[0.7rem]">
                {r.succeeded ? <Check className="h-3 w-3 text-emerald-500" /> : <X className="h-3 w-3 text-red-500" />}
                <code className="font-mono truncate flex-1" dir="ltr">{r.task}</code>
                <Badge variant="outline" className="text-[0.55rem] py-0">{r.category}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 4: System — live metrics + snapshot
// ─────────────────────────────────────────────────────────────────────────

function SystemTab() {
  const [metrics, setMetrics] = React.useState<any>(null)
  const [snapshot, setSnapshot] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [sysRes, snapRes] = await Promise.all([
        fetch("/api/observability?mode=system"),
        fetch("/api/observability?mode=snapshot"),
      ])
      setMetrics(await sysRes.json())
      setSnapshot(await snapRes.json())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
    const interval = setInterval(load, 5000) // auto-refresh every 5s
    return () => clearInterval(interval)
  }, [load])

  if (loading && !metrics) {
    return (
      <div className="text-center text-xs text-muted-foreground py-8">
        <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
        جارٍ التحميل…
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-2">
        {metrics && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <MetricCard label="RAM" value={`${metrics.ramUsagePct ?? 0}%`} sub={`${metrics.usedRamMb ?? 0} / ${metrics.totalRamMb ?? 0} MB`} icon={<Database className="h-3.5 w-3.5" />} tone={(metrics.ramUsagePct ?? 0) > 80 ? "red" : "emerald"} />
              <MetricCard label="Process" value={`${metrics.processMemoryMb ?? 0} MB`} icon={<Cpu className="h-3.5 w-3.5" />} tone="blue" />
              <MetricCard label="CPU" value={`${metrics.cpuCount ?? 0} cores`} sub={`load: ${(metrics.cpuLoadAvg ?? [0])[0]?.toFixed(2) ?? 0}`} icon={<Activity className="h-3.5 w-3.5" />} tone="default" />
              <MetricCard label="Uptime" value={`${metrics.uptimeSec ?? 0}s`} sub={`process: ${metrics.processUptimeSec ?? 0}s`} icon={<Clock className="h-3.5 w-3.5" />} tone="default" />
            </div>
            <Button onClick={load} variant="outline" size="sm" className="w-full h-7 text-xs">
              <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
              تحديث
            </Button>
          </>
        )}

        {snapshot && (
          <div className="rounded-md border border-border/60 bg-card/50 p-2">
            <p className="text-xs font-semibold mb-1">إحصائيات شاملة</p>
            <div className="space-y-0.5 text-[0.7rem]">
              <div className="flex justify-between"><span className="text-muted-foreground">المحادثات:</span><span className="font-mono">{snapshot.totalConversations ?? 0}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">الرسائل:</span><span className="font-mono">{snapshot.totalMessages ?? 0}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">نداءات الأدوات:</span><span className="font-mono">{snapshot.totalToolCalls ?? 0}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">الأخطاء:</span><span className="font-mono text-red-500">{snapshot.totalErrors ?? 0}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">الذكريات:</span><span className="font-mono">{snapshot.totalMemories ?? 0}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Tokens:</span><span className="font-mono">{(snapshot.totalTokens ?? 0).toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Event Buffer:</span><span className="font-mono">{snapshot.eventBufferSize ?? 0}</span></div>
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  )
}
