"use client"

import * as React from "react"
import { Sparkles } from "lucide-react"

interface ChatEmptyStateProps {
  onPick: (prompt: string) => void
}

const SUGGESTIONS: { title: string; prompt: string; icon: string }[] = [
  {
    title: "Explain a concept",
    icon: "💡",
    prompt: "Explain the difference between server-side rendering and client-side rendering in Next.js, with a concrete example.",
  },
  {
    title: "Write code",
    icon: "⚙️",
    prompt: "Write a TypeScript function that debounces an async function, with comments explaining each step.",
  },
  {
    title: "Brainstorm",
    icon: "🧠",
    prompt: "Give me 5 creative ideas for a local-first productivity app that works offline and syncs when online.",
  },
  {
    title: "Summarize",
    icon: "📝",
    prompt: "Summarize the key principles of clean architecture in software engineering as a short bulleted list.",
  },
]

export function ChatEmptyState({ onPick }: ChatEmptyStateProps) {
  return (
    <div className="hero-gradient flex h-full w-full flex-col items-center justify-center px-4 py-10">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
        <Sparkles className="h-7 w-7 text-primary" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        How can I help you today?
      </h1>
      <p className="mt-2 max-w-md text-center text-sm text-muted-foreground">
        Ask anything — code, writing, research. MiMo X streams answers in real
        time and remembers your conversation.
      </p>

      <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.title}
            onClick={() => onPick(s.prompt)}
            className="group rounded-xl border border-border bg-card p-4 text-left transition hover:border-primary/40 hover:bg-accent/40 hover:shadow-sm"
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
