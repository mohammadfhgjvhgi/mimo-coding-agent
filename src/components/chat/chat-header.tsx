"use client"

import * as React from "react"
import { PanelLeft, Plus, Pencil, Check, Brain } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ThemeToggle } from "./theme-toggle"
import { useChatStore } from "@/store/chat-store"

interface ChatHeaderProps {
  onToggleSidebar: () => void
  onNewChat: () => void
  onRename: (title: string) => void
  thinking: boolean
}

export function ChatHeader({
  onToggleSidebar,
  onNewChat,
  onRename,
  thinking,
}: ChatHeaderProps) {
  const { conversations, currentConversationId } = useChatStore()
  const current = conversations.find((c) => c.id === currentConversationId)
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(current?.title || "New Chat")
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    setDraft(current?.title || "New Chat")
  }, [current?.id, current?.title])

  React.useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commit = () => {
    const t = draft.trim()
    if (t && t !== (current?.title || "New Chat")) onRename(t)
    else setDraft(current?.title || "New Chat")
    setEditing(false)
  }

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-md sm:px-4">
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleSidebar}
        className="h-9 w-9 rounded-lg"
        aria-label="Toggle sidebar"
      >
        <PanelLeft className="h-4 w-4" />
      </Button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {editing ? (
          <div className="flex w-full max-w-md items-center gap-1">
            <Input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit()
                if (e.key === "Escape") {
                  setDraft(current?.title || "New Chat")
                  setEditing(false)
                }
              }}
              className="h-8 text-sm"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={commit}
              className="h-8 w-8"
              aria-label="Save title"
            >
              <Check className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <button
            onClick={() => currentConversationId && setEditing(true)}
            className="group flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium transition hover:bg-accent"
            title="Click to rename"
            disabled={!currentConversationId}
          >
            <span className="truncate max-w-[60vw] sm:max-w-md md:max-w-lg">
              {current?.title || "New Chat"}
            </span>
            {currentConversationId && (
              <Pencil className="h-3 w-3 opacity-0 transition group-hover:opacity-70" />
            )}
          </button>
        )}

        {thinking && (
          <span className="hidden items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[0.7rem] font-medium text-amber-600 dark:text-amber-400 sm:flex">
            <Brain className="h-3 w-3" /> Reasoning
          </span>
        )}
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={onNewChat}
        className="h-9 w-9 rounded-lg"
        aria-label="New chat"
      >
        <Plus className="h-4 w-4" />
      </Button>
      <div className="hidden sm:block">
        <ThemeToggle />
      </div>
    </header>
  )
}
