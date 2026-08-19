"use client"

import * as React from "react"
import {
  Brain, Trash2, Plus, RefreshCw, Loader2, Lightbulb, CheckCircle2,
  Search, Clock, Download, GitMerge, AlertTriangle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface MemoryItem {
  id: string
  key: string
  value: string
  tier: string
  category: string
  source: string
  confidence: number
  decayRate: number
  accessCount: number
  lastAccessedAt: string
  failureHash: string | null
  createdAt: string
  updatedAt: string
}

const TIER_LABELS: Record<string, string> = {
  working: "عمل", session: "جلسة", task: "مهمة", project: "مشروع",
  personal: "شخصي", semantic: "دلالي", episodic: "حدثي", failure: "أخطاء",
  negative: "ممنوعات", decision: "قرارات", preference: "تفضيلات", skill: "مهارات",
  research: "أبحاث", conversation: "محادثات", knowledge: "معرفة", general: "عام",
}

const TIER_COLORS: Record<string, string> = {
  working: "bg-blue-500/15 text-blue-600", session: "bg-cyan-500/15 text-cyan-600",
  task: "bg-indigo-500/15 text-indigo-600", project: "bg-purple-500/15 text-purple-600",
  personal: "bg-pink-500/15 text-pink-600", semantic: "bg-emerald-500/15 text-emerald-600",
  episodic: "bg-amber-500/15 text-amber-600", failure: "bg-red-500/15 text-red-600",
  negative: "bg-orange-500/15 text-orange-600", decision: "bg-teal-500/15 text-teal-600",
  preference: "bg-violet-500/15 text-violet-600", skill: "bg-lime-500/15 text-lime-600",
  research: "bg-sky-500/15 text-sky-600", conversation: "bg-fuchsia-500/15 text-fuchsia-600",
  knowledge: "bg-stone-500/15 text-stone-600", general: "bg-muted text-muted-foreground",
}

function timeAgo(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "الآن"
  if (m < 60) return `قبل ${m} دقيقة`
  const h = Math.floor(m / 60)
  if (h < 24) return `قبل ${h} ساعة`
  return `قبل ${Math.floor(h / 24)} يوم`
}

export function MemoryPanel({ refreshSignal }: { refreshSignal?: number }) {
  const [memories, setMemories] = React.useState<MemoryItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [addOpen, setAddOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [tierFilter, setTierFilter] = React.useState("")

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/memory")
      const data = await res.json()
      setMemories(data.memories || [])
    } catch {}
    setLoading(false)
  }, [])

  React.useEffect(() => { load() }, [load, refreshSignal])

  const handleDelete = async (id: string, key: string) => {
    const prev = memories
    setMemories(memories.filter(m => m.id !== id))
    try {
      await fetch(`/api/memory?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      toast.success(`حُذفت الذاكرة: ${key}`)
    } catch {
      setMemories(prev)
      toast.error("فشل حذف الذاكرة")
    }
  }

  const handleExport = async () => {
    try {
      const res = await fetch("/api/memory/export")
      const data = await res.json()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `mimo-memory-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success("تم التصدير")
    } catch { toast.error("فشل التصدير") }
  }

  const handleConsolidate = async () => {
    toast.info("جارٍ الدمج…")
    try {
      const res = await fetch("/api/memory/consolidate", { method: "POST" })
      const data = await res.json()
      toast.success(`تم: ${data.promoted} ترقية، ${data.compressed} ضغط، ${data.forgotten} نسيان`)
      load()
    } catch { toast.error("فشل الدمج") }
  }

  const filtered = React.useMemo(() => {
    let result = memories
    if (tierFilter) result = result.filter(m => m.source === tierFilter)
    if (query.trim()) {
      const q = query.toLowerCase()
      result = result.filter(m => m.key.toLowerCase().includes(q) || m.value.toLowerCase().includes(q))
    }
    return result
  }, [memories, query, tierFilter])

  const grouped = React.useMemo(() => {
    const g: Record<string, MemoryItem[]> = {}
    for (const m of filtered) {
      const tier = m.source || "general"
      if (!g[tier]) g[tier] = []
      g[tier].push(m)
    }
    return g
  }, [filtered])

  return (
    <div className="flex h-full w-full flex-col bg-sidebar">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-sidebar-border">
        <Brain className="h-4 w-4 text-purple-500" />
        <span className="flex-1 text-xs font-semibold">الذاكرة</span>
        <Button variant="ghost" size="icon" onClick={load} className="h-7 w-7 rounded-md" aria-label="تحديث">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
        <Button variant="ghost" size="icon" onClick={handleConsolidate} className="h-7 w-7 rounded-md" aria-label="دمج" title="دمج ذكريات">
          <GitMerge className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={handleExport} className="h-7 w-7 rounded-md" aria-label="تصدير" title="تصدير">
          <Download className="h-3.5 w-3.5" />
        </Button>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md" aria-label="إضافة">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </DialogTrigger>
          <AddMemoryDialog onSaved={() => { setAddOpen(false); load() }} />
        </Dialog>
      </div>

      <div className="px-3 py-2 space-y-2 border-b border-sidebar-border">
        <div className="relative">
          <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث في الذاكرة…" className="h-8 rounded-lg pr-8 text-xs" />
        </div>
        <Select value={tierFilter} onValueChange={setTierFilter}>
          <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="كل الأنواع" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">كل الأنواع ({memories.length})</SelectItem>
            {Object.entries(TIER_LABELS).map(([tier, label]) => {
              const count = memories.filter(m => m.source === tier).length
              if (count === 0) return null
              return <SelectItem key={tier} value={tier}>{label} ({count})</SelectItem>
            })}
          </SelectContent>
        </Select>
      </div>

      <ScrollArea className="flex-1 chat-scroll">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mb-2" />
            <span className="text-xs">جارٍ تحميل الذاكرة…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            <Lightbulb className="mx-auto mb-2 h-8 w-8 opacity-40" />
            لا ذاكرة بعد. اطلب من الوكيل: «تذكّر أن…» أو أضف يدوياً.
          </div>
        ) : (
          <div className="space-y-3 p-2">
            {Object.entries(grouped).map(([tier, items]) => (
              <div key={tier}>
                <p className="px-2 py-1 text-[0.7rem] font-medium tracking-wider text-muted-foreground">
                  {TIER_LABELS[tier] || tier} ({items.length})
                </p>
                <div className="space-y-1.5">
                  {items.map(m => (
                    <MemoryCard key={m.id} memory={m} onDelete={() => handleDelete(m.id, m.key)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <div className="border-t border-sidebar-border px-3 py-1.5">
        <span className="text-[0.7rem] text-muted-foreground">
          {memories.length} ذاكرة — تُحقن تلقائياً في كل محادثة
        </span>
      </div>
    </div>
  )
}

function MemoryCard({ memory, onDelete }: { memory: MemoryItem; onDelete: () => void }) {
  const [expanded, setExpanded] = React.useState(false)
  const isLong = memory.value.length > 80
  const tier = memory.source || "general"

  return (
    <div className="group rounded-lg border border-border bg-card p-2.5 transition hover:border-primary/30">
      <div className="mb-1 flex items-start gap-2">
        <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[0.6rem] font-medium", TIER_COLORS[tier] || TIER_COLORS.general)}>
          {TIER_LABELS[tier] || tier}
        </span>
        <code className="min-w-0 flex-1 truncate font-mono text-[0.8rem] font-medium text-foreground" dir="ltr">{memory.key}</code>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100">
              <Trash2 className="h-3 w-3" />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>حذف هذه الذاكرة؟</AlertDialogTitle>
              <AlertDialogDescription>سيتم حذف «{memory.key}» نهائياً.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>إلغاء</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">حذف</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <p className={cn("text-xs text-muted-foreground", !expanded && isLong && "line-clamp-2")}>{memory.value}</p>
      {isLong && (
        <button onClick={() => setExpanded(v => !v)} className="mt-1 text-[0.7rem] text-primary hover:underline">
          {expanded ? "أقل" : "المزيد"}
        </button>
      )}
      <div className="mt-1.5 flex items-center gap-2 text-[0.65rem] text-muted-foreground">
        {memory.source === "agent" || memory.source === "auto" ? (
          <span className="flex items-center gap-0.5"><Brain className="h-2.5 w-2.5" /> وكيل</span>
        ) : (
          <span className="flex items-center gap-0.5"><CheckCircle2 className="h-2.5 w-2.5" /> يدوي</span>
        )}
        <span>·</span>
        <span>{timeAgo(memory.updatedAt)}</span>
        <span>·</span>
        <span>{memory.accessCount || 0} وصول</span>
        <span>·</span>
        <span>{Math.round((memory.confidence || 0.8) * 100)}%</span>
      </div>
    </div>
  )
}

function AddMemoryDialog({ onSaved }: { onSaved: () => void }) {
  const [key, setKey] = React.useState("")
  const [value, setValue] = React.useState("")
  const [tier, setTier] = React.useState("semantic")
  const [category, setCategory] = React.useState("general")
  const [saving, setSaving] = React.useState(false)

  const save = async () => {
    if (!key.trim() || !value.trim()) return
    setSaving(true)
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim(), value: value.trim(), category, tier }),
      })
      const data = await res.json()
      if (data.error) { toast.error(data.error); return }
      toast.success("حُفظت الذاكرة")
      onSaved()
      setKey(""); setValue(""); setTier("semantic"); setCategory("general")
    } catch { toast.error("فشل الحفظ") }
    finally { setSaving(false) }
  }

  return (
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><Brain className="h-4 w-4" /> إضافة ذاكرة</DialogTitle></DialogHeader>
      <div className="space-y-3 py-2">
        <div className="space-y-1.5">
          <Label className="text-xs">المفتاح</Label>
          <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="مثال: tech_stack" dir="ltr" className="text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">القيمة</Label>
          <Textarea value={value} onChange={(e) => setValue(e.target.value)} placeholder="مثال: المشروع يستخدم Next.js + Prisma + Tailwind" className="text-sm min-h-[80px]" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs">النوع</Label>
            <Select value={tier} onValueChange={setTier}>
              <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(TIER_LABELS).filter(([k]) => k !== "general").map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">الفئة</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} className="text-sm" />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={save} disabled={saving || !key.trim() || !value.trim()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          حفظ
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
