"use client"

import { create } from "zustand"
import type { ProviderKind, ProviderSettings } from "@/lib/llm-provider"

const STORAGE_KEY = "mimo-x.settings.v1"

const DEFAULTS: ProviderSettings = {
  provider: "zai",
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "llama3.2",
  zaiThinking: false,
}

interface SettingsState extends ProviderSettings {
  loaded: boolean
  setProvider: (p: ProviderKind) => void
  setOllamaUrl: (u: string) => void
  setOllamaModel: (m: string) => void
  setZaiThinking: (v: boolean) => void
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
  setZaiThinking: (zaiThinking) => {
    set({ zaiThinking })
    persist(get())
  },
  load: () => {
    if (typeof window === "undefined") return
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ProviderSettings>
        set({ ...parsed, loaded: true })
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
      zaiThinking: s.zaiThinking,
    }
  },
}))
