"use client"

import * as React from "react"
import {
  GitCommitHorizontal,
  RotateCcw,
  Plus,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
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
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface Commit {
  hash: string
  short: string
  message: string
  author: string
  date: string
}

function timeAgo(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return "الآن"
  const m = Math.floor(s / 60)
  if (m < 60) return `قبل ${m} دقيقة`
  const h = Math.floor(m / 60)
  if (h < 24) return `قبل ${h} ساعة`
  const days = Math.floor(h / 24)
  return `قبل ${days} يوم`
}

export function CheckpointMenu({ onRevert }: { onRevert?: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [commits, setCommits] = React.useState<Commit[]>([])
  const [head, setHead] = React.useState<string | null>(null)
  const [dirty, setDirty] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [creating, setCreating] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/git")
      const data = await res.json()
      setCommits(data.commits || [])
      setHead(data.head || null)
      setDirty(!!data.dirty)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (open) load()
  }, [open, load])

  const createCheckpoint = async () => {
    setCreating(true)
    try {
      const res = await fetch("/api/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "MiMo X Checkpoint" }),
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.error)
      } else if (data.created) {
        toast.success(`تم حفظ نقطة الاسترجاع (${data.head})`)
      } else {
        toast.info(data.message || "لا تغييرات جديدة")
      }
      await load()
    } catch (e) {
      toast.error("فشل حفظ النقطة")
    } finally {
      setCreating(false)
    }
  }

  const revertTo = async (hash: string, message: string) => {
    try {
      const res = await fetch(`/api/git?to=${encodeURIComponent(hash)}`, {
        method: "DELETE",
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.error)
        return
      }
      toast.success(`تم التراجع إلى ${data.head}`)
      onRevert?.()
      await load()
    } catch {
      toast.error("فشل التراجع")
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 rounded-lg text-xs"
          title="نقاط الاسترجاع"
        >
          <GitCommitHorizontal className="h-4 w-4" />
          <span className="hidden sm:inline">نقاط الاسترجاع</span>
          {dirty && (
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold">نقاط الاسترجاع</span>
          <Button
            size="sm"
            variant="default"
            onClick={createCheckpoint}
            disabled={creating}
            className="h-7 gap-1 text-xs"
          >
            {creating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Plus className="h-3 w-3" />
            )}
            حفظ الآن
          </Button>
        </div>

        <div className="max-h-72 overflow-y-auto chat-scroll">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : commits.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              لا نقاط استرجاع بعد. احفظ واحدة الآن.
            </div>
          ) : (
            <div className="py-1">
              {commits.map((c, i) => (
                <div
                  key={c.hash}
                  className={cn(
                    "group flex items-start gap-2 px-3 py-2 transition hover:bg-accent/50",
                    i === 0 && "bg-accent/30"
                  )}
                >
                  <div className="mt-0.5">
                    {i === 0 ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <GitCommitHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{c.message}</p>
                    <p className="text-[0.7rem] text-muted-foreground" dir="ltr">
                      {c.short} · {timeAgo(c.date)}
                    </p>
                  </div>
                  {i !== 0 && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button
                          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                          title="التراجع إلى هذه النقطة"
                        >
                          <RotateCcw className="h-3 w-3" />
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            التراجع إلى نقطة الاسترجاع؟
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            سيتم تنفيذ <code dir="ltr">git reset --hard {c.short}</code>، ما يُلغي كل التعديلات اللاحقة (بما فيها تعديلات الوكيل غير المحفوظة). لا يمكن التراجع عن هذا الإجراء.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>إلغاء</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => revertTo(c.hash, c.message)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            تراجع الآن
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {dirty && (
          <div className="border-t border-border bg-amber-500/5 px-3 py-1.5">
            <p className="flex items-center gap-1 text-[0.7rem] text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-3 w-3" /> توجد تعديلات غير محفوظة
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
