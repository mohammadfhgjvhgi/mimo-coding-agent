"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Wrench,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getLanguage, getFileIcon } from "@/lib/file-utils";

interface ActiveTool {
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  status: "starting" | "done" | "error";
  timestamp: number;
}

interface ToolCallCardProps {
  tool: ActiveTool;
  onViewFile?: (filename: string) => void;
}

// Tools that modify files — rendered with diff-like preview
const FILE_MOD_TOOLS = new Set(["file_write", "file_edit", "patch", "file_delete", "file_rename", "dir_create"]);

// P-fix: getLanguage and getFileIcon now imported from @/lib/file-utils

/** Detect lines that were added/removed for a simple visual diff */
function renderDiffLines(
  oldText: string | undefined,
  newText: string | undefined
): Array<{ type: "add" | "remove" | "context"; text: string; lineNum?: number }> {
  if (!newText && !oldText) return [];
  if (!oldText) {
    // Pure addition — new file
    return (newText ?? "")
      .split("\n")
      .map((text, i) => ({ type: "add" as const, text, lineNum: i + 1 }));
  }
  if (!newText) {
    // Pure deletion
    return oldText
      .split("\n")
      .map((text, i) => ({ type: "remove" as const, text, lineNum: i + 1 }));
  }
  // Both exist — do a simple line-by-line diff
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const result: Array<{ type: "add" | "remove" | "context"; text: string; lineNum?: number }> = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oldL = oldLines[i];
    const newL = newLines[i];
    if (oldL === newL) {
      if (oldL !== undefined) result.push({ type: "context", text: oldL, lineNum: i + 1 });
    } else {
      if (oldL !== undefined) result.push({ type: "remove", text: oldL, lineNum: i + 1 });
      if (newL !== undefined) result.push({ type: "add", text: newL, lineNum: i + 1 });
    }
  }
  return result;
}

export function ToolCallCard({ tool, onViewFile }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(true);
  const isFileMod = FILE_MOD_TOOLS.has(tool.name);
  const isRunning = tool.status === "starting";
  const isDone = tool.status === "done";
  const isError = tool.status === "error";

  // Extract file info based on tool type
  const filename =
    (tool.input.filename as string) ??
    (tool.input.path as string) ??
    (tool.input.filename as string) ??
    "unknown";

  const fileIcon = getFileIcon(filename);
  const lang = getLanguage(filename);

  // Build diff content based on tool type
  let diffLines: Array<{ type: "add" | "remove" | "context"; text: string; lineNum?: number }> = [];
  let diffTitle = "";

  if (tool.name === "file_write") {
    const content = (tool.input.content as string) ?? "";
    diffLines = renderDiffLines(undefined, content);
    diffTitle = "new file";
  } else if (tool.name === "patch") {
    const find = (tool.input.find as string) ?? "";
    const replace = (tool.input.replace as string) ?? "";
    diffLines = [
      ...find.split("\n").map((text, i) => ({ type: "remove" as const, text, lineNum: i + 1 })),
      ...replace.split("\n").map((text, i) => ({ type: "add" as const, text, lineNum: i + 1 })),
    ];
    diffTitle = "patch";
  } else if (tool.name === "file_edit") {
    const edits = (tool.input.edits as Array<{ lineNumber: number; newContent: string }>) ?? [];
    diffLines = edits.flatMap((edit) => [
      { type: "remove" as const, text: `(line ${edit.lineNumber})`, lineNum: edit.lineNumber },
      { type: "add" as const, text: edit.newContent, lineNum: edit.lineNumber },
    ]);
    diffTitle = `${edits.length} edit${edits.length !== 1 ? "s" : ""}`;
  } else if (tool.name === "file_delete") {
    diffTitle = "delete file";
  } else if (tool.name === "file_rename") {
    const from = (tool.input.from as string) ?? (tool.input.path as string) ?? "";
    const to = (tool.input.to as string) ?? (tool.input.newPath as string) ?? "";
    diffTitle = `rename: ${from} → ${to}`;
  } else if (tool.name === "dir_create") {
    diffTitle = "new directory";
  }

  // For non-file tools, show generic JSON input/output
  const showGeneric = !isFileMod;

  const addedCount = diffLines.filter((l) => l.type === "add").length;
  const removedCount = diffLines.filter((l) => l.type === "remove").length;

  return (
    <Card
      className={cn(
        "overflow-hidden border-l-2",
        isRunning && "border-l-amber-400 border-l-2",
        isDone && "border-l-emerald-400",
        isError && "border-l-rose-400"
      )}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
        )}

        {isFileMod ? (
          (() => {
            const Icon = fileIcon;
            return <Icon className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />;
          })()
        ) : (
          <Wrench className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
        )}

        <span className="font-mono text-xs font-semibold flex-shrink-0">{tool.name}</span>

        {isFileMod && filename !== "unknown" && (
          <span className="text-[11px] text-muted-foreground truncate font-mono">{filename}</span>
        )}

        {diffTitle && (
          <Badge variant="outline" className="text-[9px] py-0 px-1.5 h-4 text-muted-foreground">
            {diffTitle}
          </Badge>
        )}

        {addedCount > 0 && (
          <Badge className="text-[9px] py-0 px-1.5 h-4 bg-emerald-500/15 text-emerald-500 border-0">
            +{addedCount}
          </Badge>
        )}
        {removedCount > 0 && (
          <Badge className="text-[9px] py-0 px-1.5 h-4 bg-rose-500/15 text-rose-500 border-0">
            -{removedCount}
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
          {isRunning && (
            <Badge variant="secondary" className="text-[9px] py-0 px-1.5 h-4">
              <Loader2 className="w-2.5 h-2.5 mr-1 animate-spin" />
              running
            </Badge>
          )}
          {isDone && (
            <Badge className="text-[9px] py-0 px-1.5 h-4 bg-emerald-500 border-0">
              <CheckCircle2 className="w-2.5 h-2.5 mr-1" />
              done
            </Badge>
          )}
          {isError && (
            <Badge variant="destructive" className="text-[9px] py-0 px-1.5 h-4">
              <XCircle className="w-2.5 h-2.5 mr-1" />
              error
            </Badge>
          )}
        </div>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t bg-zinc-950/50">
          {isFileMod && diffLines.length > 0 ? (
            <DiffView lines={diffLines} lang={lang} />
          ) : showGeneric ? (
            <GenericInputOutput tool={tool} />
          ) : null}

          {/* Error display */}
          {isError && tool.error && (
            <div className="px-3 py-2 text-[11px] text-rose-400 font-mono border-t border-rose-500/20">
              {tool.error}
            </div>
          )}

          {/* Action footer */}
          {isFileMod && isDone && filename !== "unknown" && onViewFile && (
            <div className="px-3 py-1.5 border-t flex items-center justify-between bg-muted/20">
              <span className="text-[10px] text-muted-foreground">
                {tool.name === "file_write" && "File created/updated"}
                {tool.name === "file_edit" && "File edited"}
                {tool.name === "patch" && "Patch applied"}
                {tool.name === "file_delete" && "File deleted"}
                {tool.name === "file_rename" && "File renamed"}
                {tool.name === "dir_create" && "Directory created"}
              </span>
              {tool.name !== "file_delete" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] gap-1"
                  onClick={() => onViewFile(filename)}
                >
                  <ExternalLink className="w-2.5 h-2.5" />
                  View in Files
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function DiffView({
  lines,
  lang: _lang,
}: {
  lines: Array<{ type: "add" | "remove" | "context"; text: string; lineNum?: number }>;
  lang: string;
}) {
  // Cap to first 100 lines to avoid huge renders
  const capped = lines.slice(0, 100);
  const truncated = lines.length > 100;

  return (
    <div className="overflow-x-auto max-h-80 overflow-y-auto scrollbar-thin">
      <table className="w-full text-[11px] font-mono">
        <tbody>
          {capped.map((line, i) => (
            <tr
              key={i}
              className={cn(
                line.type === "add" && "bg-emerald-500/10",
                line.type === "remove" && "bg-rose-500/10",
                line.type === "context" && "bg-transparent"
              )}
            >
              <td className="w-8 text-right pr-2 text-muted-foreground/50 select-none border-r border-border/30">
                {line.lineNum ?? ""}
              </td>
              <td className="w-4 text-center select-none">
                {line.type === "add" && <span className="text-emerald-400">+</span>}
                {line.type === "remove" && <span className="text-rose-400">-</span>}
                {line.type === "context" && <span> </span>}
              </td>
              <td className="pl-2 pr-3 whitespace-pre">
                {line.type === "add" ? (
                  <span className="text-emerald-300">{line.text}</span>
                ) : line.type === "remove" ? (
                  <span className="text-rose-300 line-through">{line.text}</span>
                ) : (
                  <span className="text-zinc-400">{line.text}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {truncated && (
        <div className="text-center text-[10px] text-muted-foreground py-1 border-t">
          {lines.length - 100} more lines...
        </div>
      )}
    </div>
  );
}

function GenericInputOutput({ tool }: { tool: ActiveTool }) {
  const [tab, setTab] = useState<"input" | "output">("input");

  const inputStr = JSON.stringify(tool.input, null, 2);
  const outputStr =
    tool.output != null
      ? typeof tool.output === "string"
        ? tool.output
        : JSON.stringify(tool.output, null, 2)
      : "";
  const hasOutput = outputStr.length > 0;

  return (
    <div>
      {hasOutput && (
        <div className="flex border-b border-border/30">
          <button
            onClick={() => setTab("input")}
            className={cn(
              "px-3 py-1 text-[10px] font-medium transition-colors",
              tab === "input"
                ? "bg-muted/50 text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Input
          </button>
          <button
            onClick={() => setTab("output")}
            className={cn(
              "px-3 py-1 text-[10px] font-medium transition-colors",
              tab === "output"
                ? "bg-muted/50 text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Output
          </button>
        </div>
      )}
      <pre className="p-3 text-[11px] overflow-x-auto max-h-48 scrollbar-thin text-zinc-300">
        <code>{tab === "input" ? inputStr : outputStr}</code>
      </pre>
    </div>
  );
}
