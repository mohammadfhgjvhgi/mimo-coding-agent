"use client"

/**
 * SelfImprovementPanel — Self-Improvement OS UI (spec section 26, features 371-380).
 *
 * 4 tabs:
 *  1. Metrics      — agent metrics + bottleneck + tool analytics + context waste + model routing
 *  2. Patterns      — failure pattern mining
 *  3. Hypotheses    — create/auto-generate + A/B comparison + benchmark + promote/reject
 *  4. History        — metrics snapshots over time
 */

import * as React from "react"
import {
  TrendingUp, TrendingDown, Activity, AlertTriangle, Check, X, RefreshCw,
  Brain, Bug, Cpu, Clock, Zap, ChevronRight, Loader2, Lightbulb,
  BarChart3, Layers, Workflow, ArrowRight, ArrowLeft, Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

interface Snapshot {
  totalHypotheses: number
  proposedCount: number
  testingCount: number
  provenCount: number
  promotedCount: number
  rejectedCount: number
  lastEfficiencyScore: number | null
  totalMetricsSnapshots: number
}

interface Hypothesis {
  id: string
  description: string
  status: string
  expectedImprovement: string | null
  confidence: number
  abWinner: string | null
  promotionNote: string | null
  createdAt: string
}

// ─────────────────────────────────────────────────────────────────────────
// Main panel
// ─────────────────────────────────────────────────────────────────────────

export function SelfImprovementPanel() {
  const [tab, setTab] = React.useState("metrics")
  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null)
  const [loadingSnapshot, setLoadingSnapshot] = React.useState(true)

  const loadSnapshot = React.useCallback(async () => {
    setLoadingSnapshot(true)
    try {
      const res = await fetch("/api/self-improvement?mode=snapshot")
      const data = await res.json()
      setSnapshot(data)
    } catch (err) {
      console.error("[SelfImprovementPanel] snapshot failed", err)
    } finally {
      setLoadingSnapshot(false)
    }
  }, [])

  React.useEffect(() => { loadSnapshot() }, [loadSnapshot])

  return (
    <div className="flex h-full flex-col" dir="rtl">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">تحسين الذات / Self-Improvement</span>
        </div>
        <Button variant="ghost" size="sm" onClick={loadSnapshot} className="h-7 gap-1 px-2 text-xs" disabled={loadingSnapshot}>
          <RefreshCw className={cn("h-3 w-3", loadingSnapshot && "animate-spin")} />
          تحديث
        </Button>
      </div>

      {/* Stats */}
      {snapshot && (
        <div className="grid grid-cols-3 gap-1.5 border-b border-border/60 bg-muted/30 px-3 py-2 text-center text-[0.65rem]">
          <Stat icon={<Lightbulb className="h-3 w-3 text-amber-500" />} label="فرضيات" value={snapshot.totalHypotheses} tone="amber" />
          <Stat icon={<Clock className="h-3 w-3 text-blue-500" />} label="قيد الاختبار" value={snapshot.testingCount} tone="blue" />
          <Stat icon={<Check className="h-3 w-3 text-emerald-500" />} label="مقبولة" value={snapshot.promotedCount} tone="emerald" />
          <Stat icon={<X className="h-3 w-3 text-red-500" />} label="مرفوضة" value={snapshot.rejectedCount} tone="red" />
          <Stat icon={<Activity className="h-3 w-3" />} label="لقطات" value={snapshot.totalMetricsSnapshots} tone="default" />
          <Stat
            icon={snapshot.lastEfficiencyScore !== null
              ? (snapshot.lastEfficiencyScore >= 80 ? <Check className="h-3 w-3 text-emerald-500" /> : <TrendingDown className="h-3 w-3 text-amber-500" />)
              : <Activity className="h-3 w-3 text-muted-foreground" />}
            label="الكفاءة"
            value={snapshot.lastEfficiencyScore !== null ? `${snapshot.lastEfficiencyScore}%` : "—"}
            tone={snapshot.lastEfficiencyScore !== null && snapshot.lastEfficiencyScore >= 80 ? "emerald" : "amber"}
          />
        </div>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 min-h-0 flex-col">
        <TabsList className="grid w-full grid-cols-4 rounded-none border-b border-border bg-transparent p-0">
          <TabsTrigger value="metrics" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            المقاييس
          </TabsTrigger>
          <TabsTrigger value="patterns" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            الأنماط
          </TabsTrigger>
          <TabsTrigger value="hypotheses" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            الفرضيات
          </TabsTrigger>
          <TabsTrigger value="history" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            السجل
          </TabsTrigger>
        </TabsList>

        <TabsContent value="metrics" className="m-0 flex-1 min-h-0 overflow-hidden">
          <MetricsTab onChange={loadSnapshot} />
        </TabsContent>
        <TabsContent value="patterns" className="m-0 flex-1 min-h-0 overflow-hidden">
          <PatternsTab />
        </TabsContent>
        <TabsContent value="hypotheses" className="m-0 flex-1 min-h-0 overflow-hidden">
          <HypothesesTab onChange={loadSnapshot} />
        </TabsContent>
        <TabsContent value="history" className="m-0 flex-1 min-h-0 overflow-hidden">
          <HistoryTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Stat({ icon, label, value, tone }: {
  icon: React.ReactNode; label: string; value: number | string; tone: "default" | "emerald" | "amber" | "red" | "blue"
}) {
  const toneClass = {
    default: "text-foreground",
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    red: "text-red-600 dark:text-red-400",
    blue: "text-blue-600 dark:text-blue-400",
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
  const res = await fetch("/api/self-improvement", {
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
// Tab 1: Metrics — 6 detectors
// ─────────────────────────────────────────────────────────────────────────

const METRIC_TOOLS: Array<{ key: string; label: string; icon: React.ReactNode; feature: number }> = [
  { key: "agent_metrics", label: "Agent Metrics", icon: <Activity className="h-3.5 w-3.5" />, feature: 371 },
  { key: "bottleneck", label: "Bottleneck Detection", icon: <AlertTriangle className="h-3.5 w-3.5" />, feature: 372 },
  { key: "tool_analytics", label: "Tool Failure Analytics", icon: <Bug className="h-3.5 w-3.5" />, feature: 374 },
  { key: "context_waste", label: "Context Waste Analysis", icon: <Layers className="h-3.5 w-3.5" />, feature: 375 },
  { key: "model_routing", label: "Model Routing Analytics", icon: <Cpu className="h-3.5 w-3.5" />, feature: 376 },
]

function MetricsTab({ onChange }: { onChange: () => void }) {
  const [results, setResults] = React.useState<Record<string, any>>({})
  const [running, setRunning] = React.useState<string | null>(null)

  const runTool = async (key: string) => {
    setRunning(key)
    try {
      const data = await apiCall(key)
      setResults(prev => ({ ...prev, [key]: data }))
      toast.success(`${key}: تم`)
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setRunning(null)
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-2">
        <div>
          <h3 className="text-sm font-semibold">المقاييس / Metrics (371-376)</h3>
          <p className="text-[0.7rem] text-muted-foreground mt-0.5">
            5 أدوات تحليل لقياس أداء الوكيل
          </p>
        </div>

        {METRIC_TOOLS.map(tool => {
          const data = results[tool.key]
          return (
            <div key={tool.key} className="rounded-md border border-border/60 bg-card/50 p-2">
              <div className="flex items-center gap-2 mb-1">
                {tool.icon}
                <span className="text-xs font-medium flex-1">{tool.label}</span>
                <Badge variant="outline" className="text-[0.55rem] py-0">#{tool.feature}</Badge>
                <Button
                  onClick={() => runTool(tool.key)}
                  disabled={!!running}
                  variant="outline"
                  size="sm"
                  className="h-6 gap-1 text-xs"
                >
                  {running === tool.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                  شغّل
                </Button>
              </div>
              {data && (
                <div className="mt-1.5 pt-1.5 border-t border-border/40 text-[0.7rem] space-y-0.5">
                  {tool.key === "agent_metrics" && (
                    <>
                      <MetricRow label="المهام" value={data.totalTasks} />
                      <MetricRow label="معدل النجاح" value={`${data.successRate}%`} tone={data.successRate >= 80 ? "emerald" : "amber"} />
                      <MetricRow label="كفاءة" value={`${data.efficiencyScore}%`} tone={data.efficiencyScore >= 80 ? "emerald" : "amber"} />
                      <MetricRow label="نداءات أدوات" value={data.toolCallsCount} />
                      <MetricRow label="فشل أدوات" value={data.toolFailures} tone={data.toolFailures > 0 ? "red" : "emerald"} />
                      <MetricRow label="هدر tokens" value={data.contextWasteTokens} />
                    </>
                  )}
                  {tool.key === "bottleneck" && (
                    <p>{Array.isArray(data) ? `${data.length} اختناقات مكتشفة` : "لا اختناقات"}</p>
                  )}
                  {tool.key === "tool_analytics" && (
                    <p>{Array.isArray(data) ? `${data.length} أدوات محللة` : "لا بيانات"}</p>
                  )}
                  {tool.key === "context_waste" && (
                    <>
                      <MetricRow label="إجمالي tokens" value={data.totalTokens} />
                      <MetricRow label="هدر" value={`${data.wastePercentage}%`} tone={data.wastePercentage > 20 ? "red" : "emerald"} />
                      <p className="text-muted-foreground">{data.suggestion}</p>
                    </>
                  )}
                  {tool.key === "model_routing" && (
                    <p>{Array.isArray(data) ? `${data.length} نماذج مستخدمة` : "لا بيانات"}</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

function MetricRow({ label, value, tone }: { label: string; value: string | number; tone?: "emerald" | "red" | "amber" }) {
  const toneClass = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    red: "text-red-600 dark:text-red-400",
    amber: "text-amber-600 dark:text-amber-400",
  }[tone ?? ""]
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}:</span>
      <span className={cn("font-mono font-bold", toneClass)}>{value}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 2: Patterns — failure pattern mining
// ─────────────────────────────────────────────────────────────────────────

function PatternsTab() {
  const [patterns, setPatterns] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiCall("failure_patterns")
      setPatterns(data ?? [])
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold flex items-center gap-1.5">
          <Bug className="h-3.5 w-3.5 text-red-500" />
          أنماط الفشل / Failure Patterns (373)
        </span>
        <Button onClick={load} variant="ghost" size="sm" className="h-7 w-7 p-0">
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
        </Button>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1.5">
          {loading ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
              جارٍ التحليل…
            </div>
          ) : patterns.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <Check className="h-8 w-8 text-emerald-500/30 mx-auto mb-2" />
              لا أنماط فشل مسجّلة
            </div>
          ) : (
            patterns.map((p, i) => (
              <div key={i} className="rounded-md border border-border/60 bg-card/50 p-2">
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  <Badge variant="outline" className="text-[0.6rem] py-0">{p.category}</Badge>
                  <Badge variant="outline" className="text-[0.6rem] py-0">{p.count} حدث</Badge>
                  <Badge variant="outline" className="text-[0.6rem] py-0">{p.percentage}%</Badge>
                </div>
                <p className="text-[0.7rem] mb-1"><span className="text-muted-foreground">السبب:</span> {p.rootCause}</p>
                <p className="text-[0.7rem] mb-1"><span className="text-muted-foreground">الحل:</span> <span className="text-emerald-600 dark:text-emerald-400">{p.suggestedFix}</span></p>
                <details className="text-[0.65rem]">
                  <summary className="text-muted-foreground cursor-pointer">الخطأ الشائع</summary>
                  <code className="font-mono block break-all mt-1 text-muted-foreground" dir="ltr">{p.commonError}</code>
                </details>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 3: Hypotheses — create + A/B + benchmark + promote/reject
// ─────────────────────────────────────────────────────────────────────────

function HypothesesTab({ onChange }: { onChange: () => void }) {
  const [hypotheses, setHypotheses] = React.useState<Hypothesis[]>([])
  const [loading, setLoading] = React.useState(true)
  const [showForm, setShowForm] = React.useState(false)
  const [desc, setDesc] = React.useState("")
  const [expected, setExpected] = React.useState("")
  const [autoGen, setAutoGen] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/self-improvement?mode=hypotheses&limit=50")
      const data = await res.json()
      setHypotheses(data ?? [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (!desc.trim()) {
      toast.error("الوصف مطلوب")
      return
    }
    try {
      await apiCall("hypothesis_create", { description: desc, expectedImprovement: expected })
      toast.success("أُنشئت الفرضية")
      setDesc("")
      setExpected("")
      setShowForm(false)
      load()
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleAutoGen = async () => {
    setAutoGen(true)
    try {
      const data = await apiCall("hypothesis_auto")
      toast.success(`أُنشئت ${data.created} فرضية تلقائياً`)
      load()
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setAutoGen(false)
    }
  }

  const handleABCompare = async (h: Hypothesis) => {
    const resultsA = prompt("نتيجة A (success/tokens/ms):", "true,500,2000")
    if (!resultsA) return
    const resultsB = prompt("نتيجة B (success/tokens/ms):", "true,300,1500")
    if (!resultsB) return
    try {
      const [sA, tA, mA] = resultsA.split(",").map(s => s.trim())
      const [sB, tB, mB] = resultsB.split(",").map(s => s.trim())
      const data = await apiCall("ab_compare", {
        hypothesisId: h.id,
        approachA: "baseline",
        approachB: "new",
        resultsA: { success: sA === "true", tokens: parseInt(tA), durationMs: parseInt(mA) },
        resultsB: { success: sB === "true", tokens: parseInt(tB), durationMs: parseInt(mB) },
      })
      toast.success(`الفائز: ${data.winner} — ${data.reason}`)
      load()
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handlePromote = async (h: Hypothesis, decision: "promote" | "reject") => {
    const note = decision === "promote"
      ? prompt("ملاحظة القبول (ما الذي تم تغييره؟):") ?? ""
      : prompt("سبب الرفض:") ?? ""
    try {
      await apiCall("promote_reject", { hypothesisId: h.id, decision, note })
      toast.success(decision === "promote" ? "تم القبول ✅" : "تم الرفض ❌")
      load()
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="border-b border-border/60 bg-muted/20 px-3 py-2 space-y-2">
        <div className="flex gap-1.5">
          <Button onClick={() => setShowForm(!showForm)} size="sm" className="h-7 gap-1 text-xs flex-1">
            <Plus className="h-3 w-3" /> فرضية جديدة (377)
          </Button>
          <Button onClick={handleAutoGen} disabled={autoGen} variant="outline" size="sm" className="h-7 gap-1 text-xs flex-1">
            {autoGen ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            توليد تلقائي
          </Button>
        </div>
        {showForm && (
          <div className="space-y-2 pt-1">
            <Textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="وصف الفرضية: مثلاً 'تقليل استخدام GPT-4 للمهام البسيطة لتوفير التكلفة'"
              className="text-xs"
              rows={2}
            />
            <Input
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              placeholder="التحسين المتوقع: 'تقليل التكلفة 30%'"
              className="text-xs"
            />
            <Button onClick={handleCreate} size="sm" className="w-full h-7 text-xs">
              <Check className="h-3 w-3" /> أنشئ
            </Button>
          </div>
        )}
      </div>

      {/* List */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1.5">
          {loading ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
              جارٍ التحميل…
            </div>
          ) : hypotheses.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <Lightbulb className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              لا فرضيات. اضغط "توليد تلقائي" للبدء.
            </div>
          ) : (
            hypotheses.map(h => (
              <HypothesisCard
                key={h.id}
                hypothesis={h}
                onABCompare={() => handleABCompare(h)}
                onPromote={() => handlePromote(h, "promote")}
                onReject={() => handlePromote(h, "reject")}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function Plus(props: any) {
  return <span {...props}>+</span>
}

function HypothesisCard({ hypothesis: h, onABCompare, onPromote, onReject }: {
  hypothesis: Hypothesis
  onABCompare: () => void
  onPromote: () => void
  onReject: () => void
}) {
  const [expanded, setExpanded] = React.useState(false)
  const time = new Date(h.createdAt).toLocaleDateString("ar-SA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })

  const statusTones: Record<string, string> = {
    proposed: "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400",
    testing: "border-blue-500/30 bg-blue-500/5 text-blue-600 dark:text-blue-400",
    proven: "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400",
    promoted: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    rejected: "border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400",
  }

  const statusLabels: Record<string, string> = {
    proposed: "مقترحة",
    testing: "قيد الاختبار",
    proven: "مثبتة",
    promoted: "مقبولة ✅",
    rejected: "مرفوضة ❌",
  }

  return (
    <div className={cn("rounded-md border p-2", statusTones[h.status] ?? "border-border/60 bg-card/50")}>
      <button onClick={() => setExpanded(!expanded)} className="w-full text-right">
        <div className="flex items-center gap-1.5 flex-wrap mb-1">
          <Badge variant="outline" className="text-[0.55rem] py-0">
            {statusLabels[h.status] ?? h.status}
          </Badge>
          {h.confidence > 0 && (
            <Badge variant="outline" className="text-[0.55rem] py-0">
              ثقة {h.confidence}%
            </Badge>
          )}
          {h.abWinner && h.abWinner !== "tie" && (
            <Badge variant="outline" className="text-[0.55rem] py-0 text-emerald-500 border-emerald-500/30">
              A/B: {h.abWinner}
            </Badge>
          )}
          <span className="text-[0.55rem] text-muted-foreground ml-auto">{time}</span>
        </div>
        <p className="text-[0.7rem]">{h.description}</p>
      </button>

      {expanded && (
        <div className="mt-2 pt-2 border-t border-border/40 space-y-1.5 text-[0.7rem]">
          {h.expectedImprovement && (
            <p><span className="text-muted-foreground">المتوقع:</span> {h.expectedImprovement}</p>
          )}
          {h.promotionNote && (
            <p><span className="text-muted-foreground">ملاحظة:</span> {h.promotionNote}</p>
          )}
          {h.status === "proposed" && (
            <div className="flex gap-1.5 mt-2">
              <Button onClick={onABCompare} variant="outline" size="sm" className="h-6 gap-1 text-[0.65rem] flex-1">
                <BarChart3 className="h-3 w-3" /> A/B (378)
              </Button>
            </div>
          )}
          {(h.status === "testing" || h.status === "proven") && (
            <div className="flex gap-1.5 mt-2">
              <Button onClick={onPromote} size="sm" className="h-6 gap-1 text-[0.65rem] flex-1 bg-emerald-600 hover:bg-emerald-700 text-white">
                <Check className="h-3 w-3" /> قبول (380)
              </Button>
              <Button onClick={onReject} variant="outline" size="sm" className="h-6 gap-1 text-[0.65rem] flex-1 border-red-500/40 text-red-600 hover:bg-red-500/10">
                <X className="h-3 w-3" /> رفض
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 4: History — metrics snapshots over time
// ─────────────────────────────────────────────────────────────────────────

function HistoryTab() {
  const [metrics, setMetrics] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/self-improvement?mode=metrics&limit=20")
      const data = await res.json()
      setMetrics(data ?? [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold flex items-center gap-1.5">
          <BarChart3 className="h-3.5 w-3.5" />
          سجل المقاييس / Metrics History
        </span>
        <Button onClick={load} variant="ghost" size="sm" className="h-7 w-7 p-0">
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
        </Button>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1">
          {loading ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
              جارٍ التحميل…
            </div>
          ) : metrics.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <Activity className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              لا لقطات. شغّل Agent Metrics لإنشاء أول لقطة.
            </div>
          ) : (
            metrics.map(m => {
              const time = new Date(m.createdAt).toLocaleString("ar-SA", { dateStyle: "short", timeStyle: "short" })
              return (
                <div key={m.id} className="rounded-md border border-border/60 bg-card/50 p-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Badge variant="outline" className="text-[0.55rem] py-0">{m.period}</Badge>
                    <Badge variant="outline" className={cn("text-[0.55rem] py-0",
                      m.efficiencyScore >= 80 ? "text-emerald-500 border-emerald-500/30" :
                      m.efficiencyScore >= 50 ? "text-amber-500 border-amber-500/30" :
                      "text-red-500 border-red-500/30"
                    )}>
                      كفاءة {m.efficiencyScore}%
                    </Badge>
                    <span className="text-[0.55rem] text-muted-foreground ml-auto">{time}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 text-[0.65rem]">
                    <MetricRow label="المهام" value={m.totalTasks} />
                    <MetricRow label="نجاح" value={`${m.successRate}%`} tone={m.successRate >= 80 ? "emerald" : "amber"} />
                    <MetricRow label="فشل أدوات" value={m.toolFailures} tone={m.toolFailures > 0 ? "red" : "emerald"} />
                    <MetricRow label="هدر" value={m.contextWasteTokens} />
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
