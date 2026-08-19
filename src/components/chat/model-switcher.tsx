"use client"

import * as React from "react"
import { Brain, ChevronDown, Gauge } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useChatStore } from "@/store/chat-store"
import { useSettingsStore } from "@/store/settings-store"
import { cn } from "@/lib/utils"

const MODELS = [
  { id: "default", name: "افتراضي", desc: "حسب الإعدادات" },
  { id: "qwen2.5-coder:7b", name: "Qwen2.5 Coder 7B", desc: "كود — CPU" },
  { id: "qwen3:4b", name: "Qwen3 4B", desc: "متوازن — CPU" },
  { id: "qwen3:1.7b", name: "Qwen3 1.7B", desc: "سريع — GPU" },
  { id: "zai", name: "Z.ai سحابي", desc: "قوي — إنترنت" },
]

export function ModelSwitcher() {
  const selectedModel = useChatStore((s) => s.selectedModel)
  const setSelectedModel = useChatStore((s) => s.setSelectedModel)
  const provider = useSettingsStore((s) => s.provider)

  const current = MODELS.find(m => m.id === selectedModel) || MODELS[0]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 rounded-lg text-xs">
          <Brain className="h-3.5 w-3.5 text-purple-500" />
          <span className="hidden sm:inline">{current.name}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-56">
        <DropdownMenuItem className="text-xs font-medium text-muted-foreground" disabled>
          تبديل النموذج
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {MODELS.map(m => (
          <DropdownMenuItem
            key={m.id}
            onClick={() => setSelectedModel(m.id)}
            className={cn("flex items-center justify-between gap-2", selectedModel === m.id && "bg-accent")}
          >
            <div className="flex flex-col">
              <span className="text-xs font-medium">{m.name}</span>
              <span className="text-[0.65rem] text-muted-foreground">{m.desc}</span>
            </div>
            {selectedModel === m.id && <Brain className="h-3 w-3 text-purple-500" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled className="text-[0.65rem] text-muted-foreground">
          المزود الحالي: {provider}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ContextMeter() {
  const contextTokens = useChatStore((s) => s.contextTokens)
  const contextBudget = useChatStore((s) => s.contextBudget)
  const messages = useChatStore((s) => s.messages)

  // Estimate tokens from messages
  const estimatedTokens = React.useMemo(() => {
    const total = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 3.5), 0)
    return total
  }, [messages])

  const pct = contextBudget > 0 ? Math.min(100, Math.round((estimatedTokens / contextBudget) * 100)) : 0
  const color = pct < 50 ? "bg-emerald-500" : pct < 80 ? "bg-amber-500" : "bg-destructive"

  return (
    <div className="flex items-center gap-2">
      <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
      <div className="flex items-center gap-1.5">
        <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
          <div className={cn("h-full transition-all", color)} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[0.65rem] text-muted-foreground tabular-nums">
          {(estimatedTokens / 1000).toFixed(1)}k/{(contextBudget / 1000).toFixed(0)}k
        </span>
      </div>
    </div>
  )
}
