"use client"

import * as React from "react"
import { EnhancedMessage } from "./enhanced-message"
import { ChatEmptyState } from "./chat-empty-state"
import type { ChatMessage, ToolCallRecord } from "@/types/chat"

interface ChatMessagesProps {
  messages: ChatMessage[]
  streamingContent: string
  streamingToolCalls: ToolCallRecord[]
  isStreaming: boolean
  streamingRole: "assistant" | null
  conversationId: string | null
  onPickSuggestion: (prompt: string) => void
  onRegenerate?: () => void
  onBranch?: (messageId: string) => void
  onEdit?: (messageId: string, newContent: string) => void
}

export function ChatMessages({
  messages,
  streamingContent,
  streamingToolCalls,
  isStreaming,
  streamingRole,
  conversationId,
  onPickSuggestion,
  onRegenerate,
  onBranch,
  onEdit,
}: ChatMessagesProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const bottomRef = React.useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = React.useState(false)

  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    if (!pinned || distance < 160) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
    }
  }, [messages, streamingContent, streamingToolCalls, pinned])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    setPinned(distance > 200)
  }

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
              const isStreamingMsg = isStreaming && isLast && m.id === "streaming"
              return (
                <EnhancedMessage
                  key={m.id}
                  message={m}
                  isStreaming={isStreamingMsg}
                  streamingToolCalls={isStreamingMsg ? streamingToolCalls : undefined}
                  onRegenerate={onRegenerate}
                  onBranch={onBranch}
                  onEdit={onEdit}
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
