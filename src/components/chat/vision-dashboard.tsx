"use client"

/**
 * VisionDashboard — The Ultimate MiMo X Experience.
 *
 * Visualizes the complete architecture:
 *
 *                          MiMo X
 *                            │
 *              ┌─────────────┼─────────────┐
 *              │             │             │
 *           KNOW           THINK         ACT
 *              │             │             │
 *         Knowledge       Models        Tools
 *         Memory          Reasoning     Browser
 *         Research        Planning      Terminal
 *         Documents       Routing       Git
 *                                       MCP
 *                                       APIs
 *              │             │             │
 *              └─────────────┼─────────────┘
 *                            │
 *                        VERIFY
 *                            │
 *                        REMEMBER
 *                            │
 *                       AUTOMATE
 *                            │
 *                       CONTINUE
 *
 * "بدي أستغني عن كل أدوات الذكاء الاصطناعي وأخلي MiMo هو البيئة الأساسية لكل شغلي."
 */

import * as React from "react"
import { Brain, Sparkles, Zap, CheckCircle, Pin, RotateCw, Infinity as InfinityIcon, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

const PILLARS: Array<{
  key: string
  label: string
  labelAr: string
  icon: React.ReactNode
  color: string
  bgColor: string
  features: string[]
}> = [
  {
    key: "know", label: "KNOW", labelAr: "معرفة",
    icon: <Brain className="h-5 w-5" />, color: "text-purple-500", bgColor: "bg-purple-500/10 border-purple-500/30",
    features: ["Knowledge", "Memory", "Research", "Documents"],
  },
  {
    key: "think", label: "THINK", labelAr: "تفكير",
    icon: <Sparkles className="h-5 w-5" />, color: "text-blue-500", bgColor: "bg-blue-500/10 border-blue-500/30",
    features: ["Models", "Reasoning", "Planning", "Routing"],
  },
  {
    key: "act", label: "ACT", labelAr: "تنفيذ",
    icon: <Zap className="h-5 w-5" />, color: "text-emerald-500", bgColor: "bg-emerald-500/10 border-emerald-500/30",
    features: ["Tools", "Browser", "Terminal", "Git", "MCP", "APIs"],
  },
]

const FLOW: Array<{
  key: string
  label: string
  labelAr: string
  icon: React.ReactNode
  color: string
  bgColor: string
}> = [
  { key: "verify", label: "VERIFY", labelAr: "تحقق", icon: <CheckCircle className="h-4 w-4" />, color: "text-emerald-500", bgColor: "bg-emerald-500/10 border-emerald-500/30" },
  { key: "remember", label: "REMEMBER", labelAr: "تذكر", icon: <Pin className="h-4 w-4" />, color: "text-amber-500", bgColor: "bg-amber-500/10 border-amber-500/30" },
  { key: "automate", label: "AUTOMATE", labelAr: "أتمتة", icon: <RotateCw className="h-4 w-4" />, color: "text-orange-500", bgColor: "bg-orange-500/10 border-orange-500/30" },
  { key: "continue", label: "CONTINUE", labelAr: "استمرار", icon: <InfinityIcon className="h-4 w-4" />, color: "text-primary", bgColor: "bg-primary/10 border-primary/30" },
]

export function VisionDashboard() {
  const [data, setData] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/vision-dashboard")
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
          <InfinityIcon className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">MiMo X — الرؤية الكاملة</span>
        </div>
        <button onClick={load} className="text-muted-foreground hover:text-foreground">
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
        </button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-4">
          {/* Hero: The Quote */}
          <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/5 to-purple-500/5 p-4 text-center">
            <h2 className="text-lg font-bold mb-1">MiMo X</h2>
            <p className="text-xs text-muted-foreground mb-3">
              نظام تشغيل ذكاء اصطناعي محلي شامل — {data?.system?.totalSections ?? 37} قسم · {data?.system?.totalFeatures ?? 484} ميزة
            </p>
            <p className="text-[0.75rem] italic text-primary/80">
              "بدي أستغني عن كل أدوات الذكاء الاصطناعي وأخلي MiMo هو البيئة الأساسية لكل شغلي."
            </p>
          </div>

          {/* The 3 Pillars */}
          <div className="grid grid-cols-3 gap-2">
            {PILLARS.map(pillar => {
              const pillarData = data?.[pillar.key]
              const total = pillarData?.items?.reduce((s: number, i: any) => s + i.value, 0) ?? 0
              return (
                <div key={pillar.key} className={cn("rounded-xl border p-3", pillar.bgColor)}>
                  <div className="flex flex-col items-center gap-1 mb-2">
                    <div className={pillar.color}>{pillar.icon}</div>
                    <span className={cn("text-sm font-bold", pillar.color)}>{pillar.label}</span>
                    <span className="text-[0.6rem] text-muted-foreground">{pillar.labelAr}</span>
                  </div>
                  <div className="text-center mb-2">
                    <span className={cn("text-xl font-mono font-bold", pillar.color)}>{total}</span>
                  </div>
                  <div className="space-y-0.5">
                    {pillarData?.items?.map((item: any, i: number) => (
                      <div key={i} className="flex justify-between text-[0.6rem]">
                        <span className="text-muted-foreground">{item.label}</span>
                        <span className="font-mono font-bold">{item.value}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 pt-2 border-t border-border/30">
                    <div className="flex flex-wrap gap-0.5 justify-center">
                      {pillar.features.map((f, i) => (
                        <span key={i} className="text-[0.5rem] text-muted-foreground/60">{f}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Flow: VERIFY → REMEMBER → AUTOMATE → CONTINUE */}
          <div className="flex items-center justify-center gap-2">
            {FLOW.map((step, i) => {
              const stepData = data?.[step.key]
              const total = stepData?.items?.reduce((s: number, item: any) => s + item.value, 0) ?? 0
              return (
                <React.Fragment key={step.key}>
                  <div className={cn("rounded-lg border px-3 py-2 flex flex-col items-center gap-0.5 min-w-[70px]", step.bgColor)}>
                    <div className={step.color}>{step.icon}</div>
                    <span className={cn("text-[0.65rem] font-bold", step.color)}>{step.label}</span>
                    <span className="text-[0.5rem] text-muted-foreground">{step.labelAr}</span>
                    <span className={cn("text-sm font-mono font-bold", step.color)}>{total}</span>
                  </div>
                  {i < FLOW.length - 1 && (
                    <div className="text-muted-foreground/40 text-lg">↓</div>
                  )}
                </React.Fragment>
              )
            })}
          </div>

          {/* System Status */}
          {data?.system && (
            <div className="rounded-xl border border-border/60 bg-card/50 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold">حالة النظام / System Status</span>
                <Badge className={cn(
                  "text-[0.6rem]",
                  data.system.health === "GREEN" ? "bg-emerald-500/10 text-emerald-600" :
                  data.system.health === "YELLOW" ? "bg-amber-500/10 text-amber-600" :
                  "bg-red-500/10 text-red-600"
                )}>
                  {data.system.health}
                </Badge>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center text-[0.65rem]">
                <div>
                  <div className="text-muted-foreground mb-0.5">المستخدم</div>
                  <div className="font-bold">{data.system.userName}</div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-0.5">RAM</div>
                  <div className="font-mono font-bold">{data.system.ramUsagePct}%</div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-0.5">CPU</div>
                  <div className="font-mono font-bold">{data.system.cpuCores} cores</div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-0.5">Uptime</div>
                  <div className="font-mono font-bold">{Math.round(data.system.uptime / 60)}min</div>
                </div>
              </div>
            </div>
          )}

          {/* Complete Feature Count */}
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-center">
            <p className="text-[0.7rem] text-muted-foreground mb-1">إجمالي الميزات المُنجزة</p>
            <p className="text-2xl font-mono font-bold text-primary">
              {data?.system?.totalFeatures ?? 484} <span className="text-sm">ميزة</span>
            </p>
            <p className="text-[0.6rem] text-muted-foreground mt-1">
              عبر {data?.system?.totalSections ?? 37} قسم — كلها مربوطة بالواجهة
            </p>
          </div>

          {/* The Flow Architecture */}
          <div className="rounded-xl border border-border/60 bg-card/30 p-4">
            <pre className="text-[0.6rem] font-mono text-center text-muted-foreground whitespace-pre" dir="ltr">
{`                    MiMo X
                       │
         ┌─────────────┼─────────────┐
         │             │             │
       KNOW          THINK         ACT
         │             │             │
    Knowledge       Models        Tools
    Memory          Reasoning     Browser
    Research        Planning      Terminal
    Documents       Routing       Git
                                  MCP
                                  APIs
         │             │             │
         └─────────────┼─────────────┘
                       │
                   VERIFY
                       │
                   REMEMBER
                       │
                  AUTOMATE
                       │
                  CONTINUE`}
            </pre>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
