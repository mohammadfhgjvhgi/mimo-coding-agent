"use client"

import * as React from "react"
import {
  Folder,
  FolderOpen,
  FileText,
  RefreshCw,
  Loader2,
  ChevronLeft,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

interface TreeNode {
  name: string
  path: string
  type: "dir" | "file"
  children?: TreeNode[]
}

interface WorkspaceExplorerProps {
  activeFile: string | null
  onRefresh?: () => void
  refreshSignal?: number
}

function findPathsToNode(tree: TreeNode[], target: string): Set<string> {
  const result = new Set<string>()
  function walk(nodes: TreeNode[], prefix: string[]): boolean {
    for (const node of nodes) {
      const here = [...prefix, node.name].join("/")
      if (node.path === target || here === target) {
        result.add(node.path)
        // also add all ancestor folder paths
        return true
      }
      if (node.type === "dir" && node.children) {
        if (walk(node.children, [...prefix, node.name])) {
          result.add(node.path)
          return true
        }
      }
    }
    return false
  }
  walk(tree, [])
  return result
}

function TreeItem({
  node,
  depth,
  expanded,
  toggle,
  activePath,
  highlightPaths,
}: {
  node: TreeNode
  depth: number
  expanded: Set<string>
  toggle: (path: string) => void
  activePath: string | null
  highlightPaths: Set<string>
}) {
  const isDir = node.type === "dir"
  const isOpen = expanded.has(node.path)
  const isActive = activePath === node.path
  const isOnPath = highlightPaths.has(node.path)

  if (isDir) {
    return (
      <div>
        <button
          onClick={() => toggle(node.path)}
          className={cn(
            "flex w-full items-center gap-1 rounded px-1.5 py-1 text-right text-sm transition",
            isOnPath
              ? "bg-accent/60 text-foreground"
              : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
          )}
          style={{ paddingRight: `${depth * 12 + 6}px` }}
        >
          {isOpen ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500/80" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {isOpen && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                toggle={toggle}
                activePath={activePath}
                highlightPaths={highlightPaths}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded px-1.5 py-1 text-sm transition",
        isActive
          ? "bg-primary/15 text-primary font-medium"
          : isOnPath
          ? "bg-accent/40 text-foreground"
          : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
      )}
      style={{ paddingRight: `${depth * 12 + 6}px` }}
    >
      <FileText
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          isActive ? "text-primary" : "text-muted-foreground/70"
        )}
      />
      <span className="truncate">{node.name}</span>
      {isActive && (
        <span className="mr-auto flex h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
      )}
    </div>
  )
}

export function WorkspaceExplorer({
  activeFile,
  onRefresh,
  refreshSignal,
}: WorkspaceExplorerProps) {
  const [tree, setTree] = React.useState<TreeNode[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/workspace?depth=5")
      if (!res.ok) throw new Error("فشل تحميل الشجرة")
      const data = await res.json()
      setTree(data.tree || [])
      // Auto-expand top-level directories
      setExpanded(
        new Set(
          (data.tree || [])
            .filter((n: TreeNode) => n.type === "dir")
            .map((n: TreeNode) => n.path)
        )
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطأ غير معروف")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load, refreshSignal])

  // When activeFile changes, ensure the path to it is expanded
  React.useEffect(() => {
    if (!activeFile || tree.length === 0) return
    const paths = findPathsToNode(tree, activeFile)
    if (paths.size > 0) {
      setExpanded((prev) => {
        const next = new Set(prev)
        paths.forEach((p) => next.add(p))
        return next
      })
    }
  }, [activeFile, tree])

  const toggle = (p: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })

  const highlightPaths = React.useMemo(
    () => (activeFile ? findPathsToNode(tree, activeFile) : new Set<string>()),
    [activeFile, tree]
  )

  const fileCount = React.useMemo(
    () => countFiles(tree),
    [tree]
  )

  return (
    <div className="flex h-full w-full flex-col bg-sidebar">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-sidebar-border">
        <span className="flex-1 text-xs font-semibold tracking-tight">
          مستكشف المشروع
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            load()
            onRefresh?.()
          }}
          className="h-7 w-7 rounded-md"
          aria-label="تحديث"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {/* Tree */}
      <ScrollArea className="flex-1 chat-scroll">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mb-2" />
            <span className="text-xs">جارٍ تحميل الشجرة…</span>
          </div>
        ) : error ? (
          <div className="px-3 py-6 text-center text-xs text-destructive">
            {error}
          </div>
        ) : tree.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            مجلد العمل فارغ
          </div>
        ) : (
          <div className="py-1 px-1">
            {tree.map((node) => (
              <TreeItem
                key={node.path}
                node={node}
                depth={0}
                expanded={expanded}
                toggle={toggle}
                activePath={activeFile}
                highlightPaths={highlightPaths}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-sidebar-border px-3 py-1.5">
        <span className="text-[0.7rem] text-muted-foreground">
          {fileCount} ملف
        </span>
      </div>
    </div>
  )
}

function countFiles(nodes: TreeNode[]): number {
  let n = 0
  for (const node of nodes) {
    if (node.type === "file") n++
    else if (node.children) n += countFiles(node.children)
  }
  return n
}

void ChevronLeft
