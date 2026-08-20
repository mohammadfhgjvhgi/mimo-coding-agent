"use client"

import * as React from "react"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { toast } from "sonner"
import { Plus, PanelRight } from "lucide-react"
import { useChatStore } from "@/store/chat-store"
import { useSettingsStore } from "@/store/settings-store"
import { ChatSidebar } from "./chat-sidebar"
import { ChatHeader } from "./chat-header"
import { ChatMessages } from "./chat-messages"
import { ChatInput } from "./chat-input"
import { TitleBar } from "./title-bar"
import { SettingsDialog } from "./settings-dialog"
import { HomeDashboard } from "@/components/home/home-dashboard"
import type { Conversation, ChatMessage, Role } from "@/types/chat"
import type { ProviderSettings } from "@/lib/llm-provider"

// ---- API helpers ----------------------------------------------------------

async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetch("/api/conversations", { cache: "no-store" })
  if (!res.ok) throw new Error("فشل تحميل المحادثات")
  const data = await res.json()
  return data.conversations as Conversation[]
}

async function fetchConversation(id: string): Promise<Conversation> {
  const res = await fetch(`/api/conversations/${id}`, { cache: "no-store" })
  if (!res.ok) throw new Error("فشل تحميل المحادثة")
  const data = await res.json()
  return data.conversation as Conversation
}

async function deleteConversation(id: string): Promise<void> {
  await fetch(`/api/conversations/${id}`, { method: "DELETE" })
}

async function patchConversation(
  id: string,
  body: { title?: string; pinned?: boolean; model?: string }
) {
  const res = await fetch(`/api/conversations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return data.conversation as Conversation
}

// Parse the SSE stream coming from /api/chat
async function streamChat(
  body: {
    message: string
    conversationId?: string
    history?: { role: Role; content: string }[]
    settings?: ProviderSettings
  },
  handlers: {
    onToken: (token: string) => void
    onToolCall: (call: unknown) => void
    onError: (error: string) => void
    onDone: () => void
  }
) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    handlers.onError(err)
    return
  }

  const reader = res.body?.getReader()
  if (!reader) {
    handlers.onError("No response body")
    return
  }

  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const jsonStr = line.slice(6).trim()
        if (jsonStr === "[DONE]") {
          handlers.onDone()
          return
        }
        try {
          const chunk = JSON.parse(jsonStr)
          if (chunk.delta) handlers.onToken(chunk.delta)
          if (chunk.tool_call) handlers.onToolCall(chunk.tool_call)
          if (chunk.error) handlers.onError(chunk.error)
          if (chunk.done) {
            handlers.onDone()
            return
          }
        } catch {
          /* skip non-JSON */
        }
      }
    }
  }
  handlers.onDone()
}

// ---- ChatShell -----------------------------------------------------------

export function ChatShell() {
  const store = useChatStore()
  const {
    conversations,
    upsertConversation,
    setConversations,
    removeConversation,
    currentConversationId,
    setCurrentConversationId,
    messages,
    setMessages,
    addMessage,
    isStreaming,
    setIsStreaming,
    streamingContent,
    setStreamingContent,
    streamingError,
    setStreamingError,
    streamingToolCalls,
    resetStreamingToolCalls,
    showThinking,
    setShowThinking,
    sidebarOpen,
    setSidebarOpen,
    sidebarTab,
    agentMode,
    setAgentMode,
    contextBudget,
    loadingConversations,
    setLoadingConversations,
  } = store

  const settings = useSettingsStore()
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false)
  const [initialized, setInitialized] = React.useState(false)
  // 'home' = dashboard, 'chat' = messages
  const [view, setView] = React.useState<"home" | "chat">("home")

  // --- Resizable sidebar ---
  const [sidebarWidth, setSidebarWidth] = React.useState(288)
  const [isResizing, setIsResizing] = React.useState(false)

  React.useEffect(() => {
    const saved = localStorage.getItem("mimo-sidebar-width")
    if (saved) setSidebarWidth(Math.max(200, Math.min(600, Number(saved))))
  }, [])

  React.useEffect(() => {
    if (!isResizing) return
    const onMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX
      setSidebarWidth(Math.max(200, Math.min(600, newWidth)))
    }
    const onUp = () => {
      setIsResizing(false)
      localStorage.setItem("mimo-sidebar-width", String(sidebarWidth))
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    return () => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
  }, [isResizing, sidebarWidth])

  // --- Init: load conversations (but DON'T auto-select or switch view) ---
  React.useEffect(() => {
    if (initialized) return
    setInitialized(true)
    setLoadingConversations(true)
    fetchConversations()
      .then((convs) => {
        setConversations(convs)
        // DON'T auto-select first conversation — stay on Home Dashboard
      })
      .catch(() => {})
      .finally(() => setLoadingConversations(false))
  }, [initialized, setConversations, setLoadingConversations])

  // --- Auto-switch views ---
  // Only switch to chat when user sends a message or selects a conversation
  // NOT automatically on app load (stay on Home Dashboard)

  // --- Send message ---
  const sendMessage = React.useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return

      // Switch to chat view immediately
      setView("chat")

      const userMsg: ChatMessage = {
        id: `user_${Date.now()}`,
        conversationId: currentConversationId || "",
        role: "user",
        content: text,
        createdAt: new Date().toISOString(),
      }
      addMessage(userMsg)

      setIsStreaming(true)
      setStreamingContent("")
      setStreamingError(null)
      resetStreamingToolCalls()

      // Build history from current messages
      const history = messages.map((m) => ({
        role: m.role as Role,
        content: m.content,
      }))

      const providerSettings = settings.snapshot()

      await streamChat(
        {
          message: text,
          conversationId: currentConversationId || undefined,
          history,
          settings: providerSettings,
        },
        {
          onToken: (token) => {
            setStreamingContent(useChatStore.getState().streamingContent + token)
          },
          onToolCall: (call) => {
            useChatStore.setState((s) => ({ streamingToolCalls: [...s.streamingToolCalls, call as never] }))
          },
          onError: (error) => {
            setStreamingError(error)
          },
          onDone: async () => {
            setIsStreaming(false)
            setStreamingContent("")
            resetStreamingToolCalls()

            // Reload conversations list + current conversation
            try {
              const convs = await fetchConversations()
              setConversations(convs)
              const currentId = useChatStore.getState().currentConversationId
              if (currentId) {
                const conv = await fetchConversation(currentId)
                setMessages((conv.messages || []) as ChatMessage[])
              }
            } catch {
              /* ignore */
            }
          },
        }
      )
    },
    [
      isStreaming,
      messages,
      currentConversationId,
      addMessage,
      setIsStreaming,
      setStreamingContent,
      setStreamingError,
      resetStreamingToolCalls,
      showThinking,
      settings,
      setConversations,
      setMessages,
    ]
  )

  // --- Start new chat ---
  const startNewChat = React.useCallback(() => {
    setCurrentConversationId(null)
    setMessages([])
    setStreamingContent("")
    resetStreamingToolCalls()
    setIsStreaming(false)
    setStreamingError(null)
    setView("chat") // Go to chat view (empty state with suggestions)
  }, [setCurrentConversationId, setMessages, setStreamingContent, resetStreamingToolCalls, setIsStreaming, setStreamingError])

  // --- Go to Home Dashboard ---
  const goHome = React.useCallback(() => {
    setView("home")
  }, [])

  // --- Select conversation ---
  const selectConversation = React.useCallback(
    async (id: string) => {
      setCurrentConversationId(id)
      setMobileSidebarOpen(false)
      setLoadingConversations(true)
      setView("chat")
      try {
        const conv = await fetchConversation(id)
        setMessages((conv.messages || []) as ChatMessage[])
      } catch (e) {
        console.error(e)
        setMessages([])
      } finally {
        setLoadingConversations(false)
      }
    },
    [setCurrentConversationId, setLoadingConversations, setMessages]
  )

  // setLoadingMessages uses setLoadingConversations

  // --- Conversation actions ---
  const handleDelete = React.useCallback(
    async (id: string) => {
      const prev = conversations.find((c) => c.id === id)
      removeConversation(id)
      if (currentConversationId === id) {
        startNewChat()
      }
      try {
        await deleteConversation(id)
      } catch (e) {
        console.error(e)
        if (prev) upsertConversation(prev)
      }
    },
    [conversations, removeConversation, currentConversationId, startNewChat, upsertConversation]
  )

  const handleTogglePin = React.useCallback(
    async (id: string, pinned: boolean) => {
      const prev = conversations.find((c) => c.id === id)
      if (prev) upsertConversation({ ...prev, pinned })
      try {
        await patchConversation(id, { pinned })
      } catch (e) {
        console.error(e)
        if (prev) upsertConversation(prev)
      }
    },
    [conversations, upsertConversation]
  )

  const handleRename = React.useCallback(
    async (id: string, title: string) => {
      const prev = conversations.find((c) => c.id === id)
      if (prev) upsertConversation({ ...prev, title })
      try {
        await patchConversation(id, { title })
      } catch (e) {
        console.error(e)
        if (prev) upsertConversation(prev)
      }
    },
    [conversations, upsertConversation]
  )

  const handleClearAll = React.useCallback(async () => {
    const ids = conversations.map((c) => c.id)
    setConversations([])
    startNewChat()
    await Promise.all(
      ids.map((id) => deleteConversation(id).catch(() => {}))
    )
  }, [conversations, setConversations, startNewChat])

  const regenerate = React.useCallback(() => {
    if (isStreaming || messages.length === 0) return
    let lastUserIdx = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserIdx = i
        break
      }
    }
    if (lastUserIdx < 0) return
    const userText = messages[lastUserIdx].content
    const trimmed = messages.slice(0, lastUserIdx)
    setMessages(trimmed)
    setTimeout(() => sendMessage(userText), 50)
  }, [isStreaming, messages, setMessages, sendMessage])

  const sidebar = (
    <ChatSidebar
      onNewChat={() => {
        startNewChat()
        setMobileSidebarOpen(false)
      }}
      onSelect={(id) => selectConversation(id)}
      onDelete={(id) => handleDelete(id)}
      onTogglePin={(id, p) => handleTogglePin(id, p)}
      onRename={(id, t) => handleRename(id, t)}
      onClearAll={handleClearAll}
      onOpenSettings={() => setSettingsOpen(true)}
    />
  )

  const toggleSidebar = () => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
      setMobileSidebarOpen(true)
    } else {
      setSidebarOpen(!sidebarOpen)
    }
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background">
      {/* Desktop title bar */}
      <TitleBar onOpenSettings={() => setSettingsOpen(true)} />

      <div className="flex min-h-0 flex-1">
        {/* Desktop sidebar */}
        {sidebarOpen && (
          <>
            <div
              className="hidden md:block h-full shrink-0 border-l border-sidebar-border transition-[width] duration-0"
              style={{ width: `${sidebarWidth}px` }}
            >
              {sidebar}
            </div>
            {/* Drag handle for resizing */}
            <div
              onMouseDown={() => setIsResizing(true)}
              className="hidden md:block w-1.5 shrink-0 cursor-col-resize bg-transparent hover:bg-primary/20 active:bg-primary/40 transition-colors"
              title="اسحب لتغيير الحجم / Drag to resize"
            />
          </>
        )}

        {/* Mobile sidebar (drawer) */}
        <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
          <SheetContent side="right" className="w-72 p-0 sm:w-80">
            <SheetTitle className="sr-only">القائمة الجانبية / Sidebar</SheetTitle>
            {sidebar}
          </SheetContent>
        </Sheet>

        {/* Main panel — switches between Home Dashboard and Chat */}
        <div className="flex min-w-0 flex-1 flex-col">
          {view === "home" ? (
            <div className="relative flex-1 overflow-hidden">
              {/* Floating "New Chat" button (top-left) */}
              <button
                onClick={startNewChat}
                className="absolute left-4 top-4 z-10 flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-sm transition hover:bg-accent/40"
              >
                <Plus className="h-3.5 w-3.5" />
                محادثة جديدة / New Chat
              </button>
              {/* Floating "Toggle Sidebar" button (top-right, mobile only).
                  On mobile the desktop sidebar is hidden, so users had no way
                  to access conversations/memory/tools from the Home view. */}
              <button
                onClick={toggleSidebar}
                className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card shadow-sm transition hover:bg-accent/40 md:hidden"
                aria-label="إظهار/إخفاء القائمة"
                title="إظهار/إخفاء القائمة"
              >
                <PanelRight className="h-4 w-4" />
              </button>
              <HomeDashboard />
            </div>
          ) : (
            <>
              <ChatHeader
                onToggleSidebar={toggleSidebar}
                onNewChat={startNewChat}
                onGoHome={goHome}
                onRename={(t) =>
                  currentConversationId && handleRename(currentConversationId, t)
                }
                thinking={showThinking}
                onOpenSettings={() => setSettingsOpen(true)}
                onRevert={() => {
                  loadConversations()
                }}
              />

              <ChatMessages
                messages={messages}
                streamingContent={streamingContent}
                streamingToolCalls={streamingToolCalls}
                isStreaming={isStreaming}
                streamingRole="assistant"
                conversationId={currentConversationId}
                onPickSuggestion={(p) => sendMessage(p)}
                onRegenerate={regenerate}
                onBranch={async (messageId: string) => {
                  if (!currentConversationId) return
                  try {
                    const res = await fetch(`/api/conversations/${currentConversationId}/branch`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ fromMessageId: messageId }),
                    })
                    const data = await res.json()
                    if (data.conversation) {
                      toast.success(`تم إنشاء فرع (${data.copiedMessages} رسالة)`)
                      loadConversations()
                      setCurrentConversationId(data.conversation.id)
                    }
                  } catch { toast.error("فشل التفريع") }
                }}
                onEdit={async (messageId: string, newContent: string) => {
                  try {
                    await fetch(`/api/messages/${messageId}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ content: newContent }),
                    })
                    if (currentConversationId) {
                      const res = await fetch(`/api/conversations/${currentConversationId}`)
                      const data = await res.json()
                      setMessages((data.conversation.messages || []) as ChatMessage[])
                    }
                    toast.success("تم التعديل")
                  } catch { toast.error("فشل التعديل") }
                }}
              />

              {streamingError && (
                <div className="mx-auto mb-2 w-full max-w-3xl px-3 sm:px-4">
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    خطأ: {streamingError}
                  </div>
                </div>
              )}

              <ChatInput
                onSend={sendMessage}
                onStop={stopGeneration}
                isStreaming={isStreaming}
                thinking={showThinking}
                onToggleThinking={(v) => {
                  settings.setZaiThinking(v)
                  useChatStore.getState().setShowThinking(v)
                }}
                showThinkingToggle={true}
                placeholder={
                  currentConversationId
                    ? "راسل MiMo X…"
                    : "أرسل رسالة لبدء محادثة جديدة…"
                }
              />
            </>
          )}
        </div>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )

  // --- Helper: load conversations ---
  function loadConversations() {
    setLoadingConversations(true)
    fetchConversations()
      .then((convs) => setConversations(convs))
      .catch(() => {})
      .finally(() => setLoadingConversations(false))
  }

  // --- Helper: stop generation ---
  function stopGeneration() {
    setIsStreaming(false)
    setStreamingContent("")
    resetStreamingToolCalls()
  }
}
