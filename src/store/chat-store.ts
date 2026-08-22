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
  goalsRefreshSignal: number
  symbolsRefreshSignal: number
  sidebarTab: "conversations" | "explorer" | "memory" | "goals" | "symbols" | "skills" | "eval" | "smart_tools" | "editor" | "git" | "context" | "evidence" | "benchmarks" | "autonomous" | "security" | "reliability" | "autonomous_se"
  currentWorker: "cpu" | "gpu" | "zai" | null
  workerReason: string | null
  sidebarMode: "engineering" | "personal"
  chatMode: "engineering" | "assistant"
  // Chat features
  showThinking: boolean
  contextTokens: number
  contextBudget: number
  // Quick Action prefill — set by Home Quick Action buttons, consumed + cleared by ChatInput on mount.
  inputDraft: string | null
  selectedModel: string
  systemPrompt: string | null
  conversationFolder: string | null
  agentMode: string // "agent" | "plan" | "ask" | "debug" | "review" | "research" | "architect" | "refactor" | "security" | "performance"

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
  triggerGoalsRefresh: () => void
  triggerSymbolsRefresh: () => void
  setSidebarTab: (t: "conversations" | "explorer" | "memory" | "goals" | "symbols" | "skills" | "eval" | "smart_tools" | "editor" | "git" | "context" | "evidence" | "benchmarks" | "autonomous") => void
  setCurrentWorker: (w: "cpu" | "gpu" | "zai" | null, reason?: string | null) => void
  setSidebarMode: (m: "engineering" | "personal") => void
  setChatMode: (m: "engineering" | "assistant") => void
  setShowThinking: (v: boolean) => void
  setInputDraft: (s: string | null) => void
  setContextTokens: (n: number) => void
  setSelectedModel: (m: string) => void
  setSystemPrompt: (p: string | null) => void
  setConversationFolder: (f: string | null) => void
  setAgentMode: (m: string) => void

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
  goalsRefreshSignal: 0,
  symbolsRefreshSignal: 0,
  sidebarTab: "conversations",
  currentWorker: null,
  workerReason: null,
  sidebarMode: "engineering",
  chatMode: "engineering",
  showThinking: false,
  inputDraft: null,
  contextTokens: 0,
  contextBudget: 28000,
  selectedModel: "default",
  systemPrompt: null,
  conversationFolder: null,
  agentMode: "agent",

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
  triggerGoalsRefresh: () =>
    set((s) => ({ goalsRefreshSignal: s.goalsRefreshSignal + 1 })),
  triggerSymbolsRefresh: () =>
    set((s) => ({ symbolsRefreshSignal: s.symbolsRefreshSignal + 1 })),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  setCurrentWorker: (currentWorker, reason = null) =>
    set({ currentWorker, workerReason: reason }),
  setSidebarMode: (sidebarMode) => set({ sidebarMode }),
  setChatMode: (chatMode) => set({ chatMode }),
  setShowThinking: (showThinking) => set({ showThinking }),
  setInputDraft: (inputDraft) => set({ inputDraft }),
  setContextTokens: (contextTokens) => set({ contextTokens }),
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  setSystemPrompt: (systemPrompt) => set({ systemPrompt }),
  setConversationFolder: (conversationFolder) => set({ conversationFolder }),
  setAgentMode: (agentMode) => set({ agentMode }),

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
