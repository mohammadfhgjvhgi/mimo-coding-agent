"use client";

import { useState, useEffect, useRef, memo } from "react";
import { CheckCircle2, FileCode, FileText, Loader2, Terminal, Play, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { getLanguage, getFileIcon } from "@/lib/file-utils";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface ArtifactAction {
  id: string;
  type: "file" | "shell" | "start";
  filePath?: string;
  content: string;
  status: "streaming" | "complete";
}

interface ArtifactCardProps {
  artifactId: string;
  title: string;
  actions: ArtifactAction[];
  previewUrl?: string;
  onViewPreview?: (artifactId: string) => void;
}

function ArtifactCardImpl({ artifactId, title, actions, previewUrl, onViewPreview }: ArtifactCardProps) {
  const [expanded, setExpanded] = useState(true);
  const completedCount = actions.filter((a) => a.status === "complete").length;
  const totalCount = actions.length;
  const allComplete = completedCount === totalCount && totalCount > 0;
  const hasFileActions = actions.some((a) => a.type === "file");

  return (
    <div className="my-3 rounded-lg border border-border overflow-hidden bg-card/30">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-secondary/50 transition-smooth text-left"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}

        <div className="flex-shrink-0">
          {allComplete ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          ) : (
            <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{title}</div>
          <div className="text-[11px] text-muted-foreground">
            {completedCount}/{totalCount} files
            {allComplete ? " · ready" : " · building..."}
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-16 h-1 rounded-full bg-secondary overflow-hidden flex-shrink-0">
          <div
            className={cn(
              "h-full transition-all duration-300",
              allComplete ? "bg-emerald-500" : "bg-primary"
            )}
            style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }}
          />
        </div>
      </button>

      {/* Body: file actions */}
      {expanded && (
        <div className="border-t border-border">
          {actions.map((action, i) => (
            <ActionRow key={action.id || i} action={action} />
          ))}

          {/* Preview button */}
          {allComplete && hasFileActions && previewUrl && onViewPreview && (
            <div className="border-t border-border px-3 py-2">
              <button
                onClick={() => onViewPreview(artifactId)}
                className="flex items-center gap-2 text-xs font-medium text-primary hover:text-primary/80 transition-smooth"
              >
                <Play className="w-3.5 h-3.5" />
                View Preview
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActionRow({ action }: { action: ArtifactAction }) {
  const [expanded, setExpanded] = useState(false);
  const isFile = action.type === "file";
  const isShell = action.type === "shell" || action.type === "start";
  const Icon = isFile ? getFileIcon(action.filePath ?? "") : Terminal;
  const lang = isFile ? getLanguage(action.filePath ?? "") : "bash";
  const lineCount = action.content.split("\n").length;

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => isFile && setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 hover:bg-secondary/30 transition-smooth text-left",
          !isFile && "cursor-default"
        )}
      >
        {isFile && (expanded ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
        ))}

        <Icon className={cn("w-3.5 h-3.5 flex-shrink-0", isFile ? "text-muted-foreground" : "text-amber-500")} />

        <span className="text-xs font-mono flex-1 truncate">
          {isFile ? action.filePath : action.content.slice(0, 60)}
        </span>

        {isFile && (
          <span className="text-[10px] text-muted-foreground flex-shrink-0">
            {lineCount} lines
          </span>
        )}

        {action.status === "complete" ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
        ) : (
          <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin flex-shrink-0" />
        )}
      </button>

      {/* File content preview (collapsible) */}
      {isFile && expanded && action.content && (
        <div className="bg-zinc-950 border-t border-border max-h-64 overflow-y-auto scrollbar-thin">
          <SyntaxHighlighter
            language={lang}
            style={oneDark}
            customStyle={{
              margin: 0,
              padding: "12px",
              fontSize: "11px",
              background: "transparent",
            }}
            codeTagProps={{ style: { fontFamily: "var(--font-geist-mono)" } }}
          >
            {action.content}
          </SyntaxHighlighter>
        </div>
      )}
    </div>
  );
}

export const ArtifactCard = memo(ArtifactCardImpl);
