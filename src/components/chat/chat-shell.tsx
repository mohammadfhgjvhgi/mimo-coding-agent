"use client"

import * as React from "react"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { useChatStore } from "@/store/chat-store"
import { ChatSidebar } from "./chat-sidebar"
import { ChatHeader } from "./chat-header"
import { ChatMessages } from "./chat-messages"
import { ChatInput } from "./chat-input"
import type { Conversation, ChatMessage, Role } from "@/types/chat"

// ---- API helpers ----------------------------------------------------------

async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetch("/api/conversations", { cache: "no-store" })
  if (!res.ok) throw new Error("Failed to load conversations")
  const data = await res.json()
  return data.conversations as Conversation[]
}

async function fetchConversation(id: string): Promise<Conversation> {
  const res = await fetch(`/api/conversations/${id}`, { cache: "no-store" })
  if (!res.ok) throw new Error("Failed to load conversation")
  const data = await res.json()
  return data.conversation as Conversation
}

async function deleteConversation(id: string) {
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
    history: { role: Role; content: string }[]
    thinking?: boolean
  },
  handlers: {
    onDelta: (delta: string) => void
    onMeta: (meta: { conversationId?: string; title?: string }) => void
    onError: (err: string) => void
    onDone: (info: { conversationId?: string }) => void
  },
  signal?: AbortSignal
) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => "Request failed")
    throw new Error(errText)
  }

  if (!res.body) throw new Error("No response body")

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let meta: { conversationId?: string; title?: string } = {}

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let idx: number
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 2)
        if (!chunk.startsWith("data:")) continue
        const payload = chunk.slice(5).trim()
        if (payload === "[DONE]") {
          handlers.onDone(meta)
          return
        }
        try {
          const json = JSON.parse(payload)
          if (json.type === "meta") {
            meta = { conversationId: json.conversationId, title: json.title }
            handlers.onMeta(meta)
          } else if (json.type === "delta") {
            handlers.onDelta(json.delta || "")
          } else if (json.type === "error") {
            handlers.onError(json.error || "Unknown error")
          } else if (json.type === "done") {
            meta = { ...meta, conversationId: json.conversationId }
          }
        } catch {
          /* ignore malformed chunk */
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
  handlers.onDone(meta)
}

// ---- Main shell -----------------------------------------------------------

export function ChatShell() {
  const store = useChatStore()
  const {
    conversations,
    currentConversationId,
    messages,
    isStreaming,
    streamingContent,
    streamingError,
    sidebarOpen,
    setSidebarOpen,
    setConversations,
    setLoadingConversations,
    setCurrentConversationId,
    setMessages,
    setLoadingMessages,
    setIsStreaming,
    setStreamingContent,
    appendStreamingContent,
    setStreamingError,
    setAbortController,
    upsertConversation,
    removeConversation,
    addMessage,
  } = store

  const [thinking, setThinking] = React.useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false)
  const [initialized, setInitialized] = React.useState(false)

  // Load conversations on mount
  const loadConversations = React.useCallback(async () => {
    setLoadingConversations(true)
    try {
      const list = await fetchConversations()
      setConversations(list)
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingConversations(false)
    }
  }, [setConversations, setLoadingConversations])

  React.useEffect(() => {
    if (initialized) return
    setInitialized(true)
    loadConversations()
  }, [initialized, loadConversations])

  const selectConversation = React.useCallback(
    async (id: string) => {
      setCurrentConversationId(id)
      setMobileSidebarOpen(false)
      setLoadingMessages(true)
      try {
        const conv = await fetchConversation(id)
        setMessages((conv.messages || []) as ChatMessage[])
      } catch (e) {
        console.error(e)
        setMessages([])
      } finally {
        setLoadingMessages(false)
      }
    },
    [setCurrentConversationId, setLoadingMessages, setMessages]
  )

  const startNewChat = React.useCallback(() => {
    setCurrentConversationId(null)
    setMessages([])
    setStreamingContent("")
    setIsStreaming(false)
    setStreamingError(null)
    setMobileSidebarOpen(false)
  }, [
    setCurrentConversationId,
    setMessages,
    setStreamingContent,
    setIsStreaming,
    setStreamingError,
  ])

  const stopGeneration = React.useCallback(() => {
    store.abortController?.abort()
    setAbortController(null)
    setIsStreaming(false)
  }, [store.abortController, setAbortController, setIsStreaming])

  const sendMessage = React.useCallback(
    async (text: string) => {
      if (isStreaming) return
      setStreamingError(null)

      // Optimistic: add user message immediately
      const tempId = `u_${Date.now()}`
      const userMsg: ChatMessage = {
        id: tempId,
        conversationId: currentConversationId || "",
        role: "user",
        content: text,
        createdAt: new Date().toISOString(),
      }
      addMessage(userMsg)

      // Build history from current messages + the new user message
      const history: { role: Role; content: string }[] = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: text },
      ]

      setStreamingContent("")
      setIsStreaming(true)
      const controller = new AbortController()
      setAbortController(controller)

      try {
        await streamChat(
          {
            message: text,
            conversationId: currentConversationId || undefined,
            history,
            thinking,
          },
          {
            onDelta: (delta) => appendStreamingContent(delta),
            onMeta: (meta) => {
              if (
                meta.conversationId &&
                meta.conversationId !== currentConversationId
              ) {
                setCurrentConversationId(meta.conversationId)
              }
            },
            onError: (err) => setStreamingError(err),
            onDone: (info) => {
              setIsStreaming(false)
              setAbortController(null)
              const finalContent = useChatStore.getState().streamingContent
              const assistantMsg: ChatMessage = {
                id: `a_${Date.now()}`,
                conversationId:
                  info.conversationId || currentConversationId || "",
                role: "assistant",
                content: finalContent,
                createdAt: new Date().toISOString(),
                model: thinking ? "thinking" : "default",
              }
              setMessages([...useChatStore.getState().messages, assistantMsg])
              setStreamingContent("")
              loadConversations()
            },
          },
          controller.signal
        )
      } catch (e) {
        if ((e as Error)?.name === "AbortError") {
          const finalContent = useChatStore.getState().streamingContent
          if (finalContent.trim()) {
            const assistantMsg: ChatMessage = {
              id: `a_${Date.now()}`,
              conversationId: currentConversationId || "",
              role: "assistant",
              content: finalContent,
              createdAt: new Date().toISOString(),
              model: "default",
            }
            setMessages([...useChatStore.getState().messages, assistantMsg])
          }
          setStreamingContent("")
        } else {
          setStreamingError((e as Error).message || "Failed to send message")
        }
        setIsStreaming(false)
        setAbortController(null)
      }
    },
    [
      isStreaming,
      messages,
      currentConversationId,
      thinking,
      addMessage,
      setStreamingContent,
      setIsStreaming,
      setAbortController,
      appendStreamingContent,
      setCurrentConversationId,
      setStreamingError,
      setMessages,
      loadConversations,
    ]
  )

  const handleDelete = React.useCallback(
    async (id: string) => {
      removeConversation(id)
      if (currentConversationId === id) startNewChat()
      try {
        await deleteConversation(id)
      } catch (e) {
        console.error(e)
      }
    },
    [removeConversation, currentConversationId, startNewChat]
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
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      {sidebarOpen && (
        <div className="hidden md:block h-full w-72 shrink-0 border-r border-sidebar-border">
          {sidebar}
        </div>
      )}

      {/* Mobile sidebar (drawer) */}
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="w-72 p-0 sm:w-80">
          {sidebar}
        </SheetContent>
      </Sheet>

      {/* Main panel */}
      <div className="flex min-w-0 flex-1 flex-col">
        <ChatHeader
          onToggleSidebar={toggleSidebar}
          onNewChat={startNewChat}
          onRename={(t) =>
            currentConversationId && handleRename(currentConversationId, t)
          }
          thinking={thinking}
        />

        <ChatMessages
          messages={messages}
          streamingContent={streamingContent}
          isStreaming={isStreaming}
          streamingRole="assistant"
          conversationId={currentConversationId}
          onPickSuggestion={(p) => sendMessage(p)}
          onRegenerate={regenerate}
        />

        {streamingError && (
          <div className="mx-auto mb-2 w-full max-w-3xl px-3 sm:px-4">
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Error: {streamingError}
            </div>
          </div>
        )}

        <ChatInput
          onSend={sendMessage}
          onStop={stopGeneration}
          isStreaming={isStreaming}
          thinking={thinking}
          onToggleThinking={setThinking}
          placeholder={
            currentConversationId
              ? "Message MiMo X…"
              : "Send a message to start a new chat…"
          }
        />
      </div>
    </div>
  )
}
