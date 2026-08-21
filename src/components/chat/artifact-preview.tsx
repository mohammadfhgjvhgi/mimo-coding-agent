"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Eye, Code2, History, GitCompare, Download, GitFork, Share2, Maximize2, RotateCcw, Loader2, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"

export interface ArtifactLite {
  id: string
  slug: string
  title: string
  description?: string | null
  type: string
  version: number
  language?: string | null
}

interface Props {
  artifact: ArtifactLite
  /** Compact (inline in chat) vs Full (panel). Default compact. */
  compact?: boolean
}

type Tab = "preview" | "code" | "history" | "diff"

interface VersionInfo {
  version: number
  createdAt: string
  sizeBytes: number
  additions: number
  deletions: number
  editSource: string
  reason?: string
}

interface DiffData {
  fromVersion: number
  toVersion: number
  diff: {
    additions: number
    deletions: number
    blocks: Array<{ type: "context" | "addition" | "deletion"; lines: string[] }>
  }
}

const TYPE_LABELS: Record<string, string> = {
  html: "🌐 HTML",
  svg: "🎨 SVG",
  dashboard: "📊 لوحة",
  diagram: "🔀 مخطط",
  report: "📄 تقرير",
  code: "💻 كود",
  visualization: "📈 تصور",
  react: "⚛️ React",
  markdown: "📝 Markdown",
}

const TYPE_COLORS: Record<string, string> = {
  html: "bg-orange-500/15 text-orange-600 border-orange-500/30",
  svg: "bg-purple-500/15 text-purple-600 border-purple-500/30",
  dashboard: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  diagram: "bg-pink-500/15 text-pink-600 border-pink-500/30",
  report: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  code: "bg-gray-500/15 text-gray-600 border-gray-500/30",
  visualization: "bg-cyan-500/15 text-cyan-600 border-cyan-500/30",
  react: "bg-sky-500/15 text-sky-600 border-sky-500/30",
  markdown: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30",
}

export function ArtifactPreview({ artifact, compact = true }: Props) {
  const [tab, setTab] = useState<Tab>("preview")
  const [previewHtml, setPreviewHtml] = useState<string>("")
  const [rawContent, setRawContent] = useState<string>("")
  const [versions, setVersions] = useState<VersionInfo[]>([])
  const [diffData, setDiffData] = useState<DiffData | null>(null)
  const [fromVer, setFromVer] = useState<string>("1")
  const [toVer, setToVer] = useState<string>(String(artifact.version))
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState("")
  const [shareOpen, setShareOpen] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [sharePassword, setSharePassword] = useState("")
  const [shareExpiry, setShareExpiry] = useState("24")
  const [fullscreen, setFullscreen] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const loadPreview = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/artifacts/${artifact.id}/preview`)
      const data = await res.json()
      if (data.html) setPreviewHtml(data.html)
      if (data.raw) setRawContent(data.raw)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [artifact.id])

  const loadVersions = useCallback(async () => {
    try {
      const res = await fetch(`/api/artifacts/${artifact.id}/versions`)
      const data = await res.json()
      if (data.versions) {
        setVersions(data.versions)
        setFromVer(String(Math.max(1, data.versions.length - 1)))
        setToVer(String(data.versions[data.versions.length - 1]?.version ?? artifact.version))
      }
    } catch {
      /* ignore */
    }
  }, [artifact.id, artifact.version])

  const loadDiff = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/artifacts/${artifact.id}/diff?from=${fromVer}&to=${toVer}`)
      const data = await res.json()
      if (data.diff) setDiffData(data)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [artifact.id, fromVer, toVer])

  useEffect(() => {
    if (tab === "preview" && !previewHtml) loadPreview()
    if (tab === "code" && !rawContent) loadPreview()
    if (tab === "history" && versions.length === 0) loadVersions()
    if (tab === "diff" && !diffData) loadDiff()
  }, [tab]) // tab changes trigger loads; other deps intentionally omitted

  const handleEdit = async () => {
    setEditing(true)
  }

  const saveEdit = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/artifacts/${artifact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent, reason: "edit from UI", editSource: "user" }),
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.message || data.error)
      } else {
        toast.success("✅ تم حفظ الإصدار الجديد / saved new version")
        setEditing(false)
        setRawContent(editContent)
        // Reload preview + versions.
        setPreviewHtml("")
        setVersions([])
        setDiffData(null)
        loadPreview()
        loadVersions()
      }
    } catch (e) {
      toast.error("فشل الحفظ: " + String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async (format: "raw" | "html" | "svg" | "md" | "json") => {
    window.open(`/api/artifacts/${artifact.id}/export?format=${format}`, "_blank")
  }

  const handleFork = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/artifacts/${artifact.id}/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.message || data.error)
      } else {
        toast.success(`✅ تم التفريع / forked: ${data.artifact.title}`)
      }
    } catch {
      toast.error("فشل التفريع")
    } finally {
      setLoading(false)
    }
  }

  const handleShare = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/artifacts/${artifact.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: sharePassword || undefined,
          expiresInHours: shareExpiry ? Number(shareExpiry) : undefined,
          allowFork: true,
        }),
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.message || data.error)
      } else {
        const url = `${window.location.origin}/api/artifacts/share/${data.share.token}`
        setShareUrl(url)
        navigator.clipboard.writeText(url).catch(() => {})
        toast.success("✅ تم إنشاء رابط المشاركة ونسخه")
      }
    } catch {
      toast.error("فشل المشاركة")
    } finally {
      setLoading(false)
    }
  }

  const handleRestore = async (version: number) => {
    if (!confirm(`استعادة الإصدار ${version}؟ سيُنشئ إصداراً جديداً بنفس المحتوى.`)) return
    setLoading(true)
    try {
      const res = await fetch(`/api/artifacts/${artifact.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", version }),
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.message || data.error)
      } else {
        toast.success(`✅ تمت الاستعادة إلى v${version} (إصدار جديد)`)
        setVersions([])
        setPreviewHtml("")
        setDiffData(null)
        loadVersions()
        loadPreview()
      }
    } catch {
      toast.error("فشل الاستعادة")
    } finally {
      setLoading(false)
    }
  }

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: "preview", label: "معاينة", icon: <Eye className="h-3 w-3" /> },
    { id: "code", label: "الكود", icon: <Code2 className="h-3 w-3" /> },
    { id: "history", label: "الإصدارات", icon: <History className="h-3 w-3" /> },
    { id: "diff", label: "الفرق", icon: <GitCompare className="h-3 w-3" /> },
  ]

  return (
    <div className={`rounded-lg border border-sidebar-border bg-sidebar overflow-hidden ${compact ? "" : "h-full flex flex-col"}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-sidebar-border bg-sidebar-accent/30">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="outline" className={`text-[0.6rem] px-1.5 py-0 ${TYPE_COLORS[artifact.type] ?? ""}`}>
            {TYPE_LABELS[artifact.type] ?? artifact.type}
          </Badge>
          <span className="text-xs font-medium truncate">{artifact.title}</span>
          <span className="text-[0.6rem] text-muted-foreground shrink-0">v{artifact.version}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setFullscreen(true)} title="تكبير">
            <Maximize2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-sidebar-border bg-sidebar/50">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[0.7rem] font-medium transition-colors ${
              tab === t.id ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-0.5">
          {tab === "code" && !editing && (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[0.7rem]" onClick={() => { setEditContent(rawContent); setEditing(true) }}>
              تحرير
            </Button>
          )}
          {tab === "code" && editing && (
            <>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[0.7rem]" onClick={() => setEditing(false)}>إلغاء</Button>
              <Button size="sm" variant="default" className="h-6 px-2 text-[0.7rem]" onClick={saveEdit} disabled={loading}>
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "حفظ"}
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={handleFork} title="تفريع">
            <GitFork className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setShareOpen(true)} title="مشاركة">
            <Share2 className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => handleExport("html")} title="تصدير HTML">
            <Download className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className={`relative ${compact ? "h-64" : "flex-1 min-h-0"}`}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {tab === "preview" && (
          <iframe
            ref={iframeRef}
            srcDoc={`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><style>*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,sans-serif}</style></head><body>${previewHtml}</body></html>`}
            className="w-full h-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin"
            title={artifact.title}
          />
        )}

        {tab === "code" && (
          <div className="h-full overflow-auto bg-[#0d1117]">
            {editing ? (
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="h-full w-full rounded-none border-0 bg-[#0d1117] text-[#c9d1d9] font-mono text-xs p-3 focus-visible:ring-0 resize-none"
                spellCheck={false}
              />
            ) : (
              <pre className="p-3 text-xs font-mono text-[#c9d1d9] whitespace-pre-wrap break-all overflow-auto h-full">
                {rawContent || "(فارغ / empty)"}
              </pre>
            )}
          </div>
        )}

        {tab === "history" && (
          <div className="h-full overflow-auto p-2 space-y-1 max-h-96">
            {versions.length === 0 && !loading && (
              <div className="text-center text-xs text-muted-foreground py-4">لا إصدارات</div>
            )}
            {versions.slice().reverse().map((v) => (
              <div key={v.version} className="flex items-center justify-between gap-2 p-2 rounded border border-sidebar-border bg-sidebar/50">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="outline" className="text-[0.6rem]">v{v.version}</Badge>
                  <div className="text-[0.7rem] text-muted-foreground">
                    <span className={v.additions > 0 ? "text-emerald-600" : ""}>+{v.additions}</span>
                    {" / "}
                    <span className={v.deletions > 0 ? "text-red-600" : ""}>-{v.deletions}</span>
                    {" · "}
                    {new Date(v.createdAt).toLocaleString("ar")}
                  </div>
                </div>
                {v.version !== artifact.version && (
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[0.7rem]" onClick={() => handleRestore(v.version)} title="استعادة">
                    <RotateCcw className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === "diff" && (
          <div className="h-full overflow-auto p-2 max-h-96">
            <div className="flex items-center gap-2 mb-2">
              <Select value={fromVer} onValueChange={setFromVer}>
                <SelectTrigger className="h-7 text-xs w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {versions.map((v) => <SelectItem key={v.version} value={String(v.version)}>v{v.version}</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">→</span>
              <Select value={toVer} onValueChange={setToVer}>
                <SelectTrigger className="h-7 text-xs w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {versions.map((v) => <SelectItem key={v.version} value={String(v.version)}>v{v.version}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={loadDiff}>احسب</Button>
              {diffData && (
                <span className="text-[0.7rem] text-muted-foreground ml-auto">
                  <span className="text-emerald-600">+{diffData.diff.additions}</span>
                  {" / "}
                  <span className="text-red-600">-{diffData.diff.deletions}</span>
                </span>
              )}
            </div>
            {diffData && (
              <div className="font-mono text-[0.7rem] space-y-0">
                {diffData.diff.blocks.map((b, i) => (
                  <div
                    key={i}
                    className={`whitespace-pre-wrap break-all px-2 py-0.5 ${
                      b.type === "addition" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : b.type === "deletion" ? "bg-red-500/10 text-red-700 dark:text-red-400 line-through opacity-60"
                      : "text-muted-foreground"
                    }`}
                  >
                    {b.lines.map((l, j) => (
                      <div key={j}>
                        {b.type === "addition" ? "+ " : b.type === "deletion" ? "- " : "  "}
                        {l || " "}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Fullscreen dialog */}
      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="max-w-6xl w-[95vw] h-[90vh] p-0 gap-0 flex flex-col">
          <DialogHeader className="px-4 py-2 border-b border-sidebar-border">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Badge variant="outline" className={`text-[0.6rem] ${TYPE_COLORS[artifact.type] ?? ""}`}>
                {TYPE_LABELS[artifact.type] ?? artifact.type}
              </Badge>
              {artifact.title}
              <span className="text-[0.7rem] text-muted-foreground">v{artifact.version}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            <iframe
              srcDoc={`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><style>*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,sans-serif;padding:1rem}</style></head><body>${previewHtml}</body></html>`}
              className="w-full h-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin"
              title={artifact.title}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Share dialog */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Share2 className="h-4 w-4" />
              مشاركة الأرتيفاكت
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {shareUrl ? (
              <div className="space-y-2">
                <Label className="text-xs">رابط المشاركة</Label>
                <Input readOnly value={shareUrl} className="text-xs font-mono" />
                <Button size="sm" variant="outline" className="w-full" onClick={() => navigator.clipboard.writeText(shareUrl)}>
                  نسخ الرابط
                </Button>
                <Button size="sm" variant="ghost" className="w-full" onClick={() => { setShareUrl(null); setSharePassword(""); setShareExpiry("24") }}>
                  إنشاء رابط آخر
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1">
                    <Lock className="h-3 w-3" />
                    كلمة السر (اختياري)
                  </Label>
                  <Input
                    type="password"
                    value={sharePassword}
                    onChange={(e) => setSharePassword(e.target.value)}
                    placeholder="اتركه فارغاً للرابط العام"
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">انتهاء الصلاحية (ساعات)</Label>
                  <Select value={shareExpiry} onValueChange={setShareExpiry}>
                    <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">ساعة</SelectItem>
                      <SelectItem value="24">يوم</SelectItem>
                      <SelectItem value="168">أسبوع</SelectItem>
                      <SelectItem value="720">شهر</SelectItem>
                      <SelectItem value="0">بدون انتهاء</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button size="sm" className="w-full" onClick={handleShare} disabled={loading}>
                  {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "إنشاء رابط المشاركة"}
                </Button>
              </>
            )}
          </div>
          <DialogFooter />
        </DialogContent>
      </Dialog>
    </div>
  )
}
