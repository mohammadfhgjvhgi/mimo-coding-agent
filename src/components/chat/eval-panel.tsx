"use client"

import * as React from "react"
import { CheckCircle2, XCircle, RefreshCw, Loader2, Gauge } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface EvalResult {
  name: string
  category: string
  pass: boolean
  detail: string
}

export function EvalPanel() {
  const [results, setResults] = React.useState<EvalResult[]>([])
  const [loading, setLoading] = React.useState(true)
  const [total, setTotal] = React.useState(0)
  const [passed, setPassed] = React.useState(0)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/eval")
      const data = await res.json()
      setResults(data.results || [])
      setTotal(data.total || 0)
      setPassed(data.passed || 0)
    } catch {}
    setLoading(false)
  }, [])

  React.useEffect(() => { load() }, [load])

  const categories = React.useMemo(() => {
    const g: Record<string, EvalResult[]> = {}
    for (const r of results) {
      if (!g[r.category]) g[r.category] = []
      g[r.category].push(r)
    }
    return g
  }, [results])

  return (
    <div className="flex h-full w-full flex-col bg-sidebar">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-sidebar-border">
        <Gauge className="h-4 w-4 text-emerald-500" />
        <span className="flex-1 text-xs font-semibold">التقييم</span>
        <Button variant="ghost" size="icon" onClick={load} className="h-7 w-7 rounded-md">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>
      <div className="px-3 py-2 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold",
            passed === total ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/15 text-amber-600"
          )}>
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : `${passed}/${total}`}
          </div>
          <div className="flex-1">
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={cn("h-full transition-all", passed === total ? "bg-emerald-500" : "bg-amber-500")}
                style={{ width: `${total > 0 ? (passed / total) * 100 : 0}%` }}
              />
            </div>
            <p className="mt-1 text-[0.7rem] text-muted-foreground">
              {passed === total ? "✅ كل الأنظمة تعمل" : "⚠️ بعض الأنظمة تحتاج فحص"}
            </p>
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-scroll chat-scroll">
        <div className="space-y-3 p-2">
          {Object.entries(categories).map(([cat, items]) => (
            <div key={cat}>
              <p className="px-2 py-1 text-[0.7rem] font-medium text-muted-foreground">{cat}</p>
              <div className="space-y-1">
                {items.map((r) => (
                  <div key={r.name} className="flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5">
                    {r.pass ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                    )}
                    <span className="text-[0.8rem] font-mono" dir="ltr">{r.name}</span>
                    <span className="ml-auto text-[0.65rem] text-muted-foreground truncate max-w-[50%]">{r.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
