"use client";

import { useMimo } from "@/lib/mimo-store";
import { Badge } from "@/components/ui/badge";
import { Activity, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";

const PHASE_COLORS: Record<string, string> = {
  plan: "text-amber-500",
  execute: "text-blue-500",
  observe: "text-cyan-500",
  validate: "text-violet-500",
  repair: "text-rose-500",
  retest: "text-orange-500",
  review: "text-teal-500",
  complete: "text-emerald-500",
};

const PHASE_BAR_COLORS: Record<string, string> = {
  plan: "#f59e0b",
  execute: "#3b82f6",
  observe: "#06b6d4",
  validate: "#8b5cf6",
  repair: "#f43f5e",
  retest: "#f97316",
  review: "#14b8a6",
  complete: "#10b981",
};

const LEVEL_COLORS: Record<string, string> = {
  debug: "text-muted-foreground",
  info: "text-foreground",
  warn: "text-amber-500",
  error: "text-rose-500",
  critical: "text-red-600",
};

export function TimelinePanel() {
  const { executions, locale } = useMimo();
  const [view, setView] = useState<"list" | "chart">("list");

  if (executions.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
        {t("timeline.empty", locale)}
      </div>
    );
  }

  // P5-5: Prepare chart data — group by phase, sum durations
  const phaseData = Object.entries(
    executions.reduce((acc, log) => {
      if (log.durationMs > 0) {
        acc[log.phase] = (acc[log.phase] ?? 0) + log.durationMs;
      }
      return acc;
    }, {} as Record<string, number>)
  )
    .map(([phase, duration]) => ({
      phase,
      duration: Math.round(duration / 1000 * 100) / 100, // seconds with 2 decimals
      color: PHASE_BAR_COLORS[phase] ?? "#6366f1",
    }))
    .sort((a, b) => b.duration - a.duration);

  return (
    <div className="p-2 space-y-2">
      {/* View toggle */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setView("list")}
          className={cn(
            "px-2 py-1 text-[10px] rounded font-medium transition-colors",
            view === "list" ? "bg-violet-500 text-white" : "text-muted-foreground hover:bg-muted/50"
          )}
        >
          <Activity className="w-3 h-3 inline mr-1" />
          List
        </button>
        <button
          onClick={() => setView("chart")}
          className={cn(
            "px-2 py-1 text-[10px] rounded font-medium transition-colors",
            view === "chart" ? "bg-violet-500 text-white" : "text-muted-foreground hover:bg-muted/50"
          )}
        >
          <BarChart3 className="w-3 h-3 inline mr-1" />
          Chart
        </button>
      </div>

      {/* Chart view (P5-5) */}
      {view === "chart" && phaseData.length > 0 && (
        <div className="h-[250px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={phaseData} layout="vertical" margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: "#888" }} unit="s" />
              <YAxis type="category" dataKey="phase" tick={{ fontSize: 10, fill: "#888" }} width={60} />
              <Tooltip
                contentStyle={{
                  background: "#1a1a1a",
                  border: "1px solid #333",
                  borderRadius: "4px",
                  fontSize: "11px",
                }}
                formatter={(value) => [`${value}s`, "Duration"]}
              />
              <Bar dataKey="duration" radius={[0, 3, 3, 0]}>
                {phaseData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* List view (original) */}
      {(view === "list" || phaseData.length === 0) && (
        <div className="space-y-1 max-h-[500px] overflow-y-auto">
          {executions.map((log) => (
            <div key={log.id} className="flex gap-2 text-xs">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    log.status === "failure" ? "bg-rose-500" : "bg-emerald-500"
                  )}
                />
                <div className="w-px flex-1 bg-border" />
              </div>
              <div className="flex-1 pb-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant="outline" className="text-[9px] py-0">
                    {log.phase}
                  </Badge>
                  {log.agentName && (
                    <Badge variant="outline" className="text-[9px] py-0">
                      {log.agentName}
                    </Badge>
                  )}
                  {log.toolName && (
                    <Badge variant="outline" className="text-[9px] py-0">
                      {log.toolName}
                    </Badge>
                  )}
                  <span
                    className={cn(
                      "text-[10px]",
                      LEVEL_COLORS[log.level] ?? "text-foreground"
                    )}
                  >
                    {log.level}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    · {new Date(log.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                <p className={cn("mt-0.5", PHASE_COLORS[log.phase] ?? "text-foreground")}>
                  {log.message}
                </p>
                {log.durationMs > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    {(log.durationMs / 1000).toFixed(2)}s
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
