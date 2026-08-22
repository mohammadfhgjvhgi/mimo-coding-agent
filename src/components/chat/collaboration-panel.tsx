"use client"

/**
 * CollaborationPanel — Collaboration OS UI (spec section 29, features 406-414).
 *
 * 4 tabs:
 *  1. Projects   — shared projects (406)
 *  2. Library    — prompts + skills + artifacts (409, 410, 411)
 *  3. Reviews   — review requests (412)
 *  4. Permissions — team permissions + project roles (413, 414)
 */

import * as React from "react"
import {
  Activity, AlertTriangle, Check, X, RefreshCw, Plus, Trash2,
  Copy, Code2, Brain, FileCode, Shield, ChevronRight, Loader2, Star, Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsContent, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─────────────────────────────────────────────────────────────────────────
// Main panel
// ─────────────────────────────────────────────────────────────────────────

export function CollaborationPanel() {
  const [tab, setTab] = React.useState("library")
  const [snapshot, setSnapshot] = React.useState<any>(null)
  const [loadingSnapshot, setLoadingSnapshot] = React.useState(true)

  const loadSnapshot = React.useCallback(async () => {
    setLoadingSnapshot(true)
    try {
      const res = await fetch("/api/collaboration?mode=snapshot")
      const data = await res.json()
      setSnapshot(data)
    } catch (err) {
      console.error("[CollaborationPanel] snapshot failed", err)
    } finally {
      setLoadingSnapshot(false)
    }
  }, [])

  React.useEffect(() => { loadSnapshot() }, [loadSnapshot])

  return (
    <div className="flex h-full flex-col" dir="rtl">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">التعاون / Collaboration</span>
        </div>
        <Button variant="ghost" size="sm" onClick={loadSnapshot} className="h-7 gap-1 px-2 text-xs" disabled={loadingSnapshot}>
          <RefreshCw className={cn("h-3 w-3", loadingSnapshot && "animate-spin")} />
          تحديث
        </Button>
      </div>

      {snapshot && (
        <div className="grid grid-cols-5 gap-1.5 border-b border-border/60 bg-muted/30 px-3 py-2 text-center text-[0.65rem]">
          <Stat icon={<Code2 className="h-3 w-3 text-blue-500" />} label="مشاريع" value={snapshot.sharedProjects} tone="blue" />
          <Stat icon={<Brain className="h-3 w-3 text-purple-500" />} label="وكلاء" value={snapshot.sharedAgents} tone="purple" />
          <Stat icon={<Star className="h-3 w-3 text-amber-500" />} label="Prompts" value={snapshot.prompts} tone="amber" />
          <Stat icon={<FileCode className="h-3 w-3 text-emerald-500" />} label="Artifacts" value={snapshot.sharedArtifacts} tone="emerald" />
          <Stat icon={<AlertTriangle className="h-3 w-3 text-red-500" />} label="مراجعات" value={snapshot.pendingReviews} tone="red" />
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 min-h-0 flex-col">
        <TabsList className="grid w-full grid-cols-4 rounded-none border-b border-border bg-transparent p-0">
          <TabsTrigger value="library" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            المكتبة
          </TabsTrigger>
          <TabsTrigger value="projects" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            مشاريع
          </TabsTrigger>
          <TabsTrigger value="reviews" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            مراجعات
          </TabsTrigger>
          <TabsTrigger value="permissions" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            صلاحيات
          </TabsTrigger>
        </TabsList>

        <TabsContent value="library" className="m-0 flex-1 min-h-0 overflow-hidden">
          <LibraryTab onChange={loadSnapshot} />
        </TabsContent>
        <TabsContent value="projects" className="m-0 flex-1 min-h-0 overflow-hidden">
          <ProjectsTab onChange={loadSnapshot} />
        </TabsContent>
        <TabsContent value="reviews" className="m-0 flex-1 min-h-0 overflow-hidden">
          <ReviewsTab onChange={loadSnapshot} />
        </TabsContent>
        <TabsContent value="permissions" className="m-0 flex-1 min-h-0 overflow-hidden">
          <PermissionsTab onChange={loadSnapshot} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function Stat({ icon, label, value, tone }: {
  icon: React.ReactNode; label: string; value: number | string; tone: "default" | "emerald" | "amber" | "red" | "blue" | "purple"
}) {
  const toneClass = {
    default: "text-foreground",
    emerald: "text-emerald-600 dark:text-emerald-400",
    red: "text-red-600 dark:text-red-400",
    amber: "text-amber-600 dark:text-amber-400",
    blue: "text-blue-600 dark:text-blue-400",
    purple: "text-purple-600 dark:text-purple-400",
  }[tone]
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className={cn("flex items-center gap-1 font-mono font-bold", toneClass)}>
        {icon}
        <span>{value}</span>
      </div>
      <span className="text-muted-foreground">{label}</span>
    </div>
  )
}

async function apiCall(action: string, body: Record<string, unknown> = {}) {
  const res = await fetch("/api/collaboration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "فشل الشبكة" }))
    throw new Error(err.message ?? `HTTP ${res.status}`)
  }
  return res.json()
}

async function apiGet(mode: string) {
  const res = await fetch(`/api/collaboration?mode=${mode}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 1: Library (Prompts + Skills + Artifacts)
// ─────────────────────────────────────────────────────────────────────────

function LibraryTab({ onChange }: { onChange: () => void }) {
  const [subtab, setSubtab] = React.useState("prompts")

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-2 py-1.5">
        <div className="flex flex-wrap gap-1">
          <SubTabButton active={subtab === "prompts"} onClick={() => setSubtab("prompts")} icon={<Star className="h-3 w-3" />} label="Prompts (409)" />
          <SubTabButton active={subtab === "skills"} onClick={() => setSubtab("skills")} icon={<Zap className="h-3 w-3" />} label="Skills (410)" />
          <SubTabButton active={subtab === "artifacts"} onClick={() => setSubtab("artifacts")} icon={<FileCode className="h-3 w-3" />} label="Artifacts (411)" />
        </div>
      </div>

      {subtab === "prompts" && <PromptsList onChange={onChange} />}
      {subtab === "skills" && <SkillsList onChange={onChange} />}
      {subtab === "artifacts" && <ArtifactsList onChange={onChange} />}
    </div>
  )
}

function SubTabButton({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-md px-2 py-1 text-[0.65rem] font-medium transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────────────────

function PromptsList({ onChange }: { onChange: () => void }) {
  const [items, setItems] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)
  const [showForm, setShowForm] = React.useState(false)
  const [title, setTitle] = React.useState("")
  const [prompt, setPrompt] = React.useState("")
  const [category, setCategory] = React.useState("general")

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet("prompts")
      setItems(data ?? [])
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (!title.trim() || !prompt.trim()) {
      toast.error("العنوان والـ prompt مطلوبان")
      return
    }
    try {
      await apiCall("prompt_create", { title, prompt, category })
      toast.success("تم إنشاء الـ prompt")
      setTitle(""); setPrompt("")
      setShowForm(false)
      load()
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold">Prompts (409)</span>
        <Button onClick={() => setShowForm(!showForm)} size="sm" className="h-7 gap-1 text-xs">
          <Plus className="h-3 w-3" /> جديد
        </Button>
      </div>
      {showForm && (
        <div className="border-b border-border/60 bg-muted/10 px-3 py-2 space-y-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عنوان الـ prompt" className="text-xs h-7" />
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="نص الـ prompt" className="text-xs" rows={3} />
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["general", "code", "writing", "analysis", "research"].map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleCreate} size="sm" className="w-full h-7 text-xs">
            <Check className="h-3 w-3" /> أنشئ
          </Button>
        </div>
      )}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1.5">
          {loading ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
              جارٍ التحميل…
            </div>
          ) : items.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <Star className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              لا prompts
            </div>
          ) : (
            items.map(item => (
              <div key={item.id} className="rounded-md border border-border/60 bg-card/50 p-2">
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  <Badge variant="outline" className="text-[0.55rem] py-0">{item.category}</Badge>
                  {item.builtin && <Badge variant="outline" className="text-[0.55rem] py-0 text-blue-500 border-blue-500/30">مدمج</Badge>}
                  {item.useCount > 0 && <Badge variant="outline" className="text-[0.55rem] py-0 text-amber-500">{item.useCount}× مستخدم</Badge>}
                  <span className="text-[0.55rem] text-muted-foreground ml-auto">{new Date(item.createdAt).toLocaleDateString("ar-SA", { month: "short", day: "numeric" })}</span>
                </div>
                <p className="text-xs font-medium mb-1" dir="ltr">{item.title}</p>
                <p className="text-[0.7rem] text-muted-foreground line-clamp-2" dir="ltr">{item.prompt}</p>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Skills
// ─────────────────────────────────────────────────────────────────────────

function SkillsList({ onChange }: { onChange: () => void }) {
  const [items, setItems] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet("skills")
      setItems(data ?? [])
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    const name = prompt("اسم المهارة:")
    if (!name) return
    try {
      await apiCall("skill_create", { name })
      toast.success("تم إنشاء المهارة")
      load()
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold">Skills (410)</span>
        <Button onClick={handleCreate} size="sm" className="h-7 gap-1 text-xs">
          <Plus className="h-3 w-3" /> جديد
        </Button>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1.5">
          {loading ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
              جارٍ التحميل…
            </div>
          ) : items.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <Zap className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              لا skills
            </div>
          ) : (
            items.map(item => (
              <div key={item.id} className="rounded-md border border-border/60 bg-card/50 p-2">
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  <Badge variant="outline" className="text-[0.55rem] py-0">{item.skillType}</Badge>
                  {item.builtin && <Badge variant="outline" className="text-[0.55rem] py-0 text-blue-500 border-blue-500/30">مدمج</Badge>}
                </div>
                <p className="text-xs font-medium mb-1">{item.name}</p>
                <p className="text-[0.7rem] text-muted-foreground">{item.description}</p>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Artifacts
// ─────────────────────────────────────────────────────────────────────────

function ArtifactsList({ onChange }: { onChange: () => void }) {
  const [items, setItems] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet("artifacts")
      setItems(data ?? [])
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    const title = prompt("عنوان الـ artifact:")
    if (!title) return
    const artifactType = prompt("النوع (html/react/svg/mermaid/code):", "html")
    if (!artifactType) return
    const content = prompt("المحتوى:", "<h1>Hello</h1>")
    if (!content) return
    try {
      await apiCall("artifact_create", { title, artifactType, content })
      toast.success("تم إنشاء الـ artifact")
      load()
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const typeIcons: Record<string, React.ReactNode> = {
    html: <Code2 className="h-3 w-3 text-blue-500" />,
    react: <Code2 className="h-3 w-3 text-cyan-500" />,
    svg: <FileCode className="h-3 w-3 text-purple-500" />,
    mermaid: <Brain className="h-3 w-3 text-amber-500" />,
    code: <Code2 className="h-3 w-3 text-emerald-500" />,
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold">Artifacts (411)</span>
        <Button onClick={handleCreate} size="sm" className="h-7 gap-1 text-xs">
          <Plus className="h-3 w-3" /> جديد
        </Button>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1.5">
          {loading ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
              جارٍ التحميل…
            </div>
          ) : items.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <FileCode className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              لا artifacts
            </div>
          ) : (
            items.map(item => (
              <div key={item.id} className="rounded-md border border-border/60 bg-card/50 p-2">
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  {typeIcons[item.artifactType] ?? <FileCode className="h-3 w-3" />}
                  <Badge variant="outline" className="text-[0.55rem] py-0">{item.artifactType}</Badge>
                  <span className="text-[0.55rem] text-muted-foreground ml-auto">{new Date(item.createdAt).toLocaleDateString("ar-SA", { month: "short", day: "numeric" })}</span>
                </div>
                <p className="text-xs font-medium mb-1">{item.title}</p>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 2: Projects
// ─────────────────────────────────────────────────────────────────────────

function ProjectsTab({ onChange }: { onChange: () => void }) {
  const [items, setItems] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet("projects")
      setItems(data ?? [])
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    const name = prompt("اسم المشروع:")
    if (!name) return
    try {
      await apiCall("project_create", { name })
      toast.success("تم إنشاء المشروع")
      load()
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold">المشاريع المشتركة (406)</span>
        <Button onClick={handleCreate} size="sm" className="h-7 gap-1 text-xs">
          <Plus className="h-3 w-3" /> جديد
        </Button>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1.5">
          {loading ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
              جارٍ التحميل…
            </div>
          ) : items.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <Code2 className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              لا مشاريع مشتركة
            </div>
          ) : (
            items.map(item => (
              <div key={item.id} className="rounded-md border border-border/60 bg-card/50 p-2">
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  <Badge variant="outline" className="text-[0.55rem] py-0">{item.ownerRole}</Badge>
                  {item.isPublic && <Badge variant="outline" className="text-[0.55rem] py-0 text-blue-500 border-blue-500/30">عام</Badge>}
                  <Button variant="ghost" size="icon" className="h-5 w-5 ml-auto text-muted-foreground hover:text-red-500" onClick={() => { if (confirm("حذف المشروع؟")) { apiCall("project_delete", { id: item.id }).then(() => { load(); onChange() }) } }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <p className="text-xs font-medium mb-1">{item.name}</p>
                {item.description && <p className="text-[0.7rem] text-muted-foreground">{item.description}</p>}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 3: Review Requests
// ─────────────────────────────────────────────────────────────────────────

function ReviewsTab({ onChange }: { onChange: () => void }) {
  const [items, setItems] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet("reviews")
      setItems(data ?? [])
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    const title = prompt("عنوان طلب المراجعة:")
    if (!title) return
    const targetType = prompt("النوع (file/snippet/artifact/diff):", "file")
    if (!targetType) return
    const targetPath = prompt("المسار/الهدف:", "src/app/page.tsx")
    if (!targetPath) return
    try {
      await apiCall("review_create", { title, targetType, targetPath })
      toast.success("تم إنشاء طلب المراجعة")
      load()
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleResolve = async (id: string, status: string) => {
    const comment = prompt(`ملاحظة (${status}):`) ?? ""
    try {
      await apiCall("review_resolve", { id, status, comment })
      toast.success("تم تحديث المراجعة")
      load()
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold">طلبات المراجعة (412)</span>
        <Button onClick={handleCreate} size="sm" className="h-7 gap-1 text-xs">
          <Plus className="h-3 w-3" /> جديد
        </Button>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1.5">
          {loading ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
              جارٍ التحميل…
            </div>
          ) : items.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <AlertTriangle className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              لا طلبات مراجعة
            </div>
          ) : (
            items.map(item => (
              <div key={item.id} className="rounded-md border border-border/60 bg-card/50 p-2">
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  <Badge variant="outline" className="text-[0.55rem] py-0">{item.status}</Badge>
                  <Badge variant="outline" className="text-[0.55rem] py-0">{item.priority}</Badge>
                  <span className="text-[0.55rem] text-muted-foreground ml-auto">{new Date(item.createdAt).toLocaleDateString("ar-SA", { month: "short", day: "numeric" })}</span>
                </div>
                <p className="text-xs font-medium mb-1">{item.title}</p>
                <code className="text-[0.65rem] font-mono block" dir="ltr">{item.targetPath}</code>
                {item.reviews && item.reviews.length > 0 && (
                  <p className="text-[0.65rem] text-amber-600 dark:text-amber-400 mt-1">💡 {item.reviews[item.reviews.length - 1].comment}</p>
                )}
                {item.status === "pending" && (
                  <div className="flex gap-1.5 mt-2">
                    <Button onClick={() => handleResolve(item.id, "approved")} size="sm" className="h-6 flex-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">
                      <Check className="h-3 w-3" /> موافقة
                    </Button>
                    <Button onClick={() => handleResolve(item.id, "rejected")} size="sm" variant="outline" className="h-6 flex-1 text-xs border-red-500/40 text-red-600 hover:bg-red-500/10">
                      <X className="h-3 w-3" /> رفض
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 4: Permissions + Roles
// ─────────────────────────────────────────────────────────────────────────

function PermissionsTab({ onChange }: { onChange: () => void }) {
  const [subtab, setSubtab] = React.useState("roles")

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-2 py-1.5">
        <div className="flex gap-1">
          <SubTabButton active={subtab === "roles"} onClick={() => setSubtab("roles")} icon={<Shield className="h-3 w-3" />} label="الأدوار (414)" />
          <SubTabButton active={subtab === "perms"} onClick={() => setSubtab("permissions")} icon={<Shield className="h-3 w-3" />} label="الصلاحيات (413)" />
        </div>
      </div>

      {subtab === "roles" && <RolesList onChange={onChange} />}
      {subtab === "perms" && <PermissionsList onChange={onChange} />}
    </div>
  )
}

function RolesList({ onChange }: { onChange: () => void }) {
  const [items, setItems] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet("roles")
      setItems(data ?? [])
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    const roleName = prompt("اسم الدور:")
    if (!roleName) return
    try {
      await apiCall("role_create", { projectId: "default", roleName })
      toast.success("تم إنشاء الدور")
      load()
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold">أدوار المشاريع (414)</span>
        <Button onClick={handleCreate} size="sm" className="h-7 gap-1 text-xs">
          <Plus className="h-3 w-3" /> جديد
        </Button>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1.5">
          {loading ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
              جارٍ التحميل…
            </div>
          ) : items.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <Shield className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              لا أدوار
            </div>
          ) : (
            items.map(item => {
              const perms = item.permissions || {}
              return (
              <div key={item.id} className="rounded-md border border-border/60 bg-card/50 p-2">
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  <Badge variant="outline" className="text-[0.55rem] py-0">{item.roleName}</Badge>
                  {item.builtin && <Badge variant="outline" className="text-[0.55rem] py-0 text-blue-500 border-blue-500/30">مدمج</Badge>}
                  {!item.builtin && (
                    <Button variant="ghost" size="icon" className="h-5 w-5 ml-auto text-muted-foreground hover:text-red-500" onClick={() => { if (confirm("حذف الدور؟")) { apiCall("role_delete", { id: item.id }).then(() => { load(); onChange() }) } }}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                <p className="text-[0.7rem] text-muted-foreground">{item.description}</p>
                <div className="flex flex-wrap gap-1 mt-1 text-[0.55rem]">
                  <span className={perms.canEdit ? "text-emerald-500" : "text-muted-foreground"}>✏️ تعديل</span>
                  <span className={perms.canDelete ? "text-emerald-500" : "text-muted-foreground"}>🗑 حذف</span>
                  <span className={perms.canShare ? "text-emerald-500" : "text-muted-foreground"}>🔗 مشاركة</span>
                  <span className={perms.canApprove ? "text-emerald-500" : "text-muted-foreground"}>✅ موافقة</span>
                  <span className={perms.canMerge ? "text-emerald-500" : "text-muted-foreground"}>🔀 دمج</span>
                </div>
              </div>
              )
            })
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function PermissionsList({ onChange }: { onChange: () => void }) {
  const [items, setItems] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet("permissions")
      setItems(data ?? [])
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  const handleGrant = async () => {
    const role = prompt("الدور (owner/editor/viewer/reviewer):", "viewer")
    if (!role) return
    const resourceType = prompt("نوع المورد (project/knowledge/agent/artifact/review):", "project")
    if (!resourceType) return
    const resourceId = prompt("معرف المورد:", "default")
    if (!resourceId) return
    try {
      await apiCall("permission_grant", { userId: "local", resourceType, resourceId, role })
      toast.success("تم منح الصلاحية")
      load()
      onChange()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold">صلاحيات الفريق (413)</span>
        <Button onClick={handleGrant} size="sm" className="h-7 gap-1 text-xs">
          <Plus className="h-3 w-3" /> جديد
        </Button>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1.5">
          {loading ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
              جارٍ التحميل…
            </div>
          ) : items.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <Shield className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              لا صلاحيات
            </div>
          ) : (
            items.map(item => (
              <div key={item.id} className="rounded-md border border-border/60 bg-card/50 p-2">
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  <Badge variant="outline" className="text-[0.55rem] py-0">{item.role}</Badge>
                  <span className="text-[0.55rem] text-muted-foreground ml-auto">{item.resourceType}/{item.resourceId}</span>
                  <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-red-500" onClick={() => { if (confirm("حذف الصلاحية؟")) { apiCall("permission_revoke", { id: item.id }).then(() => { load(); onChange() }) } }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1 text-[0.55rem]">
                  {Object.entries(item.permissions || {}).map(([k, v]) => (
                    <span key={k} className={v ? "text-emerald-500" : "text-muted-foreground"}>{k}: {v ? "✓" : "✗"}</span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
