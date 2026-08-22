"use client"

/**
 * PersonalIntelligencePanel — Personal Intelligence OS UI (spec section 36, features 475-484).
 *
 * 3 tabs:
 *  1. Profile    — personal profile (475) + preferences (476) + goals (477) + priorities (478)
 *  2. Insights    — routines (479) + suggestions (480) + decisions (481) + relationships (482, 483)
 *  3. Timeline    — unified personal timeline (484)
 */

import * as React from "react"
import {
  User, Settings, Target, ListChecks, Clock, Lightbulb, Gavel,
  GitBranch, Brain, Activity, RefreshCw, Loader2, Check, X,
  TrendingUp, Calendar, Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

export function PersonalIntelligencePanel() {
  const [tab, setTab] = React.useState("profile")
  const [snapshot, setSnapshot] = React.useState<any>(null)
  const [loadingSnapshot, setLoadingSnapshot] = React.useState(true)

  const loadSnapshot = React.useCallback(async () => {
    setLoadingSnapshot(true)
    try {
      const res = await fetch("/api/personal-intelligence?mode=snapshot")
      const data = await res.json()
      setSnapshot(data)
    } catch (err) { console.error(err) }
    finally { setLoadingSnapshot(false) }
  }, [])

  React.useEffect(() => { loadSnapshot() }, [loadSnapshot])

  return (
    <div className="flex h-full flex-col" dir="rtl">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">ذكاء شخصي / Personal Intelligence</span>
        </div>
        <Button variant="ghost" size="sm" onClick={loadSnapshot} className="h-7 gap-1 px-2 text-xs" disabled={loadingSnapshot}>
          <RefreshCw className={cn("h-3 w-3", loadingSnapshot && "animate-spin")} />
        </Button>
      </div>

      {snapshot && (
        <div className="grid grid-cols-3 gap-1.5 border-b border-border/60 bg-muted/30 px-3 py-2 text-center text-[0.65rem]">
          <Stat icon={<Activity className="h-3 w-3 text-blue-500" />} label="محادثات" value={snapshot.totalConversations ?? 0} tone="blue" />
          <Stat icon={<Brain className="h-3 w-3 text-purple-500" />} label="ذكريات" value={snapshot.totalMemories ?? 0} tone="purple" />
          <Stat icon={<ListChecks className="h-3 w-3 text-emerald-500" />} label="مهام" value={snapshot.totalTasks ?? 0} tone="emerald" />
          <Stat icon={<Target className="h-3 w-3 text-amber-500" />} label="أهداف" value={snapshot.totalGoals ?? 0} tone="amber" />
          <Stat icon={<Gavel className="h-3 w-3 text-pink-500" />} label="قرارات" value={snapshot.totalDecisions ?? 0} tone="default" />
          <Stat icon={<Clock className="h-3 w-3 text-orange-500" />} label="روتين" value={snapshot.routinesDetected ?? 0} tone="default" />
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 min-h-0 flex-col">
        <TabsList className="grid w-full grid-cols-3 rounded-none border-b border-border bg-transparent p-0">
          <TabsTrigger value="profile" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">ملف</TabsTrigger>
          <TabsTrigger value="insights" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">رؤى</TabsTrigger>
          <TabsTrigger value="timeline" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">خط زمني</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="m-0 flex-1 min-h-0 overflow-hidden"><ProfileTab /></TabsContent>
        <TabsContent value="insights" className="m-0 flex-1 min-h-0 overflow-hidden"><InsightsTab /></TabsContent>
        <TabsContent value="timeline" className="m-0 flex-1 min-h-0 overflow-hidden"><TimelineTab /></TabsContent>
      </Tabs>
    </div>
  )
}

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string | number; tone: string }) {
  const toneClass: Record<string, string> = {
    emerald: "text-emerald-600 dark:text-emerald-400", amber: "text-amber-600 dark:text-amber-400",
    blue: "text-blue-600 dark:text-blue-400", purple: "text-purple-600 dark:text-purple-400",
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

async function apiGet(mode: string) {
  const res = await fetch(`/api/personal-intelligence?mode=${mode}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ─── Tab 1: Profile (475, 476, 477, 478) ───

function ProfileTab() {
  const [profile, setProfile] = React.useState<any>(null)
  const [prefs, setPrefs] = React.useState<any[]>([])
  const [goals, setGoals] = React.useState<any>(null)
  const [priorities, setPriorities] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)
  const [newPrefKey, setNewPrefKey] = React.useState("")
  const [newPrefValue, setNewPrefValue] = React.useState("")

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [p, pr, g, pri] = await Promise.all([
        apiGet("profile"), apiGet("preferences"), apiGet("goals"), apiGet("priorities"),
      ])
      setProfile(p); setPrefs(pr ?? []); setGoals(g); setPriorities(pri)
    } catch (e) { toast.error((e as Error).message) }
    finally { setLoading(false) }
  }, [])

  React.useEffect(() => { load() }, [load])

  const handleSetPref = async () => {
    if (!newPrefKey.trim()) return
    try {
      await fetch("/api/personal-intelligence", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pref_set", key: newPrefKey, value: newPrefValue }),
      })
      toast.success("تم حفظ التفضيل")
      setNewPrefKey(""); setNewPrefValue("")
      load()
    } catch (e) { toast.error((e as Error).message) }
  }

  if (loading) return <div className="text-center text-xs text-muted-foreground py-8"><RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" /></div>

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        {/* Personal Profile (475) */}
        {profile && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center gap-2 mb-2">
              <User className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Personal Profile (475)</span>
            </div>
            <div className="space-y-1 text-[0.7rem]">
              <div className="flex justify-between"><span className="text-muted-foreground">الاسم:</span><span className="font-medium">{profile.name}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">اللغة:</span><span>{profile.preferredLanguage}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">المنطقة الزمنية:</span><span className="font-mono">{profile.timezone}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">ساعات العمل:</span><span className="font-mono">{profile.workHours.start} - {profile.workHours.end}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">عضو منذ:</span><span>{new Date(profile.memberSince).toLocaleDateString("ar-SA")}</span></div>
            </div>
          </div>
        )}

        {/* Preferences (476) */}
        <div className="rounded-md border border-border/60 bg-card/50 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Settings className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-semibold">Preferences (476)</span>
            <Badge variant="outline" className="text-[0.55rem] py-0 ml-auto">{prefs.length}</Badge>
          </div>
          <div className="space-y-1 mb-2">
            {prefs.length === 0 ? <p className="text-[0.7rem] text-muted-foreground">لا تفضيلات محفوظة</p> :
              prefs.map((p, i) => (
                <div key={i} className="flex justify-between text-[0.7rem]">
                  <code className="font-mono text-muted-foreground">{p.key}</code>
                  <span>{p.value}</span>
                </div>
              ))
            }
          </div>
          <div className="flex gap-1.5">
            <Input value={newPrefKey} onChange={(e) => setNewPrefKey(e.target.value)} placeholder="مفتاح" className="h-7 text-xs" dir="ltr" />
            <Input value={newPrefValue} onChange={(e) => setNewPrefValue(e.target.value)} placeholder="قيمة" className="h-7 text-xs" dir="ltr" />
            <Button onClick={handleSetPref} size="sm" className="h-7 text-xs"><Check className="h-3 w-3" /></Button>
          </div>
        </div>

        {/* Goals (477) */}
        {goals && (
          <div className="rounded-md border border-border/60 bg-card/50 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Target className="h-4 w-4 text-emerald-500" />
              <span className="text-sm font-semibold">Goals (477)</span>
              <Badge variant="outline" className="text-[0.55rem] py-0 ml-auto">{goals.total} | {goals.inProgress} نشط</Badge>
            </div>
            {goals.goals?.slice(0, 5).map((g: any, i: number) => (
              <div key={i} className="border-t border-border/40 pt-1 mt-1 first:border-0 first:mt-0 first:pt-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[0.75rem] font-medium flex-1 truncate">{g.title}</span>
                  <Badge variant="outline" className="text-[0.5rem] py-0">{g.status}</Badge>
                  <Badge variant="outline" className="text-[0.5rem] py-0 text-emerald-500">{g.keyResultsDone}/{g.keyResults} KR</Badge>
                </div>
                <div className="w-full h-1 bg-muted rounded-full mt-1">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${g.progress}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Priorities (478) */}
        {priorities && (
          <div className="rounded-md border border-border/60 bg-card/50 p-3">
            <div className="flex items-center gap-2 mb-2">
              <ListChecks className="h-4 w-4 text-orange-500" />
              <span className="text-sm font-semibold">Priorities (478)</span>
              <Badge variant="outline" className="text-[0.55rem] py-0 ml-auto">{priorities.total}</Badge>
            </div>
            {priorities.ranked?.slice(0, 8).map((p: any, i: number) => (
              <div key={i} className="flex items-center gap-2 py-0.5">
                <span className="text-[0.6rem] font-mono text-muted-foreground w-6">{i + 1}.</span>
                <span className="text-[0.7rem] flex-1 truncate">{p.title}</span>
                <Badge variant="outline" className={cn("text-[0.5rem] py-0", p.score > 70 ? "text-red-500 border-red-500/30" : p.score > 50 ? "text-amber-500 border-amber-500/30" : "")}>
                  {p.score}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

// ─── Tab 2: Insights (479, 480, 481, 482, 483) ───

function InsightsTab() {
  const [subtab, setSubtab] = React.useState("routines")
  const [data, setData] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(false)

  const subtabs: Array<{ key: string; label: string; icon: React.ReactNode; feature: number }> = [
    { key: "routines", label: "روتين", icon: <Clock className="h-3 w-3" />, feature: 479 },
    { key: "suggestions", label: "اقتراحات", icon: <Lightbulb className="h-3 w-3" />, feature: 480 },
    { key: "decisions", label: "قرارات", icon: <Gavel className="h-3 w-3" />, feature: 481 },
    { key: "project_rels", label: "مشاريع", icon: <GitBranch className="h-3 w-3" />, feature: 482 },
    { key: "knowledge_rels", label: "معرفة", icon: <Brain className="h-3 w-3" />, feature: 483 },
  ]

  const load = React.useCallback(async () => {
    setLoading(true)
    try { setData(await apiGet(subtab)) }
    catch (e) { toast.error((e as Error).message) }
    finally { setLoading(false) }
  }, [subtab])

  React.useEffect(() => { load() }, [load])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-2 py-1.5">
        <div className="flex flex-wrap gap-1">
          {subtabs.map(s => (
            <button key={s.key} onClick={() => setSubtab(s.key)}
              className={cn("flex items-center gap-1 rounded-md px-2 py-1 text-[0.65rem] font-medium", subtab === s.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}>
              {s.icon}{s.label}<Badge variant="outline" className="text-[0.5rem] py-0 ml-1">#{s.feature}</Badge>
            </button>
          ))}
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1">
          {loading ? <div className="text-center text-xs text-muted-foreground py-8"><RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" /></div> :
            !data ? <div className="text-center text-xs text-muted-foreground py-8">لا بيانات</div> :
            subtab === "routines" ? (data.routines ?? []).map((r: any, i: number) => (
              <div key={i} className="rounded-md border border-border/60 bg-card/50 p-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <Clock className="h-3 w-3 text-orange-500" />
                  <span className="text-xs font-medium flex-1">{r.pattern}</span>
                  <Badge variant="outline" className="text-[0.55rem] py-0">{r.frequency}</Badge>
                </div>
                <div className="text-[0.65rem] text-muted-foreground flex justify-between">
                  <span>{r.occurrences} مرة</span>
                  <span>ثقة: {r.confidence}%</span>
                </div>
              </div>
            )) :
            subtab === "suggestions" ? (data.suggestions ?? []).map((s: any, i: number) => (
              <div key={i} className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <Lightbulb className="h-3 w-3 text-amber-500" />
                  <span className="text-xs font-medium flex-1">{s.title}</span>
                  <Badge variant="outline" className="text-[0.55rem] py-0">{s.confidence}%</Badge>
                </div>
                <p className="text-[0.65rem] text-muted-foreground">{s.description}</p>
                <code className="text-[0.6rem] font-mono text-blue-500 block mt-0.5">{s.trigger}</code>
              </div>
            )) :
            subtab === "decisions" ? (data.decisions ?? []).map((d: any, i: number) => (
              <div key={i} className="rounded-md border border-border/60 bg-card/50 p-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <Gavel className="h-3 w-3 text-pink-500" />
                  <Badge variant="outline" className="text-[0.5rem] py-0">{d.source}</Badge>
                </div>
                <p className="text-[0.7rem]">{d.content}</p>
                <span className="text-[0.55rem] text-muted-foreground">{new Date(d.createdAt).toLocaleString("ar-SA")}</span>
              </div>
            )) :
            subtab === "project_rels" ? (data.relationships ?? []).length === 0 ? (
              <div className="text-center text-xs text-muted-foreground py-4">لا علاقات بين المشاريع</div>
            ) : (data.relationships ?? []).map((r: any, i: number) => (
              <div key={i} className="rounded-md border border-border/60 bg-card/50 p-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <GitBranch className="h-3 w-3 text-blue-500" />
                  <span className="text-[0.7rem] font-medium">{r.projectA} ↔ {r.projectB}</span>
                </div>
                <div className="text-[0.6rem] text-muted-foreground">{r.type} — {r.sharedItems} مشترك</div>
              </div>
            )) :
            subtab === "knowledge_rels" ? (data.clusters ?? []).map((c: any, i: number) => (
              <div key={i} className="rounded-md border border-border/60 bg-card/50 p-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <Brain className="h-3 w-3 text-purple-500" />
                  <span className="text-xs font-medium">{c.tag}</span>
                  <Badge variant="outline" className="text-[0.55rem] py-0 ml-auto">{c.items}</Badge>
                </div>
                <div className="flex flex-wrap gap-0.5">
                  {c.titles?.map((t: string, j: number) => <Badge key={j} variant="outline" className="text-[0.5rem] py-0 text-muted-foreground">{t.slice(0, 20)}</Badge>)}
                </div>
              </div>
            )) : null}
        </div>
      </ScrollArea>
    </div>
  )
}

// ─── Tab 3: Timeline (484) ───

function TimelineTab() {
  const [events, setEvents] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet("timeline")
      setEvents(data.events ?? [])
    } catch (e) { toast.error((e as Error).message) }
    finally { setLoading(false) }
  }, [])

  React.useEffect(() => { load() }, [load])

  const typeIcons: Record<string, React.ReactNode> = {
    conversation: <Activity className="h-3 w-3 text-blue-500" />,
    task_created: <ListChecks className="h-3 w-3 text-amber-500" />,
    task_completed: <Check className="h-3 w-3 text-emerald-500" />,
    memory: <Brain className="h-3 w-3 text-purple-500" />,
    project: <Target className="h-3 w-3 text-orange-500" />,
    goal: <TrendingUp className="h-3 w-3 text-emerald-500" />,
  }

  const typeLabels: Record<string, string> = {
    conversation: "محادثة", task_created: "مهمة جديدة", task_completed: "إنجاز",
    memory: "ذاكرة", project: "مشروع", goal: "هدف",
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold">Personal Timeline (484)</span>
        <Button onClick={load} variant="ghost" size="sm" className="h-7 w-7 p-0"><RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /></Button>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-0.5">
          {loading ? <div className="text-center text-xs text-muted-foreground py-8"><RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" /></div> :
            events.length === 0 ? <div className="text-center text-xs text-muted-foreground py-8"><Calendar className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />لا أحداث</div> :
            events.map((e, i) => (
              <div key={i} className="flex gap-2 py-1">
                <div className="flex flex-col items-center">
                  {typeIcons[e.type] ?? <Activity className="h-3 w-3" />}
                  {i < events.length - 1 && <div className="w-px h-full bg-border/40 flex-1 mt-1" />}
                </div>
                <div className="flex-1 min-w-0 pb-2">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[0.5rem] py-0">{typeLabels[e.type] ?? e.type}</Badge>
                    <span className="text-[0.55rem] text-muted-foreground ml-auto">{new Date(e.timestamp).toLocaleString("ar-SA", { dateStyle: "short", timeStyle: "short" })}</span>
                  </div>
                  <p className="text-[0.7rem] font-medium truncate mt-0.5">{e.title}</p>
                  <p className="text-[0.6rem] text-muted-foreground truncate">{e.description}</p>
                </div>
              </div>
            ))
          }
        </div>
      </ScrollArea>
    </div>
  )
}
