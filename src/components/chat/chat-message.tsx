"use client"

import * as React from "react"
import { Check, Copy, RefreshCw, User } from "lucide-react"
import { Sparkles } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { MarkdownRenderer } from "./markdown-renderer"
import { ToolCallBlock } from "./tool-call-block"
import type { ChatMessage, ToolCallRecord } from "@/types/chat"

interface ChatMessageItemProps {
  message: ChatMessage
  isStreaming?: boolean
  streamingToolCalls?: ToolCallRecord[]
  onRegenerate?: () => void
}

export function ChatMessageItem({
  message,
  isStreaming,
  streamingToolCalls,
  onRegenerate,
}: ChatMessageItemProps) {
  const [copied, setCopied] = React.useState(false)
  const isUser = message.role === "user"
  const content = message.content

  // For the streaming assistant message, merge persisted toolCalls (none) with
  // the live streaming tool calls so the UI updates in real time.
  const toolCalls: (ToolCallRecord | { id: string; name: string; args: Record<string, unknown>; status: "pending" })[] =
    isStreaming && streamingToolCalls ? streamingToolCalls : message.toolCalls || []

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="group w-full animate-fade-up px-3 py-5 sm:px-4 md:px-6">
      <div className="mx-auto flex w-full max-w-3xl gap-3 sm:gap-4">
        {/* Avatar */}
        <Avatar className={cn(
          "mt-0.5 h-8 w-8 shrink-0 rounded-xl border border-border/60 transition-all duration-200",
          isUser ? "shadow-sm" : "shadow-md elevate-1"
        )}>
          <AvatarFallback
            className={cn(
              "rounded-xl text-xs font-semibold",
              isUser
                ? "bg-gradient-to-br from-zinc-700 to-zinc-900 text-white dark:from-zinc-600 dark:to-zinc-800"
                : "gradient-primary text-white"
            )}
          >
            {isUser ? <User className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
          </AvatarFallback>
        </Avatar>

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight">
              {isUser ? "أنت" : "MiMo X"}
            </span>
            {message.model && message.model !== "default" && !isStreaming && (
              <span className="rounded-md border border-border/60 bg-muted/50 px-1.5 py-0.5 text-[0.6rem] font-medium text-muted-foreground" dir="ltr">
                {message.model}
              </span>
            )}
          </div>

          {/* Tool calls (rendered before the text answer) */}
          {toolCalls.length > 0 && (
            <div className="mb-2 space-y-0">
              {toolCalls.map((c, i) => (
                <ToolCallBlock
                  key={c.id || i}
                  call={c as ToolCallRecord}
                  pending={c.status === "pending"}
                />
              ))}
            </div>
          )}

          {/* Text content */}
          <div
            className={cn(
              "min-w-0 rounded-lg text-[0.95rem] leading-7 transition-colors duration-200",
              isUser
                ? "whitespace-pre-wrap break-words bg-primary/8 border border-primary/15 px-3 py-2 -mx-3 sm:mx-0 sm:px-3"
                : "px-0"
            )}
          >
            {isUser ? (
              content
            ) : (
              <div>
                {content ? (
                  <MarkdownRenderer content={content} />
                ) : toolCalls.length === 0 ? (
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span className="flex gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
                    </span>
                    يفكّر…
                  </span>
                ) : null}
                {isStreaming && content && (
                  <span className="streaming-caret" aria-hidden />
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          {!isStreaming && message.content && (
            <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/60"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-500" /> نُسخ
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> نسخ
                  </>
                )}
              </Button>
              {!isUser && onRegenerate && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRegenerate}
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/60"
                >
                  <RefreshCw className="h-3 w-3" /> إعادة التوليد
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
