"use client"

/**
 * ModelIntelligencePanel — Model Intelligence OS UI (spec section 32, features 434-444).
 *
 * 3 tabs:
 *  1. Health & Profiles — model health (434) + capability profile (435)
 *  2. Reliability      — tool-calling (436) + context (437) + routing (438)
 *  3. Operations       — fast/strong pair (439) + draft-verify (440) + fallback (441) +
 *                        provider failover (442) + warmup (443) + idle unload (444)
 */

import * as React from "react"
import {
  Activity, Cpu, Zap, RefreshCw, Check, X, AlertTriangle, Loader2,
  Brain, Clock, ArrowRight, Shield, Flame, Snowflake, TrendingUp,
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

export function ModelIntelligencePanel() {
  const [tab, setTab] = React.useState("health")
  const [snapshot, setSnapshot] = React.useState<any>(null)
  const [loadingSnapshot, setLoadingSnapshot] = React.useState(true)

  const loadSnapshot = React.useCallback(async () => {
    setLoadingSnapshot(true)
    try {
      const res = await fetch("/api/model-intelligence?mode=snapshot")
      const data = await res.json()
      setSnapshot(data)
    } catch (err) {
      console.error("[ModelIntel] snapshot failed", err)
    } finally {
      setLoadingSnapshot(false)
    }
  }, [])

  React.useEffect(() => { loadSnapshot() }, [loadSnapshot])

  return (
    <div className="flex h-full flex-col" dir="rtl">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">ذكاء النماذج / Model Intelligence</span>
        </div>
        <Button variant="ghost" size="sm" onClick={loadSnapshot} className="h-7 gap-1 px-2 text-xs" disabled={loadingSnapshot}>
          <RefreshCw className={cn("h-3 w-3", loadingSnapshot && "animate-spin")} />
        </Button>
      </div>

      {snapshot && (
        <div className="grid grid-cols-3 gap-1.5 border-b border-border/60 bg-muted/30 px-3 py-2 text-center text-[0.65rem]">
          <Stat icon={<Cpu className="h-3 w-3 text-blue-500" />} label="نماذج" value={snapshot.totalModels ?? 0} tone="blue" />
          <Stat icon={<Check className="h-3 w-3 text-emerald-500" />} label="نشطة" value={snapshot.activeModels ?? 0} tone="emerald" />
          <Stat icon={<Flame className="h-3 w-3 text-amber-500" />} label="ساخنة" value={snapshot.warmModels ?? 0} tone="amber" />
          <Stat icon={<Zap className="h-3 w-3 text-purple-500" />} label="أدوات" value={`${Math.round((snapshot.avgToolReliability ?? 0) * 100)}%`} tone="purple" />
          <Stat icon={<TrendingUp className="h-3 w-3" />} label="نجاح" value={`${Math.round((snapshot.avgTaskSuccess ?? 0) * 100)}%`} tone="default" />
          <Stat icon={<Activity className="h-3 w-3" />} label="مزودين" value={Object.keys(snapshot.byProvider ?? {}).length} tone="default" />
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 min-h-0 flex-col">
        <TabsList className="grid w-full grid-cols-3 rounded-none border-b border-border bg-transparent p-0">
          <TabsTrigger value="health" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">صحة</TabsTrigger>
          <TabsTrigger value="reliability" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">موثوقية</TabsTrigger>
          <TabsTrigger value="operations" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">عمليات</TabsTrigger>
        </TabsList>

        <TabsContent value="health" className="m-0 flex-1 min-h-0 overflow-hidden"><HealthTab /></TabsContent>
        <TabsContent value="reliability" className="m-0 flex-1 min-h-0 overflow-hidden"><ReliabilityTab /></TabsContent>
        <TabsContent value="operations" className="m-0 flex-1 min-h-0 overflow-hidden"><OperationsTab onChange={loadSnapshot} /></TabsContent>
      </Tabs>
    </div>
  )
}

function Stat({ icon, label, value, tone }: {
  icon: React.ReactNode; label: string; value: string | number; tone: string
}) {
  const toneClass: Record<string, string> = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
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
  const res = await fetch("/api/model-intelligence", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "فشل الشبكة" }))
    throw new Error(err.message ?? `HTTP ${res.status}`)
  }
  return res.json()
}

async function apiGet(mode: string) {
  const res = await fetch(`/api/model-intelligence?mode=${mode}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ─── Tab 1: Health & Profiles (434, 435) ───

function HealthTab() {
  const [data, setData] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(false)
  const [activeView, setActiveView] = React.useState<"health" | "profile">("health")

  const load = React.useCallback(async (view: string) => {
    setLoading(true)
    try {
      const result = view === "health" ? await apiGet("health") : await apiGet("profile")
      setData(result)
    } catch (e) { toast.error((e as Error).message) }
    finally { setLoading(false) }
  }, [])

  React.useEffect(() => { load(activeView) }, [activeView, load])

  const items = Array.isArray(data) ? data : []

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-2 py-1.5">
        <div className="flex gap-1">
          <button onClick={() => setActiveView("health")} className={cn("flex items-center gap-1 rounded-md px-2 py-1 text-[0.65rem] font-medium", activeView === "health" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
            <Activity className="h-3 w-3" /> Health (434)
          </button>
          <button onClick={() => setActiveView("profile")} className={cn("flex items-center gap-1 rounded-md px-2 py-1 text-[0.65rem] font-medium", activeView === "profile" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
            <Cpu className="h-3 w-3" /> Capability (435)
          </button>
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1">
          {loading ? (
            <div className="text-center text-xs text-muted-foreground py-8"><RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" /></div>
          ) : items.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-8">لا نماذج</div>
          ) : items.map((item: any, i: number) => (
            <div key={i} className="rounded-md border border-border/60 bg-card/50 p-2">
              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                {activeView === "health" ? (
                  <>
                    {item.alive ? <Check className="h-3 w-3 text-emerald-500" /> : <X className="h-3 w-3 text-red-500" />}
                    <span className="text-xs font-medium flex-1">{item.modelId}</span>
                    {item.latencyMs !== null && <Badge variant="outline" className="text-[0.55rem] py-0">{item.latencyMs}ms</Badge>}
                  </>
                ) : (
                  <>
                    <span className="text-xs font-medium flex-1">{item.displayName}</span>
                    <Badge variant="outline" className="text-[0.55rem] py-0">{item.provider}</Badge>
                    {item.active && <Badge className="bg-emerald-500/10 text-emerald-600 text-[0.55rem] py-0">نشط</Badge>}
                  </>
                )}
              </div>
              {activeView === "health" ? (
                <p className="text-[0.65rem] text-muted-foreground">{item.reason}</p>
              ) : (
                <div className="text-[0.65rem] space-y-0.5">
                  {item.capabilities?.length > 0 && (
                    <div className="flex flex-wrap gap-0.5">
                      {item.capabilities.map((c: string, j: number) => (
                        <Badge key={j} variant="outline" className="text-[0.5rem] py-0 text-blue-500 border-blue-500/30">{c}</Badge>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-between"><span className="text-muted-foreground">أدوات:</span><span className="font-mono">{Math.round(item.toolReliability * 100)}%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">نجاح:</span><span className="font-mono">{Math.round(item.taskSuccessRate * 100)}%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">سياق:</span><span className="font-mono">{item.contextLimit}</span></div>
                  {item.measuredTps > 0 && <div className="flex justify-between"><span className="text-muted-foreground">سرعة:</span><span className="font-mono">{item.measuredTps} tok/s</span></div>}
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

// ─── Tab 2: Reliability (436, 437, 438) ───

function ReliabilityTab() {
  const [data, setData] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(false)
  const [activeView, setActiveView] = React.useState<"tool" | "context" | "routing">("tool")
  const [taskType, setTaskType] = React.useState("coding")

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      if (activeView === "tool") setData(await apiGet("tool_reliability"))
      else if (activeView === "context") setData(await apiGet("context_reliability"))
      else setData(await apiCall("task_routing", { taskType }))
    } catch (e) { toast.error((e as Error).message) }
    finally { setLoading(false) }
  }, [activeView, taskType])

  React.useEffect(() => { load() }, [load])

  const items = Array.isArray(data) ? data : data ? [data] : []

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-2 py-1.5">
        <div className="flex gap-1">
          <button onClick={() => setActiveView("tool")} className={cn("flex items-center gap-1 rounded-md px-2 py-1 text-[0.65rem] font-medium", activeView === "tool" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
            <Zap className="h-3 w-3" /> Tool-Calling (436)
          </button>
          <button onClick={() => setActiveView("context")} className={cn("flex items-center gap-1 rounded-md px-2 py-1 text-[0.65rem] font-medium", activeView === "context" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
            <Brain className="h-3 w-3" /> Context (437)
          </button>
          <button onClick={() => setActiveView("routing")} className={cn("flex items-center gap-1 rounded-md px-2 py-1 text-[0.65rem] font-medium", activeView === "routing" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
            <ArrowRight className="h-3 w-3" /> Routing (438)
          </button>
        </div>
        {activeView === "routing" && (
          <Select value={taskType} onValueChange={setTaskType}>
            <SelectTrigger className="h-7 text-xs mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["coding", "reasoning", "writing", "vision", "fast", "strong"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1">
          {loading ? (
            <div className="text-center text-xs text-muted-foreground py-8"><RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" /></div>
          ) : items.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-8">لا بيانات</div>
          ) : items.map((item: any, i: number) => (
            <div key={i} className="rounded-md border border-border/60 bg-card/50 p-2">
              {activeView === "tool" ? (
                <>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-xs font-medium flex-1">{item.modelId}</span>
                    <Badge variant="outline" className={cn("text-[0.55rem] py-0", item.reliability >= 0.8 ? "text-emerald-500 border-emerald-500/30" : item.reliability >= 0.5 ? "text-amber-500 border-amber-500/30" : "text-red-500 border-red-500/30")}>
                      {Math.round(item.reliability * 100)}%
                    </Badge>
                  </div>
                  <div className="text-[0.65rem] space-y-0.5">
                    <div className="flex justify-between"><span className="text-muted-foreground">نداءات:</span><span className="font-mono">{item.totalCalls}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">نجح:</span><span className="font-mono text-emerald-500">{item.successfulCalls}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">فشل:</span><span className="font-mono text-red-500">{item.failedCalls}</span></div>
                  </div>
                  {item.commonErrors?.length > 0 && (
                    <div className="mt-1 pt-1 border-t border-border/40">
                      <p className="text-[0.55rem] text-muted-foreground">أخطاء شائعة:</p>
                      {item.commonErrors.map((e: string, j: number) => <p key={j} className="text-[0.55rem] text-red-500 font-mono">{e}</p>)}
                    </div>
                  )}
                </>
              ) : activeView === "context" ? (
                <>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-xs font-medium flex-1">{item.modelId}</span>
                    <Badge className="bg-emerald-500/10 text-emerald-600 text-[0.55rem] py-0">{item.status}</Badge>
                  </div>
                  <div className="text-[0.65rem] space-y-0.5">
                    <div className="flex justify-between"><span className="text-muted-foreground">الحد:</span><span className="font-mono">{item.contextLimit}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">أمثل:</span><span className="font-mono">{item.optimalContextTokens}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">تدهور:</span><span className="font-mono text-amber-500">{item.degradationThreshold}</span></div>
                  </div>
                  <p className="text-[0.55rem] text-muted-foreground mt-1">{item.reason}</p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1.5 mb-1">
                    <ArrowRight className="h-3 w-3 text-blue-500" />
                    <span className="text-xs font-medium flex-1">موصى: {item.recommendedModel}</span>
                  </div>
                  <p className="text-[0.65rem] text-muted-foreground">{item.reason}</p>
                  {item.alternatives?.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-0.5">
                      <span className="text-[0.55rem] text-muted-foreground">بدائل:</span>
                      {item.alternatives.map((a: string, j: number) => <Badge key={j} variant="outline" className="text-[0.5rem] py-0">{a}</Badge>)}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

// ─── Tab 3: Operations (439-444) ───

function OperationsTab({ onChange }: { onChange: () => void }) {
  const [running, setRunning] = React.useState<string | null>(null)
  const [results, setResults] = React.useState<Record<string, any>>({})

  const ops: Array<{ key: string; label: string; icon: React.ReactNode; feature: number; desc: string }> = [
    { key: "fast_strong_pair", label: "Fast/Strong Pair", icon: <Zap className="h-3.5 w-3.5" />, feature: 439, desc: "نموذج سريع + نموذج قوي" },
    { key: "draft_verify", label: "Draft-and-Verify", icon: <Check className="h-3.5 w-3.5" />, feature: 440, desc: "توليد ثم تحقق" },
    { key: "provider_failover", label: "Provider Failover", icon: <Shield className="h-3.5 w-3.5" />, feature: 442, desc: "تبديل provider عند الفشل" },
    { key: "model_warmup", label: "Model Warmup", icon: <Flame className="h-3.5 w-3.5" />, feature: 443, desc: "تهيئة مسبقة" },
    { key: "model_unload", label: "Idle Unload", icon: <Snowflake className="h-3.5 w-3.5" />, feature: 444, desc: "إلغاء تحميل الخامل" },
  ]

  const handleRun = async (key: string) => {
    setRunning(key)
    try {
      let data: any
      if (key === "draft_verify") data = await apiCall(key, { prompt: "Test prompt for draft-and-verify" })
      else data = await apiCall(key)
      setResults(prev => ({ ...prev, [key]: data }))
      toast.success(`${key}: تم`)
      onChange()
    } catch (e) { toast.error((e as Error).message) }
    finally { setRunning(null) }
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-2">
        <div><h3 className="text-sm font-semibold">العمليات / Operations (439-444)</h3></div>
        {ops.map(op => {
          const result = results[op.key]
          return (
            <div key={op.key} className="rounded-md border border-border/60 bg-card/50 p-2">
              <div className="flex items-center gap-2 mb-1">
                {op.icon}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium">{op.label}</span>
                    <Badge variant="outline" className="text-[0.55rem] py-0">#{op.feature}</Badge>
                  </div>
                  <p className="text-[0.65rem] text-muted-foreground">{op.desc}</p>
                </div>
                <Button onClick={() => handleRun(op.key)} disabled={!!running} variant="outline" size="sm" className="h-6 gap-1 text-xs">
                  {running === op.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                  شغّل
                </Button>
              </div>
              {result && (
                <div className="mt-1.5 pt-1.5 border-t border-border/40 text-[0.7rem] space-y-0.5">
                  {result.fastModel && <div className="flex justify-between"><span className="text-muted-foreground">سريع:</span><code className="font-mono">{result.fastModel}</code></div>}
                  {result.strongModel && <div className="flex justify-between"><span className="text-muted-foreground">قوي:</span><code className="font-mono">{result.strongModel}</code></div>}
                  {result.reason && <p className="text-muted-foreground text-[0.65rem]">{result.reason}</p>}
                  {result.failoverTo && <div className="flex justify-between"><span className="text-muted-foreground">تبديل إلى:</span><code className="font-mono">{result.failoverTo}</code></div>}
                  {Array.isArray(result) && result.map((r: any, j: number) => (
                    <div key={j} className="flex justify-between"><span className="text-muted-foreground">{r.modelId}:</span><span className="text-[0.65rem]">{r.reason}</span></div>
                  ))}
                  {result.unloaded && <p className="text-[0.65rem]">{result.reason}</p>}
                  {result.draft && <p className="text-[0.65rem] text-muted-foreground">{result.draft}</p>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}
