"use client"

import { create } from "zustand"
import type { Conversation, ChatMessage, ToolCallRecord } from "@/types/chat"

interface ChatState {
  // Conversations
  conversations: Conversation[]
  currentConversationId: string | null
  loadingConversations: boolean

  // Messages
  messages: ChatMessage[]
  loadingMessages: boolean

  // Streaming
  isStreaming: boolean
  streamingContent: string
  streamingToolCalls: ToolCallRecord[]
  streamingError: string | null
  abortController: AbortController | null

  // UI
  sidebarOpen: boolean
  theme: "light" | "dark" | "system"
  activeFile: string | null
  explorerRefreshSignal: number
  memoryRefreshSignal: number
  sidebarTab: "conversations" | "explorer" | "memory"

  // Actions
  setConversations: (c: Conversation[]) => void
  setCurrentConversationId: (id: string | null) => void
  setLoadingConversations: (v: boolean) => void
  setMessages: (m: ChatMessage[]) => void
  setLoadingMessages: (v: boolean) => void
  setIsStreaming: (v: boolean) => void
  setStreamingContent: (c: string) => void
  appendStreamingContent: (c: string) => void
  addStreamingToolCall: (c: ToolCallRecord) => void
  resetStreamingToolCalls: () => void
  setStreamingError: (e: string | null) => void
  setAbortController: (c: AbortController | null) => void
  setSidebarOpen: (v: boolean) => void
  toggleSidebar: () => void
  setActiveFile: (f: string | null) => void
  triggerExplorerRefresh: () => void
  triggerMemoryRefresh: () => void
  setSidebarTab: (t: "conversations" | "explorer" | "memory") => void

  // Helpers
  upsertConversation: (c: Conversation) => void
  removeConversation: (id: string) => void
  addMessage: (m: ChatMessage) => void
}

export const useChatStore = create<ChatState>((set) => ({
  conversations: [],
  currentConversationId: null,
  loadingConversations: false,
  messages: [],
  loadingMessages: false,
  isStreaming: false,
  streamingContent: "",
  streamingToolCalls: [],
  streamingError: null,
  abortController: null,
  sidebarOpen: true,
  theme: "system",
  activeFile: null,
  explorerRefreshSignal: 0,
  memoryRefreshSignal: 0,
  sidebarTab: "conversations",

  setConversations: (conversations) => set({ conversations }),
  setCurrentConversationId: (currentConversationId) => set({ currentConversationId }),
  setLoadingConversations: (loadingConversations) => set({ loadingConversations }),
  setMessages: (messages) => set({ messages }),
  setLoadingMessages: (loadingMessages) => set({ loadingMessages }),
  setIsStreaming: (isStreaming) => set({ isStreaming }),
  setStreamingContent: (streamingContent) => set({ streamingContent }),
  appendStreamingContent: (chunk) =>
    set((s) => ({ streamingContent: s.streamingContent + chunk })),
  addStreamingToolCall: (call) =>
    set((s) => ({ streamingToolCalls: [...s.streamingToolCalls, call] })),
  resetStreamingToolCalls: () => set({ streamingToolCalls: [] }),
  setStreamingError: (streamingError) => set({ streamingError }),
  setAbortController: (abortController) => set({ abortController }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setActiveFile: (activeFile) => set({ activeFile }),
  triggerExplorerRefresh: () =>
    set((s) => ({ explorerRefreshSignal: s.explorerRefreshSignal + 1 })),
  triggerMemoryRefresh: () =>
    set((s) => ({ memoryRefreshSignal: s.memoryRefreshSignal + 1 })),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),

  upsertConversation: (c) =>
    set((s) => {
      const exists = s.conversations.find((x) => x.id === c.id)
      const list = exists
        ? s.conversations.map((x) => (x.id === c.id ? c : x))
        : [c, ...s.conversations]
      return { conversations: list }
    }),
  removeConversation: (id) =>
    set((s) => ({
      conversations: s.conversations.filter((x) => x.id !== id),
      currentConversationId:
        s.currentConversationId === id ? null : s.currentConversationId,
      messages: s.currentConversationId === id ? [] : s.messages,
    })),
  addMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
}))
