"use client"

/**
 * UXActionsPanel — Advanced UX OS UI (spec section 34, features 454-464).
 *
 * 3 tabs:
 *  1. Quick Actions (454) — ready-made AI commands
 *  2. Selection Actions (456) — test selection actions
 *  3. Inline AI (455) — test inline suggestions
 */

import * as React from "react"
import {
  Zap, Lightbulb, Wrench, Languages, FileText, MessageSquare,
  CheckSquare, StickyNote, Brain, RefreshCw, Loader2, Copy, Check,
  Send, Code2, Activity,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  analysis: <Activity className="h-3.5 w-3.5 text-amber-500" />,
  writing: <FileText className="h-3.5 w-3.5 text-purple-500" />,
  code: <Code2 className="h-3.5 w-3.5 text-blue-500" />,
  convert: <CheckSquare className="h-3.5 w-3.5 text-emerald-500" />,
}

const ACTION_ICONS: Record<string, React.ReactNode> = {
  explain: <Lightbulb className="h-3.5 w-3.5" />,
  summarize: <FileText className="h-3.5 w-3.5" />,
  translate: <Languages className="h-3.5 w-3.5" />,
  refactor: <Wrench className="h-3.5 w-3.5" />,
  review: <Check className="h-3.5 w-3.5" />,
  test: <Zap className="h-3.5 w-3.5" />,
  docs: <FileText className="h-3.5 w-3.5" />,
  task: <CheckSquare className="h-3.5 w-3.5" />,
  note: <StickyNote className="h-3.5 w-3.5" />,
  knowledge: <Brain className="h-3.5 w-3.5" />,
}

export function UXActionsPanel() {
  const [tab, setTab] = React.useState("quick")

  return (
    <div className="flex h-full flex-col" dir="rtl">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">UX متقدم / Advanced UX</span>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 min-h-0 flex-col">
        <TabsList className="grid w-full grid-cols-3 rounded-none border-b border-border bg-transparent p-0">
          <TabsTrigger value="quick" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            أوامر سريعة
          </TabsTrigger>
          <TabsTrigger value="selection" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            تحديد
          </TabsTrigger>
          <TabsTrigger value="inline" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            Inline AI
          </TabsTrigger>
        </TabsList>

        <TabsContent value="quick" className="m-0 flex-1 min-h-0 overflow-hidden">
          <QuickActionsTab />
        </TabsContent>
        <TabsContent value="selection" className="m-0 flex-1 min-h-0 overflow-hidden">
          <SelectionTestTab />
        </TabsContent>
        <TabsContent value="inline" className="m-0 flex-1 min-h-0 overflow-hidden">
          <InlineAITab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── Tab 1: Quick Actions (454) ───

function QuickActionsTab() {
  const [actions, setActions] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/ux-actions")
      const data = await res.json()
      setActions(data ?? [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  const categories = [...new Set(actions.map(a => a.category))]

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">أوامر AI سريعة / Quick AI Actions (454)</h3>
          <p className="text-[0.7rem] text-muted-foreground mt-0.5">
            10 أوامر جاهزة مع اختصارات لوحة المفاتيح
          </p>
        </div>

        {loading ? (
          <div className="text-center text-xs text-muted-foreground py-8">
            <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
          </div>
        ) : (
          categories.map(cat => (
            <div key={cat} className="space-y-1">
              <div className="flex items-center gap-1.5 text-[0.7rem] font-semibold text-muted-foreground mb-1">
                {CATEGORY_ICONS[cat]}
                <span>{cat}</span>
              </div>
              {actions.filter(a => a.category === cat).map(action => (
                <div key={action.id} className="rounded-md border border-border/60 bg-card/50 p-2 flex items-center gap-2">
                  <span className="text-base">{action.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">{action.label}</p>
                    {action.prompt && (
                      <p className="text-[0.6rem] text-muted-foreground truncate">
                        {action.prompt.slice(0, 60)}…
                      </p>
                    )}
                  </div>
                  <Badge variant="outline" className="text-[0.5rem] py-0 font-mono">
                    {action.shortcut}
                  </Badge>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </ScrollArea>
  )
}

// ─── Tab 2: Selection Actions (456-464) ───

function SelectionTestTab() {
  const [text, setText] = React.useState("// Example: function to check palindrome\nfunction isPalindrome(str) {\n  const reversed = str.split('').reverse().join('')\n  return str === reversed\n}")
  const [availableActions, setAvailableActions] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState<string | null | boolean>(false)
  const [result, setResult] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)

  const handleCheck = async () => {
    if (!text.trim()) return
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch("/api/ux-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "selection_actions", text }),
      })
      const data = await res.json()
      setAvailableActions(data.actions ?? [])
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const handleAction = async (actionId: string) => {
    setLoading(actionId)
    setResult(null)
    try {
      const res = await fetch("/api/ux-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionId, text }),
      })
      const data = await res.json()

      if (actionId === "to_task") {
        toast.success(`✅ تم إنشاء مهمة: ${data.title}`)
      } else if (actionId === "to_note") {
        toast.success(`📌 تم حفظ ملاحظة`)
      } else if (actionId === "to_knowledge") {
        toast.success(`🧠 تم حفظ كمعرفة`)
      } else if (data.prompt) {
        setResult(data.prompt)
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-3 py-2">
        <span className="text-xs font-semibold">إجراءات التحديد / Selection Actions (456-464)</span>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-3">
          <div>
            <label className="text-xs font-medium mb-1 block">النص المحدد:</label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="اكتب أو الصق نصاً للاختبار..."
              className="text-xs font-mono min-h-[100px]"
              dir="auto"
            />
          </div>

          <Button onClick={handleCheck} disabled={!!loading as any} size="sm" className="w-full h-7 text-xs gap-1">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            افحص الإجراءات المتاحة
          </Button>

          {availableActions.length > 0 && (
            <div className="space-y-1">
              <p className="text-[0.7rem] font-semibold text-muted-foreground mb-1">الإجراءات المتاحة:</p>
              {availableActions.map(action => {
                const icon = ACTION_ICONS[action.id] ?? <Activity className="h-3.5 w-3.5" />
                return (
                  <button
                    key={action.id}
                    onClick={() => handleAction(action.id)}
                    disabled={!action.available || loading !== null}
                    className={cn(
                      "w-full rounded-md border p-2 flex items-center gap-2 transition-colors",
                      action.available
                        ? "border-border/60 bg-card/50 hover:bg-accent/40"
                        : "border-border/30 bg-muted/10 opacity-50 cursor-not-allowed"
                    )}
                  >
                    {loading === action.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
                    <div className="flex-1 text-right">
                      <p className="text-xs font-medium">{action.label}</p>
                      <p className="text-[0.6rem] text-muted-foreground">{action.reason}</p>
                    </div>
                    {action.available && (
                      <Badge variant="outline" className="text-[0.5rem] py-0 text-emerald-500 border-emerald-500/30">
                        متاح
                      </Badge>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {result && (
            <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[0.7rem] font-semibold text-blue-600 dark:text-blue-400">النتيجة (Prompt):</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => {
                    navigator.clipboard.writeText(result)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  }}
                >
                  {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                </Button>
              </div>
              <pre className="text-[0.65rem] font-mono whitespace-pre-wrap max-h-48 overflow-y-auto text-muted-foreground" dir="ltr">
                {result}
              </pre>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ─── Tab 3: Inline AI (455) ───

function InlineAITab() {
  const [context, setContext] = React.useState("const numbers = [1, 2, 3, 4, 5]\n// cursor here\nconst sum = numbers.reduce((a, b) => a + b, 0)")
  const [suggestion, setSuggestion] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState<string | null | boolean>(false)

  const handleGenerate = async () => {
    setLoading(true)
    setSuggestion(null)
    try {
      const res = await fetch("/api/ux-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "inline_ai",
          context,
          cursorPosition: Math.floor(context.length / 2),
          language: "typescript",
        }),
      })
      const data = await res.json()
      setSuggestion(data.suggestion ?? data.reason)
      toast.success("تم توليد اقتراح inline")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Inline AI (455)</h3>
          <p className="text-[0.7rem] text-muted-foreground mt-0.5">
            اقتراحات داخل المحرر عند كتابة الكود
          </p>
        </div>

        <div>
          <label className="text-xs font-medium mb-1 block">سياق المحرر:</label>
          <Textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="اكتب الكود هنا..."
            className="text-xs font-mono min-h-[120px]"
            dir="ltr"
          />
        </div>

        <Button onClick={handleGenerate} disabled={Boolean(loading)} size="sm" className="w-full h-7 text-xs gap-1">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lightbulb className="h-3 w-3" />}
          ولّد اقتراح inline
        </Button>

        {suggestion && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2">
            <div className="flex items-center gap-1.5 mb-1">
              <Lightbulb className="h-3 w-3 text-emerald-500" />
              <span className="text-[0.7rem] font-semibold text-emerald-600 dark:text-emerald-400">اقتراح AI:</span>
            </div>
            <pre className="text-[0.7rem] font-mono whitespace-pre-wrap" dir="ltr">
              {suggestion}
            </pre>
          </div>
        )}

        <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2 text-[0.7rem] text-muted-foreground">
          <p className="font-semibold text-blue-600 dark:text-blue-400 mb-1">💡 كيف يعمل؟</p>
          <p>عند كتابة الكود في المحرر، يقوم النظام بتحليل السياق قبل وبعد المؤشر ويولّد اقتراحاً للإكمال. يمكن قبوله بالضغط على Tab.</p>
        </div>
      </div>
    </ScrollArea>
  )
}
