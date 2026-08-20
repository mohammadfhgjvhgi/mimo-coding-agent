"use client"

import * as React from "react"
import { ArrowUp, Square, Brain, Paperclip, Loader2, Mic, MicOff, ImagePlus } from "lucide-react"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface ChatInputProps {
  onSend: (message: string) => void
  onStop?: () => void
  isStreaming: boolean
  thinking: boolean
  onToggleThinking: (v: boolean) => void
  disabled?: boolean
  placeholder?: string
  showThinkingToggle?: boolean
}

export function ChatInput({
  onSend,
  onStop,
  isStreaming,
  thinking,
  onToggleThinking,
  disabled,
  placeholder,
  showThinkingToggle = true,
}: ChatInputProps) {
  const [value, setValue] = React.useState("")
  const [uploading, setUploading] = React.useState(false)
  const [recording, setRecording] = React.useState(false)
  const [transcribing, setTranscribing] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const imageInputRef = React.useRef<HTMLInputElement>(null)
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null)
  const audioChunksRef = React.useRef<Blob[]>([])

  React.useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 220) + "px"
  }, [value])

  const submit = () => {
    const text = value.trim()
    if (!text || isStreaming) return
    onSend(text)
    setValue("")
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) el.style.height = "auto"
    })
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("ingest", "true")
      const res = await fetch("/api/upload", { method: "POST", body: formData })
      const data = await res.json()
      if (data.error) {
        // Use sonner toast if available, otherwise alert
        console.error("Upload error:", data.error)
      } else {
        // Insert file reference into the textarea
        const ref = `\n[📎 ${data.filename} — ${data.ingest?.chunks || 0} chunks ingested]`
        setValue((prev) => prev + ref)
      }
    } catch (e) {
      console.error("Upload failed:", e)
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  // --- Voice recording (push-to-talk) ---
  const toggleRecording = async () => {
    if (recording) {
      mediaRecorderRef.current?.stop()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      audioChunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" })
        const reader = new FileReader()
        reader.onload = async () => {
          const base64 = (reader.result as string).split(",")[1]
          setTranscribing(true)
          try {
            const res = await fetch("/api/voice/stt", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ audioBase64: base64 }),
            })
            const data = await res.json()
            if (data.text) {
              setValue(prev => prev + (prev ? " " : "") + data.text)
            }
          } catch { /* ignore */ }
          finally { setTranscribing(false) }
        }
        reader.readAsDataURL(blob)
      }
      recorder.start()
      mediaRecorderRef.current = recorder
      setRecording(true)
    } catch {
      // Mic permission denied
    }
  }

  // --- Image upload for vision analysis ---
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1]
      setValue(prev => prev + (prev ? "\n" : "") + `[📷 ${file.name} — أرسل للتحليل المرئي]`)
      // Store base64 in a data attribute for the agent to pick up
      if (textareaRef.current) {
        textareaRef.current.dataset.imageBase64 = base64
      }
    }
    reader.readAsDataURL(file)
    if (imageInputRef.current) imageInputRef.current.value = ""
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-3 sm:px-4">
      <div className="relative flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm transition focus-within:border-primary/40 focus-within:shadow-md">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileUpload}
          accept=".txt,.md,.js,.ts,.tsx,.jsx,.py,.json,.csv,.html,.yaml,.yml,.pdf,.docx,.pptx,.xlsx"
        />
        <input
          ref={imageInputRef}
          type="file"
          className="hidden"
          onChange={handleImageUpload}
          accept="image/*"
        />
        <TooltipProvider delayDuration={250}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="h-9 w-9 shrink-0 rounded-xl text-muted-foreground"
                aria-label="رفع ملف"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>رفع ملف</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Image upload for vision */}
        <TooltipProvider delayDuration={250}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => imageInputRef.current?.click()}
                className="h-9 w-9 shrink-0 rounded-xl text-muted-foreground"
                aria-label="رفع صورة"
              >
                <ImagePlus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>رفع صورة للتحليل المرئي / Upload image for vision</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Voice recording (push-to-talk) */}
        <TooltipProvider delayDuration={250}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={toggleRecording}
                disabled={transcribing}
                className={cn(
                  "h-9 w-9 shrink-0 rounded-xl",
                  recording ? "text-red-500 bg-red-500/10 animate-pulse" : "text-muted-foreground"
                )}
                aria-label="تسجيل صوتي"
              >
                {transcribing ? <Loader2 className="h-4 w-4 animate-spin" /> : recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {recording ? "جارٍ التسجيل — اضغط للإيقاف / Recording — click to stop" : "تسجيل صوتي / Voice input"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || "أرسل رسالة…"}
          rows={1}
          disabled={disabled}
          className="min-h-[40px] flex-1 resize-none border-0 bg-transparent px-1 py-2 text-[0.95rem] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/70"
        />

        {showThinkingToggle && (
        <TooltipProvider delayDuration={250}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onToggleThinking(!thinking)}
                className={cn(
                  "h-9 w-9 shrink-0 rounded-xl",
                  thinking
                    ? "text-amber-500 hover:text-amber-600"
                    : "text-muted-foreground"
                )}
                aria-label="تفعيل التفكير"
              >
                <Brain className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {thinking ? "التفكير: مُفعّل" : "التفكير: مُعطّل"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        )}

        {isStreaming ? (
          <Button
            type="button"
            size="icon"
            onClick={onStop}
            className="h-9 w-9 shrink-0 rounded-xl"
            aria-label="إيقاف التوليد"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            onClick={submit}
            disabled={!value.trim() || disabled}
            className="h-9 w-9 shrink-0 rounded-xl"
            aria-label="إرسال الرسالة"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        )}
      </div>
      <p className="mt-2 text-center text-[0.7rem] text-muted-foreground">
        قد يخطئ MiMo X. تحقّق من المعلومات المهمة. اضغط{" "}
        <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[0.65rem]">
          Enter
        </kbd>{" "}
        للإرسال،{" "}
        <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[0.65rem]">
          Shift + Enter
        </kbd>{" "}
        لسطر جديد.
      </p>
    </div>
  )
}
