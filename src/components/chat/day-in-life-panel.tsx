"use client"

/**
 * DayInLifePanel — "يوم في حياة MiMo X"
 *
 * Visualizes a full day from 08:00 to 22:00 showing how MiMo X
 * replaces ALL separate AI tools with one unified environment.
 */

import * as React from "react"
import { RefreshCw, Clock, ArrowRight, Check, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

const COLOR_MAP: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  amber: { bg: "bg-amber-500/5", text: "text-amber-600 dark:text-amber-400", border: "border-amber-500/30", dot: "bg-amber-500" },
  blue: { bg: "bg-blue-500/5", text: "text-blue-600 dark:text-blue-400", border: "border-blue-500/30", dot: "bg-blue-500" },
  purple: { bg: "bg-purple-500/5", text: "text-purple-600 dark:text-purple-400", border: "border-purple-500/30", dot: "bg-purple-500" },
  emerald: { bg: "bg-emerald-500/5", text: "text-emerald-600 dark:text-emerald-400", border: "border-emerald-500/30", dot: "bg-emerald-500" },
  orange: { bg: "bg-orange-500/5", text: "text-orange-600 dark:text-orange-400", border: "border-orange-500/30", dot: "bg-orange-500" },
  cyan: { bg: "bg-cyan-500/5", text: "text-cyan-600 dark:text-cyan-400", border: "border-cyan-500/30", dot: "bg-cyan-500" },
  pink: { bg: "bg-pink-500/5", text: "text-pink-600 dark:text-pink-400", border: "border-pink-500/30", dot: "bg-pink-500" },
  indigo: { bg: "bg-indigo-500/5", text: "text-indigo-600 dark:text-indigo-400", border: "border-indigo-500/30", dot: "bg-indigo-500" },
}

export function DayInLifePanel() {
  const [data, setData] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/day-in-life")
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
          <Clock className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">يوم في حياة MiMo X</span>
        </div>
        <button onClick={load} className="text-muted-foreground hover:text-foreground">
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
        </button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-3">
          {/* Hero */}
          <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-purple-500/5 p-4 text-center">
            <p className="text-[0.75rem] italic text-primary/80 mb-1">
              {data?.quote ?? "MiMo X = طبقة موحدة فوق كل هذه الوظائف"}
            </p>
            <p className="text-[0.6rem] text-muted-foreground">
              يوم واحد · 8 مراحل · {data?.totalTools ?? 10} أدوات مستبدلة
            </p>
          </div>

          {/* Timeline */}
          {data?.day?.map((slot: any, i: number) => {
            const colors = COLOR_MAP[slot.color] ?? COLOR_MAP.amber
            return (
              <div key={i} className="flex gap-3">
                {/* Time + dot */}
                <div className="flex flex-col items-center pt-1">
                  <div className={cn("h-3 w-3 rounded-full", colors.dot)} />
                  {i < data.day.length - 1 && (
                    <div className="w-0.5 flex-1 bg-border/30 mt-1" style={{ minHeight: "60px" }} />
                  )}
                </div>

                {/* Content */}
                <div className={cn("flex-1 rounded-lg border p-3 mb-1", colors.bg, colors.border)}>
                  {/* Header */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">{slot.icon}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={cn("text-sm font-bold", colors.text)}>{slot.phase}</span>
                        <span className="text-[0.6rem] text-muted-foreground">({slot.phaseEn})</span>
                      </div>
                      <span className="text-[0.6rem] font-mono text-muted-foreground">{slot.time} · {slot.timeAr}</span>
                    </div>
                  </div>

                  {/* Command */}
                  <div className={cn("rounded-md bg-background/50 px-2 py-1 mb-2", colors.border, "border")}>
                    <p className="text-[0.75rem] font-mono" dir="rtl">
                      <span className="text-muted-foreground">$</span> {slot.command}
                    </p>
                  </div>

                  {/* Flow */}
                  <div className="mb-2">
                    <p className="text-[0.6rem] text-muted-foreground mb-0.5">التدفق:</p>
                    <p className="text-[0.65rem] font-mono" dir="ltr">{slot.flow}</p>
                  </div>

                  {/* Tools */}
                  <div className="mb-2">
                    <p className="text-[0.6rem] text-muted-foreground mb-0.5">الأدوات:</p>
                    <div className="flex flex-wrap gap-0.5">
                      {slot.tools.map((tool: string, j: number) => (
                        <Badge key={j} variant="outline" className={cn("text-[0.5rem] py-0", colors.text, colors.border)}>
                          {tool}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {/* Real stats */}
                  <div className="grid grid-cols-3 gap-1 pt-2 border-t border-border/20">
                    {slot.stats.map((stat: any, j: number) => (
                      <div key={j} className="text-center">
                        <div className={cn("text-sm font-mono font-bold", colors.text)}>{stat.value}</div>
                        <div className="text-[0.5rem] text-muted-foreground">{stat.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}

          {/* The Replacement Message */}
          {data?.replaced && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
              <h3 className="text-sm font-bold mb-2 text-center">
                أنت لا تستخدم 10 أدوات منفصلة...
              </h3>
              <div className="space-y-1">
                {data.replaced.map((r: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-[0.7rem]">
                    <X className="h-3 w-3 text-red-500 shrink-0" />
                    <span className="line-through text-muted-foreground">{r.name}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    <Check className="h-3 w-3 text-emerald-500 shrink-0" />
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">{r.replacedBy}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-border/30 text-center">
                <p className="text-sm font-bold text-primary">
                  = MiMo X فقط
                </p>
                <p className="text-[0.6rem] text-muted-foreground mt-0.5">
                  طبقة موحدة فوق كل هذه الوظائف
                </p>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
