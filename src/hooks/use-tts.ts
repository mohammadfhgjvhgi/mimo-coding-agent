'use client'
import * as React from 'react'
import { useEffect, useCallback, useRef, useState } from 'react'
import { speak as speakEngine, stopSpeak, pauseSpeak, resumeSpeak } from '@/lib/tts'
import type { TtsEngine, TtsOptions, TtsStatus } from '@/lib/tts/types'

// Lazy import Howl to avoid SSR issues
type HowlType = any
let HowlCtor: HowlType | null = null
async function getHowl(): Promise<HowlType> {
  if (!HowlCtor) {
    const mod = await import('howler')
    HowlCtor = mod.Howl
  }
  return HowlCtor
}

const globalState: { currentHowl: any | null; currentHookId: string | null; abortController: AbortController | null } = { currentHowl: null, currentHookId: null, abortController: null }
const stopListeners: Set<() => void> = new Set()
function subscribeStop(l: () => void) { stopListeners.add(l); return () => stopListeners.delete(l) }
function notifyStop() { stopListeners.forEach(l => { try { l() } catch {} }) }
function stopAllGlobal() {
  stopSpeak()
  if (globalState.currentHowl) { try { globalState.currentHowl.stop(); globalState.currentHowl.unload() } catch {} globalState.currentHowl = null }
  if (globalState.abortController) { try { globalState.abortController.abort() } catch {} globalState.abortController = null }
  globalState.currentHookId = null
}

let hookCounter = 0

export interface UseTtsOptions extends Omit<TtsOptions, 'onChunk' | 'signal'> {
  engine?: TtsEngine
  onStatusChange?: (s: TtsStatus) => void
  onError?: (e: Error) => void
  onEnd?: () => void
}
export interface UseTtsReturn {
  status: TtsStatus
  speak: (text: string, o?: Partial<TtsOptions>) => Promise<void>
  stop: () => void
  pause: () => void
  resume: () => void
  currentChunk: { text: string; lang: string; index: number; total: number } | null
}

export function useTts(options: UseTtsOptions = {}): UseTtsReturn {
  const [status, setStatus] = React.useState<TtsStatus>('idle')
  const [currentChunk, setCurrentChunk] = useState<UseTtsReturn['currentChunk']>(null)
  const hookIdRef = useRef(`tts-${++hookCounter}`)
  const onStatusChangeRef = useRef(options.onStatusChange)
  const onErrorRef = useRef(options.onError)
  const onEndRef = useRef(options.onEnd)

  useEffect(() => { onStatusChangeRef.current = options.onStatusChange }, [options.onStatusChange])
  useEffect(() => { onErrorRef.current = options.onError }, [options.onError])
  useEffect(() => { onEndRef.current = options.onEnd }, [options.onEnd])

  const updateStatus = useCallback((s: TtsStatus) => { setStatus(s); onStatusChangeRef.current?.(s) }, [])
  useEffect(() => subscribeStop(() => { setCurrentChunk(null); updateStatus('idle') }), [updateStatus])
  useEffect(() => { const hookId = hookIdRef.current; return () => { if (globalState.currentHookId === hookId) stopAllGlobal(); setCurrentChunk(null) } }, [])

  const speak = useCallback(async (text: string, override: Partial<TtsOptions> = {}) => {
    const hookId = hookIdRef.current
    stopAllGlobal(); notifyStop()
    globalState.currentHookId = hookId
    globalState.abortController = new AbortController()
    updateStatus('loading'); setCurrentChunk(null)
    try {
      const merged: TtsOptions = {
        engine: options.engine ?? 'auto', lang: options.lang ?? 'ar', voice: options.voice,
        rate: options.rate, pitch: options.pitch, volume: options.volume,
        mixedLanguage: options.mixedLanguage ?? true, signal: globalState.abortController.signal,
        onChunk: (chunk) => setCurrentChunk(chunk), ...override,
      }
      const result = await speakEngine(text, merged)
      if (globalState.abortController?.signal.aborted) { updateStatus('idle'); return }
      if (result.audioUrl) {
        const Howl = await getHowl()
        const howl = new Howl({
          src: [result.audioUrl], format: ['mp3'], html5: true, volume: merged.volume ?? 1.0, rate: merged.rate ?? 1.0,
          onplay: () => updateStatus('speaking'),
          onend: () => { updateStatus('idle'); setCurrentChunk(null); onEndRef.current?.(); try { URL.revokeObjectURL(result.audioUrl!) } catch {}; if (globalState.currentHowl === howl) { globalState.currentHowl = null; globalState.currentHookId = null } },
          onstop: () => { updateStatus('idle'); setCurrentChunk(null); try { URL.revokeObjectURL(result.audioUrl!) } catch {} },
          onpause: () => updateStatus('paused'),
          onloaderror: () => { updateStatus('error'); onErrorRef.current?.(new Error('Howler load error')); try { URL.revokeObjectURL(result.audioUrl!) } catch {} },
          onplayerror: () => { updateStatus('error'); onErrorRef.current?.(new Error('Howler play error')) },
        })
        globalState.currentHowl = howl
        howl.play()
      } else {
        updateStatus('speaking')
        const checkEnd = setInterval(() => {
          if (typeof window !== 'undefined' && 'speechSynthesis' in window && !window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
            clearInterval(checkEnd); updateStatus('idle'); setCurrentChunk(null); onEndRef.current?.()
            if (globalState.currentHookId === hookId) globalState.currentHookId = null
          }
        }, 500)
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') { console.error('[TTS] error:', err); updateStatus('error'); onErrorRef.current?.(err as Error) }
      else updateStatus('idle')
    }
  }, [options, updateStatus])

  const stop = useCallback(() => { stopAllGlobal(); notifyStop(); updateStatus('idle'); setCurrentChunk(null) }, [updateStatus])
  const pause = useCallback(() => { if (globalState.currentHowl) globalState.currentHowl.pause(); else { pauseSpeak(); updateStatus('paused') } }, [updateStatus])
  const resume = useCallback(() => { if (globalState.currentHowl) globalState.currentHowl.play(); else { resumeSpeak(); updateStatus('speaking') } }, [updateStatus])

  return { status, speak, stop, pause, resume, currentChunk }
}
