// MiMo AI — Zustand store for client state

"use client";

import { create } from "zustand";
import type {
  AgentDefinition,
  SkillDefinition,
  Conversation,
  Message,
  Task,
  Artifact,
  Memory,
  Decision,
  ExecutionLog,
  SystemState,
  StreamEvent,
  Project,
  ToolInfo,
} from "@/lib/ai-client";
import type { Locale } from "@/lib/i18n";
import { safeFetch, ApiError } from "@/lib/safe-fetch";

interface ActiveTool {
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  status: "starting" | "done" | "error";
  timestamp: number;
}

interface ActiveAgent {
  name: string;
  phase: string;
  timestamp: number;
}

type ThemeMode = "dark" | "light" | "system";

interface MimoStore {
  // ─── Data ────────────────────────────────────────────
  agents: AgentDefinition[];
  skills: SkillDefinition[];
  tools: ToolInfo[];
  projects: Project[];
  conversations: Conversation[];
  currentConversation: Conversation | null;
  currentProjectId: string | null;
  messages: Message[];
  tasks: Task[];
  artifacts: Artifact[];
  memories: Memory[];
  decisions: Decision[];
  executions: ExecutionLog[];
  systemState: SystemState | null;

  // ─── UI state ───────────────────────────────────────
  activePanel: "chat" | "tasks" | "agents" | "artifacts" | "memory" | "decisions" | "timeline" | "skills" | "tools" | "projects" | "files" | "terminal" | "knowledge" | "preview";
  autonomousMode: boolean;
  selectedAgent: string | null;
  isStreaming: boolean;
  streamingContent: string;
  activeTools: ActiveTool[];
  activeAgents: ActiveAgent[];
  activePreview: { url: string; artifactId: string; name?: string } | null;
  pendingPreview: { url: string; name: string } | null;
  error: string | null;
  skillSearchQuery: string;

  // ─── Settings (i18n + theme) ────────────────────────
  locale: Locale;
  theme: ThemeMode;
  commandPaletteOpen: boolean;
  settingsOpen: boolean;

  // ─── Setters ────────────────────────────────────────
  setActivePanel: (panel: MimoStore["activePanel"]) => void;
  setCurrentProjectId: (id: string | null) => void;
  setAutonomousMode: (on: boolean) => void;
  setSelectedAgent: (agent: string | null) => void;
  setSkillSearchQuery: (q: string) => void;
  setError: (err: string | null) => void;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: ThemeMode) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;

  // ─── Data loaders ───────────────────────────────────
  loadAgents: () => Promise<void>;
  loadSkills: (q?: string) => Promise<void>;
  loadTools: () => Promise<void>;
  loadProjects: () => Promise<void>;
  loadConversations: () => Promise<void>;
  loadSystemState: () => Promise<void>;
  loadConversation: (id: string) => Promise<void>;
  newConversation: () => void;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  togglePinConversation: (id: string, pinned: boolean) => Promise<void>;

  // ─── Streaming ──────────────────────────────────────
  startStreaming: () => void;
  appendDelta: (delta: string) => void;
  endStreaming: (finalContent: string) => void;
  resetStreaming: () => void;

  // ─── Event handlers (from SSE) ──────────────────────
  handleStreamEvent: (event: StreamEvent) => void;
}

export const useMimo = create<MimoStore>((set, get) => ({
  // ─── Data ───
  agents: [],
  skills: [],
  tools: [],
  projects: [],
  conversations: [],
  currentConversation: null,
  currentProjectId: null,
  messages: [],
  tasks: [],
  artifacts: [],
  memories: [],
  decisions: [],
  executions: [],
  systemState: null,

  // ─── UI ───
  activePanel: "chat",
  autonomousMode: false,
  selectedAgent: null,
  isStreaming: false,
  streamingContent: "",
  activeTools: [],
  activeAgents: [],
  activePreview: null,
  pendingPreview: null,
  error: null,
  skillSearchQuery: "",

  // ─── Settings defaults ───
  locale: "en",
  theme: "dark",
  commandPaletteOpen: false,
  settingsOpen: false,

  // ─── Setters ───
  setActivePanel: (panel) => set({ activePanel: panel }),
  setCurrentProjectId: (id) => set({ currentProjectId: id }),
  setAutonomousMode: (on) => set({ autonomousMode: on }),
  setSelectedAgent: (agent) => set({ selectedAgent: agent }),
  setSkillSearchQuery: (q) => set({ skillSearchQuery: q }),
  setError: (err) => set({ error: err }),
  setLocale: (locale) => set({ locale }),
  setTheme: (theme) => set({ theme }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  // ─── Data loaders (use safeFetch to handle server-down gracefully) ───
  loadAgents: async () => {
    try {
      const data = await safeFetch<{ agents: AgentDefinition[] }>("/api/agents");
      set({ agents: data.agents ?? [] });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to load agents";
      set({ error: msg });
    }
  },

  loadSkills: async (q) => {
    try {
      const url = q ? `/api/skills?q=${encodeURIComponent(q)}` : "/api/skills";
      const data = await safeFetch<{ skills: SkillDefinition[] }>(url);
      set({ skills: data.skills ?? [] });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to load skills";
      set({ error: msg });
    }
  },

  loadTools: async () => {
    try {
      const data = await safeFetch<{ tools: ToolInfo[] }>("/api/tools");
      set({ tools: data.tools ?? [] });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to load tools";
      set({ error: msg });
    }
  },

  loadProjects: async () => {
    try {
      const data = await safeFetch<{ projects: Project[] }>("/api/projects");
      set({ projects: data.projects ?? [] });
    } catch (err) {
      if (err instanceof ApiError && err.isServerDown) return;
      const msg = err instanceof ApiError ? err.message : "Failed to load projects";
      set({ error: msg });
    }
  },

  renameConversation: async (id, title) => {
    try {
      await safeFetch(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      // Update local state
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === id ? { ...c, title } : c
        ),
        currentConversation:
          s.currentConversation?.id === id
            ? { ...s.currentConversation, title }
            : s.currentConversation,
      }));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to rename";
      set({ error: msg });
    }
  },

  deleteConversation: async (id) => {
    try {
      await safeFetch(`/api/conversations/${id}`, { method: "DELETE" });
      set((s) => {
        const conversations = s.conversations.filter((c) => c.id !== id);
        const isCurrent = s.currentConversation?.id === id;
        return {
          conversations,
          currentConversation: isCurrent ? null : s.currentConversation,
          messages: isCurrent ? [] : s.messages,
          tasks: isCurrent ? [] : s.tasks,
          artifacts: isCurrent ? [] : s.artifacts,
          decisions: isCurrent ? [] : s.decisions,
          memories: isCurrent ? [] : s.memories,
          executions: isCurrent ? [] : s.executions,
        };
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to delete";
      set({ error: msg });
    }
  },

  togglePinConversation: async (id, pinned) => {
    try {
      await safeFetch(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned }),
      });
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === id ? { ...c, pinned } : c
        ),
      }));
    } catch {
      // non-fatal
    }
  },

  loadConversations: async () => {
    try {
      const data = await safeFetch<{ conversations: Conversation[] }>("/api/conversations");
      set({ conversations: data.conversations ?? [] });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to load conversations";
      // Don't overwrite error if it's just server-down noise
      if (err instanceof ApiError && err.isServerDown) return;
      set({ error: msg });
    }
  },

  loadSystemState: async () => {
    try {
      const data = await safeFetch<SystemState>("/api/state");
      set({ systemState: data });
    } catch (err) {
      // Silent fail for periodic state refresh — don't spam errors
      if (err instanceof ApiError && err.isServerDown) return;
    }
  },

  loadConversation: async (id) => {
    try {
      const data = await safeFetch<{ conversation: Conversation & {
        messages: Message[];
        tasks: Task[];
        artifacts: Artifact[];
        decisions: Decision[];
        memories: Memory[];
        executions: ExecutionLog[];
      } }>(`/api/conversations/${id}`);
      const conv = data.conversation;
      set({
        currentConversation: conv,
        messages: conv.messages ?? [],
        tasks: conv.tasks ?? [],
        artifacts: conv.artifacts ?? [],
        decisions: conv.decisions ?? [],
        memories: conv.memories ?? [],
        executions: conv.executions ?? [],
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to load conversation" });
    }
  },

  newConversation: () => {
    set({
      currentConversation: null,
      currentProjectId: null,
      messages: [],
      tasks: [],
      artifacts: [],
      decisions: [],
      memories: [],
      executions: [],
      activeTools: [],
      activeAgents: [],
      streamingContent: "",
      isStreaming: false,
    });
  },

  // ─── Streaming ───
  startStreaming: () =>
    set({ isStreaming: true, streamingContent: "", activeTools: [], activeAgents: [], pendingPreview: null }),

  appendDelta: (delta) =>
    set((s) => ({ streamingContent: s.streamingContent + delta })),

  endStreaming: (finalContent) =>
    set((s) => {
      if (!finalContent) {
        return { isStreaming: false, streamingContent: "", pendingPreview: null };
      }
      // Prevent duplicate messages with same content
      const lastMsg = s.messages[s.messages.length - 1];
      if (lastMsg && lastMsg.role === "assistant" && lastMsg.content === finalContent) {
        return { isStreaming: false, streamingContent: "", pendingPreview: null };
      }
      const preview = s.pendingPreview;
      return {
        isStreaming: false,
        streamingContent: "",
        pendingPreview: null,
        messages: [
          ...s.messages,
          {
            id: `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            conversationId: s.currentConversation?.id ?? "",
            role: "assistant" as const,
            content: finalContent,
            agentName: null,
            toolName: null,
            tokenInput: 0,
            tokenOutput: 0,
            durationMs: 0,
            createdAt: new Date().toISOString(),
            previewUrl: preview?.url ?? null,
            previewName: preview?.name ?? null,
          },
        ],
      };
    }),

  resetStreaming: () =>
    set({ isStreaming: false, streamingContent: "", activeTools: [], activeAgents: [] }),

  // ─── Event handlers ───
  handleStreamEvent: (event) => {
    const state = get();
    switch (event.type) {
      case "start": {
        const conversationId = event.conversationId as string | undefined;
        if (conversationId && !state.currentConversation) {
          // New conversation created — refresh list
          get().loadConversations();
          // Find and set it (use safeFetch)
          safeFetch<{ conversations: Conversation[] }>("/api/conversations")
            .then((data) => {
              const conv = (data.conversations ?? []).find(
                (c: Conversation) => c.id === conversationId
              );
              if (conv) set({ currentConversation: conv });
            })
            .catch(() => {});
        }
        if (event.agent) {
          set({
            activeAgents: [
              { name: event.agent as string, phase: "start", timestamp: Date.now() },
            ],
          });
        }
        break;
      }
      case "delta": {
        const delta = event.content as string;
        if (delta) get().appendDelta(delta);
        break;
      }
      case "agent": {
        const agent = event.agent as string;
        const phase = event.phase as string;
        if (agent) {
          set((s) => ({
            activeAgents: [
              ...s.activeAgents.filter((a) => a.name !== agent && a.name !== "thinking"),
              { name: agent, phase, timestamp: Date.now() },
            ],
          }));
        }
        break;
      }
      case "tool": {
        const name = event.name as string;
        const input = (event.input as Record<string, unknown>) ?? {};
        const output = event.output;
        const error = event.error as string | undefined;
        const status = event.status as ActiveTool["status"];
        if (name) {
          set((s) => {
            const existing = s.activeTools.find((t) => t.name === name && t.status === "starting");
            if (existing && status !== "starting") {
              return {
                activeTools: s.activeTools.map((t) =>
                  t === existing ? { ...t, output, error, status } : t
                ),
              };
            }
            if (status === "starting") {
              return {
                activeTools: [
                  ...s.activeTools,
                  { name, input, output, error, status, timestamp: Date.now() },
                ],
              };
            }
            return {
              activeTools: [
                ...s.activeTools,
                { name, input, output, error, status, timestamp: Date.now() },
              ],
            };
          });
        }
        break;
      }
      case "memory": {
        // Refresh memories
        const convId = state.currentConversation?.id;
        if (convId) {
          safeFetch<{ memories: Memory[] }>(`/api/memory?conversationId=${convId}`)
            .then((data) => set({ memories: data.memories ?? [] }))
            .catch(() => {});
        }
        break;
      }
      case "artifact": {
        const convId = state.currentConversation?.id;
        if (convId) {
          safeFetch<{ artifacts: Artifact[] }>(`/api/artifacts?conversationId=${convId}`)
            .then((data) => set({ artifacts: data.artifacts ?? [] }))
            .catch(() => {});
        }
        // If artifact is previewable, set pendingPreview for INLINE display in chat
        // Do NOT auto-switch to preview panel — user stays in chat and sees it inline
        if (event.previewable && event.id) {
          const previewUrl = `/api/preview/${event.id}`;
          const previewName = (event.name as string) ?? "Preview";
          set({
            pendingPreview: { url: previewUrl, name: previewName },
            activePreview: {
              url: previewUrl,
              artifactId: event.id as string,
              name: previewName,
            },
          });
        }
        break;
      }
      case "preview": {
        const artifactId = event.artifactId as string;
        const url = event.url as string;
        if (artifactId && url) {
          const previewName = (event.name as string) ?? "Preview";
          set({
            pendingPreview: { url, name: previewName },
            activePreview: { url, artifactId, name: previewName },
          });
        }
        break;
      }
      case "task": {
        const convId = state.currentConversation?.id;
        const phase = event.phase as string;
        
        // When a task completes during autonomous mode, save the streamed content
        // as a message before clearing for the next task
        if (phase === "completed" || phase === "failed") {
          const currentStreaming = get().streamingContent;
          const currentPreview = get().pendingPreview;
          if (currentStreaming && currentStreaming.trim().length > 10) {
            const taskId = event.taskId as string;
            const agentName = event.agent as string;
            set((s) => ({
              streamingContent: "",
              pendingPreview: null,
              messages: [
                ...s.messages,
                {
                  id: `task-${taskId ?? Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  conversationId: s.currentConversation?.id ?? "",
                  role: "assistant" as const,
                  content: currentStreaming,
                  agentName: agentName ?? null,
                  toolName: null,
                  tokenInput: 0,
                  tokenOutput: 0,
                  durationMs: 0,
                  createdAt: new Date().toISOString(),
                  previewUrl: currentPreview?.url ?? null,
                  previewName: currentPreview?.name ?? null,
                },
              ],
            }));
          } else {
            set({ streamingContent: "", pendingPreview: null });
          }
        }
        
        if (convId) {
          safeFetch<{ tasks: Task[] }>(`/api/tasks?conversationId=${convId}`)
            .then((data) => set({ tasks: data.tasks ?? [] }))
            .catch(() => {});
        }
        break;
      }
      case "decision": {
        const convId = state.currentConversation?.id;
        if (convId) {
          safeFetch<{ decisions: Decision[] }>(`/api/decisions?conversationId=${convId}`)
            .then((data) => set({ decisions: data.decisions ?? [] }))
            .catch(() => {});
        }
        break;
      }
      case "end": {
        const content = event.content as string | undefined;
        const summary = event.summary as string | undefined;
        if (content) {
          // Non-autonomous: save the streamed content as a message
          get().endStreaming(content);
        } else if (summary) {
          // Autonomous mode: first save any remaining streamed content, then add summary
          const remainingContent = get().streamingContent;
          const remainingPreview = get().pendingPreview;
          
          const summaryId = `summary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          set((s) => {
            const newMessages = [...s.messages];
            
            // If there's remaining streamed content, save it as a task message first
            if (remainingContent && remainingContent.trim().length > 10) {
              newMessages.push({
                id: `task-final-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                conversationId: s.currentConversation?.id ?? "",
                role: "assistant" as const,
                content: remainingContent,
                agentName: null,
                toolName: null,
                tokenInput: 0,
                tokenOutput: 0,
                durationMs: 0,
                createdAt: new Date().toISOString(),
                previewUrl: remainingPreview?.url ?? null,
                previewName: remainingPreview?.name ?? null,
              });
            }
            
            // Then add the mission summary
            newMessages.push({
              id: summaryId,
              conversationId: s.currentConversation?.id ?? "",
              role: "assistant" as const,
              content: summary,
              agentName: "orchestrator",
              toolName: null,
              tokenInput: 0,
              tokenOutput: 0,
              durationMs: 0,
              createdAt: new Date().toISOString(),
            });
            
            return {
              isStreaming: false,
              streamingContent: "",
              pendingPreview: null,
              messages: newMessages,
              activeAgents: [],
            };
          });
        } else {
          get().endStreaming("");
        }
        // Refresh metadata WITHOUT overwriting messages (which were just added)
        // Only refresh tasks, artifacts, decisions — not messages
        // FIX: Guard against stale convId — only apply results if conversation hasn't changed
        const convId = state.currentConversation?.id;
        if (convId) {
          setTimeout(() => {
            // Guard: only apply results if we're still on the same conversation
            if (get().currentConversation?.id !== convId) return;
            safeFetch<{ tasks: Task[] }>(`/api/tasks?conversationId=${convId}`)
              .then((data) => {
                if (get().currentConversation?.id === convId) set({ tasks: data.tasks ?? [] });
              })
              .catch(() => {});
            safeFetch<{ artifacts: Artifact[] }>(`/api/artifacts?conversationId=${convId}`)
              .then((data) => {
                if (get().currentConversation?.id === convId) set({ artifacts: data.artifacts ?? [] });
              })
              .catch(() => {});
            safeFetch<{ decisions: Decision[] }>(`/api/decisions?conversationId=${convId}`)
              .then((data) => {
                if (get().currentConversation?.id === convId) set({ decisions: data.decisions ?? [] });
              })
              .catch(() => {});
            safeFetch<{ memories: Memory[] }>(`/api/memory?conversationId=${convId}`)
              .then((data) => {
                if (get().currentConversation?.id === convId) set({ memories: data.memories ?? [] });
              })
              .catch(() => {});
          }, 800);
        }
        // Refresh state and conversations list (non-blocking, suppress errors)
        setTimeout(() => {
          get().loadSystemState();
          get().loadConversations();
        }, 1000);
        break;
      }
      case "error": {
        const msg = (event.message as string) ?? "Unknown error";
        set({ error: msg, isStreaming: false, streamingContent: "" });
        break;
      }
    }
  },
}));
