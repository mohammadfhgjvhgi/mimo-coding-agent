"use client"

import * as React from "react"
import {
  Target,
  Trash2,
  Plus,
  RefreshCw,
  Loader2,
  Play,
  Pause,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronRight,
  Zap,
  Brain,
  Cloud,
  Rocket,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface TaskStep {
  type: string
  tool?: string
  args?: Record<string, unknown>
  result?: string
  status?: string
  worker?: string
  workerReason?: string
  text?: string
  ts: number
}

interface Task {
  id: string
  goal: string
  acceptanceCriteria: string[]
  status: string
  plan: string[] | null
  steps: TaskStep[]
  currentStep: number
  result: string | null
  verificationResult: { passed?: boolean; reason?: string } | null
  createdAt: string
  updatedAt: string
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  pending: { label: "بانتظار", color: "bg-muted text-muted-foreground", icon: Clock },
  running: { label: "قيد التنفيذ", color: "bg-amber-500/15 text-amber-600 dark:text-amber-400", icon: Loader2 },
  paused: { label: "متوقف مؤقتاً", color: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400", icon: Pause },
  done: { label: "مكتمل", color: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", icon: CheckCircle2 },
  failed: { label: "فشل", color: "bg-destructive/15 text-destructive", icon: XCircle },
}

const WORKER_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  cpu: Brain,
  gpu: Zap,
  zai: Cloud,
}

export function GoalsPanel({ refreshSignal }: { refreshSignal?: number }) {
  const [tasks, setTasks] = React.useState<Task[]>([])
  const [loading, setLoading] = React.useState(true)
  const [addOpen, setAddOpen] = React.useState(false)
  const [runningIds, setRunningIds] = React.useState<Set<string>>(new Set())

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/goals")
      const data = await res.json()
      setTasks(data.tasks || [])
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load, refreshSignal])

  // Runner: polls /api/goals/[id]/run until the task is done/failed/paused
  const runTask = React.useCallback(async (taskId: string) => {
    setRunningIds((prev) => new Set(prev).add(taskId))
    try {
      for (let i = 0; i < 50; i++) {
        const res = await fetch(`/api/goals/${taskId}/run`, { method: "POST" })
        const data = await res.json()
        if (data.error) {
          toast.error(data.error)
          break
        }
        // Update the task in the local list
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? { ...t, ...data.task, steps: data.task?.steps || t.steps, currentStep: data.task?.currentStep || 0 }
              : t
          )
        )
        if (data.action === "done") {
          toast.success("✅ الهدف محقق!")
          break
        }
        if (data.action === "failed") {
          toast.error("فشل الهدف")
          break
        }
        if (data.action === "noop") {
          break
        }
        // Small delay between steps
        await new Promise((r) => setTimeout(r, 300))
      }
    } catch {
      toast.error("انقطع تشغيل المهمة — يمكن استئنافها لاحقاً")
    } finally {
      setRunningIds((prev) => {
        const next = new Set(prev)
        next.delete(taskId)
        return next
      })
      load()
    }
  }, [load])

  const pauseTask = async (taskId: string) => {
    await fetch(`/api/goals/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "paused" }),
    })
    toast.info("تم إيقاف المهمة مؤقتاً")
    load()
  }

  const deleteTask = async (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
    await fetch(`/api/goals/${taskId}`, { method: "DELETE" })
    toast.success("حُذفت المهمة")
  }

  const grouped = React.useMemo(() => {
    const groups: Record<string, Task[]> = { running: [], pending: [], done: [], failed: [], paused: [] }
    for (const t of tasks) {
      if (!groups[t.status]) groups[t.status] = []
      groups[t.status].push(t)
    }
    return groups
  }, [tasks])

  return (
    <div className="flex h-full w-full flex-col bg-sidebar">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-sidebar-border">
        <Target className="h-4 w-4 text-purple-500" />
        <span className="flex-1 text-xs font-semibold tracking-tight">الأهداف</span>
        <Button variant="ghost" size="icon" onClick={load} className="h-7 w-7 rounded-md" aria-label="تحديث">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md" aria-label="هدف جديد">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </DialogTrigger>
          <AddGoalDialog
            onSaved={(newTask) => {
              setAddOpen(false)
              setTasks((prev) => [newTask, ...prev])
              // Auto-start the goal
              runTask(newTask.id)
            }}
          />
        </Dialog>
      </div>

      {/* List */}
      <ScrollArea className="flex-1 chat-scroll">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mb-2" />
            <span className="text-xs">جارٍ تحميل الأهداف…</span>
          </div>
        ) : tasks.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            <Target className="mx-auto mb-2 h-8 w-8 opacity-40" />
            لا أهداف بعد. أنشئ هدفاً كبيراً وسيخطط وينفذ ويتحقق ذاتياً.
          </div>
        ) : (
          <div className="space-y-3 p-2">
            {(["running", "pending", "paused", "done", "failed"] as string[]).map((status) =>
              grouped[status]?.length > 0 ? (
                <div key={status}>
                  <p className="px-2 py-1 text-[0.7rem] font-medium tracking-wider text-muted-foreground">
                    {STATUS_CONFIG[status]?.label} ({grouped[status].length})
                  </p>
                  <div className="space-y-2">
                    {grouped[status].map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        isRunning={runningIds.has(t.id)}
                        onRun={() => runTask(t.id)}
                        onPause={() => pauseTask(t.id)}
                        onDelete={() => deleteTask(t.id)}
                      />
                    ))}
                  </div>
                </div>
              ) : null
            )}
          </div>
        )}
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-sidebar-border px-3 py-1.5">
        <span className="text-[0.7rem] text-muted-foreground">
          {tasks.length} هدف — {tasks.filter((t) => t.status === "done").length} مكتمل
        </span>
      </div>
    </div>
  )
}

function TaskCard({
  task,
  isRunning,
  onRun,
  onPause,
  onDelete,
}: {
  task: Task
  isRunning: boolean
  onRun: () => void
  onPause: () => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = React.useState(true)
  const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending
  const StatusIcon = cfg.icon

  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
      {/* Header */}
      <div className="mb-1.5 flex items-start gap-2">
        <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[0.6rem] font-medium flex items-center gap-1", cfg.color)}>
          <StatusIcon className={cn("h-2.5 w-2.5", isRunning && "animate-spin")} />
          {cfg.label}
        </span>
        <code className="text-[0.6rem] text-muted-foreground" dir="ltr">#{task.id.slice(-6)}</code>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button className="mr-auto shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100">
              <Trash2 className="h-3 w-3" />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>حذف هذا الهدف؟</AlertDialogTitle>
              <AlertDialogDescription>سيُحذف الهدف وكل خطواته نهائياً.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>إلغاء</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">حذف</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Goal */}
      <p className="text-xs font-medium mb-1.5">{task.goal}</p>

      {/* Progress */}
      <div className="mb-2 flex items-center gap-2 text-[0.7rem] text-muted-foreground">
        <span>{task.currentStep} خطوة</span>
        <span>·</span>
        <span>{task.acceptanceCriteria.length} معيار</span>
        {task.verificationResult?.passed && (
          <span className="flex items-center gap-0.5 text-emerald-500">
            <CheckCircle2 className="h-2.5 w-2.5" /> محقق
          </span>
        )}
      </div>

      {/* Steps (collapsible) */}
      {task.steps.length > 0 && (
        <div className="mb-2">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-[0.7rem] text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")} />
            الخطوات ({task.steps.length})
          </button>
          {expanded && (
            <div className="mt-1 space-y-1 max-h-40 overflow-y-auto chat-scroll">
              {task.steps.slice(-10).map((s, i) => {
                const WorkerIcon = s.worker ? WORKER_ICON[s.worker] || Cloud : null
                return (
                  <div key={i} className="flex items-center gap-1.5 rounded bg-muted/40 px-1.5 py-1 text-[0.65rem]">
                    {s.tool ? (
                      <>
                        <span className="shrink-0 font-mono text-muted-foreground" dir="ltr">{s.tool}</span>
                        <span className={cn("shrink-0", s.status === "success" ? "text-emerald-500" : "text-destructive")}>
                          {s.status === "success" ? "✓" : "✗"}
                        </span>
                        {WorkerIcon && (
                          <span className="shrink-0 text-muted-foreground">
                            <WorkerIcon className="h-2.5 w-2.5" />
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground truncate">{s.text?.slice(0, 60)}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1">
        {(task.status === "pending" || task.status === "paused") && (
          <Button size="sm" variant="default" onClick={onRun} disabled={isRunning} className="h-7 gap-1 text-[0.7rem]">
            {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            {task.status === "pending" ? "ابدأ" : "استئناف"}
          </Button>
        )}
        {task.status === "running" && !isRunning && (
          <Button size="sm" variant="outline" onClick={onPause} className="h-7 gap-1 text-[0.7rem]">
            <Pause className="h-3 w-3" /> إيقاف
          </Button>
        )}
        {isRunning && (
          <span className="flex items-center gap-1 text-[0.7rem] text-amber-500">
            <Rocket className="h-3 w-3 animate-pulse" /> يعمل autonomously…
          </span>
        )}
        {task.result && (
          <span className="ml-auto text-[0.65rem] text-muted-foreground truncate max-w-[50%]">
            {task.result.slice(0, 50)}…
          </span>
        )}
      </div>
    </div>
  )
}

function AddGoalDialog({ onSaved }: { onSaved: (task: Task) => void }) {
  const [goal, setGoal] = React.useState("")
  const [criteria, setCriteria] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  const save = async () => {
    if (!goal.trim() || !criteria.trim()) return
    setSaving(true)
    try {
      const criteriaArr = criteria.split("\n").map((s) => s.trim()).filter(Boolean)
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: goal.trim(), acceptanceCriteria: criteriaArr }),
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.error)
        return
      }
      toast.success("أُنشئ الهدف — سيبدأ التنفيذ تلقائياً")
      onSaved(data.task)
      setGoal("")
      setCriteria("")
    } catch {
      toast.error("فشل الإنشاء")
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Target className="h-4 w-4" /> هدف جديد
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-3 py-2">
        <div className="space-y-1.5">
          <Label className="text-xs">الهدف</Label>
          <Textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="مثال: بناء تطبيق آلة حاسبة كامل: HTML + CSS + JS مع 4 عمليات + اختبارات"
            className="text-sm min-h-[60px]"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">معايير القبول (كل معيار في سطر)</Label>
          <Textarea
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            placeholder={"ملف index.html موجود ويعمل\nدوال الجمع والطرح والضرب والقسمة موجودة\nتشغيل node calculator.test.js ينجح"}
            className="text-sm min-h-[80px]"
          />
        </div>
        <p className="rounded-md bg-purple-500/5 px-2.5 py-1.5 text-[0.7rem] text-purple-600 dark:text-purple-400">
          🤖 سيخطط الوكيل، ينفذ خطوة بخطوة، ويتحقق ذاتياً من المعايير. إذا فشل، يُصلح ويُعيد المحاولة.
        </p>
      </div>
      <DialogFooter>
        <Button onClick={save} disabled={saving || !goal.trim() || !criteria.trim()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          أطلق الهدف
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
