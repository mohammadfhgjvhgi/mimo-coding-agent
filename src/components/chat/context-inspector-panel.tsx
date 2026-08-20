"use client"

import * as React from "react"
import { Activity, FileText, Brain, Database, GitBranch, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { useChatStore } from "@/store/chat-store"

// Evidence + Context Inspector — shows what the model is about to see.
// Fulfills encyclopedia chapters 23 (Evidence Plane) + 25 (Context Inspector).
// Every piece of context is tracked: source, reason, confidence, token cost.

interface EvidenceItem {
  id: string
  source: string
  path?: string
  symbol?: string
  reason: string
  confidence: number
  freshness: number
  tokenCost: number
  dependencyRelation?: string
}

interface EvidencePackage {
  items: EvidenceItem[]
  totalTokens: number
  budget: number
  sources: string[]
  summary: string
  recommendations: string[]
}

export function ContextInspectorPanel() {
  const [pkg, setPkg] = React.useState<EvidencePackage | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [budget, setBudget] = React.useState(2000)
  const contextTokens = useChatStore((s) => s.contextTokens)
  const contextBudget = useChatStore((s) => s.contextBudget)

  const buildEvidence = async () => {
    if (!query.trim()) return
    setLoading(true)
    try {
      const res = await fetch("/api/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, budget }),
      })
      const data = await res.json()
      setPkg(data)
    } catch {} finally {
      setLoading(false)
    }
  }

  const sourceIcon = (source: string) => {
    switch (source) {
      case "file": return <FileText className="h-3 w-3 text-amber-500" />
      case "symbols": return <Search className="h-3 w-3 text-blue-500" />
      case "memory": return <Brain className="h-3 w-3 text-purple-500" />
      case "git": return <GitBranch className="h-3 w-3 text-emerald-500" />
      case "tasks": return <Activity className="h-3 w-3 text-rose-500" />
      case "knowledge": return <Database className="h-3 w-3 text-cyan-500" />
      default: return <FileText className="h-3 w-3 text-muted-foreground" />
    }
  }

  const sourceColor = (source: string) => {
    const colors: Record<string, string> = {
      file: "border-l-amber-500",
      symbols: "border-l-blue-500",
      memory: "border-l-purple-500",
      git: "border-l-emerald-500",
      tasks: "border-l-rose-500",
      knowledge: "border-l-cyan-500",
      skills: "border-l-indigo-500",
    }
    return colors[source] || "border-l-muted"
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold">مفتش السياق</span>
          <span className="text-[0.6rem] text-muted-foreground">Context Inspector</span>
        </div>
        {/* Context Budget bar */}
        <div className="mb-2">
          <div className="flex items-center justify-between text-[0.6rem] text-muted-foreground mb-1">
            <span>الميزانية الحالية</span>
            <span>{contextTokens} / {contextBudget} tokens</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                "h-full transition-all",
                contextTokens / contextBudget > 0.8 ? "bg-red-500" : contextTokens / contextBudget > 0.5 ? "bg-amber-500" : "bg-emerald-500"
              )}
              style={{ width: `${Math.min(100, (contextTokens / contextBudget) * 100)}%` }}
            />
          </div>
        </div>
        {/* Query input */}
        <div className="flex gap-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && buildEvidence()}
            placeholder="استعلام السياق…"
            className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={buildEvidence}
            disabled={loading || !query.trim()}
            className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
          >
            {loading ? "…" : "جمع"}
          </button>
        </div>
      </div>

      {/* Evidence items */}
      <div className="flex-1 min-h-0 overflow-y-auto chat-scroll">
        {!pkg ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground p-4 text-center">
            <div>
              <Activity className="mx-auto mb-2 h-8 w-8 opacity-40" />
              <p>اكتب استعلام لرؤية الأدلة</p>
              <p className="text-[0.6rem] mt-1">Type a query to see evidence</p>
            </div>
          </div>
        ) : pkg.items.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            لا أدلة مطابقة
          </div>
        ) : (
          <div className="divide-y divide-border">
            {pkg.items.map((item, i) => (
              <div
                key={item.id || i}
                className={cn("border-l-2 px-3 py-2 hover:bg-accent/30 transition", sourceColor(item.source))}
              >
                <div className="flex items-center gap-2 mb-1">
                  {sourceIcon(item.source)}
                  <span className="text-[0.6rem] font-medium uppercase text-muted-foreground">{item.source}</span>
                  {item.path && <span className="text-[0.6rem] truncate flex-1">{item.path}</span>}
                  <span className="text-[0.55rem] text-muted-foreground">{item.tokenCost} tok</span>
                </div>
                <p className="text-[0.6rem] text-muted-foreground mb-1">{item.reason}</p>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <span className="text-[0.5rem] text-muted-foreground">ثقة:</span>
                    <div className="h-1 w-12 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn(
                          "h-full",
                          item.confidence > 0.8 ? "bg-emerald-500" : item.confidence > 0.5 ? "bg-amber-500" : "bg-red-500"
                        )}
                        style={{ width: `${item.confidence * 100}%` }}
                      />
                    </div>
                    <span className="text-[0.5rem] text-muted-foreground">{Math.round(item.confidence * 100)}%</span>
                  </div>
                  {item.dependencyRelation && (
                    <Badge variant="outline" className="text-[0.5rem]">{item.dependencyRelation}</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Summary footer */}
      {pkg && (
        <div className="border-t border-border px-3 py-2 space-y-1.5">
          <div className="flex items-center justify-between text-[0.6rem]">
            <span className="text-muted-foreground">المجموع:</span>
            <span className="font-medium">{pkg.totalTokens} / {pkg.budget} tokens</span>
          </div>
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div
              className={cn("h-full", pkg.totalTokens / pkg.budget > 0.9 ? "bg-red-500" : "bg-primary")}
              style={{ width: `${Math.min(100, (pkg.totalTokens / pkg.budget) * 100)}%` }}
            />
          </div>
          {pkg.sources.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {pkg.sources.map(s => (
                <Badge key={s} variant="secondary" className="text-[0.5rem]">{s}</Badge>
              ))}
            </div>
          )}
          {pkg.recommendations.length > 0 && (
            <div className="text-[0.6rem] text-amber-600 dark:text-amber-400">
              ⚠ {pkg.recommendations[0]}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
