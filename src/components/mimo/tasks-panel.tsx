"use client";

import { useMimo } from "@/lib/mimo-store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Circle, Loader2, AlertCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  pending: { icon: Circle, color: "text-muted-foreground", label: "Pending" },
  planning: { icon: Loader2, color: "text-amber-500", label: "Planning" },
  in_progress: { icon: Loader2, color: "text-blue-500", label: "In Progress" },
  blocked: { icon: AlertCircle, color: "text-rose-500", label: "Blocked" },
  validating: { icon: Loader2, color: "text-violet-500", label: "Validating" },
  completed: { icon: CheckCircle2, color: "text-emerald-500", label: "Completed" },
  failed: { icon: AlertCircle, color: "text-rose-500", label: "Failed" },
};

export function TasksPanel() {
  const { tasks, agents, locale } = useMimo();

  if (tasks.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
        {t("tasks.empty", locale)}
      </div>
    );
  }

  const completed = tasks.filter((t) => t.status === "completed").length;
  const progress = (completed / tasks.length) * 100;

  return (
    <div className="p-3 space-y-3">
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold">Mission Progress</span>
          <span className="text-muted-foreground">
            {completed}/{tasks.length}
          </span>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>

      {tasks.map((task) => {
        const status = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.pending;
        const StatusIcon = status.icon;
        const agent = task.assignedAgent ? agents.find((a) => a.name === task.assignedAgent) : null;

        return (
          <Card key={task.id} className="p-3 space-y-1.5">
            <div className="flex items-start gap-2">
              <StatusIcon
                className={cn(
                  "w-4 h-4 mt-0.5 flex-shrink-0",
                  status.color,
                  (task.status === "planning" ||
                    task.status === "in_progress" ||
                    task.status === "validating") &&
                    "animate-spin"
                )}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium leading-tight">{task.title}</div>
                {task.objective && task.objective !== task.title && (
                  <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {task.objective}
                  </div>
                )}
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  {agent && (
                    <Badge variant="secondary" className="text-[10px] py-0 gap-1">
                      <span className={cn("w-1.5 h-1.5 rounded-full", agent.color)} />
                      {agent.title}
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[10px] py-0">
                    P{task.priority}
                  </Badge>
                  {task.retryCount > 0 && (
                    <Badge variant="outline" className="text-[10px] py-0 text-amber-500">
                      retry {task.retryCount}/{task.maxRetries}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
