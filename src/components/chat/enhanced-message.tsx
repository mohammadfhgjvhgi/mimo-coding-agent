"use client"

import * as React from "react"
import { Brain, Copy, RefreshCw, GitBranch, Pencil, Check, X, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { MarkdownRenderer } from "./markdown-renderer"
import { ToolCallBlock } from "./tool-call-block"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { User, Sparkles } from "lucide-react"
import type { ChatMessage, ToolCallRecord } from "@/types/chat"

interface EnhancedMessageProps {
  message: ChatMessage
  isStreaming?: boolean
  streamingToolCalls?: ToolCallRecord[]
  showThinking?: boolean
  onRegenerate?: () => void
  onBranch?: (messageId: string) => void
  onEdit?: (messageId: string, newContent: string) => void
  onContinue?: () => void
}

export function EnhancedMessage({
  message,
  isStreaming,
  streamingToolCalls,
  showThinking,
  onRegenerate,
  onBranch,
  onEdit,
  onContinue,
}: EnhancedMessageProps) {
  const [copied, setCopied] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [editContent, setEditContent] = React.useState(message.content)
  const isUser = message.role === "user"

  const toolCalls = isStreaming && streamingToolCalls ? streamingToolCalls : message.toolCalls || []

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  const handleSaveEdit = () => {
    if (onEdit && editContent.trim()) {
      onEdit(message.id, editContent.trim())
    }
    setEditing(false)
  }

  return (
    <div className="group w-full animate-fade-up px-3 py-5 sm:px-4 md:px-6">
      <div className="mx-auto flex w-full max-w-3xl gap-3 sm:gap-4">
        {/* Avatar */}
        <Avatar className={cn(
          "mt-0.5 h-8 w-8 shrink-0 rounded-xl border border-border/60 transition-all duration-200",
          isUser ? "shadow-sm" : "shadow-md elevate-1"
        )}>
          <AvatarFallback className={cn(
            "rounded-xl text-xs font-semibold",
            isUser
              ? "bg-gradient-to-br from-zinc-700 to-zinc-900 text-white dark:from-zinc-600 dark:to-zinc-800"
              : "gradient-primary text-white"
          )}>
            {isUser ? <User className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
          </AvatarFallback>
        </Avatar>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header: name + model + tokens */}
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight">{isUser ? "أنت" : "MiMo X"}</span>
            {message.model && message.model !== "default" && !isStreaming && (
              <span className="rounded-md border border-border/60 bg-muted/50 px-1.5 py-0.5 text-[0.6rem] font-medium text-muted-foreground" dir="ltr">{message.model}</span>
            )}
            {(message.tokens ?? 0) > 0 && (
              <span className="text-[0.6rem] text-muted-foreground/80 tabular-nums" dir="ltr">{message.tokens} tok</span>
            )}
            {message.isEdited && (
              <span className="flex items-center gap-1 text-[0.6rem] text-amber-600 dark:text-amber-400">
                <Pencil className="h-2.5 w-2.5" /> مُعدّل
              </span>
            )}
            {showThinking && message.thinking && (
              <span className="flex items-center gap-1 text-[0.6rem] text-purple-600 dark:text-purple-400">
                <Brain className="h-2.5 w-2.5" /> تفكير
              </span>
            )}
          </div>

          {/* Thinking display */}
          {showThinking && message.thinking && !isStreaming && (
            <div className="mb-2 overflow-hidden rounded-lg border border-purple-500/30 bg-purple-500/5 p-2.5">
              <p className="mb-1 flex items-center gap-1.5 text-[0.65rem] font-semibold text-purple-600 dark:text-purple-400">
                <Brain className="h-3 w-3" /> التفكير
              </p>
              <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{message.thinking}</p>
            </div>
          )}

          {/* Tool calls */}
          {toolCalls.length > 0 && (
            <div className="mb-2 space-y-0">
              {toolCalls.map((c, i) => (
                <ToolCallBlock key={c.id || i} call={c} pending={c.status === "pending"} />
              ))}
            </div>
          )}

          {/* Content */}
          {editing ? (
            <div className="space-y-2">
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="min-h-[80px] border-border/60 bg-card/60 text-sm focus-visible:ring-primary/30"
                autoFocus
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveEdit} className="h-7 gap-1 bg-primary text-primary-foreground text-xs hover:bg-primary/90">
                  <Check className="h-3 w-3" /> حفظ
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)} className="h-7 gap-1 text-xs">
                  <X className="h-3 w-3" /> إلغاء
                </Button>
              </div>
            </div>
          ) : (
            <div className={cn(
              "min-w-0 rounded-lg text-[0.95rem] leading-7 transition-colors duration-200",
              isUser
                ? "whitespace-pre-wrap break-words bg-primary/8 border border-primary/15 px-3 py-2 -mx-3 sm:mx-0 sm:px-3"
                : "px-0"
            )}>
              {isUser ? (
                message.content
              ) : message.content ? (
                <>
                  <MarkdownRenderer content={message.content} />
                  {isStreaming && <span className="streaming-caret" aria-hidden />}
                </>
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
            </div>
          )}

          {/* Actions */}
          {!isStreaming && message.content && !editing && (
            <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <Button variant="ghost" size="sm" onClick={handleCopy} className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/60">
                {copied ? <><Check className="h-3 w-3 text-emerald-500" /> نُسخ</> : <><Copy className="h-3 w-3" /> نسخ</>}
              </Button>
              {isUser && onEdit && (
                <Button variant="ghost" size="sm" onClick={() => { setEditContent(message.content); setEditing(true) }} className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/60">
                  <Pencil className="h-3 w-3" /> تعديل
                </Button>
              )}
              {isUser && onBranch && (
                <Button variant="ghost" size="sm" onClick={() => onBranch(message.id)} className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/60">
                  <GitBranch className="h-3 w-3" /> تفريع
                </Button>
              )}
              {!isUser && onRegenerate && (
                <Button variant="ghost" size="sm" onClick={onRegenerate} className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/60">
                  <RefreshCw className="h-3 w-3" /> إعادة
                </Button>
              )}
              {!isUser && onContinue && message.content.endsWith("…") && (
                <Button variant="ghost" size="sm" onClick={onContinue} className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/60">
                  متابعة
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
