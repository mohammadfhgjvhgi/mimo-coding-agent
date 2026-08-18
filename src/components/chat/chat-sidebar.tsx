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
  Settings,
  Github,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
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
import type { Conversation } from "@/types/chat"

interface ChatSidebarProps {
  onNewChat: () => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onTogglePin: (id: string, pinned: boolean) => void
  onRename: (id: string, title: string) => void
  onClearAll: () => void
}

function groupByDate(items: Conversation[]) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const week = new Date(today.getTime() - 7 * 86400000)

  const groups: { label: string; items: Conversation[] }[] = [
    { label: "Pinned", items: [] },
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
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

      <div
        className="flex shrink-0 items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="rounded p-1 opacity-0 transition group-hover:opacity-100 hover:bg-background/60"
              aria-label="Conversation options"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => setEditing(true)}>
              <span>Rename</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onTogglePin(!conv.pinned)}>
              {conv.pinned ? (
                <>
                  <PinOff className="mr-2 h-3.5 w-3.5" /> Unpin
                </>
              ) : (
                <>
                  <Pin className="mr-2 h-3.5 w-3.5" /> Pin
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10">
                  <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes “{conv.title}” and all its
                    messages. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={onDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
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

export function ChatSidebar({
  onNewChat,
  onSelect,
  onDelete,
  onTogglePin,
  onRename,
  onClearAll,
}: ChatSidebarProps) {
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
    <div className="flex h-full w-full flex-col bg-sidebar">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 text-white shadow-sm">
          <MessageSquare className="h-4 w-4" />
        </div>
        <span className="flex-1 text-sm font-semibold tracking-tight">
          MiMo X
        </span>
        <ThemeToggle />
      </div>

      {/* New chat */}
      <div className="px-3 pb-2">
        <Button
          onClick={onNewChat}
          className="w-full justify-start gap-2 rounded-xl"
          variant="default"
        >
          <Plus className="h-4 w-4" /> New Chat
        </Button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations…"
            className="h-9 rounded-lg pl-8 text-sm"
          />
        </div>
      </div>

      {/* List */}
      <ScrollArea className="flex-1 px-2 chat-scroll">
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
            No conversations yet. Start a new chat!
          </div>
        ) : (
          <div className="space-y-4 py-1">
            {groups.map((group) => (
              <div key={group.label}>
                <p className="px-2.5 py-1 text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">
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
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-sidebar-border px-3 py-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-xs text-muted-foreground hover:text-foreground"
              disabled={conversations.length === 0}
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear all conversations
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear all conversations?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete every conversation and message.
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={onClearAll}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete everything
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="mt-1 flex items-center justify-between px-1 py-1">
          <span className="text-[0.7rem] text-muted-foreground">
            {conversations.length} conversation
            {conversations.length === 1 ? "" : "s"}
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
    </div>
  )
}
