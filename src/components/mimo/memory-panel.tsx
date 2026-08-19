"use client";

import { useMimo } from "@/lib/mimo-store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

const TYPE_COLORS: Record<string, string> = {
  working: "bg-blue-500",
  short_term: "bg-cyan-500",
  long_term: "bg-violet-500",
  episodic: "bg-amber-500",
  semantic: "bg-emerald-500",
  procedural: "bg-rose-500",
  preference: "bg-fuchsia-500",
  failure: "bg-red-600",
  skill: "bg-indigo-500",
};

export function MemoryPanel() {
  const { memories, locale } = useMimo();

  if (memories.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        <Brain className="w-8 h-8 mx-auto mb-2 opacity-50" />
        {t("memory.empty", locale)}
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2">
      <div className="text-xs text-muted-foreground mb-1">
        {memories.length} memories across {new Set(memories.map((m) => m.type)).size} types
      </div>
      {memories.map((mem) => (
        <Card key={mem.id} className="p-2.5">
          <div className="flex items-start gap-2">
            <div
              className={cn(
                "w-2 h-2 rounded-full mt-1.5 flex-shrink-0",
                TYPE_COLORS[mem.type] ?? "bg-muted"
              )}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                <Badge variant="outline" className="text-[9px] py-0">
                  {mem.type}
                </Badge>
                <Badge variant="outline" className="text-[9px] py-0">
                  {mem.scope}
                </Badge>
                <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                  <Star className="w-2.5 h-2.5" />
                  {mem.importance.toFixed(2)}
                </div>
                <span className="text-[10px] text-muted-foreground">
                  · {mem.source}
                </span>
              </div>
              <p className="text-xs leading-relaxed line-clamp-3">{mem.content}</p>
              {mem.tags && (
                <div className="text-[10px] text-muted-foreground mt-1">
                  {mem.tags}
                </div>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
