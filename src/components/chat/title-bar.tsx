"use client"

import * as React from "react"
import { Minus, Square, X, Sparkles, Cpu, Cloud, Layers, Zap, Brain } from "lucide-react"
import { useSettingsStore } from "@/store/settings-store"
import { useChatStore } from "@/store/chat-store"
import { cn } from "@/lib/utils"

interface TitleBarProps {
  onOpenSettings: () => void
}

export function TitleBar({ onOpenSettings }: TitleBarProps) {
  const provider = useSettingsStore((s) => s.provider)
  const currentWorker = useChatStore((s) => s.currentWorker)
  const workerReason = useChatStore((s) => s.workerReason)
  const isStreaming = useChatStore((s) => s.isStreaming)

  return (
    <div className="titlebar-drag flex h-9 shrink-0 items-center justify-between border-b border-border bg-sidebar px-2 select-none">
      {/* Right (RTL start) — app identity */}
      <div className="flex items-center gap-2 pl-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-emerald-500 to-cyan-500 text-white shadow-sm">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <span className="text-xs font-bold tracking-tight">MiMo&nbsp;X</span>
        <span className="hidden sm:inline text-[0.7rem] text-muted-foreground">
          — مساعد ذكاء اصطناعي محلي
        </span>
      </div>

      {/* Left — provider status + active worker + window controls */}
      <div className="titlebar-no-drag flex items-center gap-1.5">
        {/* Provider badge */}
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[0.7rem] text-muted-foreground transition hover:bg-accent hover:text-foreground"
          title="الإعدادات"
        >
          {provider === "ollama" && (
            <>
              <Cpu className="h-3 w-3 text-emerald-500" />
              <span>Ollama</span>
            </>
          )}
          {provider === "dual" && (
            <>
              <Layers className="h-3 w-3 text-purple-500" />
              <span>Dual-Worker</span>
            </>
          )}
          {provider === "zai" && (
            <>
              <Cloud className="h-3 w-3 text-cyan-500" />
              <span>Z.ai سحابي</span>
            </>
          )}
        </button>

        {/* Active worker indicator (shown while streaming) */}
        {isStreaming && currentWorker && (
          <div className="flex items-center gap-1 rounded-md bg-accent/60 px-2 py-1 text-[0.7rem]">
            {currentWorker === "cpu" && (
              <>
                <Brain className="h-3 w-3 text-cyan-500 animate-pulse" />
                <span className="text-cyan-600 dark:text-cyan-400 font-medium">CPU Worker</span>
              </>
            )}
            {currentWorker === "gpu" && (
              <>
                <Zap className="h-3 w-3 text-amber-500 animate-pulse" />
                <span className="text-amber-600 dark:text-amber-400 font-medium">GPU Worker</span>
              </>
            )}
            {currentWorker === "zai" && (
              <>
                <Cloud className="h-3 w-3 text-cyan-500 animate-pulse" />
                <span className="text-cyan-600 dark:text-cyan-400 font-medium">Z.ai</span>
              </>
            )}
            {workerReason && (
              <span className="hidden md:inline text-muted-foreground">
                · {workerReason}
              </span>
            )}
          </div>
        )}

        <div className="mx-1 h-4 w-px bg-border" />

        {/* Window controls (decorative) */}
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

// Kill Switch button component
import { useState, useEffect } from "react"
import { ShieldAlert } from "lucide-react"

export function KillSwitchButton() {
  const [active, setActive] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function check() {
      try {
        const res = await fetch("/api/kill-switch")
        const data = await res.json()
        setActive(data.active)
      } catch {}
    }
    check()
    const t = setInterval(check, 10000)
    return () => clearInterval(t)
  }, [])

  const toggle = async () => {
    setLoading(true)
    try {
      await fetch("/api/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !active }),
      })
      setActive(!active)
    } catch {}
    setLoading(false)
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`flex items-center gap-1 rounded-md px-2 py-1 text-[0.7rem] transition ${
        active
          ? "bg-destructive text-destructive-foreground animate-pulse"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
      title={active ? "مفتاح الإيقاف مُفعّل — اضغط لإلغاء" : "تفعيل مفتاح إيقاف الطوارئ"}
    >
      <ShieldAlert className="h-3 w-3" />
      {active ? "مُفعّل" : "طوارئ"}
    </button>
  )
}
