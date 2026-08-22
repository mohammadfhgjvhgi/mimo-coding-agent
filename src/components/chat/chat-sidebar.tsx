"use client"

import * as React from "react"
import {
  Plus,
  Search,
  MessageSquare,
  Trash2,
  Pin,
  PinOff,
  MoreHorizontal,
  Github,
  Settings,
  FolderTree,
  Brain,
  Target,
  Code2,
  Calendar,
  MessageCircle,
  BookOpen,
  Sparkles,
  FileCode,
  GitBranch,
  Activity,
  Gauge,
  Zap,
  Shield,
  ShieldAlert,
  Workflow,
  TrendingUp,
  Radar,
  Wrench,
  Settings2,
  Archive,
  Zap as ZapIcon,
  Users,
  Download,
  FileJson,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { cn } from "@/lib/utils"
import { useChatStore } from "@/store/chat-store"
import { ThemeToggle } from "./theme-toggle"
import { WorkspaceExplorer } from "./workspace-explorer"
import { MemoryPanel } from "./memory-panel"
import { KnowledgePanel } from "./knowledge-panel"
import { GoalsPanel } from "./goals-panel"
import { SmartToolsPanel } from "./smart-tools-panel"
import { SymbolsPanel } from "./symbols-panel"
import { AutomationPanel } from "./automation-panel"
import { ResearchPanel } from "./research-panel"
import { CodeEditorPanel } from "./code-editor-panel"
import { GitPanel } from "./git-panel"
import { ContextInspectorPanel } from "./context-inspector-panel"
import { SecurityPanel } from "./security-panel"
import { ReliabilityPanel } from "./reliability-panel"
import { AutonomousSEPanel } from "./autonomous-se-panel"
import { SelfImprovementPanel } from "./self-improvement-panel"
import { ObservabilityPanel } from "./observability-panel"
import { DevExperiencePanel } from "./dev-experience-panel"
import { CollaborationPanel } from "./collaboration-panel"
import { AdminPanel } from "./admin-panel"
import { BackupRecoveryPanel } from "./backup-recovery-panel"
import { ModelIntelligencePanel } from "./model-intelligence-panel"
import { ResourceIntelligencePanel } from "./resource-intelligence-panel"
import { UXActionsPanel } from "./ux-actions-panel"
import { ConversationToPanel } from "./conversation-to-panel"
import type { Conversation } from "@/types/chat"

interface ChatSidebarProps {
  onNewChat: () => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onTogglePin: (id: string, pinned: boolean) => void
  onRename: (id: string, title: string) => void
  onClearAll: () => void
  onOpenSettings: () => void
}

function groupByDate(items: Conversation[]) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const week = new Date(today.getTime() - 7 * 86400000)

  const groups: { label: string; items: Conversation[] }[] = [
    { label: "مُثبّتة", items: [] },
    { label: "اليوم", items: [] },
    { label: "الأمس", items: [] },
    { label: "آخر ٧ أيام", items: [] },
    { label: "أقدم", items: [] },
  ]

  for (const c of items) {
    if (c.pinned) {
      groups[0].items.push(c)
      continue
    }
    const d = new Date(c.updatedAt)
    if (d >= today) groups[1].items.push(c)
    else if (d >= yesterday) groups[2].items.push(c)
    else if (d >= week) groups[3].items.push(c)
    else groups[4].items.push(c)
  }
  return groups.filter((g) => g.items.length > 0)
}

function ConversationItem({
  conv,
  active,
  onSelect,
  onDelete,
  onTogglePin,
  onRename,
}: {
  conv: Conversation
  active: boolean
  onSelect: () => void
  onDelete: () => void
  onTogglePin: (pinned: boolean) => void
  onRename: (title: string) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(conv.title)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Sync draft with conv.title when not editing (handles external updates)
  React.useEffect(() => {
    if (!editing) setDraft(conv.title)
  }, [conv.title, editing])

  React.useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commit = () => {
    const t = draft.trim()
    if (t && t !== conv.title) onRename(t)
    else setDraft(conv.title)
    setEditing(false)
  }

  return (
    <div
      className={cn(
        "group relative flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-all duration-200 cursor-pointer",
        active
          ? "sidebar-tab-indicator bg-primary/12 text-primary"
          : "hover:bg-sidebar-accent/60 text-muted-foreground hover:text-foreground"
      )}
      onClick={onSelect}
      data-active={active}
    >
      <MessageSquare className={cn("h-4 w-4 shrink-0 transition-colors", active ? "text-primary" : "opacity-60 group-hover:opacity-100")} />
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit()
            if (e.key === "Escape") {
              setDraft(conv.title)
              setEditing(false)
            }
          }}
          className="min-w-0 flex-1 rounded border border-border bg-background px-1 py-0 text-sm outline-none"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{conv.title}</span>
      )}

      <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="rounded p-1 opacity-0 transition group-hover:opacity-100 hover:bg-background/60"
              aria-label="خيارات المحادثة"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40">
            <DropdownMenuItem onClick={() => setEditing(true)}>
              إعادة تسمية
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onTogglePin(!conv.pinned)}>
              {conv.pinned ? (
                <>
                  <PinOff className="ml-2 h-3.5 w-3.5" /> إلغاء التثبيت
                </>
              ) : (
                <>
                  <Pin className="ml-2 h-3.5 w-3.5" /> تثبيت
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.open(`/api/conversations/${conv.id}/export?format=md`, "_blank")}>
              <Download className="ml-2 h-3.5 w-3.5" /> تصدير (MD)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.open(`/api/conversations/${conv.id}/export?format=json`, "_blank")}>
              <FileJson className="ml-2 h-3.5 w-3.5" /> تصدير (JSON)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.open(`/api/conversations/${conv.id}/export?format=html`, "_blank")}>
              <FileCode className="ml-2 h-3.5 w-3.5" /> تصدير (HTML)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10">
                  <Trash2 className="ml-2 h-3.5 w-3.5" /> حذف
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>حذف المحادثة؟</AlertDialogTitle>
                  <AlertDialogDescription>
                    سيتم حذف «{conv.title}» وجميع رسائلها نهائياً. لا يمكن التراجع عن هذا الإجراء.
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
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function ConversationList({
  onNewChat,
  onSelect,
  onDelete,
  onTogglePin,
  onRename,
  onClearAll,
}: Omit<ChatSidebarProps, "onOpenSettings">) {
  const { conversations, currentConversationId, loadingConversations } =
    useChatStore()
  const [query, setQuery] = React.useState("")

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter((c) => c.title.toLowerCase().includes(q))
  }, [conversations, query])

  const groups = React.useMemo(() => groupByDate(filtered), [filtered])

  return (
    <>
      {/* New chat */}
      <div className="px-3 pb-2">
        <Button
          onClick={onNewChat}
          className="group w-full justify-start gap-2 rounded-xl gradient-primary text-white shadow-md elevate-1 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5"
          variant="default"
        >
          <Plus className="h-4 w-4 transition-transform duration-200 group-hover:rotate-90" /> محادثة جديدة
        </Button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث في المحادثات…"
            className="h-9 rounded-lg border-border/60 bg-sidebar-accent/40 pr-8 text-sm transition-all duration-200 focus-visible:border-primary/50 focus-visible:ring-primary/20"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-scroll chat-scroll px-2">
        {loadingConversations ? (
          <div className="space-y-2 p-2">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="h-9 animate-pulse rounded-lg bg-muted/60"
              />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            لا محادثات بعد. ابدأ محادثة جديدة!
          </div>
        ) : (
          <div className="space-y-4 py-1">
            {groups.map((group) => (
              <div key={group.label}>
                <p className="px-2.5 py-1 text-[0.7rem] font-medium tracking-wider text-muted-foreground">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((c) => (
                    <ConversationItem
                      key={c.id}
                      conv={c}
                      active={c.id === currentConversationId}
                      onSelect={() => onSelect(c.id)}
                      onDelete={() => onDelete(c.id)}
                      onTogglePin={(p) => onTogglePin(c.id, p)}
                      onRename={(t) => onRename(c.id, t)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-sidebar-border px-3 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-xs text-muted-foreground hover:text-foreground"
              disabled={conversations.length === 0}
            >
              <MoreHorizontal className="h-3.5 w-3.5" /> المزيد
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive cursor-pointer"
                  disabled={conversations.length === 0}
                  onSelect={(e) => e.preventDefault()}
                >
                  <Trash2 className="h-3.5 w-3.5" /> مسح كل المحادثات
                </DropdownMenuItem>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>مسح كل المحادثات؟</AlertDialogTitle>
                  <AlertDialogDescription>
                    سيتم حذف جميع المحادثات والرسائل نهائياً. لا يمكن التراجع عن هذا الإجراء.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-2 py-2">
                  <p className="text-xs text-muted-foreground">
                    للتأكيد، اكتب <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.65rem]">DELETE</code> أدناه:
                  </p>
                  <Input
                    placeholder="DELETE"
                    onChange={(e) => {
                      const btn = e.target.parentElement?.querySelector("button[data-confirm]") as HTMLButtonElement | null
                      if (btn) btn.disabled = e.target.value !== "DELETE"
                    }}
                    className="text-sm"
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>إلغاء</AlertDialogCancel>
                  <AlertDialogAction
                    data-confirm
                    disabled
                    onClick={onClearAll}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    حذف كل شيء
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="mt-1 flex items-center justify-between px-1 py-1">
          <span className="text-[0.7rem] text-muted-foreground">
            {conversations.length} محادثة
          </span>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground transition hover:text-foreground"
            aria-label="GitHub"
          >
            <Github className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </>
  )
}

function TabButton({
  icon,
  label,
  active,
  onClick,
  title,
  className,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
  title?: string
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title || label}
      className={cn(
        "sidebar-tab-indicator group relative flex flex-col items-center justify-center gap-1 rounded-lg py-2 transition-all duration-200",
        "focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar",
        active
          ? "bg-primary/12 text-primary"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
        className
      )}
      data-active={active}
    >
      <span className="transition-transform duration-200 group-hover:scale-110">{icon}</span>
      <span className="text-[0.6rem] font-medium leading-none">{label}</span>
    </button>
  )
}

export function ChatSidebar({
  onNewChat,
  onSelect,
  onDelete,
  onTogglePin,
  onRename,
  onClearAll,
  onOpenSettings,
}: ChatSidebarProps) {
  const sidebarTab = useChatStore((s) => s.sidebarTab)
  const setSidebarTab = useChatStore((s) => s.setSidebarTab)
  const sidebarMode = useChatStore((s) => s.sidebarMode)
  const setSidebarMode = useChatStore((s) => s.setSidebarMode)
  const setChatMode = useChatStore((s) => s.setChatMode)
  const activeFile = useChatStore((s) => s.activeFile)
  const explorerRefreshSignal = useChatStore((s) => s.explorerRefreshSignal)
  const memoryRefreshSignal = useChatStore((s) => s.memoryRefreshSignal)
  const goalsRefreshSignal = useChatStore((s) => s.goalsRefreshSignal)
  const symbolsRefreshSignal = useChatStore((s) => s.symbolsRefreshSignal)
  const setActiveFile = useChatStore((s) => s.setActiveFile)

  return (
    <div className="flex h-full w-full flex-col bg-sidebar">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-3">
        <div className="relative flex h-9 w-9 items-center justify-center rounded-xl gradient-primary text-white shadow-md elevate-1">
          <MessageSquare className="h-4 w-4" />
        </div>
        <span className="flex-1 text-sm font-bold tracking-tight">MiMo X</span>
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSettings}
          className="h-8 w-8 rounded-lg"
          aria-label="الإعدادات"
        >
          <Settings className="h-4 w-4" />
        </Button>
        <ThemeToggle onOpenSettings={onOpenSettings} />
      </div>

      {/* Mode toggle — segmented control style */}
      <div className="mx-3 mb-2 grid grid-cols-2 rounded-xl border border-sidebar-border/60 bg-sidebar-accent/40 p-1 text-xs">
        <button
          onClick={() => setSidebarMode("engineering")}
          className={cn(
            "rounded-lg py-1.5 font-medium transition-all duration-200",
            sidebarMode === "engineering"
              ? "bg-background text-foreground shadow-sm elevate-1"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          🔧 هندسة
        </button>
        <button
          onClick={() => setSidebarMode("personal")}
          className={cn(
            "rounded-lg py-1.5 font-medium transition-all duration-200",
            sidebarMode === "personal"
              ? "bg-background text-foreground shadow-sm elevate-1"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          🧑 شخصي
        </button>
      </div>

      {/* Engineering tabs — Linear-style icon grid with active indicator */}
      {sidebarMode === "engineering" && (
      <div className="mx-3 mb-2 grid grid-cols-3 gap-1">
        <TabButton icon={<MessageSquare className="h-4 w-4" />} label="محادثات" active={sidebarTab === "conversations"} onClick={() => setSidebarTab("conversations")} />
        <TabButton icon={<FolderTree className="h-4 w-4" />} label="ملفات" active={sidebarTab === "explorer"} onClick={() => setSidebarTab("explorer")} />
        <TabButton icon={<Code2 className="h-4 w-4" />} label="رموز" active={sidebarTab === "symbols"} onClick={() => setSidebarTab("symbols")} />
        <TabButton icon={<Brain className="h-4 w-4" />} label="ذاكرة" active={sidebarTab === "memory"} onClick={() => setSidebarTab("memory")} />
        <TabButton icon={<Target className="h-4 w-4" />} label="أهداف" active={sidebarTab === "goals"} onClick={() => setSidebarTab("goals")} />
        <TabButton icon={<Sparkles className="h-4 w-4" />} label="أدوات" active={sidebarTab === "smart_tools"} onClick={() => setSidebarTab("smart_tools")} />
        <TabButton icon={<FileCode className="h-4 w-4" />} label="محرر" active={sidebarTab === "editor"} onClick={() => setSidebarTab("editor")} title="محرر الكود / Code Editor" />
        <TabButton icon={<GitBranch className="h-4 w-4" />} label="git" active={sidebarTab === "git"} onClick={() => setSidebarTab("git")} title="Git" />
        <TabButton icon={<Activity className="h-4 w-4" />} label="سياق" active={sidebarTab === "context"} onClick={() => setSidebarTab("context")} title="مفتش السياق / Context Inspector" />
        <TabButton icon={<Shield className="h-4 w-4" />} label="أمان" active={sidebarTab === "security"} onClick={() => setSidebarTab("security")} title="نظام الأمان / Security OS" />
        <TabButton icon={<ShieldAlert className="h-4 w-4" />} label="موثوقية" active={sidebarTab === "reliability"} onClick={() => setSidebarTab("reliability")} title="الموثوقية / Reliability OS" />
        <TabButton icon={<Workflow className="h-4 w-4" />} label="ذاتية" active={sidebarTab === "autonomous_se"} onClick={() => setSidebarTab("autonomous_se")} title="هندسة ذاتية / Autonomous SE" />
        <TabButton icon={<TrendingUp className="h-4 w-4" />} label="تحسين" active={sidebarTab === "self_improvement"} onClick={() => setSidebarTab("self_improvement")} title="تحسين الذات / Self-Improvement" />
        <TabButton icon={<Radar className="h-4 w-4" />} label="رصد" active={sidebarTab === "observability"} onClick={() => setSidebarTab("observability")} title="المراقبة / Observability" />
        <TabButton icon={<Wrench className="h-4 w-4" />} label="مطور" active={sidebarTab === "dev_experience"} onClick={() => setSidebarTab("dev_experience")} title="تجربة المطور / Dev Experience" />
        <TabButton icon={<Users className="h-4 w-4" />} label="تعاون" active={sidebarTab === "collaboration"} onClick={() => setSidebarTab("collaboration")} title="التعاون / Collaboration" />
        <TabButton icon={<Settings2 className="h-4 w-4" />} label="إدارة" active={sidebarTab === "admin"} onClick={() => setSidebarTab("admin")} title="الإدارة والتشغيل / Admin & Ops" />
        <TabButton icon={<Archive className="h-4 w-4" />} label="نسخ" active={sidebarTab === "backup_recovery"} onClick={() => setSidebarTab("backup_recovery")} title="نسخ احتياطي / Backup & Recovery" />
        <TabButton icon={<Brain className="h-4 w-4" />} label="نماذج" active={sidebarTab === "model_intel"} onClick={() => setSidebarTab("model_intel")} title="ذكاء النماذج / Model Intelligence" />
        <TabButton icon={<Gauge className="h-4 w-4" />} label="موارد" active={sidebarTab === "resource_intel"} onClick={() => setSidebarTab("resource_intel")} title="ذكاء الموارد / Resource Intelligence" />
        <TabButton icon={<ZapIcon className="h-4 w-4" />} label="UX" active={sidebarTab === "ux_actions"} onClick={() => setSidebarTab("ux_actions")} title="UX متقدم / Advanced UX" />
        <TabButton icon={<Sparkles className="h-4 w-4" />} label="تحويل" active={sidebarTab === "conversation_to"} onClick={() => setSidebarTab("conversation_to")} title="محادثة ← كل شيء / Conversation-to-Everything" />
      </div>
      )}

      {/* Personal mode tabs — segmented control style */}
      {sidebarMode === "personal" && (
        <>
          <div className="mx-3 mb-2 grid grid-cols-3 gap-1">
            <TabButton icon={<MessageCircle className="h-4 w-4" />} label="مساعد" active={true} onClick={() => { setChatMode("assistant"); setSidebarTab("conversations" as never) }} />
            <TabButton icon={<BookOpen className="h-4 w-4" />} label="معرفة" active={sidebarTab === "memory"} onClick={() => setSidebarTab("memory" as never)} />
            <TabButton icon={<Calendar className="h-4 w-4" />} label="أتمتة" active={sidebarTab === "goals"} onClick={() => setSidebarTab("goals" as never)} />
            <TabButton icon={<FolderTree className="h-4 w-4" />} label="بحث" active={sidebarTab === "symbols"} onClick={() => setSidebarTab("symbols" as never)} className="col-span-3" />
          </div>

          {/* Personal mode content */}
          {sidebarTab === "memory" ? (
            <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
              <KnowledgePanel />
            </div>
          ) : sidebarTab === "symbols" ? (
            <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
              <ResearchPanel />
            </div>
          ) : (
            <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
              <AutomationPanel refreshSignal={goalsRefreshSignal} />
            </div>
          )}
        </>
      )}

      {/* Engineering mode content */}
      {sidebarMode === "engineering" && (
      <>
      {sidebarTab === "conversations" ? (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <ConversationList
            onNewChat={onNewChat}
            onSelect={onSelect}
            onDelete={onDelete}
            onTogglePin={onTogglePin}
            onRename={onRename}
            onClearAll={onClearAll}
          />
        </div>
      ) : sidebarTab === "explorer" ? (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <WorkspaceExplorer
            activeFile={activeFile}
            refreshSignal={explorerRefreshSignal}
          />
        </div>
      ) : sidebarTab === "symbols" ? (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <SymbolsPanel
            refreshSignal={symbolsRefreshSignal}
            onSelectFile={(p) => {
              setActiveFile(p)
              setSidebarTab("explorer")
            }}
          />
        </div>
      ) : sidebarTab === "memory" ? (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <MemoryPanel refreshSignal={memoryRefreshSignal} />
        </div>
      ) : sidebarTab === "smart_tools" ? (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <SmartToolsPanel />
        </div>
      ) : sidebarTab === "editor" ? (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <CodeEditorPanel />
        </div>
      ) : sidebarTab === "git" ? (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <GitPanel />
        </div>
      ) : sidebarTab === "context" ? (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <ContextInspectorPanel />
        </div>
      ) : sidebarTab === "security" ? (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <SecurityPanel />
        </div>
      ) : sidebarTab === "reliability" ? (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <ReliabilityPanel />
        </div>
      ) : sidebarTab === "autonomous_se" ? (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <AutonomousSEPanel />
        </div>
      ) : sidebarTab === "self_improvement" ? (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <SelfImprovementPanel />
        </div>
      ) : sidebarTab === "observability" ? (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <ObservabilityPanel />
        </div>
      ) : sidebarTab === "dev_experience" ? (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <DevExperiencePanel />
        </div>
      ) : sidebarTab === "collaboration" ? (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <CollaborationPanel />
        </div>
      ) : sidebarTab === "admin" ? (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <AdminPanel />
        </div>
      ) : sidebarTab === "backup_recovery" ? (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <BackupRecoveryPanel />
        </div>
      ) : sidebarTab === "model_intel" ? (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <ModelIntelligencePanel />
        </div>
      ) : sidebarTab === "resource_intel" ? (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <ResourceIntelligencePanel />
        </div>
      ) : sidebarTab === "ux_actions" ? (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <UXActionsPanel />
        </div>
      ) : sidebarTab === "conversation_to" ? (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <ConversationToPanel />
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <GoalsPanel refreshSignal={goalsRefreshSignal} />
        </div>
      )}
      </>
      )}
    </div>
  )
}
