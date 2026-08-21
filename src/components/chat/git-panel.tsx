"use client"

import * as React from "react"
import { GitBranch, GitCommit, GitPullRequest, RefreshCw, Plus, FilePlus, FileX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

interface GitStatus {
  branch: string
  staged: string[]
  modified: string[]
  untracked: string[]
  deleted: string[]
  ahead: number
  behind: number
}

export function GitPanel() {
  const [status, setStatus] = React.useState<GitStatus | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [commitMsg, setCommitMsg] = React.useState("")
  const [committing, setCommitting] = React.useState(false)
  const [diff, setDiff] = React.useState<string>("")
  const [selectedFile, setSelectedFile] = React.useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/git")
      const data = await res.json()
      setStatus(data)
    } catch (e) {
      // best-effort
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    refresh()
  }, [])

  const viewDiff = async (file: string) => {
    setSelectedFile(file)
    try {
      const res = await fetch("/api/workspace/diff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: file }),
      })
      const data = await res.json()
      setDiff(data.diff || data.output || "(no changes)")
    } catch {
      setDiff("(failed to load diff)")
    }
  }

  const stageFile = async (file: string) => {
    try {
      await fetch("/api/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", files: [file] }),
      })
      toast.success(`تم إضافة ${file}`)
      refresh()
    } catch {
      toast.error("فشل الإضافة")
    }
  }

  const commit = async () => {
    if (!commitMsg.trim()) {
      toast.error("اكتب رسالة commit")
      return
    }
    setCommitting(true)
    try {
      const res = await fetch("/api/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "commit", message: commitMsg }),
      })
      if (res.ok) {
        toast.success("تم commit")
        setCommitMsg("")
        refresh()
      } else {
        toast.error("فشل commit")
      }
    } catch {
      toast.error("فشل commit")
    } finally {
      setCommitting(false)
    }
  }

  const allFiles = [
    ...(status?.staged || []).map(f => ({ file: f, status: "staged" as const })),
    ...(status?.modified || []).map(f => ({ file: f, status: "modified" as const })),
    ...(status?.untracked || []).map(f => ({ file: f, status: "untracked" as const })),
    ...(status?.deleted || []).map(f => ({ file: f, status: "deleted" as const })),
  ]

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <GitBranch className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">Git</span>
        {status?.branch && (
          <Badge variant="secondary" className="text-[0.6rem]">{status.branch}</Badge>
        )}
        {(status?.ahead ?? 0) > 0 && (
          <Badge variant="outline" className="text-[0.6rem] text-emerald-500">
            <GitPullRequest className="h-2.5 w-2.5" /> {status?.ahead ?? 0}
          </Badge>
        )}
        <Button size="sm" variant="ghost" onClick={refresh} disabled={loading} className="ml-auto h-7 text-xs">
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
        </Button>
      </div>

      {/* File list */}
      <div className="flex-1 min-h-0 overflow-y-auto chat-scroll">
        {allFiles.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            لا تغييرات — المشروع نظيف
          </div>
        ) : (
          <div className="divide-y divide-border">
            {allFiles.map((f, i) => (
              <div
                key={i}
                onClick={() => viewDiff(f.file)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-accent/30 transition",
                  selectedFile === f.file && "bg-accent/50"
                )}
              >
                {f.status === "staged" && <FilePlus className="h-3 w-3 text-emerald-500" />}
                {f.status === "modified" && <FilePlus className="h-3 w-3 text-amber-500" />}
                {f.status === "untracked" && <FilePlus className="h-3 w-3 text-blue-500" />}
                {f.status === "deleted" && <FileX className="h-3 w-3 text-red-500" />}
                <span className="truncate flex-1">{f.file}</span>
                <span className="text-[0.55rem] text-muted-foreground uppercase">{f.status}</span>
                {(f.status === "modified" || f.status === "untracked") && (
                  <button
                    onClick={(e) => { e.stopPropagation(); stageFile(f.file) }}
                    className="rounded p-0.5 hover:bg-accent"
                    title="إضافة للترقين"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Diff + Commit */}
      {selectedFile && (
        <div className="border-t border-border">
          <div className="px-3 py-1.5 text-[0.65rem] text-muted-foreground border-b border-border">
            Diff: {selectedFile}
          </div>
          <pre className="max-h-40 overflow-auto chat-scroll px-3 py-2 text-[0.6rem] font-mono">
            {diff}
          </pre>
        </div>
      )}
      <div className="border-t border-border p-2 space-y-2">
        <Textarea
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          placeholder="رسالة commit…"
          className="text-xs min-h-12 resize-none"
        />
        <Button size="sm" onClick={commit} disabled={committing || !commitMsg.trim()} className="w-full h-7 text-xs">
          <GitCommit className="h-3 w-3" />
          Commit
        </Button>
      </div>
    </div>
  )
}
