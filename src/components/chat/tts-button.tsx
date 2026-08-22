"use client"

import * as React from "react"
import { Volume2, VolumeX, Loader2, Pause, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useTts } from "@/hooks/use-tts"
import { useTtsSettings } from "@/store/tts-settings-store"
import { sanitizeForTts } from "@/lib/tts/mixed-language"

// Lazy-loaded TTS button — only initializes the useTts hook when mounted
// This prevents crashes if TTS dependencies fail to load
export function TtsButton({ text }: { text: string }) {
  const { engine, voice, rate, pitch, mixedLanguage } = useTtsSettings()

  const tts = useTts({
    engine,
    voice,
    rate,
    pitch,
    mixedLanguage,
    onError: (err) => console.warn("[TTS]", err.message),
  })

  const handleSpeakToggle = async () => {
    if (tts.status === "speaking" || tts.status === "loading") {
      tts.stop()
      return
    }
    const cleaned = sanitizeForTts(text).slice(0, 1500)
    if (!cleaned.trim()) return
    await tts.speak(cleaned)
  }

  const isSpeaking = tts.status === "speaking"
  const isLoading = tts.status === "loading"
  const isPaused = tts.status === "paused"

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleSpeakToggle}
        className={cn(
          "h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/60",
          (isSpeaking || isLoading) && "text-primary hover:text-primary"
        )}
        title={isSpeaking ? "إيقاف / Stop" : "استمع / Listen"}
      >
        {isLoading ? (
          <><Loader2 className="h-3 w-3 animate-spin" /> تحميل…</>
        ) : isSpeaking ? (
          <><VolumeX className="h-3 w-3 text-red-500" /> إيقاف</>
        ) : (
          <><Volume2 className="h-3 w-3" /> استمع</>
        )}
      </Button>
      {(isSpeaking || isPaused) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => isPaused ? tts.resume() : tts.pause()}
          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/60"
          title={isPaused ? "استئناف" : "إيقاف مؤقت"}
        >
          {isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
        </Button>
      )}
    </>
  )
}
