"use client"

import * as React from "react"
import {
  Clock,
  Plus,
  Trash2,
  Play,
  Pause,
  RefreshCw,
  Loader2,
  Calendar,
  CheckCircle2,
  AlertCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface ScheduledTask {
  id: string
  name: string
  schedule: string
  goal: string
  lastRun: string | null
  nextRun: string | null
  enabled: boolean
}

const SCHEDULE_LABELS: Record<string, string> = {
  daily: "يومياً",
  weekly: "أسبوعياً",
  monthly: "شهرياً",
}

function timeAgo(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const h = Math.floor(diff / 3600000)
  if (h < 1) return "الآن"
  if (h < 24) return `قبل ${h} ساعة`
  const days = Math.floor(h / 24)
  return `قبل ${days} يوم`
}

function timeUntil(iso: string): string {
  const d = new Date(iso)
  const diff = d.getTime() - Date.now()
  if (diff < 0) return "فات الوقت"
  const h = Math.floor(diff / 3600000)
  if (h < 1) return "خلال ساعة"
  if (h < 24) return `خلال ${h} ساعة`
  const days = Math.floor(h / 24)
  return `خلال ${days} يوم`
}

export function AutomationPanel({ refreshSignal }: { refreshSignal?: number }) {
  const [tasks, setTasks] = React.useState<ScheduledTask[]>([])
  const [loading, setLoading] = React.useState(true)
  const [addOpen, setAddOpen] = React.useState(false)
  const [running, setRunning] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/scheduled-tasks")
      const data = await res.json()
      setTasks(data.tasks || [])
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  React.useEffect(() => { load() }, [load, refreshSignal])

  const runAutonomous = async () => {
    setRunning(true)
    toast.info("بدأت الحلقة المستقلة...")
    try {
      const res = await fetch("/api/autonomous/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxSteps: 5 }),
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.error)
      } else {
        toast.success(data.summary || "اكتملت الحلقة")
        load()
      }
    } catch {
      toast.error("فشل تشغيل الحلقة")
    } finally {
      setRunning(false)
    }
  }

  const toggle = async (id: string, enabled: boolean) => {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, enabled } : t))
    await fetch("/api/scheduled-tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    })
  }

  const del = async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id))
    await fetch(`/api/scheduled-tasks?id=${id}`, { method: "DELETE" })
    toast.success("حُذفت")
  }

  return (
    <div className="flex h-full w-full flex-col bg-sidebar">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-sidebar-border">
        <Calendar className="h-4 w-4 text-cyan-500" />
        <span className="flex-1 text-xs font-semibold">الأتمتة</span>
        <Button variant="ghost" size="icon" onClick={load} className="h-7 w-7 rounded-md">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={runAutonomous}
          disabled={running}
          className="h-7 gap-1 text-xs"
        >
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          شغّل
        </Button>
      </div>

      {/* Autonomous loop status */}
      <div className="px-3 py-2 border-b border-sidebar-border">
        <div className="rounded-lg bg-cyan-500/5 p-2">
          <p className="text-[0.7rem] text-muted-foreground">
            🤖 الحلقة المستقلة: تمسح المشروع، تجد المشاكل، تنشئ مهام، وتنفذها بالترتيب.
          </p>
          <p className="mt-1 text-[0.65rem] text-cyan-600 dark:text-cyan-400">
            اضغط "شغّل" لبدء دورة فحص + تنفيذ.
          </p>
        </div>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="mx-3 my-2 gap-1 text-xs">
            <Plus className="h-3 w-3" /> جدولة مهمة
          </Button>
        </DialogTrigger>
        <AddScheduledTaskDialog onSaved={() => { setAddOpen(false); load() }} />
      </Dialog>

      {/* List */}
      <ScrollArea className="flex-1 chat-scroll">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            <Calendar className="mx-auto mb-2 h-8 w-8 opacity-40" />
            لا مهام مجدولة. أضف مهمة دورية.
          </div>
        ) : (
          <div className="space-y-2 p-2">
            {tasks.map((t) => (
              <div key={t.id} className="rounded-lg border border-border bg-card p-2.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={cn(
                        "shrink-0 rounded-full px-1.5 py-0.5 text-[0.6rem]",
                        t.enabled ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground"
                      )}>
                        {SCHEDULE_LABELS[t.schedule] || t.schedule}
                      </span>
                      <span className="text-xs font-medium truncate">{t.name}</span>
                    </div>
                    <p className="mt-1 text-[0.7rem] text-muted-foreground line-clamp-2">{t.goal}</p>
                    <div className="mt-1.5 flex items-center gap-2 text-[0.65rem] text-muted-foreground">
                      {t.lastRun && <span>آخر تشغيل: {timeAgo(t.lastRun)}</span>}
                      {t.nextRun && <span>• التالي: {timeUntil(t.nextRun)}</span>}
                    </div>
                  </div>
                  <Switch checked={t.enabled} onCheckedChange={(v) => toggle(t.id, v)} />
                  <button
                    onClick={() => del(t.id)}
                    className="shrink-0 rounded p-0.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-sidebar-border px-3 py-1.5">
        <span className="text-[0.7rem] text-muted-foreground">
          {tasks.length} مهمة مجدولة — {tasks.filter(t => t.enabled).length} مُفعّلة
        </span>
      </div>
    </div>
  )
}

function AddScheduledTaskDialog({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = React.useState("")
  const [goal, setGoal] = React.useState("")
  const [schedule, setSchedule] = React.useState("daily")
  const [saving, setSaving] = React.useState(false)

  const save = async () => {
    if (!name.trim() || !goal.trim()) return
    setSaving(true)
    try {
      const res = await fetch("/api/scheduled-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), goal: goal.trim(), schedule }),
      })
      const data = await res.json()
      if (data.error) { toast.error(data.error); return }
      toast.success("أُضيفت المهمة المجدولة")
      onSaved()
      setName(""); setGoal(""); setSchedule("daily")
    } catch { toast.error("فشل الإضافة") }
    finally { setSaving(false) }
  }

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Calendar className="h-4 w-4" /> مهمة مجدولة جديدة
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-3 py-2">
        <div className="space-y-1.5">
          <Label className="text-xs">الاسم</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="فحص جودة الكود الأسبوعي" className="text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">الهدف</Label>
          <Textarea value={goal} onChange={(e) => setGoal(e.target.value)}
            placeholder="شغّل lint وأصلح أخطاء ESLint عالية الخطورة" className="text-sm min-h-[60px]" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">التكرار</Label>
          <Select value={schedule} onValueChange={setSchedule}>
            <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">يومياً</SelectItem>
              <SelectItem value="weekly">أسبوعياً</SelectItem>
              <SelectItem value="monthly">شهرياً</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={save} disabled={saving || !name.trim() || !goal.trim()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          إضافة
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
