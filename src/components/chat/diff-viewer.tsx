"use client"

import * as React from "react"
import { Minus, Plus } from "lucide-react"
import { cn } from "@/lib/utils"

interface DiffViewerProps {
  search: string
  replace: string
  className?: string
}

interface DiffLine {
  type: "context" | "add" | "remove"
  text: string
}

// Simple line-based diff: treat `search` lines as removed and `replace` lines as
// added. For a richer LCS diff we'd compute the longest common subsequence, but
// for the targeted search&replace edits our agent does, this is accurate and
// visually clear (matches the GitHub feel).
function computeDiff(search: string, replace: string): DiffLine[] {
  const beforeLines = search.split("\n")
  const afterLines = replace.split("\n")
  const lines: DiffLine[] = []

  // Greedy LCS to find common lines
  const n = beforeLines.length
  const m = afterLines.length
  // Build LCS table
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0)
  )
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (beforeLines[i] === afterLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
  }

  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (beforeLines[i] === afterLines[j]) {
      lines.push({ type: "context", text: beforeLines[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ type: "remove", text: beforeLines[i] })
      i++
    } else {
      lines.push({ type: "add", text: afterLines[j] })
      j++
    }
  }
  while (i < n) {
    lines.push({ type: "remove", text: beforeLines[i] })
    i++
  }
  while (j < m) {
    lines.push({ type: "add", text: afterLines[j] })
    j++
  }
  return lines
}

export function DiffViewer({ search, replace, className }: DiffViewerProps) {
  const lines = React.useMemo(
    () => computeDiff(search, replace),
    [search, replace]
  )

  const added = lines.filter((l) => l.type === "add").length
  const removed = lines.filter((l) => l.type === "remove").length

  return (
    <div className={cn("rounded-md border border-border overflow-hidden", className)}>
      <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-3 py-1.5 text-[0.7rem]">
        <span className="font-medium text-muted-foreground">الفروقات</span>
        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
          <Plus className="h-3 w-3" /> {added}
        </span>
        <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
          <Minus className="h-3 w-3" /> {removed}
        </span>
      </div>
      <div
        dir="ltr"
        className="overflow-x-auto chat-scroll bg-[#0d1117] text-[0.78rem] leading-relaxed font-mono"
      >
        {lines.length === 0 ? (
          <div className="px-3 py-2 text-muted-foreground text-center">
            لا فروقات
          </div>
        ) : (
          lines.map((line, idx) => (
            <div
              key={idx}
              className={cn(
                "flex min-w-max px-2",
                line.type === "add" && "bg-emerald-500/15 text-emerald-50",
                line.type === "remove" && "bg-red-500/15 text-red-50",
                line.type === "context" && "text-zinc-400"
              )}
            >
              <span className="inline-block w-5 shrink-0 select-none text-center opacity-60">
                {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
              </span>
              <span className="whitespace-pre">{line.text || " "}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
