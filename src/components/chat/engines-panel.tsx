"use client"

/**
 * EnginesPanel — The 20 Core Engines of MiMo X.
 *
 * Shows that 484 features are NOT 484 separate systems,
 * but the OUTPUT of 20 powerful engines.
 *
 * "عدد قليل من المحركات القوية يُنتج مئات الاستخدامات"
 */

import * as React from "react"
import { RefreshCw, Cog, ArrowRight, Database } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

const COLORS: Record<string, { bg: string; text: string; border: string }> = {
  blue: { bg: "bg-blue-500/5", text: "text-blue-600 dark:text-blue-400", border: "border-blue-500/30" },
  purple: { bg: "bg-purple-500/5", text: "text-purple-600 dark:text-purple-400", border: "border-purple-500/30" },
  cyan: { bg: "bg-cyan-500/5", text: "text-cyan-600 dark:text-cyan-400", border: "border-cyan-500/30" },
  orange: { bg: "bg-orange-500/5", text: "text-orange-600 dark:text-orange-400", border: "border-orange-500/30" },
  emerald: { bg: "bg-emerald-500/5", text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-500/30" },
  pink: { bg: "bg-pink-500/5", text: "text-pink-600 dark:text-pink-400", border: "border-pink-500/30" },
  indigo: { bg: "bg-indigo-500/5", text: "text-indigo-600 dark:text-indigo-400", border: "border-indigo-500/30" },
  amber: { bg: "bg-amber-500/5", text: "text-amber-600 dark:text-amber-400", border: "border-amber-500/30" },
  red: { bg: "bg-red-500/5", text: "text-red-600 dark:text-red-400", border: "border-red-500/30" },
  teal: { bg: "bg-teal-500/5", text: "text-teal-600 dark:text-teal-400", border: "border-teal-500/30" },
}

export function EnginesPanel() {
  const [data, setData] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)
  const [expanded, setExpanded] = React.useState<number | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/engines")
      const d = await res.json()
      setData(d)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }, [])

  React.useEffect(() => { load() }, [load])

  return (
    <div className="flex h-full flex-col" dir="rtl">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <Cog className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">المحركات العشرون / 20 Engines</span>
        </div>
        <button onClick={load} className="text-muted-foreground hover:text-foreground">
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
        </button>
      </div>

      {/* Header: the key insight */}
      {data && (
        <div className="border-b border-border/60 bg-gradient-to-r from-primary/5 to-purple-500/5 px-3 py-2.5 text-center">
          <p className="text-[0.7rem] text-muted-foreground mb-0.5">
            {data.totalEngines} محركات ← {data.totalCapabilities} قدرات ← {data.totalFeatures} ميزة
          </p>
          <p className="text-[0.65rem] italic text-primary/70">
            {data.message}
          </p>
        </div>
      )}

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1.5">
          {loading ? (
            <div className="text-center text-xs text-muted-foreground py-8">
              <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
            </div>
          ) : data?.engines?.map((engine: any) => {
            const colors = COLORS[engine.color] ?? COLORS.blue
            const isOpen = expanded === engine.id
            return (
              <div key={engine.id} className={cn("rounded-lg border overflow-hidden", colors.border, colors.bg)}>
                {/* Header row */}
                <button
                  onClick={() => setExpanded(isOpen ? null : engine.id)}
                  className="w-full flex items-center gap-2 p-2 text-right hover:bg-accent/20 transition-colors"
                >
                  <span className="text-base shrink-0">{engine.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={cn("text-xs font-bold", colors.text)}>{engine.nameAr}</span>
                      <span className="text-[0.55rem] text-muted-foreground">({engine.name})</span>
                    </div>
                    <p className="text-[0.6rem] text-muted-foreground truncate">{engine.description}</p>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 shrink-0">
                    <Badge variant="outline" className={cn("text-[0.5rem] py-0", colors.text, colors.border)}>
                      {engine.capabilities.length} قدرات
                    </Badge>
                    {engine.realDataLabels?.map((label: string, i: number) => (
                      <span key={i} className="text-[0.5rem] font-mono text-muted-foreground">
                        {engine.realData[Object.keys(engine.realData)[i]]} {label}
                      </span>
                    ))}
                  </div>
                </button>

                {/* Expanded content */}
                {isOpen && (
                  <div className="px-3 pb-3 pt-1 border-t border-border/20 space-y-2">
                    {/* Capabilities */}
                    <div>
                      <p className="text-[0.6rem] font-semibold text-muted-foreground mb-1">القدرات الناتجة:</p>
                      <div className="flex flex-wrap gap-0.5">
                        {engine.capabilities.map((cap: string, j: number) => (
                          <Badge key={j} variant="outline" className={cn("text-[0.5rem] py-0", colors.text, colors.border)}>
                            {cap}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {/* Feature range */}
                    <div className="flex items-center gap-2 text-[0.6rem]">
                      <Badge variant="outline" className="py-0 text-[0.5rem]">
                        <Database className="h-2.5 w-2.5 ml-0.5" />
                        الميزات #{engine.featureRange}
                      </Badge>
                      <code className="font-mono text-muted-foreground text-[0.55rem]" dir="ltr">{engine.source}</code>
                    </div>

                    {/* Real data */}
                    <div className="flex items-center gap-2">
                      {engine.realDataLabels?.map((label: string, i: number) => {
                        const value = engine.realData[Object.keys(engine.realData)[i]]
                        return (
                          <div key={i} className={cn("rounded-md border px-2 py-1 text-center", colors.border, colors.bg)}>
                            <div className={cn("text-sm font-mono font-bold", colors.text)}>{value}</div>
                            <div className="text-[0.5rem] text-muted-foreground">{label}</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* Footer: the philosophy */}
          {data && (
            <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-3 text-center">
              <p className="text-[0.7rem] font-semibold text-primary mb-1">
                {data.totalEngines} محرك ← {data.totalCapabilities} قدرة ← {data.totalFeatures} ميزة
              </p>
              <p className="text-[0.6rem] text-muted-foreground">
                الرقم الكبير لا يعني مئات الأنظمة المنفصلة.
                بل يعني أن عدداً قليلاً من المحركات القوية
                يمكنه إنتاج مئات الاستخدامات.
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
