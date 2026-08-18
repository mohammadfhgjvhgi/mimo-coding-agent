"use client"

import { create } from "zustand"
import type { ProviderKind, ProviderSettings, WorkerKind } from "@/lib/llm-provider"

const STORAGE_KEY = "mimo-x.settings.v1"

const DEFAULTS: ProviderSettings = {
  provider: "zai",
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "llama3.2",
  cpuWorkerUrl: "http://localhost:8002",
  cpuWorkerModel: "qwen3:4b",
  gpuWorkerUrl: "http://localhost:8001",
  gpuWorkerModel: "qwen2.5-coder:7b",
  routerMode: "auto",
  zaiThinking: false,
  githubToken: "",
  mcpServers: [],
}

interface SettingsState extends ProviderSettings {
  loaded: boolean
  setProvider: (p: ProviderKind) => void
  setOllamaUrl: (u: string) => void
  setOllamaModel: (m: string) => void
  setCpuWorkerUrl: (u: string) => void
  setCpuWorkerModel: (m: string) => void
  setGpuWorkerUrl: (u: string) => void
  setGpuWorkerModel: (m: string) => void
  setRouterMode: (m: "auto" | "cpu" | "gpu") => void
  setZaiThinking: (v: boolean) => void
  setGithubToken: (t: string) => void
  setMcpServers: (s: { name: string; url: string }[]) => void
  load: () => void
  snapshot: () => ProviderSettings
}

function persist(s: ProviderSettings) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  loaded: false,
  setProvider: (provider) => {
    set({ provider })
    persist(get())
  },
  setOllamaUrl: (ollamaUrl) => {
    set({ ollamaUrl })
    persist(get())
  },
  setOllamaModel: (ollamaModel) => {
    set({ ollamaModel })
    persist(get())
  },
  setCpuWorkerUrl: (cpuWorkerUrl) => {
    set({ cpuWorkerUrl })
    persist(get())
  },
  setCpuWorkerModel: (cpuWorkerModel) => {
    set({ cpuWorkerModel })
    persist(get())
  },
  setGpuWorkerUrl: (gpuWorkerUrl) => {
    set({ gpuWorkerUrl })
    persist(get())
  },
  setGpuWorkerModel: (gpuWorkerModel) => {
    set({ gpuWorkerModel })
    persist(get())
  },
  setRouterMode: (routerMode) => {
    set({ routerMode })
    persist(get())
  },
  setZaiThinking: (zaiThinking) => {
    set({ zaiThinking })
    persist(get())
  },
  setGithubToken: (githubToken) => {
    set({ githubToken })
    persist(get())
  },
  setMcpServers: (mcpServers) => {
    set({ mcpServers })
    persist(get())
  },
  load: () => {
    if (typeof window === "undefined") return
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ProviderSettings>
        set({ ...DEFAULTS, ...parsed, loaded: true })
        return
      }
    } catch {
      /* ignore */
    }
    set({ loaded: true })
  },
  snapshot: () => {
    const s = get()
    return {
      provider: s.provider,
      ollamaUrl: s.ollamaUrl,
      ollamaModel: s.ollamaModel,
      cpuWorkerUrl: s.cpuWorkerUrl,
      cpuWorkerModel: s.cpuWorkerModel,
      gpuWorkerUrl: s.gpuWorkerUrl,
      gpuWorkerModel: s.gpuWorkerModel,
      routerMode: s.routerMode,
      zaiThinking: s.zaiThinking,
      githubToken: s.githubToken,
      mcpServers: s.mcpServers,
    }
  },
}))

// Re-export for convenience
export type { WorkerKind }
export const WORKER_LABELS: Record<WorkerKind | "zai", string> = {
  cpu: "CPU Worker",
  gpu: "GPU Worker",
  zai: "Z.ai سحابي",
}
