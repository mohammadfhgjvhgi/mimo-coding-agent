"use client"
import { create } from "zustand"
import type { TtsEngine } from "@/lib/tts/types"

const STORAGE_KEY = "mimo-x.tts-settings.v1"

export interface TtsSettings {
  engine: TtsEngine
  voice: string
  rate: number
  pitch: number
  volume: number
  mixedLanguage: boolean
}

const DEFAULTS: TtsSettings = { engine: "auto", voice: "ar-EG-SalmaNeural", rate: 1.05, pitch: 1.0, volume: 1.0, mixedLanguage: true }

interface TtsSettingsStore extends TtsSettings {
  loaded: boolean
  update: (patch: Partial<TtsSettings>) => void
  reset: () => void
  load: () => void
}

function persist(s: TtsSettings) { if (typeof window !== "undefined") { try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch {} } }

export const useTtsSettings = create<TtsSettingsStore>((set, get) => ({
  ...DEFAULTS, loaded: false,
  update: (patch) => { const next = { ...get(), ...patch }; set({ ...patch }); persist({ engine: next.engine, voice: next.voice, rate: next.rate, pitch: next.pitch, volume: next.volume, mixedLanguage: next.mixedLanguage }) },
  reset: () => { set({ ...DEFAULTS }); persist(DEFAULTS) },
  load: () => { if (typeof window === "undefined") return; try { const raw = window.localStorage.getItem(STORAGE_KEY); if (raw) { const parsed = JSON.parse(raw) as Partial<TtsSettings>; set({ ...DEFAULTS, ...parsed, loaded: true }); return } } catch {} set({ loaded: true }) },
}))

export function initTtsSettings() { useTtsSettings.getState().load() }
