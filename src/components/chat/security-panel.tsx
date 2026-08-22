"use client"

/**
 * SecurityPanel — minimal Security OS UI placeholder.
 * Reuses the existing security-os API (snapshot + approvals + rules).
 *
 * For the full UI (with 8 subtabs), see /home/z/my-project/worklog.md section SEC-OS-FINAL.
 */

import * as React from "react"
import { Shield, ShieldCheck, ShieldAlert, RefreshCw, Activity, Check, X, AlertTriangle, ListChecks } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

interface Snapshot {
  totalAuditEntries: number
  allowCount: number
  denyCount: number
  askCount: number
  pendingApprovals: number
  permissionRules: number
  verified: boolean
}

interface ApprovalRequest {
  id: string
  principal: string
  resource: string
  target: string
  reason: string
  status: string
  createdAt: string
}

interface PermissionRule {
  id?: string
  resource: string
  pattern: string
  action: "allow" | "deny" | "ask"
  principal?: string
  description?: string
  builtin?: boolean
}

export function SecurityPanel() {
  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null)
  const [approvals, setApprovals] = React.useState<ApprovalRequest[]>([])
  const [rules, setRules] = React.useState<PermissionRule[]>([])
  const [loading, setLoading] = React.useState(true)
  const [tab, setTab] = React.useState<"snapshot" | "approvals" | "rules">("snapshot")

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [snapRes, apprRes, rulesRes] = await Promise.all([
        fetch("/api/security-os?mode=snapshot"),
        fetch("/api/security-os?mode=approvals"),
        fetch("/api/security-os?mode=rules"),
      ])
      setSnapshot(await snapRes.json())
      const apprData = await apprRes.json()
      setApprovals(Array.isArray(apprData) ? apprData : [])
      const rulesData = await rulesRes.json()
      setRules(rulesData.rules ?? [])
    } catch (err) {
      console.error("[SecurityPanel] load failed", err)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  const handleResolve = async (id: string, approved: boolean) => {
    try {
      const res = await fetch("/api/security-os", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approval_resolve", id, approved, decidedBy: "user" }),
      })
      if (!res.ok) {
        const err = await res.json()
        toast.error(err.message ?? "فشل")
        return
      }
      toast.success(approved ? "تمت الموافقة" : "تم الرفض")
      load()
    } catch {
      toast.error("خطأ في الشبكة")
    }
  }

  return (
    <div className="flex h-full flex-col" dir="rtl">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">نظام الأمان / Security OS</span>
        </div>
        <Button variant="ghost" size="sm" onClick={load} className="h-7 gap-1 px-2 text-xs" disabled={loading}>
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          تحديث
        </Button>
      </div>

      {/* Stats */}
      {snapshot && (
        <div className="grid grid-cols-3 gap-1.5 border-b border-border/60 bg-muted/30 px-3 py-2 text-center text-[0.65rem]">
          <Stat icon={<Activity className="h-3 w-3" />} label="مدخلات السجل" value={snapshot.totalAuditEntries} tone="default" />
          <Stat icon={<Check className="h-3 w-3 text-emerald-500" />} label="مسموح" value={snapshot.allowCount} tone="emerald" />
          <Stat icon={<X className="h-3 w-3 text-red-500" />} label="مرفوض" value={snapshot.denyCount} tone="red" />
          <Stat icon={<AlertTriangle className="h-3 w-3 text-amber-500" />} label="موافقات معلّقة" value={snapshot.pendingApprovals} tone="amber" />
          <Stat icon={<ListChecks className="h-3 w-3 text-blue-500" />} label="قواعد" value={snapshot.permissionRules} tone="blue" />
          <Stat
            icon={snapshot.verified ? <ShieldCheck className="h-3 w-3 text-emerald-500" /> : <ShieldAlert className="h-3 w-3 text-red-500" />}
            label="السلسلة"
            value={snapshot.verified ? "سليمة" : "مخترقة"}
            tone={snapshot.verified ? "emerald" : "red"}
          />
        </div>
      )}

      {/* Tab switcher */}
      <div className="flex border-b border-border/60 bg-muted/20 px-2 py-1 gap-1">
        <TabBtn active={tab === "snapshot"} onClick={() => setTab("snapshot")} label="نظرة عامة" />
        <TabBtn active={tab === "approvals"} onClick={() => setTab("approvals")} label={`الموافقات (${approvals.length})`} />
        <TabBtn active={tab === "rules"} onClick={() => setTab("rules")} label={`القواعد (${rules.length})`} />
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-2">
          {tab === "snapshot" && snapshot && (
            <div className="space-y-2 text-xs">
              <div className="rounded-md border border-border/60 bg-card/50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">إجمالي المدخلات:</span>
                  <code className="font-mono font-bold">{snapshot.totalAuditEntries}</code>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">مسموح / مرفوض / طلب:</span>
                  <code className="font-mono">
                    <span className="text-emerald-500">{snapshot.allowCount}</span> /
                    <span className="text-red-500"> {snapshot.denyCount}</span> /
                    <span className="text-amber-500"> {snapshot.askCount}</span>
                  </code>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">قواعد الصلاحيات:</span>
                  <code className="font-mono font-bold">{snapshot.permissionRules}</code>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">موافقات معلّقة:</span>
                  <code className="font-mono font-bold text-amber-500">{snapshot.pendingApprovals}</code>
                </div>
                <div className="border-t border-border/40 pt-2 flex items-center justify-between">
                  <span className="text-muted-foreground">سلامة السلسلة:</span>
                  {snapshot.verified ? (
                    <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                      <ShieldCheck className="h-3 w-3 ml-1" /> سليمة
                    </Badge>
                  ) : (
                    <Badge className="bg-red-500/10 text-red-600 border-red-500/20">
                      <ShieldAlert className="h-3 w-3 ml-1" /> مخترقة
                    </Badge>
                  )}
                </div>
              </div>
              <p className="text-[0.65rem] text-muted-foreground text-center px-4">
                نظام الأمان يحفظ كل قرار صلاحية في سجل مقاوم للتعديل (hash-chained).
                استخدم تبويب الموافقات للموافقة/الرفض، والقواعد لإدارة الأذونات.
              </p>
            </div>
          )}

          {tab === "approvals" && (
            <div className="space-y-1.5">
              {approvals.length === 0 ? (
                <div className="text-center text-xs text-muted-foreground py-8">
                  <ShieldCheck className="h-8 w-8 text-emerald-500/30 mx-auto mb-2" />
                  لا موافقات معلّقة
                </div>
              ) : (
                approvals.map((appr) => (
                  <div key={appr.id} className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 text-[0.6rem]">
                        {appr.resource}
                      </Badge>
                      <Badge variant="outline" className="text-[0.6rem]">{appr.principal}</Badge>
                    </div>
                    <code className="text-[0.7rem] font-mono block break-all mb-1" dir="ltr">{appr.target}</code>
                    <p className="text-[0.7rem] text-muted-foreground mb-2">{appr.reason}</p>
                    <div className="flex gap-1.5">
                      <Button size="sm" onClick={() => handleResolve(appr.id, true)} className="h-7 gap-1 text-xs flex-1 bg-emerald-600 hover:bg-emerald-700 text-white">
                        <Check className="h-3 w-3" /> موافقة
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleResolve(appr.id, false)} className="h-7 gap-1 text-xs flex-1 border-red-500/40 text-red-600 hover:bg-red-500/10">
                        <X className="h-3 w-3" /> رفض
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === "rules" && (
            <div className="space-y-1">
              {rules.length === 0 ? (
                <div className="text-center text-xs text-muted-foreground py-8">
                  <ListChecks className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                  لا قواعد محفوظة
                </div>
              ) : (
                rules.map((rule, i) => (
                  <div key={rule.id ?? i} className="rounded-md border border-border/60 bg-card/50 p-2">
                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                      {rule.action === "allow" && <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[0.6rem]">✅ السماح</Badge>}
                      {rule.action === "deny" && <Badge className="bg-red-500/10 text-red-600 border-red-500/20 text-[0.6rem]">❌ الرفض</Badge>}
                      {rule.action === "ask" && <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[0.6rem]">⚠️ موافقة</Badge>}
                      <Badge variant="outline" className="text-[0.6rem]">{rule.resource}</Badge>
                      {rule.principal && <Badge variant="outline" className="text-[0.6rem] text-muted-foreground">{rule.principal}</Badge>}
                      {rule.builtin && <Badge variant="outline" className="text-[0.6rem] text-blue-500 border-blue-500/30">مدمجة</Badge>}
                    </div>
                    <code className="text-[0.7rem] font-mono text-muted-foreground break-all block" dir="ltr">{rule.pattern}</code>
                    {rule.description && <p className="text-[0.65rem] text-muted-foreground mt-1">{rule.description}</p>}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function Stat({ icon, label, value, tone }: {
  icon: React.ReactNode; label: string; value: number | string; tone: "default" | "emerald" | "red" | "amber" | "blue"
}) {
  const toneClass = {
    default: "text-foreground",
    emerald: "text-emerald-600 dark:text-emerald-400",
    red: "text-red-600 dark:text-red-400",
    amber: "text-amber-600 dark:text-amber-400",
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

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 rounded-md px-2 py-1 text-[0.65rem] font-medium transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {label}
    </button>
  )
}
