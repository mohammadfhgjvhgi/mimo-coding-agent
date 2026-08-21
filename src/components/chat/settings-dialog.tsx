"use client"

import * as React from "react"
import {
  Settings as SettingsIcon,
  Palette,
  Cpu,
  MessageSquare,
  Brain,
  Database,
  Info,
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  ExternalLink,
  Key,
  Star,
  RefreshCw,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/store/settings-store"
import { toast } from "sonner"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
}

const SECTIONS = [
  { id: "general", label: "عام", icon: SettingsIcon },
  { id: "appearance", label: "المظهر", icon: Palette },
  { id: "models", label: "النماذج", icon: Cpu },
  { id: "chat", label: "المحادثة", icon: MessageSquare },
  { id: "memory", label: "الذاكرة", icon: Brain },
  { id: "data", label: "البيانات", icon: Database },
  { id: "about", label: "حول", icon: Info },
] as const

type SectionId = typeof SECTIONS[number]["id"]

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [section, setSection] = React.useState<SectionId>("models")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-none sm:!max-w-5xl w-[95vw] h-[90vh] !p-0 !gap-0 overflow-hidden flex">
        <DialogHeader className="sr-only">
          <DialogTitle>الإعدادات / Settings</DialogTitle>
        </DialogHeader>
        {/* Left sidebar — categories */}
        <div className="w-52 shrink-0 border-l border-border bg-sidebar/50 flex flex-col h-full">
          <div className="px-4 py-4 border-b border-sidebar-border shrink-0">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <SettingsIcon className="h-4 w-4 text-primary" />
              الإعدادات
            </h2>
            <p className="text-[0.6rem] text-muted-foreground mt-0.5">Settings</p>
          </div>
          <div className="flex-1 overflow-y-auto chat-scroll py-2 min-h-0">
            {SECTIONS.map(s => {
              const Icon = s.icon
              return (
                <button
                  key={s.id}
                  onClick={() => setSection(s.id)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-all text-right",
                    section === s.id
                      ? "bg-primary/10 text-primary border-r-2 border-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{s.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Right — content */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <div className="border-b border-border px-6 py-3 flex items-center justify-between shrink-0">
            <h3 className="text-base font-semibold">
              {SECTIONS.find(s => s.id === section)?.label}
            </h3>
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              إغلاق
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto chat-scroll px-6 py-4 min-h-0">
            {section === "general" && <GeneralSection />}
            {section === "appearance" && <AppearanceSection />}
            {section === "models" && <ModelsSection />}
            {section === "chat" && <ChatSection />}
            {section === "memory" && <MemorySection />}
            {section === "data" && <DataSection />}
            {section === "about" && <AboutSection />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// 1. General
// ─────────────────────────────────────────────────────────────────────────
function GeneralSection() {
  const s = useSettingsStore()
  const [enterToSend, setEnterToSend] = React.useState(true)
  const [streaming, setStreaming] = React.useState(true)

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h4 className="text-sm font-medium mb-3">السلوك العام / General Behavior</h4>
        <div className="space-y-3">
          <SettingRow
            label="Enter للإرسال / Enter to send"
            description="إرسال الرسالة عند الضغط على Enter (Shift+Enter لسطر جديد)"
          >
            <Switch checked={enterToSend} onCheckedChange={setEnterToSend} />
          </SettingRow>
          <SettingRow
            label="البث المباشر / Streaming"
            description="عرض الرد كلمًا بكلم أثناء توليده"
          >
            <Switch checked={streaming} onCheckedChange={setStreaming} />
          </SettingRow>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Appearance
// ─────────────────────────────────────────────────────────────────────────
function AppearanceSection() {
  const [density, setDensity] = React.useState<"comfortable" | "compact">("comfortable")

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h4 className="text-sm font-medium mb-3">المظهر / Appearance</h4>
        <div className="space-y-3">
          <SettingRow label="السمة / Theme" description="فاتح، داكن، أو تلقائي">
            <div className="flex gap-2">
              {["light", "dark", "system"].map(t => (
                <Button
                  key={t}
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const root = document.documentElement
                    if (t === "dark") root.classList.add("dark")
                    else if (t === "light") root.classList.remove("dark")
                    else {
                      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
                      root.classList.toggle("dark", prefersDark)
                    }
                  }}
                >
                  {t === "light" ? "☀️ فاتح" : t === "dark" ? "🌙 داكن" : "🖥️ تلقائي"}
                </Button>
              ))}
            </div>
          </SettingRow>
          <SettingRow label="الكثافة / Density" description="compact أو comfortable">
            <div className="flex gap-2">
              {(["comfortable", "compact"] as const).map(d => (
                <Button
                  key={d}
                  size="sm"
                  variant={density === d ? "default" : "outline"}
                  onClick={() => setDensity(d)}
                >
                  {d === "comfortable" ? "مريح" : "مضغوط"}
                </Button>
              ))}
            </div>
          </SettingRow>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Models (the big one — Multi-Provider)
// ─────────────────────────────────────────────────────────────────────────
interface ProviderState {
  providerId: string
  name: string
  logo: string
  accent: string
  description: string
  baseURL: string
  hasKey: boolean
  apiKey: string
  enabled: boolean
  isDefault: boolean
  testing: boolean
  testResult: "idle" | "ok" | "fail"
  testError?: string
  showKey: boolean
  models: Array<{ id: string; name: string; contextWindow: number }>
}

function ModelsSection() {
  const [providers, setProviders] = React.useState<ProviderState[]>([])
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState<string | null>(null)

  const loadProviders = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/providers")
      const data = await res.json()
      setProviders((data.providers || []).map((p: ProviderState & { models: ProviderState["models"] }) => ({
        ...p,
        apiKey: p.apiKey || "",
        showKey: false,
        testing: false,
        testResult: "idle" as const,
      })))
    } catch {} finally { setLoading(false) }
  }

  React.useEffect(() => { loadProviders() }, [])

  const updateProvider = (id: string, patch: Partial<ProviderState>) => {
    setProviders(prev => prev.map(p => p.providerId === id ? { ...p, ...patch } : p))
  }

  const saveProvider = async (p: ProviderState) => {
    setSaving(p.providerId)
    try {
      await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: p.providerId,
          name: p.name,
          apiKey: p.apiKey || null,
          baseURL: p.baseURL,
          enabled: p.enabled,
          isDefault: p.isDefault,
        }),
      })
      toast.success(`تم حفظ ${p.name}`)
    } catch {
      toast.error("فشل الحفظ")
    } finally { setSaving(null) }
  }

  const testProvider = async (p: ProviderState) => {
    updateProvider(p.providerId, { testing: true, testResult: "idle" })
    try {
      const res = await fetch("/api/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: p.providerId,
          apiKey: p.apiKey,
          baseURL: p.baseURL,
        }),
      })
      const data = await res.json()
      updateProvider(p.providerId, {
        testing: false,
        testResult: data.ok ? "ok" : "fail",
        testError: data.error,
      })
      if (data.ok) toast.success(`${p.name}: متصل ✓`)
      else toast.error(`${p.name}: ${data.error || "فشل"}`)
    } catch (e) {
      updateProvider(p.providerId, { testing: false, testResult: "fail", testError: String(e) })
    }
  }

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium">مزوّدو النماذج / Model Providers</h4>
          <p className="text-xs text-muted-foreground mt-0.5">إدارة 8 مزوّدين — OpenAI, Claude, Gemini, DeepSeek, Groq, Mistral, OpenRouter, Ollama</p>
        </div>
        <Button size="sm" variant="ghost" onClick={loadProviders}>
          <RefreshCw className="h-3.5 w-3.5" /> تحديث
        </Button>
      </div>

      <div className="space-y-3">
        {providers.map(p => (
          <div
            key={p.providerId}
            className={cn(
              "rounded-xl border p-4 transition-all elevated-card",
              p.isDefault && "border-primary/40 glow-primary"
            )}
          >
            {/* Header */}
            <div className="flex items-center gap-3 mb-3">
              <div
                className="flex h-9 w-9 items-center justify-center rounded-lg text-lg shrink-0"
                style={{ backgroundColor: `${p.accent}15`, border: `1px solid ${p.accent}30` }}
              >
                {p.logo}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{p.name}</span>
                  {p.isDefault && <Badge variant="default" className="text-[0.55rem] py-0"><Star className="h-2.5 w-2.5" /> افتراضي</Badge>}
                  {p.testResult === "ok" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                  {p.testResult === "fail" && <XCircle className="h-3.5 w-3.5 text-red-500" />}
                </div>
                <p className="text-[0.65rem] text-muted-foreground truncate">{p.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={p.enabled}
                  onCheckedChange={(v) => updateProvider(p.providerId, { enabled: v })}
                />
              </div>
            </div>

            {/* API key input */}
            {p.providerId !== "zai" && (
              <div className="space-y-2">
                {p.providerId !== "ollama" && (
                  <div>
                    <Label className="text-[0.65rem] text-muted-foreground mb-1 flex items-center gap-1">
                      <Key className="h-3 w-3" /> API Key
                    </Label>
                    <div className="flex gap-1.5">
                      <div className="relative flex-1">
                        <Input
                          type={p.showKey ? "text" : "password"}
                          value={p.apiKey}
                          onChange={(e) => updateProvider(p.providerId, { apiKey: e.target.value })}
                          placeholder={p.hasKey ? "•••••••••••• (محفوظ)" : "sk-..."}
                          className="text-xs pr-9 font-mono"
                        />
                        <button
                          onClick={() => updateProvider(p.providerId, { showKey: !p.showKey })}
                          className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {p.showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => testProvider(p)}
                        disabled={p.testing}
                        className="h-9 text-xs"
                      >
                        {p.testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "اختبار"}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => saveProvider(p)}
                        disabled={saving === p.providerId}
                        className="h-9 text-xs"
                      >
                        {saving === p.providerId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "حفظ"}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Base URL */}
                <div>
                  <Label className="text-[0.65rem] text-muted-foreground mb-1 block">Base URL</Label>
                  <Input
                    type="text"
                    value={p.baseURL}
                    onChange={(e) => updateProvider(p.providerId, { baseURL: e.target.value })}
                    className="text-xs font-mono"
                    placeholder="https://api.example.com/v1"
                  />
                </div>

                {/* Models preview */}
                {p.models.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {p.models.slice(0, 4).map(m => (
                      <Badge key={m.id} variant="secondary" className="text-[0.55rem] py-0">
                        {m.name}
                      </Badge>
                    ))}
                    {p.models.length > 4 && (
                      <Badge variant="outline" className="text-[0.55rem] py-0">
                        +{p.models.length - 4}
                      </Badge>
                    )}
                  </div>
                )}

                {p.testResult === "fail" && p.testError && (
                  <div className="mt-2 rounded-md bg-red-500/10 border border-red-500/20 px-2 py-1 text-[0.6rem] text-red-600 dark:text-red-400">
                    {p.testError.slice(0, 150)}
                  </div>
                )}
              </div>
            )}

            {/* Set as default */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
              <span className="text-[0.65rem] text-muted-foreground">
                {p.models.length} نموذج متاح
              </span>
              {!p.isDefault && p.enabled && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    updateProvider(p.providerId, { isDefault: true })
                    setProviders(prev => prev.map(x => ({ ...x, isDefault: x.providerId === p.providerId })))
                    await saveProvider({ ...p, isDefault: true })
                  }}
                  className="h-7 text-[0.65rem]"
                >
                  <Star className="h-3 w-3" /> اجعله افتراضي
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Chat
// ─────────────────────────────────────────────────────────────────────────
function ChatSection() {
  const [systemPrompt, setSystemPrompt] = React.useState("")
  const [contextBudget, setContextBudget] = React.useState(28000)
  const [injectMemory, setInjectMemory] = React.useState(true)

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h4 className="text-sm font-medium mb-3">السياق / Context</h4>
        <SettingRow label="ميزانية السياق / Context Budget" description="أقصى عدد من الـtokens لكل محادثة">
          <Input
            type="number"
            value={contextBudget}
            onChange={(e) => setContextBudget(Number(e.target.value))}
            className="w-32 text-xs"
          />
        </SettingRow>
      </div>
      <div>
        <h4 className="text-sm font-medium mb-3">حقن الذاكرة / Memory Injection</h4>
        <SettingRow label="حقن الذكريات / Inject memories" description="تضمين الذكريات المحفوظة في بداية كل محادثة">
          <Switch checked={injectMemory} onCheckedChange={setInjectMemory} />
        </SettingRow>
      </div>
      <div>
        <h4 className="text-sm font-medium mb-3">System Prompt افتراضي</h4>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="أنت مساعد ذكي..."
          className="w-full min-h-24 rounded-lg border border-border bg-background p-3 text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// 5. Memory
// ─────────────────────────────────────────────────────────────────────────
function MemorySection() {
  const [memories, setMemories] = React.useState<Array<{ id: string; key: string; value: string; category: string }>>([])
  const [loading, setLoading] = React.useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/memory")
      const data = await res.json()
      setMemories(data.memories || [])
    } catch {} finally { setLoading(false) }
  }

  React.useEffect(() => { load() }, [])

  const deleteMem = async (id: string) => {
    await fetch(`/api/memory?id=${id}`, { method: "DELETE" })
    setMemories(prev => prev.filter(m => m.id !== id))
    toast.success("تم الحذف")
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">الذكريات المحفوظة / Saved Memories</h4>
        <Button size="sm" variant="ghost" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : memories.length === 0 ? (
        <div className="text-center py-8 text-xs text-muted-foreground">لا ذكريات محفوظة</div>
      ) : (
        <div className="space-y-2">
          {memories.map(m => (
            <div key={m.id} className="flex items-start gap-2 rounded-lg border border-border p-2.5">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <Badge variant="secondary" className="text-[0.5rem] py-0">{m.category}</Badge>
                  <span className="text-xs font-medium font-mono">{m.key}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{m.value}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => deleteMem(m.id)} className="h-7 text-xs text-red-500 hover:text-red-600">
                حذف
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// 6. Data (Export)
// ─────────────────────────────────────────────────────────────────────────
function DataSection() {
  const [exporting, setExporting] = React.useState(false)

  const exportAll = async (format: "md" | "json" | "html") => {
    setExporting(true)
    try {
      const res = await fetch("/api/conversations")
      const data = await res.json()
      const convs = data.conversations || []
      // For now, export conversation list as JSON
      const blob = new Blob([JSON.stringify(convs, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `mimo-conversations-${Date.now()}.${format === "json" ? "json" : format}`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`تم تصدير ${convs.length} محادثة`)
    } catch {
      toast.error("فشل التصدير")
    } finally { setExporting(false) }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h4 className="text-sm font-medium mb-3">تصدير المحادثات / Export Conversations</h4>
        <div className="grid grid-cols-3 gap-2">
          <Button onClick={() => exportAll("json")} disabled={exporting} variant="outline" className="flex flex-col gap-1 h-auto py-3">
            <Database className="h-5 w-5" />
            <span className="text-xs">JSON</span>
            <span className="text-[0.6rem] text-muted-foreground">lossless</span>
          </Button>
          <Button onClick={() => exportAll("md")} disabled={exporting} variant="outline" className="flex flex-col gap-1 h-auto py-3">
            <MessageSquare className="h-5 w-5" />
            <span className="text-xs">Markdown</span>
            <span className="text-[0.6rem] text-muted-foreground">human-readable</span>
          </Button>
          <Button onClick={() => exportAll("html")} disabled={exporting} variant="outline" className="flex flex-col gap-1 h-auto py-3">
            <ExternalLink className="h-5 w-5" />
            <span className="text-xs">HTML</span>
            <span className="text-[0.6rem] text-muted-foreground">styled</span>
          </Button>
        </div>
      </div>
      <div>
        <h4 className="text-sm font-medium mb-3">إجراءات خطيرة / Dangerous Actions</h4>
        <Button
          variant="destructive"
          size="sm"
          onClick={async () => {
            if (!confirm("هل أنت متأكد؟ سيتم حذف كل المحادثات.")) return
            await fetch("/api/conversations", { method: "DELETE" })
            toast.success("تم حذف كل المحادثات")
          }}
        >
          حذف كل المحادثات
        </Button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// 7. About
// ─────────────────────────────────────────────────────────────────────────
function AboutSection() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div className="text-center py-8">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl gradient-primary text-white elevate-2 mb-3">
          <Brain className="h-8 w-8" />
        </div>
        <h3 className="text-xl font-bold">MiMo X</h3>
        <p className="text-xs text-muted-foreground mt-1">Personal AI & Software Engineering OS</p>
        <p className="text-[0.65rem] text-muted-foreground mt-0.5">v1.0.0 — Local-first</p>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <InfoCard label="المزودون المدعومون" value="8 providers" />
        <InfoCard label="النماذج" value="30+ models" />
        <InfoCard label="أنظمة التشغيل" value="10 OS modules" />
        <InfoCard label="API Routes" value="104 routes" />
      </div>
      <div className="text-center">
        <a
          href="https://github.com/mimo-x"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-primary link-underline"
        >
          <ExternalLink className="h-3 w-3" /> GitHub Repository
        </a>
      </div>
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3 text-center">
      <div className="text-base font-bold text-primary">{value}</div>
      <div className="text-[0.6rem] text-muted-foreground mt-0.5">{label}</div>
    </div>
  )
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium">{label}</div>
        {description && <div className="text-[0.65rem] text-muted-foreground mt-0.5">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
