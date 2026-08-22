"use client"

import * as React from "react"
import { Volume2, VolumeX, Loader2, Pause, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useTts } from "@/hooks/use-tts"

export function TtsButton({ text }: { text: string }) {
  const tts = useTts({ voice: "ar-EG-SalmaNeural", rate: 1.05 })

  const handleSpeakToggle = async () => {
    if (tts.status === "speaking" || tts.status === "loading") {
      tts.stop()
      return
    }
    const cleaned = text.replace(/```[\s\S]*?```/g, " كود ").replace(/`[^`]+`/g, " ").replace(/[#*_~>|]/g, "").slice(0, 1000)
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
        title={isSpeaking ? "إيقاف" : "استمع"}
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
          className="h-7 gap-1 px-2 text-xs"
        >
          {isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
        </Button>
      )}
    </>
  )
}
