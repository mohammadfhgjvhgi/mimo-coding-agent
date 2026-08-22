"use client"

/**
 * DevExperiencePanel — Developer Experience OS UI (spec section 28, features 393-405).
 *
 * 4 tabs:
 *  1. Templates    — project templates + scaffolding (393, 394)
 *  2. Detection     — framework/PM/test framework/command discovery (395-398, 400)
 *  3. Constitution  — instructions + critical files + dangerous ops + DoD + runbooks (399, 401-405)
 *  4. Profile        — repository profile (400)
 */

import * as React from "react"
import {
  FileCode, Package, TestTube, Terminal, BookOpen, Shield, AlertTriangle,
  CheckCircle, FileText, ListChecks, Plus, Trash2, RefreshCw, Loader2,
  Code2, Cpu, Zap, ChevronRight, Wrench, ScrollText, FileWarning,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// ─────────────────────────────────────────────────────────────────────────
// Main panel
// ─────────────────────────────────────────────────────────────────────────

export function DevExperiencePanel() {
  const [tab, setTab] = React.useState("templates")

  return (
    <div className="flex h-full flex-col" dir="rtl">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">تجربة المطور / Dev Experience</span>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 min-h-0 flex-col">
        <TabsList className="grid w-full grid-cols-4 rounded-none border-b border-border bg-transparent p-0">
          <TabsTrigger value="templates" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            قوالب
          </TabsTrigger>
          <TabsTrigger value="detection" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            كشف
          </TabsTrigger>
          <TabsTrigger value="constitution" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            دستور
          </TabsTrigger>
          <TabsTrigger value="profile" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2">
            ملف
          </TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="m-0 flex-1 min-h-0 overflow-hidden">
          <TemplatesTab />
        </TabsContent>
        <TabsContent value="detection" className="m-0 flex-1 min-h-0 overflow-hidden">
          <DetectionTab />
        </TabsContent>
        <TabsContent value="constitution" className="m-0 flex-1 min-h-0 overflow-hidden">
          <ConstitutionTab />
        </TabsContent>
        <TabsContent value="profile" className="m-0 flex-1 min-h-0 overflow-hidden">
          <ProfileTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

async function apiCall(action: string, body: Record<string, unknown> = {}) {
  const res = await fetch("/api/dev-experience", {
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
  const res = await fetch(`/api/dev-experience?mode=${mode}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "فشل الشبكة" }))
    throw new Error(err.message ?? `HTTP ${res.status}`)
  }
  return res.json()
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 1: Templates (393, 394)
// ─────────────────────────────────────────────────────────────────────────

interface Template {
  id: string
  name: string
  description: string
  framework: string
  language: string
  packageManager: string
  testFramework: string
  builtin: boolean
}

function TemplatesTab() {
  const [templates, setTemplates] = React.useState<Template[]>([])
  const [loading, setLoading] = React.useState(true)
  const [showForm, setShowForm] = React.useState(false)
  const [scaffolding, setScaffolding] = React.useState<string | null>(null)

  // form state
  const [name, setName] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [framework, setFramework] = React.useState("nextjs")
  const [language, setLanguage] = React.useState("typescript")
  const [packageManager, setPackageManager] = React.useState("bun")
  const [testFramework, setTestFramework] = React.useState("vitest")

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet("templates")
      setTemplates(data ?? [])
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (!name.trim() || !description.trim()) {
      toast.error("الاسم والوصف مطلوبان")
      return
    }
    try {
      await apiCall("template_create", {
        name, description, framework, language, packageManager, testFramework,
        files: {}, commands: {},
      })
      toast.success("أُنشئ القالب")
      setName(""); setDescription(""); setShowForm(false)
      load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("حذف القالب؟")) return
    try {
      await apiCall("template_delete", { id })
      toast.success("حُذف القالب")
      load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleScaffold = async (templateName: string) => {
    const projectName = prompt("اسم المشروع الجديد:", templateName)
    if (!projectName) return
    setScaffolding(templateName)
    try {
      const data = await apiCall("scaffold", { templateName, projectName })
      toast.success(`أُنشئ ${data.created.length} ملف في ${data.targetPath}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setScaffolding(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold">قوالب المشاريع / Project Templates (393)</span>
        <Button onClick={() => setShowForm(!showForm)} size="sm" className="h-7 gap-1 text-xs">
          <Plus className="h-3 w-3" /> جديد
        </Button>
      </div>

      {showForm && (
        <div className="border-b border-border/60 bg-muted/10 px-3 py-2 space-y-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم القالب" className="text-xs h-7" dir="ltr" />
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="الوصف" className="text-xs h-7" />
          <div className="grid grid-cols-2 gap-2">
            <Select value={framework} onValueChange={setFramework}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["nextjs", "react", "vue", "express", "fastify", "nest", "fastapi", "django", "flask", "svelte", "astro", "remix"].map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["typescript", "javascript", "python", "go", "rust", "java"].map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={packageManager} onValueChange={setPackageManager}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["bun", "npm", "pnpm", "yarn", "pip", "poetry"].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={testFramework} onValueChange={setTestFramework}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["vitest", "jest", "mocha", "pytest", "playwright", "none"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleCreate} size="sm" className="w-full h-7 text-xs">
            <CheckCircle className="h-3 w-3" /> أنشئ
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
          ) : templates.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <FileCode className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              لا قوالب
            </div>
          ) : (
            templates.map(t => (
              <div key={t.id} className="rounded-md border border-border/60 bg-card/50 p-2">
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  <code className="text-xs font-mono font-bold" dir="ltr">{t.name}</code>
                  {t.builtin && <Badge variant="outline" className="text-[0.55rem] py-0 text-blue-500 border-blue-500/30">مدمج</Badge>}
                </div>
                <p className="text-[0.7rem] text-muted-foreground mb-1.5">{t.description}</p>
                <div className="flex items-center gap-1 flex-wrap text-[0.6rem]">
                  <Badge variant="outline" className="py-0">{t.framework}</Badge>
                  <Badge variant="outline" className="py-0">{t.language}</Badge>
                  <Badge variant="outline" className="py-0">{t.packageManager}</Badge>
                  <Badge variant="outline" className="py-0">{t.testFramework}</Badge>
                </div>
                <div className="flex gap-1.5 mt-2">
                  <Button
                    onClick={() => handleScaffold(t.name)}
                    disabled={scaffolding === t.name}
                    size="sm"
                    className="h-6 gap-1 text-[0.65rem] flex-1"
                  >
                    {scaffolding === t.name ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                    أنشئ مشروع (394)
                  </Button>
                  {!t.builtin && (
                    <Button onClick={() => handleDelete(t.id)} variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-red-500">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 2: Detection (395-398, 400)
// ─────────────────────────────────────────────────────────────────────────

function DetectionTab() {
  const [data, setData] = React.useState<Record<string, any>>({})
  const [loading, setLoading] = React.useState<string | null>(null)

  const detectors: Array<{ key: string; label: string; icon: React.ReactNode; feature: number; mode: string }> = [
    { key: "framework", label: "Framework Detection", icon: <Code2 className="h-3.5 w-3.5" />, feature: 395, mode: "framework" },
    { key: "pm", label: "Package Manager", icon: <Package className="h-3.5 w-3.5" />, feature: 396, mode: "package_manager" },
    { key: "test", label: "Test Framework", icon: <TestTube className="h-3.5 w-3.5" />, feature: 397, mode: "test_framework" },
    { key: "commands", label: "Command Discovery", icon: <Terminal className="h-3.5 w-3.5" />, feature: 398, mode: "commands" },
  ]

  const run = async (key: string, mode: string) => {
    setLoading(key)
    try {
      const result = await apiGet(mode)
      setData(prev => ({ ...prev, [key]: result }))
      toast.success(`${key}: تم`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(null)
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-2">
        <div>
          <h3 className="text-sm font-semibold">الكشف / Detection (395-398)</h3>
          <p className="text-[0.7rem] text-muted-foreground mt-0.5">
            كشف تلقائي لإطار العمل + مدير الحزم + إطار الاختبار + الأوامر
          </p>
        </div>

        {detectors.map(d => {
          const result = data[d.key]
          return (
            <div key={d.key} className="rounded-md border border-border/60 bg-card/50 p-2">
              <div className="flex items-center gap-2 mb-1">
                {d.icon}
                <span className="text-xs font-medium flex-1">{d.label}</span>
                <Badge variant="outline" className="text-[0.55rem] py-0">#{d.feature}</Badge>
                <Button onClick={() => run(d.key, d.mode)} disabled={!!loading} variant="outline" size="sm" className="h-6 gap-1 text-xs">
                  {loading === d.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                  كشف
                </Button>
              </div>
              {result && (
                <div className="mt-1.5 pt-1.5 border-t border-border/40 text-[0.7rem] space-y-0.5">
                  {d.key === "framework" && (
                    <>
                      <div className="flex justify-between"><span className="text-muted-foreground">الإطار:</span><code className="font-mono font-bold">{result.name}</code></div>
                      {result.version && <div className="flex justify-between"><span className="text-muted-foreground">الإصدار:</span><code className="font-mono">{result.version}</code></div>}
                      <div className="flex justify-between"><span className="text-muted-foreground">الثقة:</span><span className="font-mono">{result.confidence}%</span></div>
                      <p className="text-muted-foreground text-[0.65rem]">{result.reason}</p>
                    </>
                  )}
                  {d.key === "pm" && (
                    <>
                      <div className="flex justify-between"><span className="text-muted-foreground">المدير:</span><code className="font-mono font-bold">{result.name}</code></div>
                      {result.lockFile && <div className="flex justify-between"><span className="text-muted-foreground">Lock file:</span><code className="font-mono">{result.lockFile}</code></div>}
                      <p className="text-muted-foreground text-[0.65rem]">{result.reason}</p>
                    </>
                  )}
                  {d.key === "test" && (
                    <>
                      <div className="flex justify-between"><span className="text-muted-foreground">الإطار:</span><code className="font-mono font-bold">{result.name}</code></div>
                      {result.configFiles?.length > 0 && (
                        <div className="flex justify-between"><span className="text-muted-foreground">Config:</span><code className="font-mono text-[0.6rem]">{result.configFiles.join(", ")}</code></div>
                      )}
                      <p className="text-muted-foreground text-[0.65rem]">{result.reason}</p>
                    </>
                  )}
                  {d.key === "commands" && (
                    <div className="space-y-0.5 max-h-32 overflow-y-auto">
                      {Array.isArray(result) && result.slice(0, 8).map((c: any, i: number) => (
                        <div key={i} className="flex justify-between">
                          <code className="font-mono text-[0.65rem]" dir="ltr">{c.name}</code>
                          <code className="font-mono text-[0.65rem] text-muted-foreground" dir="ltr">{c.command}</code>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 3: Constitution (399, 401-405)
// ─────────────────────────────────────────────────────────────────────────

function ConstitutionTab() {
  const [subtab, setSubtab] = React.useState("instruction")
  const [rules, setRules] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)
  const [showForm, setShowForm] = React.useState(false)
  const [title, setTitle] = React.useState("")
  const [content, setContent] = React.useState("")
  const [severity, setSeverity] = React.useState("medium")

  const TYPES: Array<{ key: string; label: string; feature: number; icon: React.ReactNode }> = [
    { key: "instruction", label: "تعليمات", feature: 401, icon: <BookOpen className="h-3 w-3" /> },
    { key: "critical_file", label: "ملفات محمية", feature: 402, icon: <FileWarning className="h-3 w-3" /> },
    { key: "dangerous_op", label: "عمليات ممنوعة", feature: 403, icon: <AlertTriangle className="h-3 w-3" /> },
    { key: "definition_of_done", label: "DoD", feature: 404, icon: <CheckCircle className="h-3 w-3" /> },
    { key: "runbook", label: "خطط تنفيذ", feature: 405, icon: <ScrollText className="h-3 w-3" /> },
  ]

  const MODE_MAP: Record<string, string> = {
    instruction: "instructions",
    critical_file: "critical_files",
    dangerous_op: "dangerous_ops",
    definition_of_done: "dod_templates",
    runbook: "runbooks",
  }

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet(MODE_MAP[subtab])
      setRules(data ?? [])
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [subtab])

  React.useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error("العنوان والمحتوى مطلوبان")
      return
    }
    try {
      await apiCall("constitution_add", { type: subtab, title, content, severity })
      toast.success("أُضيفت القاعدة")
      setTitle(""); setContent(""); setShowForm(false)
      load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("حذف القاعدة؟")) return
    try {
      await apiCall("constitution_delete", { id })
      toast.success("حُذفت")
      load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const currentType = TYPES.find(t => t.key === subtab)

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-muted/20 px-2 py-1.5">
        <div className="flex flex-wrap gap-1">
          {TYPES.map(t => (
            <button
              key={t.key}
              onClick={() => setSubtab(t.key)}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-[0.65rem] font-medium transition-colors",
                subtab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {t.icon}
              {t.label}
              <Badge variant="outline" className="text-[0.5rem] py-0 ml-1">#{t.feature}</Badge>
            </button>
          ))}
        </div>
      </div>

      <div className="border-b border-border/60 bg-muted/10 px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold">{currentType?.label} (399)</span>
        <Button onClick={() => setShowForm(!showForm)} size="sm" className="h-7 gap-1 text-xs">
          <Plus className="h-3 w-3" /> جديد
        </Button>
      </div>

      {showForm && (
        <div className="border-b border-border/60 bg-muted/10 px-3 py-2 space-y-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="العنوان" className="text-xs h-7" dir="ltr" />
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="المحتوى" className="text-xs" rows={3} />
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low">low</SelectItem>
              <SelectItem value="medium">medium</SelectItem>
              <SelectItem value="high">high</SelectItem>
              <SelectItem value="critical">critical</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleAdd} size="sm" className="w-full h-7 text-xs">
            <CheckCircle className="h-3 w-3" /> أنشئ
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
          ) : rules.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              لا قواعد
            </div>
          ) : (
            rules.map((r, i) => (
              <div key={r.id ?? i} className="rounded-md border border-border/60 bg-card/50 p-2">
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  <Badge variant="outline" className="text-[0.55rem] py-0">{r.severity}</Badge>
                  {r.builtin && <Badge variant="outline" className="text-[0.55rem] py-0 text-blue-500 border-blue-500/30">مدمج</Badge>}
                  {!r.builtin && (
                    <Button onClick={() => handleDelete(r.id)} variant="ghost" size="icon" className="h-5 w-5 ml-auto text-muted-foreground hover:text-red-500">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                <p className="text-xs font-medium mb-1" dir="ltr">{r.title}</p>
                <pre className="text-[0.65rem] text-muted-foreground whitespace-pre-wrap font-mono">{r.content}</pre>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Tab 4: Profile (400)
// ─────────────────────────────────────────────────────────────────────────

function ProfileTab() {
  const [profile, setProfile] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet("profile")
      setProfile(data)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="text-center text-xs text-muted-foreground py-8">
        <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
        جارٍ التحميل…
      </div>
    )
  }

  if (!profile) {
    return <div className="text-center text-xs text-muted-foreground py-8">لا بيانات</div>
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-2">
        <div>
          <h3 className="text-sm font-semibold">ملف المستودع / Repository Profile (400)</h3>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <ProfileCard label="الإطار" value={profile.framework?.name ?? "unknown"} sub={profile.framework?.version} tone="blue" />
          <ProfileCard label="مدير الحزم" value={profile.packageManager?.name ?? "unknown"} sub={profile.packageManager?.lockFile} tone="emerald" />
          <ProfileCard label="إطار الاختبار" value={profile.testFramework?.name ?? "unknown"} tone="amber" />
          <ProfileCard label="Git Repo" value={profile.gitRepo ? "✅ نعم" : "❌ لا"} tone={profile.gitRepo ? "emerald" : "red"} />
          <ProfileCard label="إجمالي الملفات" value={profile.totalFiles ?? 0} tone="default" />
          <ProfileCard label="إجمالي الأسطر" value={(profile.totalLines ?? 0).toLocaleString()} tone="default" />
        </div>

        {profile.languages?.length > 0 && (
          <div className="rounded-md border border-border/60 bg-card/50 p-2">
            <p className="text-xs font-semibold mb-1">اللغات</p>
            <div className="space-y-0.5">
              {profile.languages.slice(0, 8).map((lang: any, i: number) => (
                <div key={i} className="flex justify-between text-[0.7rem]">
                  <span>{lang.name}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${lang.percentage}%` }} />
                    </div>
                    <span className="font-mono w-8 text-left">{lang.percentage}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {profile.commands?.length > 0 && (
          <div className="rounded-md border border-border/60 bg-card/50 p-2">
            <p className="text-xs font-semibold mb-1">الأوامر المكتشفة</p>
            <div className="space-y-0.5">
              {profile.commands.slice(0, 10).map((c: any, i: number) => (
                <div key={i} className="flex justify-between text-[0.7rem]">
                  <code className="font-mono" dir="ltr">{c.name}</code>
                  <code className="font-mono text-muted-foreground" dir="ltr">{c.command}</code>
                </div>
              ))}
            </div>
          </div>
        )}

        <Button onClick={load} variant="outline" size="sm" className="w-full h-7 text-xs">
          <RefreshCw className="h-3 w-3" /> تحديث
        </Button>
      </div>
    </ScrollArea>
  )
}

function ProfileCard({ label, value, sub, tone }: {
  label: string; value: string | number; sub?: string; tone: "emerald" | "red" | "amber" | "blue" | "default"
}) {
  const toneClass = {
    emerald: "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400",
    red: "border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400",
    amber: "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400",
    blue: "border-blue-500/30 bg-blue-500/5 text-blue-600 dark:text-blue-400",
    default: "border-border/60 bg-card/50",
  }[tone]
  return (
    <div className={cn("rounded-md border p-2", toneClass)}>
      <div className="text-[0.65rem] text-muted-foreground mb-0.5">{label}</div>
      <div className="text-sm font-mono font-bold">{value}</div>
      {sub && <div className="text-[0.6rem] text-muted-foreground mt-0.5" dir="ltr">{sub}</div>}
    </div>
  )
}
