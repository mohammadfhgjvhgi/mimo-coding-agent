"use client";

import { useState, useEffect, useCallback } from "react";
import { useMimo } from "@/lib/mimo-store";
import { safeFetch } from "@/lib/safe-fetch";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Folder,
  File as FileIcon,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Eye,
  Code2,
  Save,
  X,
  GitCompare,
  History,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { getLanguage, getFileIcon } from "@/lib/file-utils";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface TreeNode {
  path: string;
  size: number;
  type: "file" | "directory";
}

interface FileTreeGroup {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileTreeGroup[];
  file?: TreeNode;
}

// Build a tree structure from a flat list of file paths
function buildTree(files: TreeNode[]): FileTreeGroup[] {
  const root: FileTreeGroup[] = [];

  for (const file of files) {
    const parts = file.path.split("/");
    let currentLevel = root;
    let currentPath = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLast = i === parts.length - 1;

      let existing = currentLevel.find((n) => n.name === part);
      if (!existing) {
        existing = {
          name: part,
          path: currentPath,
          isDir: !isLast,
          children: isLast ? undefined : [],
          file: isLast ? file : undefined,
        };
        currentLevel.push(existing);
      }
      if (!isLast) {
        currentLevel = existing.children ?? (existing.children = []);
      }
    }
  }

  // Sort: directories first, then files, alphabetically
  const sortGroup = (group: FileTreeGroup[]) => {
    group.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of group) {
      if (node.children) sortGroup(node.children);
    }
  };
  sortGroup(root);
  return root;
}

// P-fix: getFileIcon and getLanguage now imported from shared @/lib/file-utils
// (was duplicated in 4 files with drift)

// ─── Tree Node Component ────────────────────────────────────────────

function TreeItem({
  node,
  depth,
  expandedPaths,
  togglePath,
  selectedPath,
  onSelectFile,
}: {
  node: FileTreeGroup;
  depth: number;
  expandedPaths: Set<string>;
  togglePath: (path: string) => void;
  selectedPath: string | null;
  onSelectFile: (node: TreeNode) => void;
}) {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;

  if (node.isDir) {
    const Icon = Folder;
    return (
      <div>
        <button
          onClick={() => togglePath(node.path)}
          className={cn(
            "w-full flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-muted/50 transition-colors text-left",
            `pl-${depth * 2 + 2}`
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {isExpanded ? (
            <ChevronDown className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
          )}
          <Icon className="w-3.5 h-3.5 flex-shrink-0 text-amber-500" />
          <span className="truncate">{node.name}</span>
        </button>
        {isExpanded && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                expandedPaths={expandedPaths}
                togglePath={togglePath}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const FileIconComponent = getFileIcon(node.name);
  return (
    <button
      onClick={() => node.file && onSelectFile(node.file)}
      className={cn(
        "w-full flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-muted/50 transition-colors text-left",
        isSelected && "bg-violet-500/10 text-violet-600 dark:text-violet-400"
      )}
      style={{ paddingLeft: `${depth * 12 + 24}px` }}
    >
      <FileIconComponent className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
      <span className="truncate">{node.name}</span>
      {node.file && (
        <span className="ml-auto text-[10px] text-muted-foreground/60 flex-shrink-0">
          {(node.file.size / 1024).toFixed(1)}KB
        </span>
      )}
    </button>
  );
}

// ─── Diff Viewer (P2-6, depends on P2-5 versioning) ────────────────

interface DiffRow {
  type: "added" | "removed" | "same";
  lineA?: number;
  lineB?: number;
  content: string;
}

function DiffViewer({
  diff,
  versionA,
  versionB,
  added,
  removed,
}: {
  diff: DiffRow[];
  versionA: number;
  versionB: number;
  added: number;
  removed: number;
}) {
  return (
    <div className="border rounded-lg overflow-hidden bg-zinc-950">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <GitCompare className="w-3.5 h-3.5 text-violet-400" />
          <span className="text-xs font-mono text-zinc-400">
            v{versionA} → v{versionB}
          </span>
        </div>
        <span className="text-xs font-mono text-zinc-400">
          +{added} / -{removed}
        </span>
      </div>
      <div className="max-h-[400px] overflow-auto font-mono text-xs">
        {diff.map((row, i) => (
          <div
            key={i}
            className={cn(
              "flex",
              row.type === "added" && "bg-emerald-500/10",
              row.type === "removed" && "bg-rose-500/10"
            )}
          >
            <span className="w-8 text-right pr-2 text-zinc-600 select-none flex-shrink-0">
              {row.type === "added" ? row.lineB : row.type === "removed" ? row.lineA : row.lineB}
            </span>
            <span
              className={cn(
                "flex-1 px-2 whitespace-pre-wrap break-all",
                row.type === "added" && "text-emerald-400",
                row.type === "removed" && "text-rose-400",
                row.type === "same" && "text-zinc-400"
              )}
            >
              {row.type === "added" ? "+ " : row.type === "removed" ? "- " : "  "}
              {row.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Version History Panel (P2-5) ───────────────────────────────────

interface VersionEntry {
  id: string;
  version: number;
  hash: string;
  sizeBytes: number;
  conversationId: string | null;
  taskId: string | null;
  agentName: string | null;
  artifactId: string | null;
  createdAt: string;
}

function VersionHistoryPanel({
  projectId,
  filePath,
  onBack,
}: {
  projectId: string;
  filePath: string;
  onBack: () => void;
}) {
  const { locale } = useMimo();
  const [history, setHistory] = useState<{ versions: VersionEntry[]; currentVersion: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVersions, setSelectedVersions] = useState<[number | null, number | null]>([null, null]);
  const [diffData, setDiffData] = useState<{ diff: DiffRow[]; versionA: number; versionB: number; added: number; removed: number } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await safeFetch<{
        versions: VersionEntry[];
        currentVersion: number;
      }>(`/api/workspace/history?projectId=${projectId}&path=${encodeURIComponent(filePath)}`);
      setHistory(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [projectId, filePath]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const loadDiff = async (vA: number, vB: number) => {
    setDiffLoading(true);
    try {
      const data = await safeFetch<{
        diff: DiffRow[];
        versionA: number;
        versionB: number;
        added: number;
        removed: number;
      }>(`/api/workspace/diff?projectId=${projectId}&path=${encodeURIComponent(filePath)}&versionA=${vA}&versionB=${vB}`);
      setDiffData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load diff");
    } finally {
      setDiffLoading(false);
    }
  };

  const revert = async (version: number) => {
    if (!confirm(`Revert to version ${version}? This creates a new version with the old content.`)) return;
    try {
      await safeFetch(`/api/workspace/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, path: filePath, version }),
      });
      await loadHistory();
      setDiffData(null);
      setSelectedVersions([null, null]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revert");
    }
  };

  const toggleVersionSelect = (version: number) => {
    setSelectedVersions((prev) => {
      const [a, b] = prev;
      if (a === null) return [version, null];
      if (b === null && version !== a) {
        const [vA, vB] = a < version ? [a, version] : [version, a];
        loadDiff(vA, vB);
        return [vA, vB];
      }
      return [version, null];
    });
  };

  return (
    <div className="flex flex-col h-full p-2 gap-2">
      <div className="flex items-center justify-between">
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onBack}>
          <ChevronRight className="w-3.5 h-3.5 rotate-180 mr-1" />
          {t("files.edit", locale)}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={loadHistory} disabled={loading}>
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
        </Button>
      </div>

      <div className="text-xs text-muted-foreground px-1">
        {filePath}
      </div>

      {error && (
        <div className="px-2 py-1.5 bg-rose-500/10 border border-rose-500/30 rounded text-[11px] text-rose-500">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">...</div>
      ) : history && history.versions.length > 0 ? (
        <div className="flex-1 overflow-y-auto space-y-1">
          <div className="text-[10px] text-muted-foreground px-1 mb-1">
            {history.versions.length} versions · current: v{history.currentVersion}
          </div>
          {history.versions.map((v) => (
            <div
              key={v.id}
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 rounded border text-xs cursor-pointer hover:bg-muted/50",
                (selectedVersions[0] === v.version || selectedVersions[1] === v.version) &&
                  "border-violet-500 bg-violet-500/10",
                v.version === history.currentVersion && "border-emerald-500/50"
              )}
              onClick={() => toggleVersionSelect(v.version)}
            >
              <span className="font-mono font-semibold w-8">v{v.version}</span>
              <span className="text-muted-foreground flex-1">
                {(v.sizeBytes / 1024).toFixed(1)}KB · {v.agentName ?? "system"}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {new Date(v.createdAt).toLocaleString()}
              </span>
              {v.version !== history.currentVersion && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    revert(v.version);
                  }}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 hover:bg-amber-500/30"
                  title="Revert to this version"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
          No versions yet
        </div>
      )}

      {diffLoading && (
        <div className="text-xs text-muted-foreground text-center py-2">Loading diff...</div>
      )}

      {diffData && (
        <div className="flex-shrink-0 max-h-[300px] overflow-hidden">
          <DiffViewer
            diff={diffData.diff}
            versionA={diffData.versionA}
            versionB={diffData.versionB}
            added={diffData.added}
            removed={diffData.removed}
          />
        </div>
      )}
    </div>
  );
}

// ─── Code Editor (P2-4) ─────────────────────────────────────────────

function CodeEditor({
  projectId,
  file,
  onClose,
  onSaved,
}: {
  projectId: string;
  file: TreeNode;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { locale } = useMimo();
  const [content, setContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await safeFetch<{ content: string; path: string; size: number }>(
        `/api/workspace/file?projectId=${projectId}&path=${encodeURIComponent(file.path)}`
      );
      setContent(data.content);
      setOriginalContent(data.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load file");
    } finally {
      setLoading(false);
    }
  }, [projectId, file.path]);

  useEffect(() => {
    loadFile();
  }, [loadFile]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await safeFetch(
        `/api/workspace/file?projectId=${projectId}&path=${encodeURIComponent(file.path)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        }
      );
      setOriginalContent(content);
      setEditing(false);
      onSaved?.(); // Refresh file tree after save
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save file");
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setContent(originalContent);
    setEditing(false);
  };

  const isDirty = content !== originalContent;
  const fileName = file.path.split("/").pop() ?? file.path;
  const language = getLanguage(fileName);
  const canPreview = ["html", "htm", "svg"].includes(fileName.split(".").pop()?.toLowerCase() ?? "");

  return (
    <Card className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          {(() => {
            const Icon = getFileIcon(fileName);
            return <Icon className="w-4 h-4 text-violet-500 flex-shrink-0" />;
          })()}
          <span className="text-sm font-mono truncate">{file.path}</span>
          {isDirty && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 flex-shrink-0">
              {t("files.modified", locale)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {!editing ? (
            <>
              {canPreview && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => window.open(`/api/workspace/file?projectId=${projectId}&path=${encodeURIComponent(file.path)}`, "_blank")}
                  title="Preview"
                >
                  <Eye className="w-3.5 h-3.5" />
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setEditing(true)}
              >
                <Code2 className="w-3.5 h-3.5 mr-1" />
                {t("files.edit", locale)}
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                onClick={save}
                disabled={saving || !isDirty}
              >
                <Save className="w-3.5 h-3.5 mr-1" />
                {saving ? "..." : t("files.save", locale)}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={cancel}
              >
                <X className="w-3.5 h-3.5 mr-1" />
                {t("files.cancel", locale)}
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={onClose}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-2 bg-rose-500/10 border-b border-rose-500/30 text-xs text-rose-500">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
          ...
        </div>
      ) : editing ? (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="flex-1 w-full p-3 font-mono text-xs bg-background border-0 outline-none resize-none"
          spellCheck={false}
        />
      ) : (
        <div className="flex-1 overflow-auto">
          <SyntaxHighlighter
            language={language}
            style={oneDark}
            customStyle={{
              margin: 0,
              padding: "12px",
              fontSize: "12px",
              background: "transparent",
            }}
            wrapLongLines
          >
            {content}
          </SyntaxHighlighter>
        </div>
      )}
    </Card>
  );
}

// ─── File Tree Panel (P2-2) ─────────────────────────────────────────

export function FilesPanel() {
  const { projects, currentProjectId, setCurrentProjectId, locale } = useMimo();
  const [tree, setTree] = useState<FileTreeGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<TreeNode | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTree = useCallback(async () => {
    if (!currentProjectId) {
      setTree([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await safeFetch<{ tree: TreeNode[]; count: number }>(
        `/api/workspace/tree?projectId=${currentProjectId}`
      );
      setTree(buildTree(data.tree ?? []));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load file tree");
      setTree([]);
    } finally {
      setLoading(false);
    }
  }, [currentProjectId]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  // Refresh when switching projects
  useEffect(() => {
    setSelectedFile(null);
  }, [currentProjectId]);

  const togglePath = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // If a file is selected, show the editor full-width
  if (selectedFile && currentProjectId) {
    if (showHistory) {
      return (
        <div className="flex flex-col h-full p-2 gap-2">
          <div className="flex items-center justify-between">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setShowHistory(false)}
            >
              <ChevronRight className="w-3.5 h-3.5 rotate-180 mr-1" />
              {t("files.edit", locale)}
            </Button>
          </div>
          <div className="flex-1 min-h-0">
            <VersionHistoryPanel
              projectId={currentProjectId}
              filePath={selectedFile.path}
              onBack={() => setShowHistory(false)}
            />
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col h-full p-2 gap-2">
        <div className="flex items-center justify-between">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setSelectedFile(null)}
          >
            <ChevronRight className="w-3.5 h-3.5 rotate-180 mr-1" />
            {t("panel.files", locale)}
          </Button>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setShowHistory(true)}
              title="Version History"
            >
              <History className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={loadTree}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <CodeEditor
            projectId={currentProjectId}
            file={selectedFile}
            onSaved={loadTree}
            onClose={() => {
              setSelectedFile(null);
              setShowHistory(false);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-2 space-y-2 h-full flex flex-col">
      {/* Project selector */}
      {projects.length > 0 && (
        <select
          value={currentProjectId ?? ""}
          onChange={(e) => setCurrentProjectId(e.target.value || null)}
          className="w-full h-8 text-xs rounded-md border bg-background px-2"
        >
          <option value="">{t("files.noProject", locale)}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}

      {/* Refresh button */}
      {currentProjectId && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {tree.reduce((acc, n) => acc + (n.children?.length ?? 0) + 1, 0)} items
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[10px]"
            onClick={loadTree}
            disabled={loading}
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            {t("files.refresh", locale)}
          </Button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-2 py-1.5 bg-rose-500/10 border border-rose-500/30 rounded text-[11px] text-rose-500">
          {error}
        </div>
      )}

      {/* Tree or empty state */}
      {!currentProjectId ? (
        <div className="flex-1 flex items-center justify-center text-center text-xs text-muted-foreground p-4">
          <div>
            <Folder className="w-8 h-8 mx-auto mb-2 opacity-40" />
            {t("files.noProject", locale)}
          </div>
        </div>
      ) : tree.length === 0 && !loading ? (
        <div className="flex-1 flex items-center justify-center text-center text-xs text-muted-foreground p-4">
          <div>
            <FileIcon className="w-8 h-8 mx-auto mb-2 opacity-40" />
            {t("files.empty", locale)}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {tree.map((node) => (
            <TreeItem
              key={node.path}
              node={node}
              depth={0}
              expandedPaths={expandedPaths}
              togglePath={togglePath}
              selectedPath={selectedFile?.path ?? null}
              onSelectFile={setSelectedFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}
