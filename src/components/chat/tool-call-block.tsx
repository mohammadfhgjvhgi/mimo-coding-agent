"use client"

import * as React from "react"
import {
  FileText,
  FilePlus,
  FileEdit,
  Terminal,
  FolderTree,
  GitCommitHorizontal,
  Brain,
  Lightbulb,
  Target,
  Search,
  Link2,
  Code2,
  ChevronRight,
  Check,
  X,
  Loader2,
  Clock,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { DiffViewer } from "./diff-viewer"
import type { ToolCallRecord } from "@/types/chat"

interface ToolCallBlockProps {
  call: ToolCallRecord | { id: string; name: string; args: Record<string, unknown>; status?: "pending"; result?: never }
  pending?: boolean
}

const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  read_file: FileText,
  write_file: FilePlus,
  edit_file: FileEdit,
  run_terminal_command: Terminal,
  list_files: FolderTree,
  git_checkpoint: GitCommitHorizontal,
  save_memory: Brain,
  recall_memory: Lightbulb,
  set_goal: Target,
  find_symbol: Search,
  get_references: Link2,
  structural_search: Code2,
}

const TOOL_LABELS: Record<string, string> = {
  read_file: "قراءة ملف",
  write_file: "كتابة ملف",
  edit_file: "تعديل ملف",
  run_terminal_command: "تنفيذ أمر طرفية",
  list_files: "خريطة المستودع",
  git_checkpoint: "نقطة استرجاع",
  save_memory: "حفظ ذاكرة",
  recall_memory: "استرجاع ذاكرة",
  set_goal: "تحديد هدف",
  find_symbol: "بحث عن رمز",
  get_references: "مراجع الرمز",
  structural_search: "بحث هيكلي",
}

function prettyArgs(name: string, args: Record<string, unknown>): string {
  if (name === "read_file" || name === "write_file" || name === "edit_file") {
    return String(args.path || "")
  }
  if (name === "run_terminal_command") {
    return String(args.command || "")
  }
  if (name === "list_files") {
    const p = args.path ? String(args.path) : ""
    return p || "جذر المشروع"
  }
  if (name === "git_checkpoint") {
    return String(args.message || "MiMo X Checkpoint")
  }
  if (name === "save_memory" || name === "recall_memory") {
    return String(args.key || "(الكل)")
  }
  if (name === "set_goal") {
    return String(args.goal || "").slice(0, 60)
  }
  if (name === "find_symbol" || name === "get_references") {
    return String(args.name || "")
  }
  if (name === "structural_search") {
    return String(args.pattern || "")
  }
  return JSON.stringify(args, null, 2)
}

function statusBadge(call: ToolCallBlockProps["call"], pending?: boolean) {
  if (pending || call.status === "pending") {
    return (
      <span className="flex items-center gap-1 text-[0.7rem] text-amber-500">
        <Loader2 className="h-3 w-3 animate-spin" /> جارٍ التنفيذ…
      </span>
    )
  }
  if (call.status === "success") {
    return (
      <span className="flex items-center gap-1 text-[0.7rem] text-emerald-500">
        <Check className="h-3 w-3" /> نجح
        {"durationMs" in call && call.durationMs != null && (
          <span className="flex items-center gap-0.5 text-muted-foreground">
            <Clock className="h-2.5 w-2.5" />
            {call.durationMs < 1000 ? `${call.durationMs}ms` : `${(call.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-[0.7rem] text-destructive">
      <X className="h-3 w-3" /> فشل
    </span>
  )
}

export function ToolCallBlock({ call, pending }: ToolCallBlockProps) {
  const [open, setOpen] = React.useState(false)
  const Icon = TOOL_ICONS[call.name] || Terminal
  const label = TOOL_LABELS[call.name] || call.name
  const summary = prettyArgs(call.name, call.args)

  const isTerminal = call.name === "run_terminal_command"
  const isEdit = call.name === "edit_file"
  const isList = call.name === "list_files"
  const isGit = call.name === "git_checkpoint"
  const resultText = "result" in call && call.result ? String(call.result) : ""

  // For edit_file, extract search & replace to render a visual diff
  const searchStr = isEdit ? String((call.args as Record<string, unknown>).search || "") : ""
  const replaceStr = isEdit ? String((call.args as Record<string, unknown>).replace || "") : ""

  // Auto-open edit_file blocks to show the diff
  React.useEffect(() => {
    if (isEdit && call.status === "success") setOpen(true)
  }, [call.status])

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-muted/30">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-right transition hover:bg-muted/60"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90"
          )}
        />
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-xs font-medium">{label}</span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xs text-muted-foreground",
            (isTerminal || isGit) && "font-mono"
          )}
          dir={isTerminal || isGit || /[a-zA-Z0-9_/]/.test(summary) ? "ltr" : "rtl"}
        >
          {summary}
        </span>
        {statusBadge(call, pending)}
      </button>

      {open && (
        <div className="border-t border-border bg-background/60 px-3 py-2">
          {/* For edit_file: show visual diff */}
          {isEdit && searchStr ? (
            <div className="mb-2">
              <DiffViewer search={searchStr} replace={replaceStr} />
            </div>
          ) : null}

          {/* Args (skip for edit_file since the diff shows them, and for list_files since the result IS the tree) */}
          {!isEdit && !isList && (
            <div className="mb-2">
              <p className="mb-1 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
                المدخلات
              </p>
              <pre
                dir="ltr"
                className="overflow-x-auto chat-scroll rounded-md bg-muted/60 p-2 text-[0.75rem] leading-relaxed"
              >
                {JSON.stringify(call.args, null, 2)}
              </pre>
            </div>
          )}

          {/* Result */}
          {resultText && (
            <div>
              <p className="mb-1 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
                {call.status === "error" ? "الخطأ" : "المخرجات"}
              </p>
              <pre
                dir="ltr"
                className={cn(
                  "chat-scroll max-h-72 overflow-auto whitespace-pre-wrap rounded-md p-2 text-[0.75rem] leading-relaxed",
                  call.status === "error"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-emerald-500/5"
                )}
              >
                {resultText}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
