"use client"

/**
 * ConversationToPanel — Conversation-to-Everything OS UI (spec section 35, features 465-474).
 *
 * "المحادثة ليست المكان الذي تنتهي فيه الأعمال؛ هي نقطة انطلاق الأعمال."
 *
 * 3 tabs:
 *  1. Convert All  — one-click "Chat → Everything" (465-474 combined)
 *  2. Individual    — 10 individual conversion actions
 *  3. Results        — show last conversion results
 */

import * as React from "react"
import {
  CheckSquare, FolderTree, Search, Brain, Clock, Workflow,
  Code2, ListChecks, Gavel, Zap, RefreshCw, Loader2, Check, X,
  Sparkles, ArrowRight, FileCode, AlertTriangle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

const CONVERTIONS: Array<{ id: string; label: string; icon: React.ReactNode; feature: number; desc: string; color: string }> = [
  { id: "to_task", label: "Chat → Task", icon: <CheckSquare className="h-3.5 w-3.5" />, feature: 465, desc: "استخراج المهام من المحادثة", color: "text-emerald-500" },
  { id: "to_project", label: "Chat → Project", icon: <FolderTree className="h-3.5 w-3.5" />, feature: 466, desc: "إنشاء مشروع مع milestones", color: "text-blue-500" },
  { id: "to_research", label: "Chat → Research", icon: <Search className="h-3.5 w-3.5" />, feature: 467, desc: "أسئلة بحث + مصادر", color: "text-purple-500" },
  { id: "to_knowledge", label: "Chat → Knowledge", icon: <Brain className="h-3.5 w-3.5" />, feature: 468, desc: "حفظ الحقائق في المعرفة", color: "text-amber-500" },
  { id: "to_automation", label: "Chat → Automation", icon: <Clock className="h-3.5 w-3.5" />, feature: 469, desc: "جدولة الإجراءات المتفق عليها", color: "text-orange-500" },
  { id: "to_agent", label: "Chat → Agent Run", icon: <Workflow className="h-3.5 w-3.5" />, feature: 470, desc: "تحويل الكلام لخطة تنفيذ", color: "text-red-500" },
  { id: "to_artifact", label: "Chat → Artifact", icon: <FileCode className="h-3.5 w-3.5" />, feature: 471, desc: "توليد منتج (HTML/React/Mermaid)", color: "text-indigo-500" },
  { id: "to_code", label: "Chat → Code", icon: <Code2 className="h-3.5 w-3.5" />, feature: 472, desc: "استخراج ملفات الكود", color: "text-cyan-500" },
  { id: "to_checklist", label: "Chat → Checklist", icon: <ListChecks className="h-3.5 w-3.5" />, feature: 473, desc: "قائمة تحقق من المحادثة", color: "text-teal-500" },
  { id: "to_decision", label: "Chat → Decision", icon: <Gavel className="h-3.5 w-3.5" />, feature: 474, desc: "حفظ القرارات المتخذة", color: "text-pink-500" },
]

export function ConversationToPanel() {
  const [tab, setTab] = React.useState("all")
  const [conversationId, setConversationId] = React.useState("")
  const [conversations, setConversations] = React.useState<any[]>([])

  // Load conversations
  React.useEffect(() => {
    fetch("/api/conversations")
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data) ? data : (data?.conversations ?? [])
        setConversations(list)
        if (list.length > 0) setConversationId(list[0].id)
      })
      .catch(() => {})
  }, [])

  return (
    <div className="flex h-full flex-col" dir="rtl">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">محادثة ← كل شيء / Conversation-to-Everything</span>
        </div>
      </div>

      {/* Conversation selector */}
      <div className="border-b border-border/60 bg-muted/20 px-3 py-2">
        <Select value={conversationId} onValueChange={setConversationId}>
          <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="اختر محادثة…" /></SelectTrigger>
          <SelectContent>
            {conversations.map(c => (
              <SelectItem key={c.id} value={c.id}>{c.title?.slice(0, 50) ?? c.id.slice(-8)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 min-h-0 flex-col">
        <TabsList className="grid w-full grid-cols-3 rounded-none border-b border-border bg-transparent p-0">
          <TabsTrigger value="all" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            تحويل الكل
          </TabsTrigger>
          <TabsTrigger value="individual" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            فردي
          </TabsTrigger>
          <TabsTrigger value="results" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            نتائج
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="m-0 flex-1 min-h-0 overflow-hidden">
          <ConvertAllTab conversationId={conversationId} />
        </TabsContent>
        <TabsContent value="individual" className="m-0 flex-1 min-h-0 overflow-hidden">
          <IndividualTab conversationId={conversationId} />
        </TabsContent>
        <TabsContent value="results" className="m-0 flex-1 min-h-0 overflow-hidden">
          <ResultsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── Tab 1: Convert All ───

function ConvertAllTab({ conversationId }: { conversationId: string }) {
  const [result, setResult] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(false)

  const handleConvertAll = async () => {
    if (!conversationId) {
      toast.error("اختر محادثة أولاً")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/conversation-to", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "to_everything", conversationId }),
      })
      const data = await res.json()
      setResult(data)
      toast.success(data.reason ?? "تم التحويل")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        {/* Hero banner */}
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-center">
          <Sparkles className="h-8 w-8 text-primary mx-auto mb-2" />
          <h3 className="text-sm font-bold mb-1">المحادثة ← كل شيء</h3>
          <p className="text-[0.7rem] text-muted-foreground mb-3">
            "المحادثة ليست المكان الذي تنتهي فيه الأعمال؛ هي نقطة انطلاق الأعمال."
          </p>
          <Button onClick={handleConvertAll} disabled={loading || !conversationId} size="sm" className="gap-1.5">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            حوّل المحادثة إلى كل شيء
          </Button>
        </div>

        {/* Results */}
        {result && (
          <div className="space-y-2">
            <p className="text-xs font-semibold">النتائج:</p>
            <div className="grid grid-cols-2 gap-2">
              <ResultCard label="مهام" value={result.tasks} icon={<CheckSquare className="h-3 w-3" />} color="emerald" />
              <ResultCard label="مشروع" value={result.project ? "✅" : "—"} icon={<FolderTree className="h-3 w-3" />} color="blue" />
              <ResultCard label="أسئلة بحث" value={result.researchQueries} icon={<Search className="h-3 w-3" />} color="purple" />
              <ResultCard label="معرفة" value={result.knowledgeItems} icon={<Brain className="h-3 w-3" />} color="amber" />
              <ResultCard label="أتمتة" value={result.automations} icon={<Clock className="h-3 w-3" />} color="orange" />
              <ResultCard label="خطة وكيل" value={result.agentPlan} icon={<Workflow className="h-3 w-3" />} color="red" />
              <ResultCard label="artifacts" value={result.artifacts} icon={<FileCode className="h-3 w-3" />} color="indigo" />
              <ResultCard label="ملفات كود" value={result.codeFiles} icon={<Code2 className="h-3 w-3" />} color="cyan" />
              <ResultCard label="قائمة تحقق" value={result.checklistItems} icon={<ListChecks className="h-3 w-3" />} color="teal" />
              <ResultCard label="قرارات" value={result.decisions} icon={<Gavel className="h-3 w-3" />} color="pink" />
            </div>
            {result.project && <p className="text-[0.7rem] text-muted-foreground">المشروع: {result.project}</p>}
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

function ResultCard({ label, value, icon, color }: { label: string; value: string | number; icon: React.ReactNode; color: string }) {
  const colorClasses: Record<string, string> = {
    emerald: "border-emerald-500/30 bg-emerald-500/5 text-emerald-600",
    blue: "border-blue-500/30 bg-blue-500/5 text-blue-600",
    purple: "border-purple-500/30 bg-purple-500/5 text-purple-600",
    amber: "border-amber-500/30 bg-amber-500/5 text-amber-600",
    orange: "border-orange-500/30 bg-orange-500/5 text-orange-600",
    red: "border-red-500/30 bg-red-500/5 text-red-600",
    indigo: "border-indigo-500/30 bg-indigo-500/5 text-indigo-600",
    cyan: "border-cyan-500/30 bg-cyan-500/5 text-cyan-600",
    teal: "border-teal-500/30 bg-teal-500/5 text-teal-600",
    pink: "border-pink-500/30 bg-pink-500/5 text-pink-600",
  }
  return (
    <div className={cn("rounded-md border p-2", colorClasses[color] ?? "border-border/60 bg-card/50")}>
      <div className="flex items-center gap-1 text-[0.6rem] text-muted-foreground mb-0.5">{icon}{label}</div>
      <div className="text-sm font-mono font-bold">{value}</div>
    </div>
  )
}

// ─── Tab 2: Individual ───

function IndividualTab({ conversationId }: { conversationId: string }) {
  const [results, setResults] = React.useState<Record<string, any>>({})
  const [loading, setLoading] = React.useState<string | null>(null)

  const handleConvert = async (actionId: string) => {
    if (!conversationId) {
      toast.error("اختر محادثة أولاً")
      return
    }
    setLoading(actionId)
    try {
      const res = await fetch("/api/conversation-to", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionId, conversationId }),
      })
      const data = await res.json()
      setResults(prev => ({ ...prev, [actionId]: data }))
      toast.success(`تم ${actionId}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(null)
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-2">
        <p className="text-[0.7rem] text-muted-foreground mb-1">10 تحويلات فردية — اختر ما تحتاجه:</p>
        {CONVERTIONS.map(conv => {
          const result = results[conv.id]
          return (
            <div key={conv.id} className="rounded-md border border-border/60 bg-card/50 p-2">
              <div className="flex items-center gap-2 mb-1">
                {React.cloneElement(conv.icon as React.ReactElement, { className: cn("h-3.5 w-3.5", conv.color) })}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium">{conv.label}</span>
                    <Badge variant="outline" className="text-[0.5rem] py-0">#{conv.feature}</Badge>
                  </div>
                  <p className="text-[0.65rem] text-muted-foreground">{conv.desc}</p>
                </div>
                <Button
                  onClick={() => handleConvert(conv.id)}
                  disabled={!!loading || !conversationId}
                  variant="outline"
                  size="sm"
                  className="h-6 gap-1 text-xs"
                >
                  {loading === conv.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
                  حوّل
                </Button>
              </div>
              {result && (
                <div className="mt-1.5 pt-1.5 border-t border-border/40 text-[0.65rem] space-y-0.5">
                  {result.created !== undefined && <span className="text-emerald-500">✅ {result.created} عنصر</span>}
                  {result.saved !== undefined && <span className="text-emerald-500">✅ {result.saved} محفوظ</span>}
                  {result.extracted !== undefined && <span className="text-emerald-500">✅ {result.extracted} ملف</span>}
                  {result.queries?.length > 0 && <span className="text-purple-500">🔍 {result.queries.length} أسئلة</span>}
                  {result.plan?.length > 0 && <span className="text-red-500">📋 {result.plan.length} خطوات</span>}
                  {result.checklist?.length > 0 && <span className="text-teal-500">✅ {result.checklist.length} بنود</span>}
                  {result.decisions?.length > 0 && <span className="text-pink-500">⚖️ {result.decisions.length} قرارات</span>}
                  {result.artifacts?.length > 0 && <span className="text-indigo-500">🎨 {result.artifacts.length} artifacts</span>}
                  {result.files?.length > 0 && <span className="text-cyan-500">📄 {result.files.length} ملفات</span>}
                  {result.automations?.length > 0 && <span className="text-orange-500">⏰ {result.automations.length} أتمتة</span>}
                  {result.name && <span className="text-blue-500">📁 {result.name}</span>}
                  {result.reason && <p className="text-muted-foreground">{result.reason}</p>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

// ─── Tab 3: Results ───

function ResultsTab() {
  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-2 text-center">
        <AlertTriangle className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">
          النتائج تُحفظ في الأنظمة المناسبة:
        </p>
        <div className="grid grid-cols-2 gap-2 text-[0.7rem]">
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2"><CheckSquare className="h-3 w-3 text-emerald-500 inline" /> Tasks → Task OS</div>
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2"><FolderTree className="h-3 w-3 text-blue-500 inline" /> Projects → Productivity</div>
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2"><Search className="h-3 w-3 text-purple-500 inline" /> Research → Research OS</div>
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2"><Brain className="h-3 w-3 text-amber-500 inline" /> Knowledge → Knowledge OS</div>
          <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-2"><Clock className="h-3 w-3 text-orange-500 inline" /> Automation → Scheduler</div>
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2"><Workflow className="h-3 w-3 text-red-500 inline" /> Agent → Agent OS</div>
          <div className="rounded-md border border-indigo-500/30 bg-indigo-500/5 p-2"><FileCode className="h-3 w-3 text-indigo-500 inline" /> Artifacts → Artifact OS</div>
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2"><Code2 className="h-3 w-3 text-cyan-500 inline" /> Code → File Intel</div>
          <div className="rounded-md border border-teal-500/30 bg-teal-500/5 p-2"><ListChecks className="h-3 w-3 text-teal-500 inline" /> Checklist → Memory</div>
          <div className="rounded-md border border-pink-500/30 bg-pink-500/5 p-2"><Gavel className="h-3 w-3 text-pink-500 inline" /> Decisions → Memory</div>
        </div>
        <p className="text-[0.65rem] text-muted-foreground mt-2">
          استخدم تبويب "فردي" لرؤية النتائج التفصيلية لكل تحويل
        </p>
      </div>
    </ScrollArea>
  )
}
