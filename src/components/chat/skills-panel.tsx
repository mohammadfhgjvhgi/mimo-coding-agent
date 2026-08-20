"use client"

import * as React from "react"
import { Package, Search, RefreshCw, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface SkillEntry {
  name: string
  path: string
  hasSkillMd: boolean
  hasScripts: boolean
  scriptCount: number
}

export function SkillsPanel({ refreshSignal }: { refreshSignal?: number }) {
  const [skills, setSkills] = React.useState<SkillEntry[]>([])
  const [loading, setLoading] = React.useState(true)
  const [query, setQuery] = React.useState("")

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/skills")
      const data = await res.json()
      setSkills(data.skills || [])
    } catch {
      setSkills([])
    }
    setLoading(false)
  }, [])

  React.useEffect(() => { load() }, [load, refreshSignal])

  const filtered = React.useMemo(() => {
    if (!query.trim()) return skills
    return skills.filter(s => s.name.toLowerCase().includes(query.toLowerCase()))
  }, [skills, query])

  return (
    <div className="flex h-full w-full flex-col bg-sidebar">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-sidebar-border">
        <Package className="h-4 w-4 text-purple-500" />
        <span className="flex-1 text-xs font-semibold">المهارات</span>
        <Button variant="ghost" size="icon" onClick={load} className="h-7 w-7 rounded-md">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث في المهارات…" className="h-8 rounded-lg pr-8 text-xs" />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-scroll chat-scroll">
        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground"><Package className="mx-auto mb-2 h-8 w-8 opacity-40" />لا مهارات.</div>
        ) : (
          <div className="space-y-1 p-2">
            {filtered.map((s) => (
              <div key={s.name} className="rounded-lg border border-border bg-card p-2 hover:border-primary/30 transition">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">{s.name}</span>
                  {s.hasSkillMd && <Badge variant="secondary" className="text-[0.6rem]">SKILL.md</Badge>}
                  {s.hasScripts && <Badge variant="outline" className="text-[0.6rem]">{s.scriptCount} scripts</Badge>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-sidebar-border px-3 py-1.5"><span className="text-[0.7rem] text-muted-foreground">{skills.length} مهارة مثبّتة</span></div>
    </div>
  )
}
