"use client"

/**
 * SelectionToolbar — floating context menu that appears when text is selected.
 *
 * Shows 8 actions (456-464):
 *   Explain (457) | Refactor (458) | Translate (459) | Summarize (460)
 *   Ask (461) | To Task (462) | To Note (463) | To Knowledge (464)
 *
 * Positioned at the selection's bounding rect.
 */

import * as React from "react"
import {
  Lightbulb, Wrench, Languages, FileText, MessageSquare,
  CheckSquare, StickyNote, Brain, X, Loader2, Copy, Check,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

interface SelectionToolbarProps {
  selectedText: string
  position: { x: number; y: number } | null
  onClose: () => void
  onSendToChat?: (prompt: string) => void
}

const ACTIONS: Array<{
  id: string
  label: string
  icon: React.ReactNode
  feature: number
  color: string
}> = [
  { id: "explain", label: "شرح", icon: <Lightbulb className="h-3.5 w-3.5" />, feature: 457, color: "text-amber-500" },
  { id: "refactor", label: "إعادة هيكلة", icon: <Wrench className="h-3.5 w-3.5" />, feature: 458, color: "text-blue-500" },
  { id: "translate", label: "ترجمة", icon: <Languages className="h-3.5 w-3.5" />, feature: 459, color: "text-purple-500" },
  { id: "summarize", label: "تلخيص", icon: <FileText className="h-3.5 w-3.5" />, feature: 460, color: "text-emerald-500" },
  { id: "ask", label: "سؤال", icon: <MessageSquare className="h-3.5 w-3.5" />, feature: 461, color: "text-orange-500" },
  { id: "to_task", label: "مهمة", icon: <CheckSquare className="h-3.5 w-3.5" />, feature: 462, color: "text-emerald-600" },
  { id: "to_note", label: "ملاحظة", icon: <StickyNote className="h-3.5 w-3.5" />, feature: 463, color: "text-amber-600" },
  { id: "to_knowledge", label: "معرفة", icon: <Brain className="h-3.5 w-3.5" />, feature: 464, color: "text-purple-600" },
]

export function SelectionToolbar({ selectedText, position, onClose, onSendToChat }: SelectionToolbarProps) {
  const [loading, setLoading] = React.useState<string | null>(null)
  const [askMode, setAskMode] = React.useState(false)
  const [askQuestion, setAskQuestion] = React.useState("")

  if (!position || !selectedText.trim()) return null

  const handleAction = async (actionId: string) => {
    if (actionId === "ask") {
      setAskMode(true)
      return
    }

    setLoading(actionId)
    try {
      const res = await fetch("/api/ux-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionId, text: selectedText }),
      })
      const data = await res.json()

      if (actionId === "to_task") {
        toast.success(`✅ تم إنشاء مهمة: ${data.title}`)
      } else if (actionId === "to_note") {
        toast.success(`📌 تم حفظ ملاحظة`)
      } else if (actionId === "to_knowledge") {
        toast.success(`🧠 تم حفظ كمعرفة: ${data.title}`)
      } else {
        // For text-processing actions, send to chat
        if (data.prompt && onSendToChat) {
          onSendToChat(data.prompt)
          toast.success(`تم إرسال ${data.action} للمحادثة`)
        }
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(null)
    }
  }

  const handleAsk = async () => {
    if (!askQuestion.trim()) return
    setLoading("ask")
    try {
      const res = await fetch("/api/ux-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ask", text: selectedText, question: askQuestion }),
      })
      const data = await res.json()
      if (data.prompt && onSendToChat) {
        onSendToChat(data.prompt)
        toast.success("تم إرسال السؤال للمحادثة")
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(null)
      setAskMode(false)
      setAskQuestion("")
    }
  }

  return (
    <div
      className="fixed z-50 animate-fade-up"
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      dir="rtl"
    >
      <div className="rounded-xl border border-border/60 bg-popover/95 backdrop-blur-md shadow-2xl p-2 min-w-[320px] max-w-[400px]">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-[0.7rem] font-semibold text-muted-foreground">
            إجراءات النص المحدد (456)
          </span>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onClose}>
            <X className="h-3 w-3" />
          </Button>
        </div>

        {/* Selected text preview */}
        <div className="mb-2 rounded-md bg-muted/30 p-1.5 max-h-20 overflow-y-auto">
          <p className="text-[0.65rem] text-muted-foreground line-clamp-3" dir="auto">
            {selectedText.slice(0, 200)}{selectedText.length > 200 ? "…" : ""}
          </p>
        </div>

        {/* Ask mode */}
        {askMode ? (
          <div className="space-y-2 mb-2">
            <Textarea
              value={askQuestion}
              onChange={(e) => setAskQuestion(e.target.value)}
              placeholder="اكتب سؤالك عن النص..."
              className="text-xs min-h-[60px]"
              autoFocus
              dir="rtl"
            />
            <div className="flex gap-1.5">
              <Button onClick={handleAsk} disabled={loading === "ask" || !askQuestion.trim()} size="sm" className="h-7 gap-1 text-xs flex-1">
                {loading === "ask" ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageSquare className="h-3 w-3" />}
                اسأل
              </Button>
              <Button onClick={() => setAskMode(false)} variant="ghost" size="sm" className="h-7 text-xs">
                إلغاء
              </Button>
            </div>
          </div>
        ) : (
          /* Action grid */
          <div className="grid grid-cols-4 gap-1">
            {ACTIONS.map(action => (
              <button
                key={action.id}
                onClick={() => handleAction(action.id)}
                disabled={loading !== null}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border border-transparent p-2 transition-all hover:border-border hover:bg-accent/40",
                  loading === action.id && "opacity-50"
                )}
                title={`${action.label} (#${action.feature})`}
              >
                {loading === action.id ? (
                  <Loader2 className={cn("h-4 w-4 animate-spin", action.color)} />
                ) : (
                  React.cloneElement(action.icon as React.ReactElement, { className: cn("h-4 w-4", action.color) })
                )}
                <span className="text-[0.6rem] font-medium">{action.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-2 pt-1.5 border-t border-border/40 flex items-center justify-between">
          <span className="text-[0.55rem] text-muted-foreground">
            {selectedText.length} حرف
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 gap-1 text-[0.6rem] px-1.5"
            onClick={() => {
              navigator.clipboard.writeText(selectedText)
              toast.success("نُسخ")
            }}
          >
            <Copy className="h-2.5 w-2.5" />
            نسخ
          </Button>
        </div>
      </div>
    </div>
  )
}
