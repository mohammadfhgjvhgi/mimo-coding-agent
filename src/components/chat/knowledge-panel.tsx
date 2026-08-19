"use client"

import * as React from "react"
import {
  BookOpen, Search, RefreshCw, Loader2, Plus, Upload, FolderSync,
  Trash2, FileText, Tag, Layers, Database, Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface SearchResult {
  id: string
  source: string
  sourceType: string
  content: string
  finalScore: number
  bm25Score: number
  semanticScore: number
}

interface Collection {
  id: string
  name: string
  description: string | null
  scope: string
  color: string | null
}

interface Stats {
  totalChunks: number
  totalSources: number
  totalCollections: number
  byType: Record<string, number>
}

export function KnowledgePanel() {
  const [stats, setStats] = React.useState<Stats | null>(null)
  const [results, setResults] = React.useState<SearchResult[]>([])
  const [collections, setCollections] = React.useState<Collection[]>([])
  const [loading, setLoading] = React.useState(true)
  const [searching, setSearching] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [selectedCollection, setSelectedCollection] = React.useState<string>("")
  const [searchMode, setSearchMode] = React.useState<"hybrid" | "agentic" | "full">("hybrid")
  const [showIngest, setShowIngest] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      const [statsRes, colRes] = await Promise.all([
        fetch("/api/knowledge?action=stats"),
        fetch("/api/knowledge?action=collections"),
      ])
      setStats(await statsRes.json())
      const colData = await colRes.json()
      setCollections(colData.collections || [])
    } catch {}
    setLoading(false)
  }, [])

  React.useEffect(() => { load() }, [load])

  const search = async () => {
    if (!query.trim()) return
    setSearching(true)
    try {
      const params = new URLSearchParams({ q: query, limit: "10" })
      if (selectedCollection) params.set("collectionId", selectedCollection)
      if (searchMode === "agentic") params.set("action", "agentic")
      else if (searchMode === "full") params.set("action", "full")
      else params.set("action", "search")

      const res = await fetch(`/api/knowledge?${params}`)
      const data = await res.json()
      if (data.results) {
        setResults(data.results)
      } else if (data.hits) {
        setResults(data.hits)
      }
    } catch { toast.error("فشل البحث") }
    setSearching(false)
  }

  return (
    <div className="flex h-full w-full flex-col bg-sidebar">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-sidebar-border">
        <BookOpen className="h-4 w-4 text-amber-500" />
        <span className="flex-1 text-xs font-semibold">المعرفة</span>
        <Button variant="ghost" size="icon" onClick={load} className="h-7 w-7 rounded-md">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
        <Dialog open={showIngest} onOpenChange={setShowIngest}>
          <DialogTrigger asChild>
            <Button variant="default" size="sm" className="h-7 gap-1 text-xs">
              <Plus className="h-3 w-3" /> إضافة
            </Button>
          </DialogTrigger>
          <IngestDialog onDone={() => { setShowIngest(false); load() }} collections={collections} />
        </Dialog>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-1 px-3 py-1.5 border-b border-sidebar-border text-center">
          <div className="text-[0.7rem]">
            <div className="font-bold text-foreground">{stats.totalChunks}</div>
            <div className="text-muted-foreground">قطعة</div>
          </div>
          <div className="text-[0.7rem]">
            <div className="font-bold text-foreground">{stats.totalSources}</div>
            <div className="text-muted-foreground">مصدر</div>
          </div>
          <div className="text-[0.7rem]">
            <div className="font-bold text-foreground">{stats.totalCollections}</div>
            <div className="text-muted-foreground">مجموعة</div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="px-3 py-2 border-b border-sidebar-border space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="ابحث في المعرفة…"
            className="h-8 rounded-lg pr-8 text-xs"
          />
        </div>
        <div className="flex items-center gap-1">
          <Select value={searchMode} onValueChange={(v) => setSearchMode(v as typeof searchMode)}>
            <SelectTrigger className="h-7 text-[0.7rem] flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hybrid">🔍 هجين (BM25+دلالي)</SelectItem>
              <SelectItem value="agentic">🤖 وكيل (Agentic)</SelectItem>
              <SelectItem value="full">📄 سياق كامل</SelectItem>
            </SelectContent>
          </Select>
          <Select value={selectedCollection} onValueChange={setSelectedCollection}>
            <SelectTrigger className="h-7 text-[0.7rem] w-24">
              <SelectValue placeholder="الكل" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">كل المجموعات</SelectItem>
              {collections.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="default" onClick={search} disabled={searching || !query.trim()} className="h-7 text-xs">
            {searching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      {/* Results */}
      <ScrollArea className="flex-1 chat-scroll">
        {searching ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : results.length > 0 ? (
          <div className="space-y-2 p-2">
            {results.map((r) => (
              <div key={r.id} className="rounded-lg border border-border bg-card p-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <Badge variant="outline" className="text-[0.6rem]">{r.sourceType}</Badge>
                  <span className="text-[0.65rem] text-muted-foreground truncate flex-1" dir="ltr">{r.source}</span>
                  <Badge variant="secondary" className="text-[0.6rem]">{Math.round(r.finalScore * 100)}%</Badge>
                </div>
                <p className="text-[0.75rem] text-muted-foreground line-clamp-3">{r.content}</p>
                <div className="flex items-center gap-2 mt-1 text-[0.6rem] text-muted-foreground">
                  <span>BM25: {Math.round((r.bm25Score || 0) * 100)}%</span>
                  <span>دلالي: {Math.round((r.semanticScore || 0) * 100)}%</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            <Database className="mx-auto mb-2 h-8 w-8 opacity-40" />
            {stats?.totalChunks === 0 ? "لا معرفة بعد. أضف ملفات أو نصوصاً." : "اكتب استعلاماً للبحث."}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

function IngestDialog({ onDone, collections }: { onDone: () => void; collections: Collection[] }) {
  const [tab, setTab] = React.useState<"text" | "file" | "sync">("text")
  const [text, setText] = React.useState("")
  const [source, setSource] = React.useState("")
  const [filePath, setFilePath] = React.useState("")
  const [folderPath, setFolderPath] = React.useState("")
  const [collectionId, setCollectionId] = React.useState("")
  const [incremental, setIncremental] = React.useState(true)
  const [busy, setBusy] = React.useState(false)

  const ingest = async () => {
    setBusy(true)
    try {
      let res
      if (tab === "text") {
        if (!text.trim() || !source.trim()) { toast.error("النص والمصدر مطلوبان"); setBusy(false); return }
        res = await fetch("/api/knowledge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "ingest_text", text, source, collectionId: collectionId || undefined }),
        })
      } else if (tab === "file") {
        if (!filePath.trim()) { toast.error("مسار الملف مطلوب"); setBusy(false); return }
        res = await fetch("/api/knowledge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "ingest_file", path: filePath, collectionId: collectionId || undefined }),
        })
      } else {
        if (!folderPath.trim()) { toast.error("مسار المجلد مطلوب"); setBusy(false); return }
        res = await fetch("/api/knowledge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sync_folder", path: folderPath, incremental, collectionId: collectionId || undefined }),
        })
      }
      const data = await res.json()
      if (data.error) { toast.error(data.error); setBusy(false); return }
      const msg = tab === "text" ? `تم إدخال ${data.chunks} قطعة` : tab === "file" ? `تم إدخال ${data.chunks} قطعة من ${data.sourceType}` : `تم مزامنة ${data.files || (data.new + data.updated)} ملف`
      toast.success(msg)
      setText(""); setSource(""); setFilePath(""); setFolderPath("")
      onDone()
    } catch { toast.error("فشل") }
    setBusy(false)
  }

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Database className="h-4 w-4" /> إضافة معرفة</DialogTitle>
      </DialogHeader>
      <div className="space-y-3 py-2">
        <div className="flex gap-1">
          {(["text", "file", "sync"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={cn("flex-1 rounded-md py-1.5 text-xs font-medium transition",
                tab === t ? "bg-background shadow-sm text-foreground" : "text-muted-foreground")}>
              {t === "text" ? "نص" : t === "file" ? "ملف" : "مزامنة مجلد"}
            </button>
          ))}
        </div>

        {tab === "text" && (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">المصدر (اسم)</Label>
              <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="ملاحظات الاجتماع" className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">النص</Label>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="الصق النص هنا…" className="text-sm min-h-[100px]" />
            </div>
          </>
        )}
        {tab === "file" && (
          <div className="space-y-1.5">
            <Label className="text-xs">مسار الملف (نسبةً للمشروع)</Label>
            <Input value={filePath} onChange={(e) => setFilePath(e.target.value)} placeholder="docs/readme.md" className="text-sm" dir="ltr" />
            <p className="text-[0.7rem] text-muted-foreground">يدعم: .txt .md .js .ts .py .json .csv .html</p>
          </div>
        )}
        {tab === "sync" && (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">مسار المجلد</Label>
              <Input value={folderPath} onChange={(e) => setFolderPath(e.target.value)} placeholder="docs/ أو ." className="text-sm" dir="ltr" />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={incremental} onChange={(e) => setIncremental(e.target.checked)} />
              مزامنة تزايدية (فقط الملفات المتغيرة)
            </label>
          </>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs">المجموعة (اختياري)</Label>
          <Select value={collectionId} onValueChange={setCollectionId}>
            <SelectTrigger className="text-sm"><SelectValue placeholder="بدون مجموعة" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">بدون مجموعة</SelectItem>
              {collections.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={ingest} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          إضافة
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
