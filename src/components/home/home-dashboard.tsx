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

export function HomeDashboard() {
  const [tasks, setTasks] = React.useState<Task[]>([])
  const [projects, setProjects] = React.useState<Project[]>([])
  const [knowledge, setKnowledge] = React.useState<KnowledgeItem[]>([])
  const [conversations, setConversations] = React.useState<ConvItem[]>([])
  const [systemStats, setSystemStats] = React.useState<SystemStats | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [greeting, setGreeting] = React.useState("مرحباً / WELCOME")

  const setMessages = useChatStore((s) => s.setMessages)
  const setCurrentConversationId = useChatStore((s) => s.setCurrentConversationId)

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
          setTasks((taskRes.value.tasks || []).slice(0, 5))
        }
        if (mounted && projRes.status === "fulfilled") {
          setProjects((projRes.value.projects || []).filter((p: Project) => p.status === "active").slice(0, 5))
        }
        if (mounted && knRes.status === "fulfilled") {
          setKnowledge((knRes.value.results || []).slice(0, 3).map((r: { id: string; source: string; content: string }) => ({
            id: r.id, source: r.source, snippet: (r.content || "").slice(0, 100),
          })))
        }
        if (mounted && convRes.status === "fulfilled") {
          setConversations((convRes.value.conversations || []).slice(0, 5))
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
    <div className="flex h-full w-full flex-col overflow-y-auto chat-scroll px-4 py-6">
      <div className="mx-auto w-full max-w-4xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-card shadow-sm">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{greeting}</h1>
            <p className="text-xs text-muted-foreground">MiMo X — نظام تشغيل ذكي محلي</p>
          </div>
        </div>

        {/* Stats bar */}
        {!loading && systemStats && (
          <div className="mb-4 flex flex-wrap gap-2">
            <StatChip icon={<Cpu className="h-3 w-3" />} label="RAM" value={`${systemStats.ramUsagePct}%`} sub={`${systemStats.usedRamMb}/${systemStats.totalRamMb}MB`} color={systemStats.ramUsagePct > 80 ? "text-red-500" : "text-emerald-500"} />
            <StatChip icon={<Activity className="h-3 w-3" />} label="CPU" value={`${systemStats.cpuCount}`} sub={`load ${systemStats.cpuLoadAvg[0]?.toFixed(2)}`} color="text-blue-500" />
            <StatChip icon={<Database className="h-3 w-3" />} label="Proc" value={`${systemStats.processMemoryMb}MB`} sub="memory" color="text-purple-500" />
          </div>
        )}

        {/* Grid */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* Today's Tasks */}
          <Card title="مهام اليوم" subtitle="Today's Tasks" icon={<CheckSquare className="h-4 w-4" />} count={tasks.length}>
            {loading ? <SkeletonItems /> : tasks.length === 0 ? (
              <Empty text="لا مهام معلقة" />
            ) : (
              tasks.map(t => (
                <div key={t.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs transition hover:bg-accent/30">
                  <div className={cn("h-2 w-2 rounded-full shrink-0",
                    t.priority === "urgent" ? "bg-red-500" : t.priority === "high" ? "bg-orange-500" : t.priority === "medium" ? "bg-blue-500" : "bg-gray-400")} />
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
                <div key={p.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-xs">
                  <span className="truncate flex-1">{p.name}</span>
                  {p.totalTasks > 0 && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[0.6rem] font-medium text-muted-foreground">
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
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-right transition hover:border-primary/40 hover:bg-accent/40"
                >
                  <div className="text-xs font-medium truncate">{c.title}</div>
                  <div className="text-[0.65rem] text-muted-foreground mt-0.5">{formatTimeAgo(c.updatedAt)}</div>
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
                <div key={k.id} className="rounded-lg border border-border bg-card px-3 py-2 text-xs">
                  <div className="font-medium text-[0.7rem] mb-0.5">{k.source}</div>
                  <div className="text-muted-foreground line-clamp-2">{k.snippet}</div>
                </div>
              ))
            )}
          </Card>

          {/* Quick Actions */}
          <Card title="إجراءات سريعة" subtitle="Quick Actions" icon={<Zap className="h-4 w-4" />} className="sm:col-span-2">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              <QuickAction icon={<MessageSquare className="h-5 w-5" />} label="محادثة" color="text-blue-500" onClick={() => {}} />
              <QuickAction icon={<Search className="h-5 w-5" />} label="بحث" color="text-emerald-500" onClick={() => {}} />
              <QuickAction icon={<Code className="h-5 w-5" />} label="كود" color="text-purple-500" onClick={() => {}} />
              <QuickAction icon={<FileSearch className="h-5 w-5" />} label="تحليل" color="text-amber-500" onClick={() => {}} />
              <QuickAction icon={<Plus className="h-5 w-5" />} label="مهمة" color="text-rose-500" onClick={() => {}} />
              <QuickAction icon={<Play className="h-5 w-5" />} label="وكيل" color="text-cyan-500" onClick={() => {}} />
            </div>
          </Card>
        </div>

        {/* Footer — semantic <footer> with mt-auto so it sticks to the bottom
            on short content and is pushed down naturally on long content. */}
        <footer className="mt-auto flex items-center justify-center gap-2 border-t border-border/50 pt-4 pb-2 text-[0.65rem] text-muted-foreground">
          <TrendingUp className="h-3 w-3" />
          MiMo X • {tasks.length} مهام • {projects.length} مشاريع • {conversations.length} محادثات
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
    <div className={cn("rounded-xl border border-border bg-background/60 p-3", className)}>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <div>
            <div className="text-xs font-semibold">{title}</div>
            <div className="text-[0.6rem] text-muted-foreground">{subtitle}</div>
          </div>
        </div>
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.65rem] font-medium text-primary">{count}</span>
        )}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function StatChip({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string; sub: string; color: string
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1">
      <span className={color}>{icon}</span>
      <div className="flex flex-col">
        <span className="text-[0.6rem] text-muted-foreground">{label}</span>
        <span className="text-[0.7rem] font-bold">{value}</span>
      </div>
      <span className="text-[0.55rem] text-muted-foreground">{sub}</span>
    </div>
  )
}

function QuickAction({ icon, label, color, onClick }: {
  icon: React.ReactNode; label: string; color: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 rounded-lg border border-border bg-card p-3 transition hover:border-primary/40 hover:bg-accent/40 hover:shadow-sm"
    >
      <span className={color}>{icon}</span>
      <span className="text-[0.65rem] font-medium text-center leading-tight">{label}</span>
    </button>
  )
}

function SkeletonItems() {
  return (
    <div className="space-y-1.5">
      {[1, 2].map(i => <div key={i} className="h-8 animate-pulse rounded-lg bg-muted/60" />)}
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
