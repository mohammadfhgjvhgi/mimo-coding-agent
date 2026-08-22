"use client"

/**
 * BackupRecoveryPanel — Backup / Recovery OS UI (spec section 31, features 426-433).
 *
 * 3 tabs:
 *  1. Backup    — 5 backup operations (426-430)
 *  2. Recovery  — wizard (431), crash (432), integrity (433)
 *  3. Archives   — list + restore + delete
 */

import * as React from "react"
import {
  Database, Brain, FolderTree, Settings, Archive, Wand, RefreshCw,
  ShieldCheck, AlertTriangle, Check, X, Trash2, Loader2, Download,
  Upload, Clock, FileWarning, Zap,
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

export function BackupRecoveryPanel() {
  const [tab, setTab] = React.useState("backup")
  const [snapshot, setSnapshot] = React.useState<any>(null)
  const [loadingSnapshot, setLoadingSnapshot] = React.useState(true)

  const loadSnapshot = React.useCallback(async () => {
    setLoadingSnapshot(true)
    try {
      const res = await fetch("/api/backup-recovery?mode=snapshot")
      const data = await res.json()
      setSnapshot(data)
    } catch (err) {
      console.error("[BackupRecoveryPanel] snapshot failed", err)
    } finally {
      setLoadingSnapshot(false)
    }
  }, [])

  React.useEffect(() => { loadSnapshot() }, [loadSnapshot])

  return (
    <div className="flex h-full flex-col" dir="rtl">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <Archive className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">نسخ احتياطي / Backup & Recovery</span>
        </div>
        <Button variant="ghost" size="sm" onClick={loadSnapshot} className="h-7 gap-1 px-2 text-xs" disabled={loadingSnapshot}>
          <RefreshCw className={cn("h-3 w-3", loadingSnapshot && "animate-spin")} />
          تحديث
        </Button>
      </div>

      {/* Stats */}
      {snapshot && (
        <div className="grid grid-cols-3 gap-1.5 border-b border-border/60 bg-muted/30 px-3 py-2 text-center text-[0.65rem]">
          <Stat icon={<Archive className="h-3 w-3 text-blue-500" />} label="أرشيفات" value={snapshot.totalArchives ?? 0} tone="blue" />
          <Stat icon={<Database className="h-3 w-3 text-purple-500" />} label="حجم" value={`${snapshot.totalSizeMb ?? 0}MB`} tone="purple" />
          <Stat icon={<RefreshCw className="h-3 w-3 text-emerald-500" />} label="استعدادات" value={snapshot.totalRecoveries ?? 0} tone="emerald" />
          <Stat
            icon={snapshot.integrityStatus === "healthy" ? <Check className="h-3 w-3 text-emerald-500" /> : <AlertTriangle className="h-3 w-3 text-amber-500" />}
            label="سلامة"
            value={snapshot.integrityStatus === "healthy" ? "سليم" : snapshot.integrityStatus === "warnings" ? "تحذيرات" : "أخطاء"}
            tone={snapshot.integrityStatus === "healthy" ? "emerald" : "amber"}
          />
          <Stat icon={<Clock className="h-3 w-3" />} label="آخر نسخ" value={snapshot.lastBackupAt ? new Date(snapshot.lastBackupAt).toLocaleDateString("ar-SA", { month: "short", day: "numeric" }) : "—"} tone="default" />
          <Stat icon={<Zap className="h-3 w-3 text-amber-500" />} label="آخر استعادة" value={snapshot.lastRecoveryAt ? new Date(snapshot.lastRecoveryAt).toLocaleDateString("ar-SA", { month: "short", day: "numeric" }) : "—"} tone="amber" />
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 min-h-0 flex-col">
        <TabsList className="grid w-full grid-cols-3 rounded-none border-b border-border bg-transparent p-0">
          <TabsTrigger value="backup" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            نسخ احتياطي
          </TabsTrigger>
          <TabsTrigger value="recovery" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            استعادة
          </TabsTrigger>
          <TabsTrigger value="archives" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            الأرشيف
          </TabsTrigger>
        </TabsList>

        <TabsContent value="backup" className="m-0 flex-1 min-h-0 overflow-hidden">
          <BackupTab onChange={loadSnapshot} />
        </TabsContent>
        <TabsContent value="recovery" className="m-0 flex-1 min-h-0 overflow-hidden">
          <RecoveryTab onChange={loadSnapshot} />
        </TabsContent>
        <TabsContent value="archives" className="m-0 flex-1 min-h-0 overflow-hidden">
          <ArchivesTab onChange={loadSnapshot} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Stat({ icon, label, value, tone }: {
  icon: React.ReactNode; label: string; value: string | number; tone: "emerald" | "amber" | "red" | "blue" | "purple" | "default"
}) {
  const toneClass = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    red: "text-red-600 dark:text-red-400",
    blue: "text-blue-600 dark:text-blue-400",
    purple: "text-purple-600 dark:text-purple-400",
    default: "text-foreground",
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
  const res = await fetch("/api/backup-recovery", {
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

async function apiGet(mode: string) {
  const res = await fetch(`/api/backup-recovery?mode=${mode}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 1: Backup — 5 operations (426-430)
// ─────────────────────────────────────────────────────────────────────────

const BACKUPS: Array<{ key: string; label: string; icon: React.ReactNode; feature: number; desc: string }> = [
  { key: "conversation_backup", label: "نسخ المحادثات", icon: <Database className="h-3.5 w-3.5" />, feature: 426, desc: "تصدير كل المحادثات + الرسائل" },
  { key: "memory_backup", label: "نسخ الذاكرة", icon: <Brain className="h-3.5 w-3.5" />, feature: 427, desc: "تصدير كل الذكريات" },
  { key: "project_backup", label: "بيانات المشاريع", icon: <FolderTree className="h-3.5 w-3.5" />, feature: 428, desc: "مشاريع + أهداف + مهام" },
  { key: "settings_backup", label: "الإعدادات", icon: <Settings className="h-3.5 w-3.5" />, feature: 429, desc: "مزودين + إعدادات المحادثات" },
  { key: "checkpoint_archive", label: "أرشيف نقاط الحفظ", icon: <Archive className="h-3.5 w-3.5" />, feature: 430, desc: "كل ReliabilityCheckpoints" },
]

function BackupTab({ onChange }: { onChange: () => void }) {
  const [running, setRunning] = React.useState<string | null>(null)
  const [results, setResults] = React.useState<Record<string, any>>({})

  const handleBackup = async (key: string) => {
    setRunning(key)
    try {
      const data = await apiCall(key)
      setResults(prev => ({ ...prev, [key]: data }))
      toast.success("تم إنشاء النسخة الاحتياطية")
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setRunning(null)
    }
  }

  const handleBackupAll = async () => {
    setRunning("all")
    try {
      for (const b of BACKUPS) {
        await apiCall(b.key)
      }
      toast.success("تم نسخ كل البيانات احتياطياً")
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setRunning(null)
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">النسخ الاحتياطي / Backups (426-430)</h3>
            <p className="text-[0.7rem] text-muted-foreground mt-0.5">5 أنواع نسخ احتياطي + زر "نسخ الكل"</p>
          </div>
          <Button onClick={handleBackupAll} disabled={!!running} size="sm" className="h-7 gap-1 text-xs">
            {running === "all" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            نسخ الكل
          </Button>
        </div>

        <div className="space-y-1.5">
          {BACKUPS.map(b => {
            const result = results[b.key]
            return (
              <div key={b.key} className="rounded-md border border-border/60 bg-card/50 p-2">
                <div className="flex items-center gap-2 mb-1">
                  {b.icon}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium">{b.label}</span>
                      <Badge variant="outline" className="text-[0.55rem] py-0">#{b.feature}</Badge>
                    </div>
                    <p className="text-[0.65rem] text-muted-foreground">{b.desc}</p>
                  </div>
                  <Button
                    onClick={() => handleBackup(b.key)}
                    disabled={!!running}
                    variant="outline"
                    size="sm"
                    className="h-6 gap-1 text-xs"
                  >
                    {running === b.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                    نسخ
                  </Button>
                </div>
                {result && (
                  <div className="mt-1.5 pt-1.5 border-t border-border/40 text-[0.7rem] space-y-0.5">
                    {result.conversations !== undefined && <div className="flex justify-between"><span className="text-muted-foreground">محادثات:</span><span className="font-mono">{result.conversations} ({result.messages} رسالة)</span></div>}
                    {result.memories !== undefined && <div className="flex justify-between"><span className="text-muted-foreground">ذكريات:</span><span className="font-mono">{result.memories}</span></div>}
                    {result.projects !== undefined && <div className="flex justify-between"><span className="text-muted-foreground">مشاريع:</span><span className="font-mono">{result.projects} ({result.tasks} مهمة)</span></div>}
                    {result.providers !== undefined && <div className="flex justify-between"><span className="text-muted-foreground">مزودين:</span><span className="font-mono">{result.providers}</span></div>}
                    {result.checkpoints !== undefined && <div className="flex justify-between"><span className="text-muted-foreground">نقاط حفظ:</span><span className="font-mono">{result.checkpoints}</span></div>}
                    <div className="flex justify-between"><span className="text-muted-foreground">حجم:</span><span className="font-mono">{(result.sizeBytes / 1024).toFixed(1)}KB</span></div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </ScrollArea>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 2: Recovery — wizard (431), crash (432), integrity (433)
// ─────────────────────────────────────────────────────────────────────────

function RecoveryTab({ onChange }: { onChange: () => void }) {
  const [wizardResult, setWizardResult] = React.useState<any>(null)
  const [crashResult, setCrashResult] = React.useState<any>(null)
  const [integrity, setIntegrity] = React.useState<any>(null)
  const [running, setRunning] = React.useState<string | null>(null)
  const [selectedArchive, setSelectedArchive] = React.useState("")

  const handleWizard = async () => {
    if (!selectedArchive) {
      toast.error("اختر أرشيفاً أولاً")
      return
    }
    setRunning("wizard")
    try {
      const data = await apiCall("recovery_wizard", { archiveId: selectedArchive })
      setWizardResult(data)
      toast.success(`استُعيد ${data.restored} عنصر`)
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setRunning(null)
    }
  }

  const handleCrash = async () => {
    setRunning("crash")
    try {
      const data = await apiCall("crash_recovery")
      setCrashResult(data)
      if (data.crashDetected) toast.warning(data.reason)
      else toast.success(data.reason)
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setRunning(null)
    }
  }

  const handleIntegrity = async () => {
    setRunning("integrity")
    try {
      const data = await apiCall("integrity_check")
      setIntegrity(data)
      toast.success(`السلامة: ${data.status}`)
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setRunning(null)
    }
  }

  const archives = React.useMemo(() => {
    if (!integrity) return []
    return []
  }, [integrity])

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        {/* Recovery Wizard (431) */}
        <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Wand className="h-4 w-4 text-blue-500" />
            <span className="text-sm font-semibold">Recovery Wizard (431)</span>
            <Badge variant="outline" className="text-[0.55rem] py-0 ml-auto">#431</Badge>
          </div>
          <p className="text-[0.7rem] text-muted-foreground">اختر أرشيفاً للاستعادة منه خطوة بخطوة</p>
          <select
            value={selectedArchive}
            onChange={(e) => setSelectedArchive(e.target.value)}
            className="w-full h-7 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">— اختر أرشيف —</option>
          </select>
          <Button onClick={handleWizard} disabled={!!running || !selectedArchive} size="sm" className="w-full h-7 text-xs">
            {running === "wizard" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand className="h-3 w-3" />}
            ابدأ الاستعادة
          </Button>
          {wizardResult && (
            <div className="rounded-md border border-border/40 p-2 text-[0.7rem]">
              <div className="flex justify-between"><span className="text-muted-foreground">مستعاد:</span><span className="font-mono text-emerald-500">{wizardResult.restored}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">فشل:</span><span className="font-mono text-red-500">{wizardResult.failed}</span></div>
              {wizardResult.details?.map((d: string, i: number) => (
                <p key={i} className="text-[0.65rem] text-muted-foreground mt-1">{d}</p>
              ))}
            </div>
          )}
        </div>

        {/* Crash Recovery (432) */}
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-semibold">Crash Recovery (432)</span>
            <Badge variant="outline" className="text-[0.55rem] py-0 ml-auto">#432</Badge>
          </div>
          <p className="text-[0.7rem] text-muted-foreground">كشف تلقائي للانهيارات + استعادة من آخر نسخة</p>
          <Button onClick={handleCrash} disabled={!!running} variant="outline" size="sm" className="w-full h-7 text-xs">
            {running === "crash" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            فحص الانهيار
          </Button>
          {crashResult && (
            <div className={cn(
              "rounded-md border p-2 text-[0.7rem]",
              crashResult.crashDetected ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5"
            )}>
              <div className="flex items-center gap-1.5">
                {crashResult.crashDetected ? <AlertTriangle className="h-3 w-3 text-amber-500" /> : <Check className="h-3 w-3 text-emerald-500" />}
                <span>{crashResult.reason}</span>
              </div>
              {crashResult.restoredFrom && (
                <p className="text-[0.65rem] text-muted-foreground mt-1">من أرشيف: {crashResult.restoredFrom.slice(-12)}</p>
              )}
            </div>
          )}
        </div>

        {/* Data Integrity Check (433) */}
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            <span className="text-sm font-semibold">Data Integrity Check (433)</span>
            <Badge variant="outline" className="text-[0.55rem] py-0 ml-auto">#433</Badge>
          </div>
          <p className="text-[0.7rem] text-muted-foreground">فحص سلامة DB: يتامى، تكرار، سلسلة audit</p>
          <Button onClick={handleIntegrity} disabled={!!running} variant="outline" size="sm" className="w-full h-7 text-xs">
            {running === "integrity" ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
            فحص السلامة
          </Button>
          {integrity && (
            <div className={cn(
              "rounded-md border p-2",
              integrity.status === "healthy" ? "border-emerald-500/30 bg-emerald-500/5" :
              integrity.status === "warnings" ? "border-amber-500/30 bg-amber-500/5" :
              "border-red-500/30 bg-red-500/5"
            )}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold">
                  {integrity.status === "healthy" ? "سليم ✅" : integrity.status === "warnings" ? "تحذيرات ⚠️" : "أخطاء 🔴"}
                </span>
                <Badge variant="outline" className="text-[0.55rem] py-0">{integrity.totalIssues} مشاكل</Badge>
              </div>
              <div className="space-y-0.5">
                {integrity.checks?.map((c: any, i: number) => (
                  <div key={i} className="flex items-center gap-1.5 text-[0.65rem]">
                    {c.status === "pass" ? <Check className="h-3 w-3 text-emerald-500" /> : c.status === "warn" ? <AlertTriangle className="h-3 w-3 text-amber-500" /> : <X className="h-3 w-3 text-red-500" />}
                    <span className="text-muted-foreground">{c.name}:</span>
                    <span>{c.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 3: Archives — list + restore + delete
// ─────────────────────────────────────────────────────────────────────────

function ArchivesTab({ onChange }: { onChange: () => void }) {
  const [archives, setArchives] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet("archives")
      setArchives(data ?? [])
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  const handleRestore = async (id: string) => {
    if (!confirm("استعادة هذا الأرشيف؟")) return
    try {
      const data = await apiCall("recovery_wizard", { archiveId: id })
      toast.success(`استُعيد ${data.restored} عنصر`)
      load()
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("حذف هذا الأرشيف؟")) return
    try {
      await apiCall("archive_delete", { id })
      toast.success("حُذف")
      load()
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const typeLabels: Record<string, string> = {
    conversation: "محادثات",
    memory: "ذاكرة",
    project_metadata: "مشاريع",
    settings: "إعدادات",
    checkpoint: "نقاط حفظ",
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold">الأرشيف / Archives ({archives.length})</span>
        <Button onClick={load} variant="ghost" size="sm" className="h-7 w-7 p-0">
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
        </Button>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1.5">
          {loading ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
            </div>
          ) : archives.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <Archive className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              لا أرشيف. أنشئ نسخة احتياطية من التبويب الأول.
            </div>
          ) : (
            archives.map(a => {
              const time = new Date(a.createdAt).toLocaleString("ar-SA", { dateStyle: "short", timeStyle: "short" })
              const sizeKb = (a.sizeBytes / 1024).toFixed(1)
              return (
                <div key={a.id} className="rounded-md border border-border/60 bg-card/50 p-2">
                  <div className="flex items-center gap-1.5 flex-wrap mb-1">
                    <Badge variant="outline" className="text-[0.55rem] py-0">{typeLabels[a.type] ?? a.type}</Badge>
                    <Badge variant="outline" className="text-[0.55rem] py-0">{a.itemCount} عنصر</Badge>
                    <Badge variant="outline" className="text-[0.55rem] py-0 text-muted-foreground">{sizeKb}KB</Badge>
                    {a.status === "completed" && <Badge className="bg-emerald-500/10 text-emerald-600 text-[0.55rem] py-0">مكتمل</Badge>}
                    {a.label && <Badge variant="outline" className="text-[0.55rem] py-0 text-blue-500 border-blue-500/30">{a.label}</Badge>}
                    <span className="text-[0.55rem] text-muted-foreground ml-auto">{time}</span>
                  </div>
                  <div className="flex gap-1.5 mt-1">
                    <Button onClick={() => handleRestore(a.id)} size="sm" className="h-6 gap-1 text-[0.65rem] flex-1">
                      <Upload className="h-3 w-3" /> استعادة
                    </Button>
                    <Button onClick={() => handleDelete(a.id)} variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-red-500">
                      <Trash2 className="h-3 w-3" />
                    </Button>
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
