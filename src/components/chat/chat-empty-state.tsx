"use client"

import * as React from "react"
import { Sparkles } from "lucide-react"

interface ChatEmptyStateProps {
  onPick: (prompt: string) => void
}

const SUGGESTIONS: { title: string; prompt: string; icon: string }[] = [
  {
    title: "اشرح لي مفهوماً",
    icon: "💡",
    prompt: "اشرح لي الفرق بين الـ Server-Side Rendering و الـ Client-Side Rendering في Next.js مع مثال عملي.",
  },
  {
    title: "اكتب لي كوداً",
    icon: "⚙️",
    prompt: "اكتب دالة TypeScript تنفّذ debounce لدالة async، مع تعليقات تشرح كل خطوة.",
  },
  {
    title: "أعطني أفكاراً",
    icon: "🧠",
    prompt: "أعطني 5 أفكار إبداعية لتطبيق إنتاجية محلي (local-first) يعمل دون إنترنت ويزامن عند الاتصال.",
  },
  {
    title: "لخّص لي",
    icon: "📝",
    prompt: "لخّص المبادئ الأساسية للهندسة البرمجية النظيفة (clean architecture) كقائمة نقاط قصيرة.",
  },
]

export function ChatEmptyState({ onPick }: ChatEmptyStateProps) {
  return (
    <div className="hero-gradient flex h-full w-full flex-col items-center justify-center px-4 py-10">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
        <Sparkles className="h-7 w-7 text-primary" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        كيف يمكنني مساعدتك اليوم؟
      </h1>
      <p className="mt-2 max-w-md text-center text-sm text-muted-foreground">
        اسألني عن أي شيء — برمجة، كتابة، بحث. MiMo X يبثّ الإجابات لحظياً ويتذكّر محادثتك.
      </p>

      <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.title}
            onClick={() => onPick(s.prompt)}
            className="group rounded-xl border border-border bg-card p-4 text-right transition hover:border-primary/40 hover:bg-accent/40 hover:shadow-sm"
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="text-base">{s.icon}</span>
              <span className="text-sm font-medium">{s.title}</span>
            </div>
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {s.prompt}
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}
