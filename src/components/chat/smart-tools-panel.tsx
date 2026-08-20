"use client"

import * as React from "react"
import {
  Sparkles, Eye, Palette, BarChart3, GraduationCap, CheckSquare,
  Loader2, Play, Download, Plus, Check, X, Mic, MicOff,
  Image as ImageIcon, FileText, Send,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

type SubTab = "vision" | "creative" | "data" | "study" | "productivity"

const SUB_TABS: Array<{ id: SubTab; label: string; icon: React.ReactNode }> = [
  { id: "vision", label: "رؤية", icon: <Eye className="h-3 w-3" /> },
  { id: "creative", label: "إبداع", icon: <Palette className="h-3 w-3" /> },
  { id: "data", label: "بيانات", icon: <BarChart3 className="h-3 w-3" /> },
  { id: "study", label: "دراسة", icon: <GraduationCap className="h-3 w-3" /> },
  { id: "productivity", label: "إنتاجية", icon: <CheckSquare className="h-3 w-3" /> },
]

export function SmartToolsPanel() {
  const [tab, setTab] = React.useState<SubTab>("vision")
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Sub-tab bar */}
      <div className="flex items-center gap-0.5 border-b border-sidebar-border bg-sidebar-accent/30 px-1 py-1">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[0.7rem] font-medium transition",
              tab === t.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      {/* Content */}
      <ScrollArea className="flex-1">
        {tab === "vision" && <VisionTab />}
        {tab === "creative" && <CreativeTab />}
        {tab === "data" && <DataTab />}
        {tab === "study" && <StudyTab />}
        {tab === "productivity" && <ProductivityTab />}
      </ScrollArea>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Vision Tab — upload image → analyze → show result
// ---------------------------------------------------------------------------

function VisionTab() {
  const [image, setImage] = React.useState<string | null>(null)
  const [prompt, setPrompt] = React.useState("")
  const [action, setAction] = React.useState<"analyze" | "fix" | "ui">("analyze")
  const [result, setResult] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1]
      setImage(base64)
      setResult(null)
    }
    reader.readAsDataURL(file)
  }

  const run = async () => {
    if (!image) { toast.error("اختر صورة أولاً / select an image first"); return }
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch("/api/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: action === "fix" ? "fix" : action === "ui" ? "ui" : "analyze",
          image: { base64: image },
          prompt: prompt || undefined,
        }),
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.message || data.error)
      } else {
        setResult(JSON.stringify(data, null, 2).slice(0, 5000))
      }
    } catch (e) {
      toast.error("فشل التحليل / analysis failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3 p-3">
      <div className="text-[0.7rem] font-medium text-muted-foreground">تحليل الصور / Image Analysis</div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      <Button size="sm" variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
        <ImageIcon className="h-3.5 w-3.5" />
        {image ? "تغيير الصورة / Change" : "رفع صورة / Upload Image"}
      </Button>
      {image && (
        <div className="rounded-lg border border-sidebar-border overflow-hidden">
          <img src={`data:image/png;base64,${image}`} alt="preview" className="w-full max-h-40 object-contain bg-muted" />
        </div>
      )}
      <Select value={action} onValueChange={(v) => setAction(v as typeof action)}>
        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="analyze">تحليل عام / General</SelectItem>
          <SelectItem value="fix"> screenshot → إصلاح كود / Code Fix</SelectItem>
          <SelectItem value="ui">تحليل واجهة / UI Analysis</SelectItem>
        </SelectContent>
      </Select>
      <Input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="سؤال اختياري / optional prompt"
        className="h-7 text-xs"
      />
      <Button size="sm" className="w-full" onClick={run} disabled={loading || !image}>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        تحليل / Analyze
      </Button>
      {result && (
        <pre className="rounded-md border border-sidebar-border bg-muted/50 p-2 text-[0.65rem] overflow-auto max-h-64 whitespace-pre-wrap">
          {result}
        </pre>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Creative Tab — image gen + diagram gen
// ---------------------------------------------------------------------------

function CreativeTab() {
  const [prompt, setPrompt] = React.useState("")
  const [type, setType] = React.useState<"image_generate" | "diagram" | "flowchart">("image_generate")
  const [result, setResult] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)

  const run = async () => {
    if (!prompt.trim()) { toast.error("اكتب وصفاً / enter a prompt"); return }
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch("/api/creative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: type, prompt, description: prompt }),
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.message || data.error)
      } else {
        if (data.imagePath) {
          setResult(data.imagePath)
        } else if (data.svgPath) {
          setResult(data.svgPath)
        } else if (data.svgContent) {
          setResult(data.svgContent)
        }
      }
    } catch {
      toast.error("فشل التوليد / generation failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3 p-3">
      <div className="text-[0.7rem] font-medium text-muted-foreground">توليد المحتوى / Content Generation</div>
      <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="image_generate">صورة / Image</SelectItem>
          <SelectItem value="diagram">مخطط / Diagram</SelectItem>
          <SelectItem value="flowchart">مخطط انسيابي / Flowchart</SelectItem>
        </SelectContent>
      </Select>
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="صف ما تريد توليده... / describe what to generate..."
        className="text-xs min-h-[80px]"
      />
      <Button size="sm" className="w-full" onClick={run} disabled={loading || !prompt.trim()}>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        توليد / Generate
      </Button>
      {result && (
        <div className="rounded-lg border border-sidebar-border overflow-hidden">
          {result.endsWith(".svg") || result.startsWith("<svg") ? (
            <div className="p-2 bg-muted" dangerouslySetInnerHTML={{ __html: result.startsWith("<svg") ? result : "" }} />
          ) : (
            <img src={result.replace("/home/z/my-project", "")} alt="generated" className="w-full" />
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Data Tab — CSV analysis + Python execution
// ---------------------------------------------------------------------------

function DataTab() {
  const [csvContent, setCsvContent] = React.useState("")
  const [query, setQuery] = React.useState("")
  const [result, setResult] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [datasetId, setDatasetId] = React.useState<string | null>(null)
  const [pyScript, setPyScript] = React.useState("print('sum:', sum([1,2,3,4,5]))")
  const [pyResult, setPyResult] = React.useState<string | null>(null)

  const analyzeCsv = async () => {
    if (!csvContent.trim()) { toast.error("الصق محتوى CSV / paste CSV content"); return }
    setLoading(true)
    try {
      const res = await fetch("/api/data-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "csv_analyze", content: csvContent, name: `csv-${Date.now()}` }),
      })
      const data = await res.json()
      if (data.error) { toast.error(data.message || data.error); return }
      setDatasetId(data.datasetId)
      setResult(`Rows: ${data.rowCount} | Cols: ${data.columns?.join(", ")} | Schema: ${data.schema?.map((s: { name: string; type: string }) => `${s.name}(${s.type})`).join(", ")}`)
    } catch { toast.error("فشل التحليل / analysis failed") }
    finally { setLoading(false) }
  }

  const runQuery = async () => {
    if (!datasetId || !query.trim()) { toast.error("حلل CSV أولاً ثم اكتب استعلام / analyze CSV first"); return }
    setLoading(true)
    try {
      const res = await fetch("/api/data-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sql_query", datasetId, query }),
      })
      const data = await res.json()
      if (data.error) { toast.error(data.message || data.error); return }
      setResult(`Returned ${data.rowCount} rows:\n${JSON.stringify(data.rows?.slice(0, 5), null, 2)}`)
    } catch { toast.error("فشل الاستعلام / query failed") }
    finally { setLoading(false) }
  }

  const runPython = async () => {
    setLoading(true)
    setPyResult(null)
    try {
      const res = await fetch("/api/data-analysis/python", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: pyScript }),
      })
      const data = await res.json()
      if (data.error) { toast.error(data.error); return }
      setPyResult(`exit=${data.exitCode}\n${data.stdout || data.stderr}`)
    } catch { toast.error("فشل Python / python failed") }
    finally { setLoading(false) }
  }

  return (
    <div className="space-y-3 p-3">
      <div className="text-[0.7rem] font-medium text-muted-foreground">تحليل البيانات / Data Analysis</div>
      <Textarea
        value={csvContent}
        onChange={(e) => setCsvContent(e.target.value)}
        placeholder="الصق CSV هنا... / paste CSV here..."
        className="text-xs font-mono min-h-[60px]"
      />
      <Button size="sm" variant="outline" className="w-full" onClick={analyzeCsv} disabled={loading}>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        تحليل CSV / Analyze
      </Button>
      {datasetId && (
        <Badge variant="outline" className="text-[0.6rem]">Dataset: {datasetId.slice(-8)}</Badge>
      )}
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="SELECT * FROM ... WHERE ..."
        className="h-7 text-xs font-mono"
      />
      <Button size="sm" variant="outline" className="w-full" onClick={runQuery} disabled={loading || !datasetId}>
        تنفيذ SQL / Run Query
      </Button>
      {result && (
        <pre className="rounded-md border border-sidebar-border bg-muted/50 p-2 text-[0.65rem] overflow-auto max-h-40 whitespace-pre-wrap">
          {result}
        </pre>
      )}
      <div className="border-t border-sidebar-border pt-2">
        <div className="text-[0.7rem] font-medium text-muted-foreground mb-1">Python / بايثون</div>
        <Textarea
          value={pyScript}
          onChange={(e) => setPyScript(e.target.value)}
          className="text-xs font-mono min-h-[60px]"
        />
        <Button size="sm" variant="outline" className="w-full mt-1" onClick={runPython} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          تنفيذ Python / Execute
        </Button>
        {pyResult && (
          <pre className="rounded-md border border-sidebar-border bg-muted/50 p-2 text-[0.65rem] overflow-auto max-h-40 whitespace-pre-wrap mt-1">
            {pyResult}
          </pre>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Study Tab — flashcards + quiz
// ---------------------------------------------------------------------------

function StudyTab() {
  const [courses, setCourses] = React.useState<Array<{ id: string; name: string }>>([])
  const [courseId, setCourseId] = React.useState<string | null>(null)
  const [flashcards, setFlashcards] = React.useState<Array<{ id: string; front: string; back: string }>>([])
  const [showAnswer, setShowAnswer] = React.useState(false)
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    fetch("/api/study?mode=courses").then(r => r.json()).then(d => {
      if (d.courses) setCourses(d.courses)
    })
  }, [])

  const loadCards = async () => {
    if (!courseId) return
    const res = await fetch(`/api/study?mode=flashcards&courseId=${courseId}`)
    const data = await res.json()
    if (data.flashcards) setFlashcards(data.flashcards.slice(0, 20))
  }

  const review = async (cardId: string, quality: number) => {
    await fetch("/api/study", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "flashcard_review", flashcardId: cardId, quality }),
    })
    setShowAnswer(false)
    setFlashcards(prev => prev.slice(1))
  }

  return (
    <div className="space-y-3 p-3">
      <div className="text-[0.7rem] font-medium text-muted-foreground">الدراسة / Study</div>
      <Select value={courseId ?? ""} onValueChange={(v) => { setCourseId(v); setTimeout(loadCards, 100) }}>
        <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="اختر مقرراً / select course" /></SelectTrigger>
        <SelectContent>
          {courses.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" className="w-full" onClick={loadCards} disabled={loading}>
        تحميل البطاقات / Load Flashcards
      </Button>
      {flashcards.length > 0 && (
        <div className="rounded-lg border border-sidebar-border bg-card p-3 space-y-2">
          <div className="text-xs font-medium">{flashcards[0].front}</div>
          {showAnswer && (
            <div className="text-xs text-muted-foreground border-t border-sidebar-border pt-2">{flashcards[0].back}</div>
          )}
          {!showAnswer ? (
            <Button size="sm" variant="outline" className="w-full" onClick={() => setShowAnswer(true)}>
              إظهار الإجابة / Show
            </Button>
          ) : (
            <div className="grid grid-cols-3 gap-1">
              <Button size="sm" variant="ghost" className="text-red-500" onClick={() => review(flashcards[0].id, 1)}>خطأ</Button>
              <Button size="sm" variant="ghost" onClick={() => review(flashcards[0].id, 3)}>صعب</Button>
              <Button size="sm" variant="ghost" className="text-green-500" onClick={() => review(flashcards[0].id, 5)}>سهل</Button>
            </div>
          )}
          <div className="text-[0.6rem] text-muted-foreground text-center">{flashcards.length} متبقية</div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Productivity Tab — quick task add + dashboard summary
// ---------------------------------------------------------------------------

function ProductivityTab() {
  const [taskTitle, setTaskTitle] = React.useState("")
  const [tasks, setTasks] = React.useState<Array<{ id: string; title: string; status: string; priority: string }>>([])
  const [loading, setLoading] = React.useState(false)

  const loadTasks = React.useCallback(async () => {
    const res = await fetch("/api/productivity?mode=tasks&limit=10")
    const data = await res.json()
    if (data.tasks) setTasks(data.tasks)
  }, [])

  React.useEffect(() => { loadTasks() }, [loadTasks])

  const addTask = async () => {
    if (!taskTitle.trim()) return
    setLoading(true)
    try {
      await fetch("/api/productivity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "task_create", title: taskTitle, priority: "medium" }),
      })
      setTaskTitle("")
      loadTasks()
      toast.success("تمت الإضافة / added")
    } catch { toast.error("فشل / failed") }
    finally { setLoading(false) }
  }

  const toggleDone = async (id: string, status: string) => {
    await fetch("/api/productivity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "task_update", id, patch: { status: status === "done" ? "todo" : "done" } }),
    })
    loadTasks()
  }

  const priorityColor: Record<string, string> = {
    urgent: "bg-red-500", high: "bg-orange-500", medium: "bg-blue-500", low: "bg-gray-400",
  }

  return (
    <div className="space-y-2 p-3">
      <div className="text-[0.7rem] font-medium text-muted-foreground">المهام / Tasks</div>
      <div className="flex gap-1">
        <Input
          value={taskTitle}
          onChange={(e) => setTaskTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTask()}
          placeholder="مهمة جديدة... / new task..."
          className="h-7 text-xs"
        />
        <Button size="sm" className="h-7 px-2" onClick={addTask} disabled={loading}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {tasks.length === 0 && (
          <div className="text-center text-[0.7rem] text-muted-foreground py-4">لا مهام / no tasks</div>
        )}
        {tasks.map(t => (
          <div key={t.id} className="flex items-center gap-2 rounded-md border border-sidebar-border bg-card p-1.5">
            <button
              onClick={() => toggleDone(t.id, t.status)}
              className={cn(
                "h-4 w-4 rounded border shrink-0",
                t.status === "done" ? "bg-green-500 border-green-500" : "border-muted-foreground"
              )}
            >
              {t.status === "done" && <Check className="h-3 w-3 text-white" />}
            </button>
            <div className={cn("h-2 w-2 rounded-full shrink-0", priorityColor[t.priority] ?? "bg-gray-400")} />
            <span className={cn("text-xs flex-1 truncate", t.status === "done" && "line-through opacity-50")}>
              {t.title}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
