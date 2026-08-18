"use client"

import * as React from "react"
import { ChatMessageItem } from "./chat-message"
import { ChatEmptyState } from "./chat-empty-state"
import type { ChatMessage } from "@/types/chat"

interface ChatMessagesProps {
  messages: ChatMessage[]
  streamingContent: string
  isStreaming: boolean
  streamingRole: "assistant" | null
  conversationId: string | null
  onPickSuggestion: (prompt: string) => void
  onRegenerate?: () => void
}

export function ChatMessages({
  messages,
  streamingContent,
  isStreaming,
  streamingRole,
  conversationId,
  onPickSuggestion,
  onRegenerate,
}: ChatMessagesProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const bottomRef = React.useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = React.useState(false)

  // Auto-scroll to bottom on new content unless user has scrolled up
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    if (!pinned || distance < 120) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
    }
  }, [messages, streamingContent, pinned])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    setPinned(distance > 200)
  }

  // Build the visible message list (existing + currently streaming assistant message)
  const visible: ChatMessage[] = [...messages]
  if (isStreaming && streamingRole === "assistant") {
    visible.push({
      id: "streaming",
      conversationId: conversationId || "",
      role: "assistant",
      content: streamingContent,
      createdAt: new Date().toISOString(),
    })
  }

  const isEmpty = visible.length === 0

  return (
    <div className="relative flex-1 overflow-hidden">
      {isEmpty ? (
        <ChatEmptyState onPick={onPickSuggestion} />
      ) : (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="chat-scroll h-full overflow-y-auto"
        >
          <div className="min-h-full pb-6">
            {visible.map((m, i) => {
              const isLast = i === visible.length - 1
              return (
                <ChatMessageItem
                  key={m.id}
                  message={m}
                  isStreaming={isStreaming && isLast && m.id === "streaming"}
                  onRegenerate={onRegenerate}
                />
              )
            })}
          </div>
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  )
}
