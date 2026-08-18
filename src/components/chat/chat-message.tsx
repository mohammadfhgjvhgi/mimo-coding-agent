"use client"

import * as React from "react"
import { Check, Copy, RefreshCw, User } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { MarkdownRenderer } from "./markdown-renderer"
import { Sparkles } from "lucide-react"
import type { ChatMessage } from "@/types/chat"

interface ChatMessageItemProps {
  message: ChatMessage
  isStreaming?: boolean
  onRegenerate?: () => void
}

export function ChatMessageItem({
  message,
  isStreaming,
  onRegenerate,
}: ChatMessageItemProps) {
  const [copied, setCopied] = React.useState(false)
  const isUser = message.role === "user"
  const content = isStreaming ? message.content : message.content

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
        <Avatar className="mt-0.5 h-8 w-8 shrink-0 rounded-lg border border-border">
          <AvatarFallback
            className={cn(
              "rounded-lg text-xs font-medium",
              isUser
                ? "bg-primary text-primary-foreground"
                : "bg-gradient-to-br from-emerald-500/15 to-cyan-500/15 text-emerald-600 dark:text-emerald-400"
            )}
          >
            {isUser ? <User className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
          </AvatarFallback>
        </Avatar>

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-sm font-semibold">
              {isUser ? "You" : "MiMo X"}
            </span>
          </div>

          <div
            className={cn(
              "min-w-0 text-[0.95rem] leading-7",
              isUser ? "whitespace-pre-wrap break-words" : ""
            )}
          >
            {isUser ? (
              content
            ) : (
              <div className={isStreaming && !content ? "" : ""}>
                {content ? (
                  <MarkdownRenderer content={content} />
                ) : (
                  <span className="text-muted-foreground">…</span>
                )}
                {isStreaming && content && (
                  <span className="streaming-caret" aria-hidden />
                )}
              </div>
            )}
          </div>

          {/* Actions (hidden while streaming) */}
          {!isStreaming && message.content && (
            <div className="mt-2 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> Copy
                  </>
                )}
              </Button>
              {!isUser && onRegenerate && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRegenerate}
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  <RefreshCw className="h-3 w-3" /> Regenerate
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
