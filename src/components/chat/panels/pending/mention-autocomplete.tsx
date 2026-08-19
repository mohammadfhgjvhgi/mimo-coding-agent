"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useMimo } from "@/lib/mimo-store";
import { safeFetch } from "@/lib/safe-fetch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { X, Paperclip } from "lucide-react";
import { getFileIcon } from "@/lib/file-utils";
import { cn } from "@/lib/utils";

interface TreeNode {
  path: string;
  size: number;
  type: "file" | "directory";
}

export interface AttachedFile {
  path: string;
  content: string;
  size: number;
}

// P-fix: getFileIcon now imported from @/lib/file-utils

/**
 * Hook: manages @-mention state + file attachment.
 * Call `handleInputChange(value)` on every textarea change.
 */
export function useMentionAutocomplete(
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  currentValue: string,
  onValueChange: (v: string) => void
) {
  const { currentProjectId } = useMimo();
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [, setMentionStart] = useState(-1);
  const [files, setFiles] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const filesLoadedRef = useRef(false);
  const mentionStartRef = useRef(-1);

  const loadFiles = useCallback(async () => {
    if (filesLoadedRef.current) return;
    if (!currentProjectId) {
      // No project selected — show empty state with guidance
      setFiles([]);
      return;
    }
    filesLoadedRef.current = true;
    setLoading(true);
    const url = `/api/workspace/tree?projectId=${currentProjectId}`;
    try {
      const data = await safeFetch<{ tree: TreeNode[] }>(url);
      setFiles(data.tree ?? []);
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [currentProjectId]);

  const handleInputChange = useCallback(
    (newValue: string) => {
      onValueChange(newValue);

      const cursorPos = textareaRef.current?.selectionStart ?? newValue.length;
      const beforeCursor = newValue.slice(0, cursorPos);
      const atMatch = beforeCursor.match(/(?:^|\s)@([\w./-]*)$/);

      if (atMatch) {
        const atPos = beforeCursor.lastIndexOf("@");
        mentionStartRef.current = atPos;
        setMentionStart(atPos);
        setMentionQuery(atMatch[1] ?? "");
        setMentionOpen(true);
        setHighlightIndex(0);
        void loadFiles();
      } else {
        setMentionOpen(false);
        setMentionStart(-1);
        mentionStartRef.current = -1;
      }
    },
    [onValueChange, textareaRef, loadFiles]
  );

  const insertMention = useCallback(
    async (filePath: string) => {
      const start = mentionStartRef.current;
      if (start < 0) return;

      const before = currentValue.slice(0, start);
      const queryLen = mentionQuery.length + 1; // +1 for @
      const after = currentValue.slice(start + queryLen);
      const newValue = `${before}@${filePath} ${after}`;
      onValueChange(newValue);
      setMentionOpen(false);
      setMentionStart(-1);
      mentionStartRef.current = -1;

      // Fetch file content and attach
      try {
        const url = currentProjectId
          ? `/api/workspace/file?projectId=${currentProjectId}&path=${encodeURIComponent(filePath)}`
          : `/api/workspace/file?path=${encodeURIComponent(filePath)}`;
        const data = await safeFetch<{ content: string; size: number }>(url);
        setAttachedFiles((prev) =>
          prev.some((f) => f.path === filePath) ? prev : [...prev, { path: filePath, content: data.content ?? "", size: data.size ?? 0 }]
        );
      } catch {
        // non-fatal
      }

      setTimeout(() => {
        if (textareaRef.current) {
          const newPos = before.length + filePath.length + 2;
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newPos, newPos);
        }
      }, 0);
    },
    [currentValue, mentionQuery, onValueChange, textareaRef, currentProjectId]
  );

  const detachFile = useCallback((path: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.path !== path));
  }, []);

  const clearAttached = useCallback(() => {
    setAttachedFiles([]);
    filesLoadedRef.current = false;
  }, []);

  const closeMention = useCallback(() => {
    setMentionOpen(false);
    setMentionStart(-1);
    mentionStartRef.current = -1;
  }, []);

  return {
    mentionOpen,
    mentionQuery,
    setMentionQuery,
    files,
    loading,
    highlightIndex,
    setHighlightIndex,
    attachedFiles,
    handleInputChange,
    insertMention,
    detachFile,
    clearAttached,
    closeMention,
  };
}

/** Presentational component: renders the mention popover + attached file chips */
export function MentionPopover({
  open,
  onOpenChange,
  query,
  onQueryChange,
  files,
  loading,
  highlightIndex,
  onHighlightChange,
  onSelect,
  attachedFiles,
  onDetach,
  hasProject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (q: string) => void;
  files: TreeNode[];
  loading: boolean;
  highlightIndex: number;
  onHighlightChange: (i: number) => void;
  onSelect: (path: string) => void;
  attachedFiles: AttachedFile[];
  onDetach: (path: string) => void;
  hasProject: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  // Standard React pattern for client-only rendering (avoids Radix ID hydration mismatch)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const filteredFiles = files
    .filter((f) => f.type === "file")
    .filter((f) => (query ? f.path.toLowerCase().includes(query.toLowerCase()) : true))
    .slice(0, 20);

  const safeHighlightIndex = Math.min(highlightIndex, Math.max(0, filteredFiles.length - 1));

  return (
    <>
      {/* Only render Popover after mount to avoid Radix ID hydration mismatch */}
      {mounted && (
        <Popover open={open} onOpenChange={onOpenChange}>
          <PopoverTrigger asChild>
            <span className="sr-only" aria-hidden>
              mention
            </span>
          </PopoverTrigger>
          <PopoverContent
            className="w-80 p-0"
            align="start"
            side="top"
            sideOffset={8}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <Command shouldFilter={false}>
              <CommandInput
                placeholder={loading ? "Loading files..." : "Search files..."}
                value={query}
                onValueChange={onQueryChange}
              />
              <CommandList className="max-h-60 scrollbar-thin">
              <CommandEmpty>
                {loading
                  ? "Loading..."
                  : !hasProject
                  ? "Select a project first to mention files."
                  : "No files found."}
              </CommandEmpty>
              {filteredFiles.length > 0 && (
                <CommandGroup>
                  {filteredFiles.map((file, i) => {
                    const Icon = getFileIcon(file.path);
                    const isAttached = attachedFiles.some((a) => a.path === file.path);
                    return (
                      <CommandItem
                        key={file.path}
                        value={file.path}
                        onSelect={() => onSelect(file.path)}
                        className={cn("gap-2", i === safeHighlightIndex && "bg-accent")}
                        onMouseEnter={() => onHighlightChange(i)}
                      >
                        <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="font-mono text-xs flex-1 truncate">{file.path}</span>
                        {isAttached && <Paperclip className="w-3 h-3 text-violet-500 flex-shrink-0" />}
                        <span className="text-[10px] text-muted-foreground">
                          {(file.size / 1024).toFixed(1)}k
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      )}

      {/* Attached files chips */}
      {attachedFiles.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
          {attachedFiles.map((file) => {
            const Icon = getFileIcon(file.path);
            return (
              <div
                key={file.path}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-[11px]"
              >
                <Icon className="w-2.5 h-2.5 text-violet-400" />
                <span className="font-mono text-violet-300 truncate max-w-32">{file.path}</span>
                <button onClick={() => onDetach(file.path)} className="text-violet-400 hover:text-violet-200">
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
