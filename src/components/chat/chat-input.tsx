"use client"

import * as React from "react"
import { ArrowUp, Square, Brain, Paperclip } from "lucide-react"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface ChatInputProps {
  onSend: (message: string) => void
  onStop?: () => void
  isStreaming: boolean
  thinking: boolean
  onToggleThinking: (v: boolean) => void
  disabled?: boolean
  placeholder?: string
}

export function ChatInput({
  onSend,
  onStop,
  isStreaming,
  thinking,
  onToggleThinking,
  disabled,
  placeholder,
}: ChatInputProps) {
  const [value, setValue] = React.useState("")
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  // Auto-resize the textarea
  React.useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 220) + "px"
  }, [value])

  const submit = () => {
    const text = value.trim()
    if (!text || isStreaming) return
    onSend(text)
    setValue("")
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) el.style.height = "auto"
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-3 sm:px-4">
      <div className="relative flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm transition focus-within:border-primary/40 focus-within:shadow-md">
        <TooltipProvider delayDuration={250}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 rounded-xl text-muted-foreground"
                disabled
                aria-label="Attachments (coming soon)"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Attachments</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || "Send a message…"}
          rows={1}
          disabled={disabled}
          className="min-h-[40px] flex-1 resize-none border-0 bg-transparent px-1 py-2 text-[0.95rem] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/70"
        />

        <TooltipProvider delayDuration={250}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onToggleThinking(!thinking)}
                className={cn(
                  "h-9 w-9 shrink-0 rounded-xl",
                  thinking
                    ? "text-amber-500 hover:text-amber-600"
                    : "text-muted-foreground"
                )}
                aria-label="Toggle reasoning"
              >
                <Brain className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {thinking ? "Reasoning: on" : "Reasoning: off"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {isStreaming ? (
          <Button
            type="button"
            size="icon"
            onClick={onStop}
            className="h-9 w-9 shrink-0 rounded-xl"
            aria-label="Stop generating"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            onClick={submit}
            disabled={!value.trim() || disabled}
            className="h-9 w-9 shrink-0 rounded-xl"
            aria-label="Send message"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        )}
      </div>
      <p className="mt-2 text-center text-[0.7rem] text-muted-foreground">
        MiMo X can make mistakes. Verify important info. Press{" "}
        <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[0.65rem]">
          Enter
        </kbd>{" "}
        to send,{" "}
        <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[0.65rem]">
          Shift + Enter
        </kbd>{" "}
        for a new line.
      </p>
    </div>
  )
}
