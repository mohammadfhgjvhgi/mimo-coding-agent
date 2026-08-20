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
        "group relative flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition cursor-pointer",
        active
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/60 text-muted-foreground hover:text-foreground"
      )}
      onClick={onSelect}
    >
      <MessageSquare className="h-4 w-4 shrink-0 opacity-70" />
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
          className="w-full justify-start gap-2 rounded-xl"
          variant="default"
        >
          <Plus className="h-4 w-4" /> محادثة جديدة
        </Button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث في المحادثات…"
            className="h-9 rounded-lg pr-8 text-sm"
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
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 text-white shadow-sm">
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

      {/* Mode toggle */}
      <div className="mx-3 mb-1 grid grid-cols-2 rounded-lg bg-muted/60 p-0.5 text-xs">
        <button
          onClick={() => setSidebarMode("engineering")}
          className={cn(
            "rounded-md py-1 font-medium transition",
            sidebarMode === "engineering"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          🔧 هندسة
        </button>
        <button
          onClick={() => setSidebarMode("personal")}
          className={cn(
            "rounded-md py-1 font-medium transition",
            sidebarMode === "personal"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          🧑 شخصي
        </button>
      </div>

      {/* Engineering tabs */}
      {sidebarMode === "engineering" && (
      <div className="mx-3 mb-1 grid grid-cols-6 rounded-lg bg-muted/60 p-0.5 text-xs">
        <button
          onClick={() => setSidebarTab("conversations")}
          className={cn(
            "flex items-center justify-center gap-1 rounded-md py-1.5 font-medium transition",
            sidebarTab === "conversations"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <MessageSquare className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setSidebarTab("explorer")}
          className={cn(
            "flex items-center justify-center gap-1 rounded-md py-1.5 font-medium transition",
            sidebarTab === "explorer"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <FolderTree className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setSidebarTab("symbols")}
          className={cn(
            "flex items-center justify-center gap-1 rounded-md py-1.5 font-medium transition",
            sidebarTab === "symbols"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Code2 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setSidebarTab("memory")}
          className={cn(
            "flex items-center justify-center gap-1 rounded-md py-1.5 font-medium transition",
            sidebarTab === "memory"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Brain className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setSidebarTab("goals")}
          className={cn(
            "flex items-center justify-center gap-1 rounded-md py-1.5 font-medium transition",
            sidebarTab === "goals"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Target className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setSidebarTab("smart_tools")}
          className={cn(
            "flex items-center justify-center gap-1 rounded-md py-1.5 font-medium transition",
            sidebarTab === "smart_tools"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Sparkles className="h-3.5 w-3.5" />
        </button>
      </div>
      )}

      {/* Tab labels */}
      {sidebarMode === "engineering" && (
      <div className="mx-3 mb-2 grid grid-cols-6 text-[0.55rem] text-muted-foreground">
        <span className={cn("text-center", sidebarTab !== "conversations" && "opacity-50")}>محادثات</span>
        <span className={cn("text-center", sidebarTab !== "explorer" && "opacity-50")}>الملفات</span>
        <span className={cn("text-center", sidebarTab !== "symbols" && "opacity-50")}>الرموز</span>
        <span className={cn("text-center", sidebarTab !== "memory" && "opacity-50")}>الذاكرة</span>
        <span className={cn("text-center", sidebarTab !== "goals" && "opacity-50")}>الأهداف</span>
        <span className={cn("text-center", sidebarTab !== "smart_tools" && "opacity-50")}>أدوات</span>
      </div>
      )}

      {/* Personal mode tabs */}
      {sidebarMode === "personal" && (
        <>
          <div className="mx-3 mb-1 grid grid-cols-3 rounded-lg bg-muted/60 p-0.5 text-xs">
            <button
              onClick={() => { setChatMode("assistant"); setSidebarTab("conversations" as never) }}
              className={cn(
                "flex items-center justify-center gap-1 rounded-md py-1.5 font-medium transition",
                "bg-background text-foreground shadow-sm"
              )}
            >
              <MessageCircle className="h-3.5 w-3.5" /> مساعد
            </button>
            <button
              onClick={() => setSidebarTab("memory" as never)}
              className="flex items-center justify-center gap-1 rounded-md py-1.5 font-medium text-muted-foreground hover:text-foreground"
            >
              <BookOpen className="h-3.5 w-3.5" /> معرفة
            </button>
            <button
              onClick={() => setSidebarTab("goals" as never)}
              className="flex items-center justify-center gap-1 rounded-md py-1.5 font-medium text-muted-foreground hover:text-foreground"
            >
              <Calendar className="h-3.5 w-3.5" /> أتمتة
            </button>
            <button
              onClick={() => setSidebarTab("symbols" as never)}
              className="flex items-center justify-center gap-1 rounded-md py-1.5 font-medium text-muted-foreground hover:text-foreground"
            >
              <FolderTree className="h-3.5 w-3.5" /> بحث
            </button>
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
