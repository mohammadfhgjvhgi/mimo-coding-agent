"use client"

import * as React from "react"
import {
  Code2,
  RefreshCw,
  Loader2,
  Search,
  FunctionSquare,
  Boxes,
  Braces,
  Variable,
  FileCode,
  ChevronRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface SymbolEntry {
  name: string
  type: string
  filePath: string
  line: number
  column: number
  endLine: number
  signature: string
}

interface IndexStats {
  totalSymbols: number
  filesIndexed: number
  byType: Record<string, number>
}

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  function: FunctionSquare,
  method: Boxes,
  class: Braces,
  variable: Variable,
  constant: Variable,
  interface: Code2,
  type: Code2,
  import: FileCode,
}

const TYPE_LABELS: Record<string, string> = {
  function: "دالة",
  method: "دالة",
  class: "كلاس",
  variable: "متغير",
  constant: "ثابت",
  interface: "واجهة",
  type: "نوع",
  import: "استيراد",
}

const TYPE_COLORS: Record<string, string> = {
  function: "text-cyan-500",
  method: "text-blue-500",
  class: "text-amber-500",
  variable: "text-purple-500",
  constant: "text-purple-500",
  interface: "text-emerald-500",
  type: "text-emerald-500",
  import: "text-muted-foreground",
}

export function SymbolsPanel({
  refreshSignal,
  onSelectFile,
}: {
  refreshSignal?: number
  onSelectFile?: (path: string) => void
}) {
  const [stats, setStats] = React.useState<IndexStats | null>(null)
  const [symbols, setSymbols] = React.useState<SymbolEntry[]>([])
  const [loading, setLoading] = React.useState(true)
  const [query, setQuery] = React.useState("")

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/symbols")
      const data = await res.json()
      setStats(data.stats)
      // Flatten the repo map into a symbol list (for display)
      const map = data.map || []
      const all: SymbolEntry[] = []
      for (const f of map) {
        for (const s of f.symbols || []) {
          all.push({
            name: s.name,
            type: s.type,
            filePath: f.filePath,
            line: s.line,
            column: 0,
            endLine: 0,
            signature: "",
          })
        }
      }
      setSymbols(all)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load, refreshSignal])

  const reindex = async () => {
    setLoading(true)
    toast.info("جارٍ إعادة فهرسة المشروع…")
    try {
      const res = await fetch("/api/symbols", { method: "POST" })
      const data = await res.json()
      if (data.error) {
        toast.error(data.error)
      } else {
        toast.success(`فُهرست ${data.files} ملف، ${data.symbols} رمز`)
      }
      load()
    } catch {
      toast.error("فشلت إعادة الفهرسة")
    } finally {
      setLoading(false)
    }
  }

  const search = async (q: string) => {
    if (!q.trim()) {
      load()
      return
    }
    try {
      const res = await fetch(`/api/symbols?action=search&q=${encodeURIComponent(q)}`)
      const data = await res.json()
      setSymbols(data.symbols || [])
    } catch {
      /* ignore */
    }
  }

  const filtered = React.useMemo(() => {
    if (!query.trim()) return symbols
    return symbols.filter(
      (s) =>
        s.name.toLowerCase().includes(query.toLowerCase()) ||
        s.filePath.toLowerCase().includes(query.toLowerCase())
    )
  }, [symbols, query])

  // Group by type
  const grouped = React.useMemo(() => {
    const g: Record<string, SymbolEntry[]> = {}
    for (const s of filtered) {
      if (!g[s.type]) g[s.type] = []
      g[s.type].push(s)
    }
    return g
  }, [filtered])

  return (
    <div className="flex h-full w-full flex-col bg-sidebar">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-sidebar-border">
        <Code2 className="h-4 w-4 text-cyan-500" />
        <span className="flex-1 text-xs font-semibold tracking-tight">الرموز</span>
        <Button variant="ghost" size="icon" onClick={reindex} className="h-7 w-7 rounded-md" aria-label="إعادة فهرسة">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-1 px-3 py-1.5 border-b border-sidebar-border text-center">
          <div className="text-[0.7rem]">
            <div className="font-bold text-foreground">{stats.totalSymbols}</div>
            <div className="text-muted-foreground">رمز</div>
          </div>
          <div className="text-[0.7rem]">
            <div className="font-bold text-foreground">{stats.filesIndexed}</div>
            <div className="text-muted-foreground">ملف</div>
          </div>
          <div className="text-[0.7rem]">
            <div className="font-bold text-foreground">{Object.keys(stats.byType).length}</div>
            <div className="text-muted-foreground">أنواع</div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              if (e.target.value.length >= 2) {
                search(e.target.value)
              } else if (e.target.value.length === 0) {
                load()
              }
            }}
            placeholder="ابحث عن رمز…"
            className="h-8 rounded-lg pr-8 text-xs"
          />
        </div>
      </div>

      {/* List */}
      <ScrollArea className="flex-1 chat-scroll">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mb-2" />
            <span className="text-xs">جارٍ تحميل الرموز…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            <Code2 className="mx-auto mb-2 h-8 w-8 opacity-40" />
            {query ? "لا نتائج" : "الفهرس فارغ. اضغط 🔄 لإعادة الفهرسة."}
          </div>
        ) : (
          <div className="space-y-3 p-2 pb-4">
            {Object.entries(grouped).map(([type, items]) => {
              const Icon = TYPE_ICONS[type] || Code2
              const color = TYPE_COLORS[type] || ""
              return (
                <div key={type}>
                  <p className="px-2 py-1 text-[0.7rem] font-medium tracking-wider text-muted-foreground">
                    {TYPE_LABELS[type] || type} ({items.length})
                  </p>
                  <div className="space-y-0.5">
                    {items.slice(0, 50).map((s, i) => (
                      <SymbolItem
                        key={`${s.filePath}:${s.line}:${i}`}
                        symbol={s}
                        icon={Icon}
                        color={color}
                        onSelect={() => onSelectFile?.(s.filePath)}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

function SymbolItem({
  symbol,
  icon: Icon,
  color,
  onSelect,
}: {
  symbol: SymbolEntry
  icon: React.ComponentType<{ className?: string }>
  color: string
  onSelect?: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className="group flex w-full items-center gap-1.5 rounded px-2 py-1 text-right transition hover:bg-accent/60"
      title={symbol.signature}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", color)} />
      <code className="min-w-0 flex-1 truncate text-[0.8rem] font-medium" dir="ltr">
        {symbol.name}
      </code>
      <span className="shrink-0 text-[0.6rem] text-muted-foreground truncate max-w-[80px]" dir="ltr">
        {symbol.filePath}:{symbol.line}
      </span>
      <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
    </button>
  )
}

// end of file
