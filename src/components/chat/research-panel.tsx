"use client"

import * as React from "react"
import { Search, Loader2, FileText, CheckCircle2, XCircle, AlertCircle, Trash2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { MarkdownRenderer } from "./markdown-renderer"

interface ResearchJob {
  id: string
  query: string
  status: string
  depth: string
  createdAt: string
  tokenUsage: number
}

interface ResearchResult {
  jobId: string
  query: string
  status: string
  report: string
  sources: { url: string; title: string; reliability: number; relevanceScore: number }[]
  claims: { text: string; verdict: string; sourceTitle: string }[]
  agreements: { claim: string; sources: string[] }[]
  contradictions: { claim: string; sources: { url: string; verdict: string }[] }[]
  stages: { name: string; detail: string }[]
  tokenUsage: number
}

export function ResearchPanel() {
  const [jobs, setJobs] = React.useState<ResearchJob[]>([])
  const [loading, setLoading] = React.useState(true)
  const [searching, setSearching] = React.useState(false)
  const [result, setResult] = React.useState<ResearchResult | null>(null)
  const [showNew, setShowNew] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [depth, setDepth] = React.useState("standard")

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/research")
      const data = await res.json()
      setJobs(data.jobs || [])
    } catch {}
    setLoading(false)
  }, [])

  React.useEffect(() => { load() }, [load])

  const startResearch = async () => {
    if (!query.trim()) return
    setSearching(true)
    toast.info("بدأ البحث — قد يستغرق دقيقة…")
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), depth }),
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.error)
      } else {
        setResult(data)
        toast.success(`اكتمل البحث — ${data.sources?.length || 0} مصادر، ${data.claims?.length || 0} ادعاءات`)
        load()
      }
    } catch {
      toast.error("فشل البحث")
    }
    setSearching(false)
    setShowNew(false)
    setQuery("")
  }

  const viewJob = async (id: string) => {
    try {
      const res = await fetch(`/api/research/${id}`)
      const data = await res.json()
      if (data.job) {
        setResult({
          jobId: data.job.id,
          query: data.job.query,
          status: data.job.status,
          report: data.job.report || "",
          sources: JSON.parse(data.job.sources || "[]"),
          claims: JSON.parse(data.job.claims || "[]"),
          agreements: data.job.citations ? JSON.parse(data.job.citations).agreements || [] : [],
          contradictions: data.job.citations ? JSON.parse(data.job.citations).contradictions || [] : [],
          stages: [],
          tokenUsage: data.job.tokenUsage || 0,
        })
      }
    } catch {}
  }

  const deleteJob = async (id: string) => {
    setJobs(prev => prev.filter(j => j.id !== id))
    await fetch(`/api/research/${id}`, { method: "DELETE" })
    if (result?.jobId === id) setResult(null)
    toast.success("حُذف البحث")
  }

  return (
    <div className="flex h-full w-full flex-col bg-sidebar">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-sidebar-border">
        <Search className="h-4 w-4 text-blue-500" />
        <span className="flex-1 text-xs font-semibold">البحث العميق</span>
        <Button variant="ghost" size="icon" onClick={load} className="h-7 w-7 rounded-md">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
        <Dialog open={showNew} onOpenChange={setShowNew}>
          <DialogTrigger asChild>
            <Button variant="default" size="sm" className="h-7 gap-1 text-xs">
              <Search className="h-3 w-3" /> بحث
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>بحث عميق جديد</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs">السؤال البحثي</Label>
                <Textarea
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="مثال: أفضل ممارسات Next.js 16 للأداء"
                  className="text-sm min-h-[60px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">العمق</Label>
                <Select value={depth} onValueChange={setDepth}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="quick">سريع (1 استعلام، 3 مصادر)</SelectItem>
                    <SelectItem value="standard">قياسي (3 استعلامات، 6 مصادر)</SelectItem>
                    <SelectItem value="deep">عميق (5 استعلامات، 10 مصادر)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="rounded-md bg-blue-500/5 p-2 text-[0.7rem] text-blue-600 dark:text-blue-400">
                🔍 يبحث في DuckDuckGo، يستخرج النص، يتحقق من الادعاءات، ويكتب تقريراً بالعربية.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={startResearch} disabled={searching || !query.trim()}>
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                ابدأ البحث
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {searching ? (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            <p className="text-xs text-muted-foreground">جارٍ البحث والتحقق…</p>
          </div>
        ) : result ? (
          <div className="flex-1 min-h-0 overflow-y-scroll chat-scroll">
            <div className="p-3 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold">{result.query}</h3>
                <Button variant="ghost" size="sm" onClick={() => setResult(null)} className="text-xs">رجوع</Button>
              </div>

              {/* Sources */}
              {result.sources.length > 0 && (
                <div>
                  <p className="text-[0.7rem] font-medium text-muted-foreground mb-1">المصادر ({result.sources.length})</p>
                  <div className="space-y-1">
                    {result.sources.slice(0, 10).map((s, i) => (
                      <div key={i} className="flex items-center gap-1.5 rounded border border-border bg-card p-1.5 text-[0.7rem]">
                        <span className="font-mono text-muted-foreground">[{i + 1}]</span>
                        <span className="flex-1 truncate">{s.title}</span>
                        <Badge variant="outline" className="text-[0.6rem]">{Math.round((s.reliability || 0.5) * 100)}%</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Claims */}
              {result.claims.length > 0 && (
                <div>
                  <p className="text-[0.7rem] font-medium text-muted-foreground mb-1">الادعاءات ({result.claims.length})</p>
                  <div className="space-y-1">
                    {result.claims.slice(0, 10).map((c, i) => (
                      <div key={i} className="flex items-start gap-1.5 rounded border border-border bg-card p-1.5 text-[0.7rem]">
                        {c.verdict === "verified" ? <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0 mt-0.5" />
                         : c.verdict === "contradicts" ? <XCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
                         : <AlertCircle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />}
                        <span className="flex-1">{c.text.slice(0, 80)}…</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Report */}
              {result.report && (
                <div>
                  <p className="text-[0.7rem] font-medium text-muted-foreground mb-1">التقرير</p>
                  <div className="rounded-lg border border-border bg-card p-3">
                    <MarkdownRenderer content={result.report} />
                  </div>
                </div>
              )}

              {result.tokenUsage > 0 && (
                <p className="text-[0.65rem] text-muted-foreground text-center">{result.tokenUsage} tokens</p>
              )}
            </div>
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <Search className="h-8 w-8 opacity-40 mb-2" />
            <p className="text-xs">لا أبحاث بعد. ابدأ بحثاً جديداً.</p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-scroll chat-scroll">
            <div className="space-y-2 p-2">
              {jobs.map(j => (
                <div key={j.id} className="group rounded-lg border border-border bg-card p-2.5">
                  <div className="flex items-start gap-2">
                    <FileText className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{j.query}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <Badge variant={j.status === "done" ? "secondary" : "outline"} className="text-[0.6rem]">
                          {j.status === "done" ? "✅ مكتمل" : j.status}
                        </Badge>
                        <Badge variant="outline" className="text-[0.6rem]">{j.depth}</Badge>
                        {j.tokenUsage > 0 && <span className="text-[0.6rem] text-muted-foreground">{j.tokenUsage} tok</span>}
                      </div>
                    </div>
                    <button onClick={() => viewJob(j.id)} className="text-xs text-primary hover:underline">عرض</button>
                    <button onClick={() => deleteJob(j.id)} className="opacity-0 group-hover:opacity-100 transition">
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
