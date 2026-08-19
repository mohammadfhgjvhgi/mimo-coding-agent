"use client";

import { useState, useRef, useEffect } from "react";
import { useMimo } from "@/lib/mimo-store";
import { safeFetch } from "@/lib/safe-fetch";
import { Button } from "@/components/ui/button";
import { Terminal as TerminalIcon, Play, Hammer, FlaskConical, Search, Type, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

interface OutputEntry {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  success: boolean;
  timestamp: string;
  passed?: number;
  failed?: number;
  total?: number;
  errorCount?: number;
  warningCount?: number;
}

export function TerminalPanel() {
  const { currentProjectId, locale } = useMimo();
  const [outputs, setOutputs] = useState<OutputEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [activeCommand, setActiveCommand] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [outputs]);

  const executeCommand = async (command: "build" | "test" | "lint" | "typecheck") => {
    if (!currentProjectId || running) return;
    setRunning(true);
    setActiveCommand(command);

    try {
      const endpoint =
        command === "build" ? "/api/build" :
        command === "test" ? "/api/test" :
        command === "lint" ? "/api/lint" :
        "/api/lint";

      const body =
        command === "typecheck"
          ? { projectId: currentProjectId, action: "typecheck" }
          : { projectId: currentProjectId };

      const result = await safeFetch<OutputEntry>(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      setOutputs((prev) => [...prev, { ...result, command, timestamp: new Date().toISOString() }]);
    } catch (err) {
      setOutputs((prev) => [
        ...prev,
        {
          command,
          stdout: "",
          stderr: err instanceof Error ? err.message : "Failed to execute",
          exitCode: null,
          durationMs: 0,
          success: false,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setRunning(false);
      setActiveCommand(null);
    }
  };

  if (!currentProjectId) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        <TerminalIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
        {t("terminal.noProject", locale)}
      </div>
    );
  }

  return (
    <div className="p-2 space-y-2 h-full flex flex-col">
      {/* Command buttons */}
      <div className="flex items-center gap-1 flex-wrap">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => executeCommand("build")}
          disabled={running}
        >
          <Hammer className="w-3 h-3 mr-1" />
          {t("terminal.build", locale)}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => executeCommand("test")}
          disabled={running}
        >
          <FlaskConical className="w-3 h-3 mr-1" />
          {t("terminal.test", locale)}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => executeCommand("lint")}
          disabled={running}
        >
          <Search className="w-3 h-3 mr-1" />
          {t("terminal.lint", locale)}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => executeCommand("typecheck")}
          disabled={running}
        >
          <Type className="w-3 h-3 mr-1" />
          {t("terminal.typecheck", locale)}
        </Button>
        {outputs.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs ml-auto"
            onClick={() => setOutputs([])}
            disabled={running}
            title={locale === "ar" ? "مسح" : "Clear"}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        )}
      </div>

      {/* Output area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto bg-zinc-950 rounded-lg border border-zinc-800 p-3 font-mono text-xs"
      >
        {outputs.length === 0 ? (
          <div className="text-zinc-600 text-center py-4">
            {t("terminal.empty", locale)}
          </div>
        ) : (
          outputs.map((entry, i) => (
            <div key={i} className="mb-4">
              {/* Command header */}
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Play className="w-3 h-3 text-violet-400" />
                  <span className="text-violet-400 font-semibold">
                    {entry.command}
                  </span>
                  <span
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded font-semibold",
                      entry.success
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-rose-500/20 text-rose-400"
                    )}
                  >
                    {entry.success ? "✓ PASS" : "✗ FAIL"}
                  </span>
                </div>
                <span className="text-zinc-600 text-[10px]">
                  {t("terminal.duration", locale)}: {(entry.durationMs / 1000).toFixed(1)}s
                  {entry.exitCode !== null && ` · ${t("terminal.exit", locale)} ${entry.exitCode}`}
                </span>
              </div>

              {/* Test counts if available */}
              {entry.passed !== undefined && (
                <div className="text-[10px] text-zinc-500 mb-1">
                  <span className="text-emerald-400">{entry.passed} pass</span>
                  {entry.failed !== undefined && entry.failed > 0 && (
                    <span className="text-rose-400"> · {entry.failed} fail</span>
                  )}
                  <span className="text-zinc-600"> · {entry.total} total</span>
                </div>
              )}

              {/* Lint counts if available */}
              {entry.errorCount !== undefined && (
                <div className="text-[10px] text-zinc-500 mb-1">
                  <span className={entry.errorCount > 0 ? "text-rose-400" : "text-emerald-400"}>
                    {entry.errorCount} errors
                  </span>
                  <span className={entry.warningCount && entry.warningCount > 0 ? "text-amber-400" : "text-zinc-500"}>
                    {" · "}{entry.warningCount} warnings
                  </span>
                </div>
              )}

              {/* stdout */}
              {entry.stdout && (
                <pre className="text-zinc-300 whitespace-pre-wrap break-all mb-1">
                  {entry.stdout.slice(0, 5000)}
                </pre>
              )}

              {/* stderr */}
              {entry.stderr && (
                <pre className="text-rose-400 whitespace-pre-wrap break-all">
                  {entry.stderr.slice(0, 5000)}
                </pre>
              )}
            </div>
          ))
        )}
        {running && (
          <div className="text-amber-400 animate-pulse">
            ▸ {t("terminal.running", locale)} ({activeCommand})
          </div>
        )}
      </div>
    </div>
  );
}
