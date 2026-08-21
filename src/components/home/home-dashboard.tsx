"use client"

import * as React from "react"
import {
  Sparkles, CheckSquare, FolderKanban, Clock, BookOpen,
  MessageSquare, Search, Code, FileSearch, Plus, Zap, Play,
  TrendingUp, Activity, Database, Cpu,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useChatStore } from "@/store/chat-store"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Task { id: string; title: string; priority: string; status: string }
interface Project { id: string; name: string; status: string; totalTasks: number; completedTasks: number }
interface KnowledgeItem { id: string; source: string; snippet: string }
interface ConvItem { id: string; title: string; updatedAt: string }
interface SystemStats { totalRamMb: number; usedRamMb: number; ramUsagePct: number; cpuCount: number; cpuLoadAvg: number[]; processMemoryMb: number }

// ---------------------------------------------------------------------------
// Main Dashboard Component
// ---------------------------------------------------------------------------

export function HomeDashboard({ startNewChat }: { startNewChat?: () => void } = {}) {
  const [tasks, setTasks] = React.useState<Task[]>([])
  const [projects, setProjects] = React.useState<Project[]>([])
  const [knowledge, setKnowledge] = React.useState<KnowledgeItem[]>([])
  const [conversations, setConversations] = React.useState<ConvItem[]>([])
  const [systemStats, setSystemStats] = React.useState<SystemStats | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [greeting, setGreeting] = React.useState("مرحباً / WELCOME")

  const setMessages = useChatStore((s) => s.setMessages)
  const setCurrentConversationId = useChatStore((s) => s.setCurrentConversationId)
  const setInputDraft = useChatStore((s) => s.setInputDraft)
  const safeStartNewChat = startNewChat ?? (() => {})
  const setDraft = (prompt: string) => {
    // Delay slightly so startNewChat's chat-view switch lands first,
    // then ChatInput mounts and consumes the draft.
    setTimeout(() => setInputDraft(prompt), 50)
  }

  React.useEffect(() => {
    setGreeting(getGreeting())
  }, [])

  React.useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const [taskRes, projRes, knRes, convRes, sysRes] = await Promise.allSettled([
          fetch("/api/productivity?mode=tasks&status=todo&limit=5").then(r => r.json()),
          fetch("/api/productivity?mode=projects&limit=5").then(r => r.json()),
          fetch("/api/knowledge?limit=3").then(r => r.json()),
          fetch("/api/conversations").then(r => r.json()),
          fetch("/api/observability?mode=system").then(r => r.json()),
        ])

        if (mounted && taskRes.status === "fulfilled") {
          // Handle both shapes: API returns bare array `[...]`, not `{tasks: [...]}`
          const td = taskRes.value
          const arr = Array.isArray(td) ? td : (td.tasks || [])
          setTasks(arr.slice(0, 5))
        }
        if (mounted && projRes.status === "fulfilled") {
          const pd = projRes.value
          const arr = Array.isArray(pd) ? pd : (pd.projects || [])
          setProjects(arr.filter((p: Project) => p.status === "active").slice(0, 5))
        }
        if (mounted && knRes.status === "fulfilled") {
          const kd = knRes.value
          const arr = Array.isArray(kd) ? kd : (kd.results || [])
          setKnowledge(arr.slice(0, 3).map((r: { id: string; source: string; content: string }) => ({
            id: r.id, source: r.source, snippet: (r.content || "").slice(0, 100),
          })))
        }
        if (mounted && convRes.status === "fulfilled") {
          const cd = convRes.value
          const arr = Array.isArray(cd) ? cd : (cd.conversations || [])
          setConversations(arr.slice(0, 5))
        }
        if (mounted && sysRes.status === "fulfilled") {
          setSystemStats(sysRes.value)
        }
      } catch {
        // best-effort
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [])

  const resumeConversation = async (convId: string) => {
    try {
      const res = await fetch(`/api/conversations/${convId}`)
      if (res.ok) {
        const data = await res.json()
        setMessages(data.conversation.messages || [])
        setCurrentConversationId(convId)
      }
    } catch { /* ignore */ }
  }

  return (
    <div className="ambient-mesh flex h-full w-full flex-col overflow-y-auto chat-scroll px-4 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-4xl">
        {/* Header — elegant hero */}
        <div className="mb-8 flex items-center gap-4">
          <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl gradient-primary text-white elevate-2">
            <Sparkles className="h-7 w-7" />
            <div className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-background ring-2 ring-background">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse-glow" />
            </div>
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              <span className="bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text">
                {greeting}
              </span>
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              MiMo X <span className="mx-1 text-muted-foreground/50">·</span>
              <span className="text-emerald-600 dark:text-emerald-400">نظام تشغيل ذكي محلي</span>
            </p>
          </div>
        </div>

        {/* Stats bar — monitoring dashboard style */}
        {!loading && systemStats && (
          <div className="mb-6 grid grid-cols-1 gap-3 rounded-2xl border border-border/60 bg-card/40 p-3 backdrop-blur-sm elevate-1 sm:grid-cols-3">
            <StatChip
              icon={<Activity className="h-4 w-4" />}
              label="RAM"
              value={`${systemStats.ramUsagePct}%`}
              sub={`${systemStats.usedRamMb} / ${systemStats.totalRamMb} MB`}
              progress={systemStats.ramUsagePct}
              color={systemStats.ramUsagePct > 85 ? "danger" : systemStats.ramUsagePct > 65 ? "warning" : "success"}
            />
            <StatChip
              icon={<Cpu className="h-4 w-4" />}
              label="CPU"
              value={`${systemStats.cpuCount} cores`}
              sub={`load avg ${systemStats.cpuLoadAvg[0]?.toFixed(2)}`}
              progress={Math.min(100, (systemStats.cpuLoadAvg[0] ?? 0) * 100 / Math.max(1, systemStats.cpuCount))}
              color="primary"
            />
            <StatChip
              icon={<Database className="h-4 w-4" />}
              label="Process"
              value={`${systemStats.processMemoryMb} MB`}
              sub="resident memory"
              progress={Math.min(100, (systemStats.processMemoryMb / Math.max(1, systemStats.totalRamMb)) * 100)}
              color="neutral"
            />
          </div>
        )}

        {/* Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Today's Tasks */}
          <Card title="مهام اليوم" subtitle="Today's Tasks" icon={<CheckSquare className="h-4 w-4" />} count={tasks.length}>
            {loading ? <SkeletonItems /> : tasks.length === 0 ? (
              <Empty text="لا مهام معلقة" />
            ) : (
              tasks.map(t => (
                <div key={t.id} className="group flex items-center gap-2.5 rounded-lg border border-border/50 bg-card/60 px-3 py-2 text-xs transition-all duration-200 hover:border-primary/30 hover:bg-accent/40 hover:translate-x-[-2px]">
                  <div className={cn("h-2 w-2 rounded-full shrink-0 transition-shadow",
                    t.priority === "urgent" ? "bg-red-500 shadow-[0_0_6px] shadow-red-500/50" :
                    t.priority === "high" ? "bg-orange-500 shadow-[0_0_6px] shadow-orange-500/50" :
                    t.priority === "medium" ? "bg-blue-500 shadow-[0_0_6px] shadow-blue-500/50" :
                    "bg-muted-foreground")} />
                  <span className="truncate flex-1">{t.title}</span>
                </div>
              ))
            )}
          </Card>

          {/* Active Projects */}
          <Card title="المشاريع النشطة" subtitle="Active Projects" icon={<FolderKanban className="h-4 w-4" />} count={projects.length}>
            {loading ? <SkeletonItems /> : projects.length === 0 ? (
              <Empty text="لا مشاريع نشطة" />
            ) : (
              projects.map(p => (
                <div key={p.id} className="group flex items-center justify-between rounded-lg border border-border/50 bg-card/60 px-3 py-2 text-xs transition-all duration-200 hover:border-primary/30 hover:bg-accent/40">
                  <span className="truncate flex-1">{p.name}</span>
                  {p.totalTasks > 0 && (
                    <span className="ml-2 shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[0.6rem] font-semibold text-primary tabular-nums">
                      {p.completedTasks}/{p.totalTasks}
                    </span>
                  )}
                </div>
              ))
            )}
          </Card>

          {/* Continue */}
          <Card title="متابعة" subtitle="Continue" icon={<Clock className="h-4 w-4" />} count={conversations.length}>
            {loading ? <SkeletonItems /> : conversations.length === 0 ? (
              <Empty text="لا جلسات سابقة" />
            ) : (
              conversations.slice(0, 4).map(c => (
                <button
                  key={c.id}
                  onClick={() => resumeConversation(c.id)}
                  className="group w-full rounded-lg border border-border/50 bg-card/60 px-3 py-2 text-right transition-all duration-200 hover:border-primary/40 hover:bg-accent/50 hover:shadow-sm"
                >
                  <div className="flex items-center gap-1.5">
                    <MessageSquare className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
                    <div className="truncate text-xs font-medium">{c.title}</div>
                  </div>
                  <div className="mt-0.5 text-[0.65rem] text-muted-foreground">{formatTimeAgo(c.updatedAt)}</div>
                </button>
              ))
            )}
          </Card>

          {/* Recent Knowledge */}
          <Card title="معرفة حديثة" subtitle="Recent Knowledge" icon={<BookOpen className="h-4 w-4" />} count={knowledge.length}>
            {loading ? <SkeletonItems /> : knowledge.length === 0 ? (
              <Empty text="لا معرفة محفوظة" />
            ) : (
              knowledge.map(k => (
                <div key={k.id} className="rounded-lg border border-border/50 bg-card/60 px-3 py-2 text-xs">
                  <div className="flex items-center gap-1.5 font-medium text-[0.7rem] mb-0.5">
                    <BookOpen className="h-3 w-3 text-primary" />
                    {k.source}
                  </div>
                  <div className="text-muted-foreground line-clamp-2">{k.snippet}</div>
                </div>
              ))
            )}
          </Card>

          {/* Quick Actions — command palette style */}
          <Card title="إجراءات سريعة" subtitle="Quick Actions" icon={<Zap className="h-4 w-4" />} className="sm:col-span-2">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              <QuickAction icon={<MessageSquare className="h-5 w-5" />} label="محادثة" color="text-blue-500 dark:text-blue-400" bg="from-blue-500/10 to-blue-500/0" onClick={() => { safeStartNewChat(); }} />
              <QuickAction icon={<Search className="h-5 w-5" />} label="بحث" color="text-emerald-500 dark:text-emerald-400" bg="from-emerald-500/10 to-emerald-500/0" onClick={() => { safeStartNewChat(); setDraft("ابحث لي عن: "); }} />
              <QuickAction icon={<Code className="h-5 w-5" />} label="كود" color="text-purple-500 dark:text-purple-400" bg="from-purple-500/10 to-purple-500/0" onClick={() => { safeStartNewChat(); setDraft("اكتب كود: "); }} />
              <QuickAction icon={<FileSearch className="h-5 w-5" />} label="تحليل" color="text-amber-500 dark:text-amber-400" bg="from-amber-500/10 to-amber-500/0" onClick={() => { safeStartNewChat(); setDraft("حلّل: "); }} />
              <QuickAction icon={<Plus className="h-5 w-5" />} label="مهمة" color="text-rose-500 dark:text-rose-400" bg="from-rose-500/10 to-rose-500/0" onClick={() => { safeStartNewChat(); setDraft("أنشئ مهمة: "); }} />
              <QuickAction icon={<Play className="h-5 w-5" />} label="وكيل" color="text-cyan-500 dark:text-cyan-400" bg="from-cyan-500/10 to-cyan-500/0" onClick={() => { safeStartNewChat(); }} />
            </div>
          </Card>
        </div>

        {/* Footer — semantic <footer> with mt-auto so it sticks to the bottom
            on short content and is pushed down naturally on long content. */}
        <footer className="mt-auto flex items-center justify-center gap-2 border-t border-border/50 pt-5 pb-3 text-[0.65rem] text-muted-foreground">
          <TrendingUp className="h-3 w-3" />
          <span>MiMo X</span>
          <span className="text-muted-foreground/40">•</span>
          <span className="tabular-nums">{tasks.length} مهام</span>
          <span className="text-muted-foreground/40">•</span>
          <span className="tabular-nums">{projects.length} مشاريع</span>
          <span className="text-muted-foreground/40">•</span>
          <span className="tabular-nums">{conversations.length} محادثات</span>
        </footer>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Card({ title, subtitle, icon, count, className, children }: {
  title: string; subtitle: string; icon: React.ReactNode; count?: number; className?: string; children: React.ReactNode
}) {
  return (
    <div className={cn(
      "group relative overflow-hidden rounded-2xl border border-border/60 bg-card/60 p-3.5 transition-all duration-300",
      "hover:border-primary/30 hover:shadow-md hover:-translate-y-0.5",
      "backdrop-blur-sm",
      className
    )}>
      {/* Subtle gradient accent on hover */}
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 gradient-primary-soft" aria-hidden />
      <div className="relative mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </span>
          <div>
            <div className="text-xs font-semibold tracking-tight">{title}</div>
            <div className="text-[0.6rem] text-muted-foreground/80">{subtitle}</div>
          </div>
        </div>
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.65rem] font-semibold text-primary tabular-nums">
            {count}
          </span>
        )}
      </div>
      <div className="relative space-y-1.5">{children}</div>
    </div>
  )
}

function StatChip({
  icon,
  label,
  value,
  sub,
  progress,
  color = "neutral",
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub: string
  progress?: number
  color?: "neutral" | "primary" | "success" | "warning" | "danger"
}) {
  const toneClass =
    color === "primary"
      ? "bg-primary"
      : color === "success"
        ? "bg-emerald-500"
        : color === "warning"
          ? "bg-amber-500"
          : color === "danger"
            ? "bg-red-500"
            : "bg-muted-foreground"
  const iconTone =
    color === "primary"
      ? "text-primary"
      : color === "success"
        ? "text-emerald-500 dark:text-emerald-400"
        : color === "warning"
          ? "text-amber-500 dark:text-amber-400"
          : color === "danger"
            ? "text-red-500 dark:text-red-400"
            : "text-muted-foreground"
  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-background/40 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className={cn("shrink-0", iconTone)}>{icon}</span>
        <span className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground/80">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-sm font-bold tabular-nums" dir="ltr">{value}</span>
        <span className="text-[0.65rem] text-muted-foreground/80 tabular-nums" dir="ltr">{sub}</span>
      </div>
      {progress !== undefined && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted/70">
          <div
            className={cn("h-full rounded-full transition-all duration-500 ease-out", toneClass)}
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
    </div>
  )
}

function QuickAction({ icon, label, color, bg, onClick }: {
  icon: React.ReactNode; label: string; color: string; bg: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex flex-col items-center gap-2 overflow-hidden rounded-xl border border-border/60 bg-card/80 p-3 transition-all duration-200",
        "hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5",
        "focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      )}
    >
      <div className={cn("absolute inset-0 bg-gradient-to-br opacity-0 transition-opacity duration-300 group-hover:opacity-100", bg)} aria-hidden />
      <span className={cn("relative transition-transform duration-200 group-hover:scale-110", color)}>{icon}</span>
      <span className="relative text-[0.65rem] font-medium text-center leading-tight">{label}</span>
    </button>
  )
}

function SkeletonItems() {
  return (
    <div className="space-y-1.5">
      {[1, 2].map(i => (
        <div key={i} className="h-8 skeleton-shimmer rounded-lg" />
      ))}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="px-3 py-4 text-center text-[0.7rem] text-muted-foreground">{text}</div>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "صباح الخير / GOOD MORNING"
  if (hour < 17) return "مساء الخير / GOOD AFTERNOON"
  if (hour < 21) return "مساء الخير / GOOD EVENING"
  return "سهرة هادئة / GOOD NIGHT"
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "الآن"
  if (mins < 60) return `منذ ${mins} دقيقة`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `منذ ${hours} ساعة`
  const days = Math.floor(hours / 24)
  return `منذ ${days} يوم`
}
