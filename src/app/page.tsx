"use client"

import * as React from "react"
import { ChatShell } from "@/components/chat/chat-shell"
import { HomeDashboard } from "@/components/home/home-dashboard"
import { useChatStore } from "@/store/chat-store"
import { MessageSquare } from "lucide-react"

export default function Home() {
  const [view, setView] = React.useState<"home" | "chat">("home")
  const currentConversationId = useChatStore((s) => s.currentConversationId)
  const messages = useChatStore((s) => s.messages)

  // Auto-switch to chat when conversation is selected or messages exist
  React.useEffect(() => {
    if (currentConversationId || messages.length > 0) {
      setView("chat")
    }
  }, [currentConversationId, messages.length])

  // Listen for new chat
  React.useEffect(() => {
    if (!currentConversationId && messages.length === 0) {
      // Could be triggered by "new chat" button
      const timer = setTimeout(() => {
        if (!currentConversationId && messages.length === 0) {
          setView("home")
        }
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [currentConversationId, messages.length])

  if (view === "home") {
    return (
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 text-white shadow-sm">
              <MessageSquare className="h-4 w-4" />
            </div>
            <span className="text-sm font-bold">MiMo X</span>
          </div>
          <button
            onClick={() => setView("chat")}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium transition hover:bg-accent/40"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            محادثة جديدة / New Chat
          </button>
        </div>
        {/* Dashboard */}
        <div className="flex-1 overflow-hidden">
          <HomeDashboard />
        </div>
      </div>
    )
  }

  return <ChatShell />
}
