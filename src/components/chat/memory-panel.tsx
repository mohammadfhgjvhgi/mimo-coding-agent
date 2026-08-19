"use client"

import * as React from "react"
import {
  Brain,
  Trash2,
  Plus,
  RefreshCw,
  Loader2,
  Lightbulb,
  CheckCircle2,
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

interface MemoryItem {
  id: string
  key: string
  value: string
  category: string
  source: string
  createdAt: string
  updatedAt: string
}

const CATEGORY_COLORS: Record<string, string> = {
  decision: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  fact: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
  preference: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  project: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  general: "bg-muted text-muted-foreground",
}

const CATEGORY_LABELS: Record<string, string> = {
  decision: "قرار",
  fact: "حقيقة",
  preference: "تفضيل",
  project: "مشروع",
  general: "عام",
}

export function MemoryPanel({ refreshSignal }: { refreshSignal?: number }) {
  const [memories, setMemories] = React.useState<MemoryItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [addOpen, setAddOpen] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/memory")
      const data = await res.json()
      setMemories(data.memories || [])
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load, refreshSignal])

  const handleDelete = async (id: string, key: string) => {
    const prev = memories
    setMemories(memories.filter((m) => m.id !== id))
    try {
      await fetch(`/api/memory?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      toast.success(`حُذفت الذاكرة: ${key}`)
    } catch {
      setMemories(prev)
      toast.error("فشل حذف الذاكرة")
    }
  }

  const grouped = React.useMemo(() => {
    const groups: Record<string, MemoryItem[]> = {}
    for (const m of memories) {
      if (!groups[m.category]) groups[m.category] = []
      groups[m.category].push(m)
    }
    return groups
  }, [memories])

  return (
    <div className="flex h-full w-full flex-col bg-sidebar">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-sidebar-border">
        <Brain className="h-4 w-4 text-purple-500" />
        <span className="flex-1 text-xs font-semibold tracking-tight">
          ذاكرة المشروع
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={load}
          className="h-7 w-7 rounded-md"
          aria-label="تحديث"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md"
              aria-label="إضافة ذاكرة"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </DialogTrigger>
          <AddMemoryDialog
            onSaved={() => {
              setAddOpen(false)
              load()
            }}
          />
        </Dialog>
      </div>

      {/* List */}
      <ScrollArea className="flex-1 chat-scroll">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mb-2" />
            <span className="text-xs">جارٍ تحميل الذاكرة…</span>
          </div>
        ) : memories.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            <Lightbulb className="mx-auto mb-2 h-8 w-8 opacity-40" />
            الذاكرة فارغة. اطلب من الوكيل: «تذكّر أن المشروع يستخدم…» أو أضف يدوياً.
          </div>
        ) : (
          <div className="space-y-4 p-2">
            {Object.entries(grouped).map(([category, items]) => (
              <div key={category}>
                <p className="px-2 py-1 text-[0.7rem] font-medium tracking-wider text-muted-foreground">
                  {CATEGORY_LABELS[category] || category} ({items.length})
                </p>
                <div className="space-y-1.5">
                  {items.map((m) => (
                    <MemoryCard
                      key={m.id}
                      memory={m}
                      onDelete={() => handleDelete(m.id, m.key)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-sidebar-border px-3 py-1.5">
        <span className="text-[0.7rem] text-muted-foreground">
          {memories.length} ذاكرة محفوظة — تُحقن تلقائياً في كل محادثة
        </span>
      </div>
    </div>
  )
}

function MemoryCard({
  memory,
  onDelete,
}: {
  memory: MemoryItem
  onDelete: () => void
}) {
  const [expanded, setExpanded] = React.useState(false)
  const isLong = memory.value.length > 80
  const colorClass =
    CATEGORY_COLORS[memory.category] || CATEGORY_COLORS.general

  return (
    <div className="group rounded-lg border border-border bg-card p-2.5 transition hover:border-primary/30">
      <div className="mb-1 flex items-start gap-2">
        <span
          className={cn(
            "shrink-0 rounded-full px-1.5 py-0.5 text-[0.6rem] font-medium",
            colorClass
          )}
        >
          {CATEGORY_LABELS[memory.category] || memory.category}
        </span>
        <code className="min-w-0 flex-1 truncate font-mono text-[0.8rem] font-medium text-foreground" dir="ltr">
          {memory.key}
        </code>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
              title="حذف"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>حذف هذه الذاكرة؟</AlertDialogTitle>
              <AlertDialogDescription>
                سيتم حذف «{memory.key}» نهائياً. لن يُحقن في المحادثات القادمة.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>إلغاء</AlertDialogCancel>
              <AlertDialogAction
                onClick={onDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                حذف
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <p
        className={cn(
          "text-xs text-muted-foreground",
          !expanded && isLong && "line-clamp-2"
        )}
      >
        {memory.value}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[0.7rem] text-primary hover:underline"
        >
          {expanded ? "أقل" : "المزيد"}
        </button>
      )}
      <div className="mt-1 flex items-center gap-1 text-[0.65rem] text-muted-foreground">
        {memory.source === "agent" ? (
          <span className="flex items-center gap-0.5">
            <Brain className="h-2.5 w-2.5" /> وكيل
          </span>
        ) : (
          <span className="flex items-center gap-0.5">
            <CheckCircle2 className="h-2.5 w-2.5" /> يدوي
          </span>
        )}
        <span>·</span>
        <span>{new Date(memory.updatedAt).toLocaleDateString("ar")}</span>
      </div>
    </div>
  )
}

function AddMemoryDialog({ onSaved }: { onSaved: () => void }) {
  const [key, setKey] = React.useState("")
  const [value, setValue] = React.useState("")
  const [category, setCategory] = React.useState("general")
  const [saving, setSaving] = React.useState(false)

  const save = async () => {
    if (!key.trim() || !value.trim()) return
    setSaving(true)
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim(), value: value.trim(), category }),
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.error)
        return
      }
      toast.success("حُفظت الذاكرة")
      setKey("")
      setValue("")
      setCategory("general")
      onSaved()
    } catch {
      toast.error("فشل الحفظ")
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>إضافة ذاكرة يدوياً</DialogTitle>
      </DialogHeader>
      <div className="space-y-3 py-2">
        <div className="space-y-1.5">
          <Label className="text-xs">المفتاح</Label>
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="مثال: tech_stack"
            dir="ltr"
            className="text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">القيمة</Label>
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="مثال: المشروع يستخدم Next.js + Prisma + Tailwind"
            className="text-sm min-h-[80px]"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">الفئة</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="general">عام</SelectItem>
              <SelectItem value="decision">قرار</SelectItem>
              <SelectItem value="fact">حقيقة</SelectItem>
              <SelectItem value="preference">تفضيل</SelectItem>
              <SelectItem value="project">مشروع</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={save} disabled={saving || !key.trim() || !value.trim()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "حفظ"}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
