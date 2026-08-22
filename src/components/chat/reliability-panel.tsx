"use client"

/**
 * ReliabilityPanel — complete Reliability OS UI (13 features from spec section 24).
 *
 * Tabs:
 *  1. Loop Guard         — detect + break infinite loops
 *  2. Tool Recovery      — malformed + wrong tool + argument repair + prose→tool
 *  3. Failure Memory      — saved lessons from past failures
 *  4. Recovery Tools      — timeout/OOM/crash recovery + checkpoints + unknown-state
 *
 * This panel makes ALL 13 features of section 24 (Reliability) usable by a normal user.
 */

import * as React from "react"
import {
  Activity, AlertTriangle, Check, X, RefreshCw, Plus, Trash2, Copy,
  Shield, ShieldCheck, ShieldAlert, RotateCcw, Zap, Brain, Cpu, Clock,
  Bug, Wrench, History, ListChecks, ChevronRight, Loader2, Save, Search, Lightbulb,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
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
  totalFailures: number
  totalCheckpoints: number
  totalLoopEvents: number
  loopEventsBroken: number
  failuresByCategory: Record<string, number>
  failuresBySeverity: Record<string, number>
  recoveredCount: number
  lessonsLearned: number
}

interface Failure {
  id: string
  task: string
  error: string
  category: string
  severity: string
  recovered: boolean
  lesson: string | null
  occurrences: number
  createdAt: string
}

interface Checkpoint {
  id: string
  kind: string
  label: string | null
  gitHash: string | null
  tokens: number
  createdAt: string
}

// ─────────────────────────────────────────────────────────────────────────
// Main panel
// ─────────────────────────────────────────────────────────────────────────

export function ReliabilityPanel() {
  const [tab, setTab] = React.useState("loop")
  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null)
  const [loadingSnapshot, setLoadingSnapshot] = React.useState(true)

  const loadSnapshot = React.useCallback(async () => {
    setLoadingSnapshot(true)
    try {
      const res = await fetch("/api/reliability-os?mode=snapshot")
      const data = await res.json()
      setSnapshot(data)
    } catch (err) {
      console.error("[ReliabilityPanel] snapshot failed", err)
    } finally {
      setLoadingSnapshot(false)
    }
  }, [])

  React.useEffect(() => { loadSnapshot() }, [loadSnapshot])

  return (
    <div className="flex h-full flex-col" dir="rtl">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">الموثوقية / Reliability OS</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={loadSnapshot}
          className="h-7 gap-1 px-2 text-xs"
          disabled={loadingSnapshot}
        >
          <RefreshCw className={cn("h-3 w-3", loadingSnapshot && "animate-spin")} />
          تحديث
        </Button>
      </div>

      {/* Stats */}
      {snapshot && (
        <div className="grid grid-cols-3 gap-1.5 border-b border-border/60 bg-muted/30 px-3 py-2 text-center text-[0.65rem]">
          <Stat icon={<Bug className="h-3 w-3 text-red-500" />} label="فشل" value={snapshot.totalFailures} tone="red" />
          <Stat icon={<Check className="h-3 w-3 text-emerald-500" />} label="مُتعافى" value={snapshot.recoveredCount} tone="emerald" />
          <Stat icon={<Lightbulb className="h-3 w-3 text-amber-500" />} label="دروس" value={snapshot.lessonsLearned} tone="amber" />
          <Stat icon={<Save className="h-3 w-3 text-blue-500" />} label="نقاط حفظ" value={snapshot.totalCheckpoints} tone="blue" />
          <Stat icon={<RotateCcw className="h-3 w-3 text-purple-500" />} label="أحداث loop" value={snapshot.totalLoopEvents} tone="purple" />
          <Stat icon={<ShieldXIcon />} label="مكسورة" value={snapshot.loopEventsBroken} tone="default" />
        </div>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 min-h-0 flex-col">
        <TabsList className="grid w-full grid-cols-4 rounded-none border-b border-border bg-transparent p-0">
          <TabsTrigger value="loop" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            Loop
          </TabsTrigger>
          <TabsTrigger value="tools" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            إصلاح أدوات
          </TabsTrigger>
          <TabsTrigger value="memory" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            ذاكرة الفشل
          </TabsTrigger>
          <TabsTrigger value="recovery" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            استعادة
          </TabsTrigger>
        </TabsList>

        <TabsContent value="loop" className="m-0 flex-1 min-h-0 overflow-hidden">
          <LoopGuardTab />
        </TabsContent>
        <TabsContent value="tools" className="m-0 flex-1 min-h-0 overflow-hidden">
          <ToolRecoveryTab />
        </TabsContent>
        <TabsContent value="memory" className="m-0 flex-1 min-h-0 overflow-hidden">
          <FailureMemoryTab onChange={loadSnapshot} />
        </TabsContent>
        <TabsContent value="recovery" className="m-0 flex-1 min-h-0 overflow-hidden">
          <RecoveryToolsTab onChange={loadSnapshot} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function ShieldXIcon() {
  return <X className="h-3 w-3 text-muted-foreground" />
}

function Stat({ icon, label, value, tone }: {
  icon: React.ReactNode; label: string; value: number; tone: "default" | "emerald" | "red" | "amber" | "blue" | "purple"
}) {
  const toneClass = {
    default: "text-foreground",
    emerald: "text-emerald-600 dark:text-emerald-400",
    red: "text-red-600 dark:text-red-400",
    amber: "text-amber-600 dark:text-amber-400",
    blue: "text-blue-600 dark:text-blue-400",
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
  const res = await fetch("/api/reliability-os", {
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
// Tab 1: Loop Guard
// ─────────────────────────────────────────────────────────────────────────

function LoopGuardTab() {
  const [toolName, setToolName] = React.useState("file_read")
  const [argsText, setArgsText] = React.useState('{"path": "/etc/passwd"}')
  const [conversationId, setConversationId] = React.useState("")
  const [result, setResult] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(false)

  const handleCheck = async () => {
    setLoading(true)
    try {
      let args: unknown = {}
      try { args = JSON.parse(argsText) } catch { args = { _raw: argsText } }
      const data = await apiCall("loop_guard", {
        conversationId: conversationId || undefined,
        toolName,
        args,
      })
      setResult(data)
      if (data.isLoop) toast.error(data.reason)
      else toast.success(data.reason)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const handleReset = async () => {
    if (!conversationId) {
      toast.error("أدخل conversation ID أولاً")
      return
    }
    try {
      await apiCall("loop_reset", { conversationId })
      toast.success("تمت إعادة تعيين الـ loop guard")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // Quick demo: simulate 3 identical calls to trigger the guard
  const handleSimulateLoop = async () => {
    setLoading(true)
    try {
      for (let i = 1; i <= 4; i++) {
        let args: unknown = {}
        try { args = JSON.parse(argsText) } catch { args = { _raw: argsText } }
        const data = await apiCall("loop_guard", {
          conversationId: conversationId || "demo",
          toolName,
          args,
        })
        setResult(data)
        if (data.isLoop) {
          toast.error(`Loop detected at call #${i}!`)
          break
        }
        await new Promise((r) => setTimeout(r, 100))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <RotateCcw className="h-4 w-4 text-purple-500" />
            منع الـ Loops (338)
          </h3>
          <p className="text-[0.7rem] text-muted-foreground mt-0.5">
            كشف الأداة المُعادة 3+ مرات بنفس الوسائط وكسر الـ loop تلقائياً
          </p>
        </div>

        <div className="space-y-2">
          <div>
            <Label className="text-xs">اسم الأداة / Tool Name</Label>
            <Input
              value={toolName}
              onChange={(e) => setToolName(e.target.value)}
              placeholder="file_read"
              className="text-xs font-mono"
              dir="ltr"
            />
          </div>
          <div>
            <Label className="text-xs">الوسائط / Args (JSON)</Label>
            <Textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              placeholder='{"path": "/etc/passwd"}'
              className="text-xs font-mono"
              dir="ltr"
              rows={3}
            />
          </div>
          <div>
            <Label className="text-xs">معرف المحادثة / Conversation ID (اختياري)</Label>
            <Input
              value={conversationId}
              onChange={(e) => setConversationId(e.target.value)}
              placeholder="cmt1..."
              className="text-xs font-mono"
              dir="ltr"
            />
          </div>

          <div className="flex gap-2">
            <Button onClick={handleCheck} disabled={loading} size="sm" className="h-8 text-xs flex-1">
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
              افحص نداء
            </Button>
            <Button onClick={handleSimulateLoop} disabled={loading} variant="outline" size="sm" className="h-8 text-xs flex-1">
              <Bug className="h-3 w-3" />
              محاكاة loop
            </Button>
            <Button onClick={handleReset} variant="ghost" size="sm" className="h-8 text-xs">
              إعادة تعيين
            </Button>
          </div>
        </div>

        {result && (
          <div className={cn(
            "rounded-md border p-2 text-xs space-y-1",
            result.isLoop
              ? "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300"
              : "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
          )}>
            <div className="flex items-center gap-1.5 font-semibold">
              {result.isLoop ? <ShieldAlert className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              {result.isLoop ? "تم كشف loop — مكسور!" : "مسموح"}
              <Badge variant="outline" className="text-[0.6rem] ml-auto">
                العدد: {result.count}
              </Badge>
            </div>
            <p className="text-[0.7rem]">{result.reason}</p>
          </div>
        )}

        <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2 text-[0.7rem] text-muted-foreground">
          <p className="font-semibold text-blue-600 dark:text-blue-400 mb-1">💡 كيف يعمل؟</p>
          <ul className="space-y-0.5 list-disc list-inside">
            <li>كل نداء أداة يُسجَّل مع hash للوسائط</li>
            <li>عند 3 نداءات متطابقة = loop → يُكسر تلقائياً</li>
            <li>يُسجَّل كفشل من نوع "loop" في ذاكرة الفشل</li>
          </ul>
        </div>
      </div>
    </ScrollArea>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 2: Tool Recovery (4 subtools: malformed + wrong + args + prose)
// ─────────────────────────────────────────────────────────────────────────

function ToolRecoveryTab() {
  const [subtab, setSubtab] = React.useState("malformed")

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-2 py-1.5">
        <div className="flex flex-wrap gap-1">
          <SubTabButton active={subtab === "malformed"} onClick={() => setSubtab("malformed")} icon={<Bug className="h-3 w-3" />} label="Malformed" />
          <SubTabButton active={subtab === "wrong"} onClick={() => setSubtab("wrong")} icon={<RotateCcw className="h-3 w-3" />} label="Wrong Tool" />
          <SubTabButton active={subtab === "args"} onClick={() => setSubtab("args")} icon={<Wrench className="h-3 w-3" />} label="Args" />
          <SubTabButton active={subtab === "prose"} onClick={() => setSubtab("prose")} icon={<Brain className="h-3 w-3" />} label="Prose→Tool" />
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3">
          {subtab === "malformed" && <MalformedToolTool />}
          {subtab === "wrong" && <WrongToolTool />}
          {subtab === "args" && <ArgumentRepairTool />}
          {subtab === "prose" && <ProseToToolTool />}
        </div>
      </ScrollArea>
    </div>
  )
}

function SubTabButton({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-md px-2 py-1 text-[0.65rem] font-medium transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function MalformedToolTool() {
  const [input, setInput] = React.useState('```json\n{"name": "shell", "args": {"command": "ls -la",},\n}\n```')
  const [result, setResult] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(false)

  const handleRecover = async () => {
    setLoading(true)
    try {
      const data = await apiCall("malformed_recover", { rawToolCall: input })
      setResult(data)
      if (data.repaired) toast.success(`تم الإصلاح — ${data.changes.length} تغييرات`)
      else toast.success("صالح أصلاً")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <ToolCard
      title="Malformed Tool Recovery (339)"
      description="إصلاح tool-call غير صالح (markdown fences, trailing commas, single quotes, unquoted keys)"
      icon={<Bug className="h-4 w-4" />}
    >
      <Textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder='```\n{"name": "shell", "args": {"command": "ls",},}\n```'
        className="text-xs font-mono"
        dir="ltr"
        rows={5}
      />
      <Button onClick={handleRecover} disabled={loading} size="sm" className="w-full h-8 text-xs">
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bug className="h-3 w-3" />}
        أصلح
      </Button>
      {result && (
        <div className={cn(
          "rounded-md border p-2 text-xs space-y-1",
          result.repaired ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5"
        )}>
          <div className="flex items-center gap-1.5 font-semibold">
            {result.repaired ? <Wrench className="h-3.5 w-3.5 text-amber-500" /> : <Check className="h-3.5 w-3.5 text-emerald-500" />}
            {result.repaired ? `${result.changes.length} إصلاحات` : "صالح أصلاً"}
          </div>
          {result.repaired && (
            <ul className="text-[0.7rem] list-disc list-inside text-muted-foreground">
              {result.changes.map((c: string, i: number) => <li key={i}>{c}</li>)}
            </ul>
          )}
          <div className="border-t border-border/40 pt-1 mt-1">
            <div className="text-[0.65rem] text-muted-foreground mb-0.5">النتيجة:</div>
            <code className="text-[0.65rem] font-mono block break-all" dir="ltr">
              tool: {result.toolName} | args: {JSON.stringify(result.args)}
            </code>
          </div>
        </div>
      )}
    </ToolCard>
  )
}

function WrongToolTool() {
  const [toolName, setToolName] = React.useState("bash")
  const [result, setResult] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(false)

  const handleRecover = async () => {
    setLoading(true)
    try {
      const data = await apiCall("wrong_tool_recover", { toolName })
      setResult(data)
      if (data.rerouted !== data.original) toast.success(`تمت إعادة التوجيه: ${data.rerouted}`)
      else toast.warning(data.reason)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <ToolCard
      title="Wrong Tool Recovery (340)"
      description="إعادة توجيه الأدوات الخاطئة (bash → shell, google → web_search...)"
      icon={<RotateCcw className="h-4 w-4" />}
    >
      <Input
        value={toolName}
        onChange={(e) => setToolName(e.target.value)}
        placeholder="bash / google / read / cat..."
        className="text-xs font-mono"
        dir="ltr"
      />
      <Button onClick={handleRecover} disabled={loading} size="sm" className="w-full h-8 text-xs">
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
        أعد التوجيه
      </Button>
      {result && (
        <div className={cn(
          "rounded-md border p-2 text-xs",
          result.rerouted !== result.original
            ? "border-amber-500/30 bg-amber-500/5"
            : "border-blue-500/30 bg-blue-500/5"
        )}>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="font-mono" dir="ltr">{result.original}</code>
            <ChevronRight className="h-3 w-3" />
            <code className="font-mono font-bold" dir="ltr">{result.rerouted}</code>
          </div>
          <p className="text-[0.7rem] mt-1 text-muted-foreground">{result.reason}</p>
        </div>
      )}
      <div className="text-[0.65rem] text-muted-foreground grid grid-cols-2 gap-1">
        <span>bash → shell</span>
        <span>google → web_search</span>
        <span>cat → file_read</span>
        <span>rm → file_delete</span>
      </div>
    </ToolCard>
  )
}

function ArgumentRepairTool() {
  const [toolName, setToolName] = React.useState("file_read")
  const [argsText, setArgsText] = React.useState('{"file": 123, "encoding": ""}')
  const [result, setResult] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(false)

  const handleRepair = async () => {
    setLoading(true)
    try {
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(argsText) } catch {
        toast.error("JSON غير صالح")
        setLoading(false)
        return
      }
      const data = await apiCall("argument_repair", { toolName, args })
      setResult(data)
      if (data.repaired) toast.success(`${data.changes.length} إصلاحات`)
      else toast.success("الوسائط سليمة")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <ToolCard
      title="Argument Repair (341)"
      description="إصلاح arguments (file→path, cmd→command, remove empties, cast types)"
      icon={<Wrench className="h-4 w-4" />}
    >
      <Input
        value={toolName}
        onChange={(e) => setToolName(e.target.value)}
        placeholder="file_read"
        className="text-xs font-mono"
        dir="ltr"
      />
      <Textarea
        value={argsText}
        onChange={(e) => setArgsText(e.target.value)}
        placeholder='{"file": 123, "encoding": ""}'
        className="text-xs font-mono"
        dir="ltr"
        rows={3}
      />
      <Button onClick={handleRepair} disabled={loading} size="sm" className="w-full h-8 text-xs">
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
        أصلح الوسائط
      </Button>
      {result && (
        <div className={cn(
          "rounded-md border p-2 text-xs space-y-1",
          result.repaired ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5"
        )}>
          <div className="flex items-center gap-1.5 font-semibold">
            {result.repaired ? <Wrench className="h-3.5 w-3.5 text-amber-500" /> : <Check className="h-3.5 w-3.5 text-emerald-500" />}
            {result.repaired ? `${result.changes.length} إصلاحات` : "سليمة"}
          </div>
          {result.repaired && (
            <ul className="text-[0.7rem] list-disc list-inside text-muted-foreground">
              {result.changes.map((c: string, i: number) => <li key={i}>{c}</li>)}
            </ul>
          )}
          <code className="text-[0.65rem] font-mono block break-all" dir="ltr">
            {JSON.stringify(result.args)}
          </code>
        </div>
      )}
    </ToolCard>
  )
}

function ProseToToolTool() {
  const [prose, setProse] = React.useState("use bash to run ls -la")
  const [result, setResult] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(false)

  const handleConvert = async () => {
    setLoading(true)
    try {
      const data = await apiCall("prose_to_tool", { prose })
      setResult(data)
      if (data.toolName) toast.success(`تم التحويل → ${data.toolName}`)
    } catch (e) {
      toast.error((e as Error).message)
      setResult({ error: (e as Error).message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <ToolCard
      title="Prose-to-Tool Recovery (342)"
      description="تحويل نص إلى tool call (use bash → shell, search for X → web_search...)"
      icon={<Brain className="h-4 w-4" />}
    >
      <Textarea
        value={prose}
        onChange={(e) => setProse(e.target.value)}
        placeholder="use bash to run ls -la / search for OpenAI / read file /etc/passwd"
        className="text-xs"
        dir="ltr"
        rows={3}
      />
      <Button onClick={handleConvert} disabled={loading} size="sm" className="w-full h-8 text-xs">
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
        حوّل
      </Button>
      {result && !result.error && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs space-y-1">
          <div className="flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300">
            <Check className="h-3.5 w-3.5" />
            تم التحويل ← <code className="font-mono font-bold" dir="ltr">{result.toolName}</code>
          </div>
          <code className="text-[0.65rem] font-mono block break-all" dir="ltr">
            {JSON.stringify(result.args)}
          </code>
          <p className="text-[0.65rem] text-muted-foreground">{result.changes[0]}</p>
        </div>
      )}
      {result?.error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-700 dark:text-red-300">
          <X className="h-3.5 w-3.5 inline" /> {result.error}
        </div>
      )}
    </ToolCard>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 3: Failure Memory
// ─────────────────────────────────────────────────────────────────────────

function FailureMemoryTab({ onChange }: { onChange: () => void }) {
  const [failures, setFailures] = React.useState<Failure[]>([])
  const [loading, setLoading] = React.useState(true)
  const [filter, setFilter] = React.useState("")
  const [lookupTask, setLookupTask] = React.useState("")
  const [lookupResult, setLookupResult] = React.useState<Failure[] | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/reliability-os?mode=failures&limit=100")
      const data = await res.json()
      setFailures(data ?? [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  const handleLookup = async () => {
    if (!lookupTask.trim()) return
    try {
      const data = await apiCall("failure_memory_lookup", { task: lookupTask })
      setLookupResult(data)
      toast.success(`وُجدت ${data.length} ذكريات مطابقة`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleMarkRecovered = async (id: string) => {
    const lesson = prompt("ما الدرس المستفاد؟ (اختياري)")
    try {
      await apiCall("failure_mark_recovered", { id, lesson: lesson ?? undefined })
      toast.success("تم تعليم الفشل كـ مُتعافى")
      load()
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleAddLesson = async () => {
    const task = prompt("المهمة التي فشلت:")
    if (!task) return
    const error = prompt("رسالة الخطأ:")
    if (!error) return
    const lesson = prompt("ما الدرس؟ (لا تفعل X)")
    if (!lesson) return
    try {
      await apiCall("negative_learning", { task, error, lesson })
      toast.success("تم تسجيل الدرس")
      setLookupTask(task)
      handleLookup()
      load()
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const filtered = React.useMemo(() => {
    if (!filter) return failures
    const f = filter.toLowerCase()
    return failures.filter(x =>
      x.task.toLowerCase().includes(f) ||
      x.error.toLowerCase().includes(f) ||
      x.category.toLowerCase().includes(f)
    )
  }, [failures, filter])

  const categoryTone: Record<string, string> = {
    timeout: "amber",
    oom: "red",
    crash: "red",
    loop: "purple",
    tool_malformed: "amber",
    tool_wrong: "blue",
    argument_invalid: "amber",
    unknown_state: "default",
    unknown: "default",
  }

  return (
    <div className="flex h-full flex-col">
      {/* Lookup bar */}
      <div className="border-b border-border/60 bg-muted/20 px-3 py-2 space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
          ابحث في ذاكرة الفشل (349)
        </div>
        <div className="flex gap-2">
          <Input
            value={lookupTask}
            onChange={(e) => setLookupTask(e.target.value)}
            placeholder="اكتب وصف المهمة…"
            className="h-7 text-xs"
            dir="ltr"
          />
          <Button onClick={handleLookup} size="sm" variant="outline" className="h-7 text-xs">
            <Search className="h-3 w-3" />
          </Button>
        </div>
        <Button onClick={handleAddLesson} variant="outline" size="sm" className="w-full h-7 text-xs">
          <Plus className="h-3 w-3" /> أضف درس سلبي (350)
        </Button>
      </div>

      {/* Filter */}
      <div className="border-b border-border/60 px-3 py-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="فلتر (task/error/category)…"
          className="h-7 text-xs"
          dir="ltr"
        />
      </div>

      {/* Results */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1.5">
          {lookupResult && (
            <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2 mb-2">
              <p className="text-[0.65rem] font-semibold text-blue-600 dark:text-blue-400 mb-1">
                نتائج البحث ({lookupResult.length}):
              </p>
              {lookupResult.slice(0, 3).map((f) => (
                <div key={f.id} className="text-[0.7rem] mb-1">
                  <code className="font-mono">{f.category}</code>
                  {f.lesson && <p className="text-amber-600 dark:text-amber-400">💡 {f.lesson}</p>}
                </div>
              ))}
            </div>
          )}

          {loading ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
              جارٍ التحميل…
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <Bug className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              لا فشل مسجّل
            </div>
          ) : (
            filtered.map((f) => (
              <FailureCard key={f.id} failure={f} tone={categoryTone[f.category] ?? "default"} onRecover={() => handleMarkRecovered(f.id)} />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function FailureCard({ failure, tone, onRecover }: {
  failure: Failure; tone: string; onRecover: () => void
}) {
  const [expanded, setExpanded] = React.useState(false)
  const time = new Date(failure.createdAt).toLocaleDateString("ar-SA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })

  const toneClasses: Record<string, string> = {
    amber: "border-amber-500/30 bg-amber-500/5",
    red: "border-red-500/30 bg-red-500/5",
    purple: "border-purple-500/30 bg-purple-500/5",
    blue: "border-blue-500/30 bg-blue-500/5",
    default: "border-border/60 bg-card/50",
  }
  const cls = toneClasses[tone] ?? toneClasses.default

  return (
    <div className={cn("rounded-md border p-2", cls)}>
      <button onClick={() => setExpanded(!expanded)} className="w-full text-right">
        <div className="flex items-center gap-1.5 flex-wrap mb-1">
          {failure.recovered ? (
            <Check className="h-3 w-3 text-emerald-500 shrink-0" />
          ) : (
            <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
          )}
          <Badge variant="outline" className="text-[0.6rem] py-0">{failure.category}</Badge>
          <Badge variant="outline" className="text-[0.6rem] py-0">{failure.severity}</Badge>
          {failure.occurrences > 1 && (
            <Badge variant="outline" className="text-[0.6rem] py-0 text-purple-500 border-purple-500/30">
              ×{failure.occurrences}
            </Badge>
          )}
          <span className="text-[0.6rem] text-muted-foreground ml-auto">{time}</span>
        </div>
        <p className="text-[0.7rem] font-mono truncate" dir="ltr">{failure.task}</p>
      </button>

      {expanded && (
        <div className="mt-2 pt-2 border-t border-border/40 space-y-1 text-[0.7rem]">
          <div>
            <span className="text-muted-foreground">الخطأ:</span>
            <code className="font-mono break-all block mt-0.5 text-red-600 dark:text-red-400" dir="ltr">
              {failure.error}
            </code>
          </div>
          {failure.lesson && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded p-1.5 mt-1">
              <p className="text-amber-700 dark:text-amber-300">💡 {failure.lesson}</p>
            </div>
          )}
          {!failure.recovered && (
            <Button onClick={onRecover} variant="outline" size="sm" className="h-6 w-full text-xs mt-1">
              <Check className="h-3 w-3" /> علّم كمُتعافى
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 4: Recovery Tools (timeout + OOM + crash + checkpoint + state)
// ─────────────────────────────────────────────────────────────────────────

function RecoveryToolsTab({ onChange }: { onChange: () => void }) {
  const [subtab, setSubtab] = React.useState("timeout")

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-2 py-1.5">
        <div className="flex flex-wrap gap-1">
          <SubTabButton active={subtab === "timeout"} onClick={() => setSubtab("timeout")} icon={<Clock className="h-3 w-3" />} label="Timeout" />
          <SubTabButton active={subtab === "oom"} onClick={() => setSubtab("oom")} icon={<Cpu className="h-3 w-3" />} label="OOM" />
          <SubTabButton active={subtab === "crash"} onClick={() => setSubtab("crash")} icon={<ShieldAlert className="h-3 w-3" />} label="Crash" />
          <SubTabButton active={subtab === "state"} onClick={() => setSubtab("state")} icon={<Bug className="h-3 w-3" />} label="State" />
          <SubTabButton active={subtab === "checkpoint"} onClick={() => setSubtab("checkpoint")} icon={<Save className="h-3 w-3" />} label="Checkpoints" />
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3">
          {subtab === "timeout" && <TimeoutRecoveryTool />}
          {subtab === "oom" && <OOMRecoveryTool />}
          {subtab === "crash" && <CrashRecoveryTool onChange={onChange} />}
          {subtab === "state" && <UnknownStateTool />}
          {subtab === "checkpoint" && <CheckpointTab onChange={onChange} />}
        </div>
      </ScrollArea>
    </div>
  )
}

function TimeoutRecoveryTool() {
  const [attempt, setAttempt] = React.useState(1)
  const [result, setResult] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(false)

  const handleCheck = async () => {
    setLoading(true)
    try {
      const data = await apiCall("timeout_recover", {
        toolName: "demo_tool", args: {}, attempt,
      })
      setResult(data)
      if (data.shouldRetry) toast.success(data.reason)
      else toast.error(data.reason)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <ToolCard title="Timeout Recovery (343)" description="إعادة محاولة بعد timeout مع exponential backoff" icon={<Clock className="h-4 w-4" />}>
      <div>
        <Label className="text-xs">رقم المحاولة / Attempt</Label>
        <Input
          type="number" min={1} max={5} value={attempt}
          onChange={(e) => setAttempt(parseInt(e.target.value || "1"))}
          className="text-xs"
          dir="ltr"
        />
      </div>
      <Button onClick={handleCheck} disabled={loading} size="sm" className="w-full h-8 text-xs">
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Clock className="h-3 w-3" />}
        احسب التأخير
      </Button>
      {result && (
        <div className={cn(
          "rounded-md border p-2 text-xs",
          result.shouldRetry ? "border-amber-500/30 bg-amber-500/5" : "border-red-500/30 bg-red-500/5"
        )}>
          <div className="flex items-center gap-1.5 font-semibold">
            {result.shouldRetry ? <Clock className="h-3.5 w-3.5 text-amber-500" /> : <X className="h-3.5 w-3.5 text-red-500" />}
            {result.shouldRetry ? `إعادة بعد ${result.delayMs}ms` : "توقف"}
          </div>
          <p className="text-[0.7rem] mt-1">{result.reason}</p>
        </div>
      )}
    </ToolCard>
  )
}

function OOMRecoveryTool() {
  const [memMB, setMemMB] = React.useState(3800)
  const [threshold, setThreshold] = React.useState(3500)
  const [result, setResult] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(false)

  const handleCheck = async () => {
    setLoading(true)
    try {
      const data = await apiCall("oom_recover", {
        currentMemoryMB: memMB, thresholdMB: threshold,
      })
      setResult(data)
      if (data.shedding) toast.error(data.reason)
      else toast.success(data.reason)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <ToolCard title="OOM Recovery (344)" description="تخفيف الموارد عند اقتراب نفاد الذاكرة" icon={<Cpu className="h-4 w-4" />}>
      <div>
        <Label className="text-xs">الذاكرة الحالية (MB)</Label>
        <Input type="number" value={memMB} onChange={(e) => setMemMB(parseInt(e.target.value || "0"))} className="text-xs" dir="ltr" />
      </div>
      <div>
        <Label className="text-xs">العتبة (MB)</Label>
        <Input type="number" value={threshold} onChange={(e) => setThreshold(parseInt(e.target.value || "0"))} className="text-xs" dir="ltr" />
      </div>
      <Button onClick={handleCheck} disabled={loading} size="sm" className="w-full h-8 text-xs">
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Cpu className="h-3 w-3" />}
        افحص
      </Button>
      {result && (
        <div className={cn(
          "rounded-md border p-2 text-xs",
          result.shedding ? "border-red-500/30 bg-red-500/5" : "border-emerald-500/30 bg-emerald-500/5"
        )}>
          <div className="flex items-center gap-1.5 font-semibold">
            {result.shedding ? <ShieldAlert className="h-3.5 w-3.5 text-red-500" /> : <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />}
            {result.shedding ? "يتطلب تخفيف" : "آمن"}
          </div>
          {result.shedding && (
            <ul className="text-[0.7rem] mt-1 list-disc list-inside text-muted-foreground">
              {result.actions.map((a: string, i: number) => <li key={i}>{a}</li>)}
            </ul>
          )}
          <p className="text-[0.7rem] mt-1">{result.reason}</p>
        </div>
      )}
    </ToolCard>
  )
}

function CrashRecoveryTool({ onChange }: { onChange: () => void }) {
  const [result, setResult] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(false)

  const handleRecover = async () => {
    setLoading(true)
    try {
      const data = await apiCall("crash_recover", {})
      setResult(data)
      if (data.recovered) toast.success(data.reason)
      else toast.error(data.reason)
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <ToolCard title="Crash Recovery (345)" description="استعادة الجلسة بعد crash من آخر checkpoint" icon={<ShieldAlert className="h-4 w-4" />}>
      <Button onClick={handleRecover} disabled={loading} size="sm" className="w-full h-8 text-xs">
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldAlert className="h-3 w-3" />}
        استعادة من آخر checkpoint
      </Button>
      {result && (
        <div className={cn(
          "rounded-md border p-2 text-xs",
          result.recovered ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"
        )}>
          <div className="flex items-center gap-1.5 font-semibold">
            {result.recovered ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
            {result.recovered ? "تمت الاستعادة" : "لا استعادة"}
          </div>
          {result.checkpointId && (
            <code className="text-[0.65rem] font-mono block break-all mt-1" dir="ltr">{result.checkpointId}</code>
          )}
          <p className="text-[0.7rem] mt-1">{result.reason}</p>
        </div>
      )}
    </ToolCard>
  )
}

function UnknownStateTool() {
  const [stateText, setStateText] = React.useState('{"mode": "", "status": null, "toolName": "unknown"}')
  const [result, setResult] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(false)

  const handleReconcile = async () => {
    setLoading(true)
    try {
      let state: Record<string, unknown> = {}
      try { state = JSON.parse(stateText) } catch {
        toast.error("JSON غير صالح")
        setLoading(false)
        return
      }
      const data = await apiCall("unknown_state_reconcile", { state })
      setResult(data)
      if (data.reconciled) toast.success(`${data.changes.length} تصالحات`)
      else toast.success("الحالة سليمة")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <ToolCard title="Unknown-State Reconciliation (346)" description="حل الحالات غير المؤكدة" icon={<Bug className="h-4 w-4" />}>
      <Textarea
        value={stateText}
        onChange={(e) => setStateText(e.target.value)}
        placeholder='{"mode": "", "status": null}'
        className="text-xs font-mono"
        dir="ltr"
        rows={4}
      />
      <Button onClick={handleReconcile} disabled={loading} size="sm" className="w-full h-8 text-xs">
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bug className="h-3 w-3" />}
        صالح الحالة
      </Button>
      {result && (
        <div className={cn(
          "rounded-md border p-2 text-xs",
          result.reconciled ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5"
        )}>
          <div className="flex items-center gap-1.5 font-semibold">
            {result.reconciled ? <Wrench className="h-3.5 w-3.5 text-amber-500" /> : <Check className="h-3.5 w-3.5 text-emerald-500" />}
            {result.reconciled ? `${result.changes.length} تصالحات` : "سليمة"}
          </div>
          {result.reconciled && (
            <ul className="text-[0.7rem] mt-1 list-disc list-inside text-muted-foreground">
              {result.changes.map((c: string, i: number) => <li key={i}>{c}</li>)}
            </ul>
          )}
          <code className="text-[0.65rem] font-mono block break-all mt-1" dir="ltr">
            {JSON.stringify(result.state)}
          </code>
        </div>
      )}
    </ToolCard>
  )
}

function CheckpointTab({ onChange }: { onChange: () => void }) {
  const [checkpoints, setCheckpoints] = React.useState<Checkpoint[]>([])
  const [loading, setLoading] = React.useState(true)
  const [label, setLabel] = React.useState("manual checkpoint")
  const [stateText, setStateText] = React.useState('{"messages": [], "context": "test"}')
  const [creating, setCreating] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/reliability-os?mode=checkpoints&limit=50")
      const data = await res.json()
      setCheckpoints(data ?? [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    setCreating(true)
    try {
      let state: Record<string, unknown> = {}
      try { state = JSON.parse(stateText) } catch {
        toast.error("JSON غير صالح")
        setCreating(false)
        return
      }
      await apiCall("checkpoint_create", { state, kind: "manual", label })
      toast.success("تم إنشاء checkpoint")
      setLabel("manual checkpoint")
      load()
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const handleRollback = async (id: string) => {
    if (!confirm("التراجع إلى هذا checkpoint؟")) return
    try {
      const data = await apiCall("checkpoint_rollback", { id })
      if (data.restored) toast.success(data.reason)
      else toast.error("فشل التراجع")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="space-y-3">
      <ToolCard title="Checkpoint Rollback (347)" description="إنشاء نقاط حفظ والتراجع إليها" icon={<Save className="h-4 w-4" />}>
        <div>
          <Label className="text-xs">التسمية / Label</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} className="text-xs" dir="ltr" />
        </div>
        <div>
          <Label className="text-xs">الحالة / State (JSON)</Label>
          <Textarea
            value={stateText}
            onChange={(e) => setStateText(e.target.value)}
            className="text-xs font-mono"
            dir="ltr"
            rows={3}
          />
        </div>
        <Button onClick={handleCreate} disabled={creating} size="sm" className="w-full h-8 text-xs">
          {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          أنشئ checkpoint
        </Button>
      </ToolCard>

      <div className="border-t border-border/60 pt-2">
        <div className="text-xs font-semibold mb-2 flex items-center gap-1.5">
          <History className="h-3.5 w-3.5" />
          النقاط المحفوظة ({checkpoints.length})
        </div>
        {loading ? (
          <div className="text-center text-xs text-muted-foreground py-4">
            <RefreshCw className="h-4 w-4 animate-spin mx-auto" />
          </div>
        ) : checkpoints.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-4">
            لا نقاط حفظ
          </div>
        ) : (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {checkpoints.map((cp) => {
              const time = new Date(cp.createdAt).toLocaleString("ar-SA", { dateStyle: "short", timeStyle: "short" })
              return (
                <div key={cp.id} className="rounded-md border border-border/60 bg-card/50 p-2 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="outline" className="text-[0.6rem] py-0">{cp.kind}</Badge>
                      {cp.gitHash && (
                        <Badge variant="outline" className="text-[0.6rem] py-0 text-blue-500 border-blue-500/30 font-mono">
                          {cp.gitHash.slice(0, 8)}
                        </Badge>
                      )}
                      {cp.tokens > 0 && (
                        <Badge variant="outline" className="text-[0.6rem] py-0">{cp.tokens} tok</Badge>
                      )}
                    </div>
                    {cp.label && <p className="text-[0.7rem] mt-0.5 truncate">{cp.label}</p>}
                    <p className="text-[0.6rem] text-muted-foreground">{time}</p>
                  </div>
                  <Button onClick={() => handleRollback(cp.id)} variant="ghost" size="icon" className="h-6 w-6 shrink-0" title="تراجع">
                    <RotateCcw className="h-3 w-3" />
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ToolCard({ title, description, icon, children }: {
  title: string; description: string; icon: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          {icon}
          {title}
        </h3>
        <p className="text-[0.7rem] text-muted-foreground mt-0.5">{description}</p>
      </div>
      {children}
    </div>
  )
}
