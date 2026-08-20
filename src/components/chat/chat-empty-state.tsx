"use client"

import * as React from "react"
import {
  Sparkles, CheckSquare, FolderKanban, Clock, BookOpen,
  MessageSquare, Search, Code, FileSearch, Plus, Zap, Play,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface ChatEmptyStateProps {
  onPick: (prompt: string) => void
}

interface Task {
  id: string
  title: string
  priority: "low" | "medium" | "high" | "urgent"
  status: string
}

interface Project {
  id: string
  name: string
  status: string
  taskCount: number
}

interface KnowledgeItem {
  id: string
  source: string
  snippet: string
}

interface LastSession {
  conversationId: string
  title: string
  lastMessage: string
  updatedAt: string
}

export function ChatEmptyState({ onPick }: ChatEmptyStateProps) {
  const [tasks, setTasks] = React.useState<Task[]>([])
  const [projects, setProjects] = React.useState<Project[]>([])
  const [knowledge, setKnowledge] = React.useState<KnowledgeItem[]>([])
  const [lastSession, setLastSession] = React.useState<LastSession | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        // Fetch tasks (pending only)
        const taskRes = await fetch("/api/productivity?mode=tasks&status=todo&limit=5").catch(() => null)
        if (taskRes?.ok) {
          const data = await taskRes.json()
          if (mounted && data.tasks) setTasks(data.tasks.slice(0, 5))
        }

        // Fetch active projects
        const projRes = await fetch("/api/productivity?mode=projects&limit=5").catch(() => null)
        if (projRes?.ok) {
          const data = await projRes.json()
          if (mounted && data.projects) setProjects(data.projects.filter((p: Project) => p.status === "active").slice(0, 5))
        }

        // Fetch recent knowledge
        const knRes = await fetch("/api/knowledge?limit=3").catch(() => null)
        if (knRes?.ok) {
          const data = await knRes.json()
          if (mounted && data.results) {
            setKnowledge(data.results.slice(0, 3).map((r: { id: string; source: string; content: string }) => ({
              id: r.id,
              source: r.source,
              snippet: (r.content || "").slice(0, 100),
            })))
          }
        }

        // Fetch last conversation
        const convRes = await fetch("/api/conversations").catch(() => null)
        if (convRes?.ok) {
          const data = await convRes.json()
          if (mounted && data.conversations && data.conversations.length > 0) {
            const last = data.conversations[0]
            setLastSession({
              conversationId: last.id,
              title: last.title,
              lastMessage: "",
              updatedAt: last.updatedAt,
            })
          }
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

  const greeting = getGreeting()
  const taskCount = tasks.length
  const projectCount = projects.length

  const quickActions = [
    { icon: MessageSquare, label: "محادثة / Chat", prompt: "", color: "text-blue-500" },
    { icon: Search, label: "بحث / Research", prompt: "اعمل بحثًا شاملًا عن ", color: "text-emerald-500" },
    { icon: Code, label: "كود / Code", prompt: "اكتب لي كود ", color: "text-purple-500" },
    { icon: FileSearch, label: "تحليل ملف / Analyze", prompt: "حلّل الملف ", color: "text-amber-500" },
    { icon: Plus, label: "مهمة / Create Task", prompt: "أنشئ مهمة: ", color: "text-rose-500" },
    { icon: Play, label: "وكيل / Start Agent", prompt: "ابدأ وكيل: ", color: "text-cyan-500" },
  ]

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto chat-scroll px-4 py-6">
      {/* Greeting */}
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6">
          <div className="mb-1 flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card shadow-sm">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{greeting}</h1>
          </div>
          <p className="text-xs text-muted-foreground">MiMo X — نظام تشغيل ذكي محلي</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Today's Tasks */}
          <Section title="مهام اليوم" subtitle="Today's Tasks" icon={<CheckSquare className="h-4 w-4" />} count={taskCount}>
            {loading ? (
              <Skeleton />
            ) : tasks.length === 0 ? (
              <Empty text="لا مهام معلقة / no pending tasks" />
            ) : (
              tasks.map((t) => (
                <div key={t.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs">
                  <div className={cn("h-2 w-2 rounded-full shrink-0",
                    t.priority === "urgent" ? "bg-red-500" : t.priority === "high" ? "bg-orange-500" : t.priority === "medium" ? "bg-blue-500" : "bg-gray-400")} />
                  <span className="truncate flex-1">{t.title}</span>
                </div>
              ))
            )}
          </Section>

          {/* Active Projects */}
          <Section title="المشاريع النشطة" subtitle="Active Projects" icon={<FolderKanban className="h-4 w-4" />} count={projectCount}>
            {loading ? (
              <Skeleton />
            ) : projects.length === 0 ? (
              <Empty text="لا مشاريع نشطة / no active projects" />
            ) : (
              projects.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-xs">
                  <span className="truncate flex-1">{p.name}</span>
                  {p.taskCount > 0 && <Badge>{p.taskCount}</Badge>}
                </div>
              ))
            )}
          </Section>

          {/* Continue Last Session */}
          <Section title="متابعة" subtitle="Continue" icon={<Clock className="h-4 w-4" />}>
            {loading ? (
              <Skeleton />
            ) : lastSession ? (
              <button
                onClick={() => onPick(`متابعة: ${lastSession.title}`)}
                className="w-full rounded-lg border border-border bg-card px-3 py-3 text-right transition hover:border-primary/40 hover:bg-accent/40"
              >
                <div className="text-xs font-medium truncate">{lastSession.title}</div>
                <div className="text-[0.65rem] text-muted-foreground mt-0.5">
                  آخر نشاط: {formatTimeAgo(lastSession.updatedAt)}
                </div>
              </button>
            ) : (
              <Empty text="لا جلسات سابقة / no recent sessions" />
            )}
          </Section>

          {/* Recent Knowledge */}
          <Section title="معرفة حديثة" subtitle="Recent Knowledge" icon={<BookOpen className="h-4 w-4" />} count={knowledge.length}>
            {loading ? (
              <Skeleton />
            ) : knowledge.length === 0 ? (
              <Empty text="لا معرفة محفوظة / no recent knowledge" />
            ) : (
              knowledge.map((k) => (
                <div key={k.id} className="rounded-lg border border-border bg-card px-3 py-2 text-xs">
                  <div className="font-medium text-[0.7rem] mb-0.5">{k.source}</div>
                  <div className="text-muted-foreground line-clamp-2">{k.snippet}</div>
                </div>
              ))
            )}
          </Section>
        </div>

        {/* Quick Actions */}
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-2 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
            <Zap className="h-3.5 w-3.5" />
            إجراءات سريعة / Quick Actions
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {quickActions.map((a) => {
              const Icon = a.icon
              return (
                <button
                  key={a.label}
                  onClick={() => onPick(a.prompt)}
                  className="flex flex-col items-center gap-1.5 rounded-lg border border-border bg-card p-3 transition hover:border-primary/40 hover:bg-accent/40 hover:shadow-sm"
                >
                  <Icon className={cn("h-5 w-5", a.color)} />
                  <span className="text-[0.65rem] font-medium text-center leading-tight">{a.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
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
  if (mins < 1) return "الآن / just now"
  if (mins < 60) return `منذ ${mins} دقيقة / ${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `منذ ${hours} ساعة / ${hours}h ago`
  const days = Math.floor(hours / 24)
  return `منذ ${days} يوم / ${days}d ago`
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Section({ title, subtitle, icon, count, children }: {
  title: string
  subtitle: string
  icon: React.ReactNode
  count?: number
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-border bg-background/60 p-3">
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

function Skeleton() {
  return (
    <div className="space-y-1.5">
      {[1, 2].map((i) => (
        <div key={i} className="h-8 animate-pulse rounded-lg bg-muted/60" />
      ))}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="px-3 py-4 text-center text-[0.7rem] text-muted-foreground">{text}</div>
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[0.6rem] font-medium text-muted-foreground">{children}</span>
  )
}
