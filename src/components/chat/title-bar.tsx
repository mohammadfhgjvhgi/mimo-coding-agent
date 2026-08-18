"use client"

import * as React from "react"
import { Minus, Square, X, Sparkles, Cpu, Cloud } from "lucide-react"
import { useSettingsStore } from "@/store/settings-store"
import { cn } from "@/lib/utils"

interface TitleBarProps {
  onOpenSettings: () => void
}

export function TitleBar({ onOpenSettings }: TitleBarProps) {
  const provider = useSettingsStore((s) => s.provider)
  const [ollamaStatus, setOllamaStatus] = React.useState<"checking" | "ok" | "off">("checking")

  React.useEffect(() => {
    let cancelled = false
    async function probe() {
      try {
        const url = useSettingsStore.getState().ollamaUrl
        const res = await fetch(`/api/providers?ollamaUrl=${encodeURIComponent(url)}`)
        const data = await res.json()
        if (!cancelled) setOllamaStatus(data.reachable ? "ok" : "off")
      } catch {
        if (!cancelled) setOllamaStatus("off")
      }
    }
    probe()
    const t = setInterval(probe, 30000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  return (
    <div className="titlebar-drag flex h-9 shrink-0 items-center justify-between border-b border-border bg-sidebar px-2 select-none">
      {/* Right (RTL: visually right = start) — app identity */}
      <div className="flex items-center gap-2 pl-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-emerald-500 to-cyan-500 text-white shadow-sm">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <span className="text-xs font-bold tracking-tight">MiMo&nbsp;X</span>
        <span className="text-[0.7rem] text-muted-foreground">— مساعد ذكاء اصطناعي محلي</span>
      </div>

      {/* Center / left — provider status + window controls */}
      <div className="titlebar-no-drag flex items-center gap-1.5">
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[0.7rem] text-muted-foreground transition hover:bg-accent hover:text-foreground"
          title="الإعدادات"
        >
          {provider === "ollama" ? (
            <>
              <Cpu className={cn("h-3 w-3", ollamaStatus === "ok" ? "text-emerald-500" : ollamaStatus === "checking" ? "text-amber-500" : "text-muted-foreground")} />
              <span>Ollama</span>
              <span className={cn(
                "ml-0.5 h-1.5 w-1.5 rounded-full",
                ollamaStatus === "ok" ? "bg-emerald-500" : ollamaStatus === "checking" ? "bg-amber-500 animate-pulse" : "bg-muted-foreground/40"
              )} />
            </>
          ) : (
            <>
              <Cloud className="h-3 w-3 text-cyan-500" />
              <span>Z.ai سحابي</span>
            </>
          )}
        </button>

        <div className="mx-1 h-4 w-px bg-border" />

        {/* Window controls (decorative in web preview) */}
        <button
          className="flex h-6 w-7 items-center justify-center rounded text-muted-foreground transition hover:bg-accent"
          title="تصغير"
          aria-label="تصغير"
        >
          <Minus className="h-3 w-3" />
        </button>
        <button
          className="flex h-6 w-7 items-center justify-center rounded text-muted-foreground transition hover:bg-accent"
          title="تكبير"
          aria-label="تكبير"
        >
          <Square className="h-2.5 w-2.5" />
        </button>
        <button
          className="flex h-6 w-7 items-center justify-center rounded text-muted-foreground transition hover:bg-destructive hover:text-white"
          title="إغلاق"
          aria-label="إغلاق"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
