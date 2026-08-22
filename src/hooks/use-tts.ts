'use client'
// use-tts.ts — NO howler dependency. Uses native <audio> + Web Speech API only.

import * as React from 'react'

export type TtsStatus = 'idle' | 'loading' | 'speaking' | 'paused' | 'error'

export interface UseTtsOptions {
  engine?: string
  voice?: string
  rate?: number
  pitch?: number
  volume?: number
  mixedLanguage?: boolean
}

export interface UseTtsReturn {
  status: TtsStatus
  speak: (text: string) => Promise<void>
  stop: () => void
  pause: () => void
  resume: () => void
}

let currentAudio: HTMLAudioElement | null = null

export function useTts(options: UseTtsOptions = {}): UseTtsReturn {
  const [status, setStatus] = React.useState<TtsStatus>('idle')

  const stop = React.useCallback(() => {
    if (currentAudio) {
      currentAudio.pause()
      currentAudio = null
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    setStatus('idle')
  }, [])

  const speak = React.useCallback(async (text: string) => {
    // Stop any current playback
    if (currentAudio) { currentAudio.pause(); currentAudio = null }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }

    if (!text.trim()) return
    setStatus('loading')

    const isArabic = /[\u0600-\u06FF]/.test(text)

    try {
      if (isArabic) {
        // Use Edge TTS for Arabic (via API)
        const res = await fetch('/api/voice/tts/edge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: text.slice(0, 1000),
            voice: options.voice || 'ar-EG-SalmaNeural',
            rate: `${Math.round(((options.rate ?? 1.05) - 1) * 100)}%`,
            pitch: '+0Hz',
          }),
        })

        if (!res.ok) throw new Error(`TTS failed: ${res.status}`)
        
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        currentAudio = audio

        audio.onplay = () => setStatus('speaking')
        audio.onended = () => { setStatus('idle'); URL.revokeObjectURL(url); currentAudio = null }
        audio.onerror = () => { setStatus('error'); URL.revokeObjectURL(url); currentAudio = null }

        await audio.play()
      } else {
        // Use Web Speech API for non-Arabic
        if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
          throw new Error('Web Speech API not available')
        }

        const utterance = new SpeechSynthesisUtterance(text)
        utterance.lang = 'en-US'
        utterance.rate = options.rate ?? 1.0
        utterance.onstart = () => setStatus('speaking')
        utterance.onend = () => setStatus('idle')
        utterance.onerror = () => setStatus('error')
        window.speechSynthesis.speak(utterance)
      }
    } catch (e) {
      console.warn('[TTS] error:', e)
      setStatus('error')
    }
  }, [options.voice, options.rate])

  const pause = React.useCallback(() => {
    if (currentAudio) { currentAudio.pause(); setStatus('paused') }
    else if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.pause(); setStatus('paused')
    }
  }, [])

  const resume = React.useCallback(() => {
    if (currentAudio) { currentAudio.play(); setStatus('speaking') }
    else if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.resume(); setStatus('speaking')
    }
  }, [])

  React.useEffect(() => {
    return () => {
      if (currentAudio) { currentAudio.pause(); currentAudio = null }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  return { status, speak, stop, pause, resume }
}
