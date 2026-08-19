"use client";

import { useMimo } from "@/lib/mimo-store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getAgentIcon } from "./agent-icons";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

export function AgentsPanel() {
  const { agents, activeAgents, locale } = useMimo();

  return (
    <div className="p-3 space-y-2">
      <div className="text-xs text-muted-foreground mb-1">
        {t("agents.subtitle", locale)}
      </div>
      {agents.map((agent) => {
        const Icon = getAgentIcon(agent.icon);
        const isActive = activeAgents.some((a) => a.name === agent.name);
        const activePhase = activeAgents.find((a) => a.name === agent.name)?.phase;

        return (
          <Card
            key={agent.name}
            className={cn(
              "p-2.5 transition-all",
              isActive && "ring-2 ring-violet-500/50 bg-violet-500/5"
            )}
          >
            <div className="flex items-start gap-2">
              <div
                className={cn(
                  "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0",
                  agent.color
                )}
              >
                <Icon className="w-3.5 h-3.5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold">{agent.title}</span>
                  {isActive && (
                    <Badge
                      variant="default"
                      className="text-[9px] py-0 px-1.5 bg-violet-500 animate-pulse"
                    >
                      {activePhase ?? "active"}
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                  {agent.description}
                </p>
                <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                  {agent.capabilities.slice(0, 3).map((cap) => (
                    <Badge key={cap} variant="outline" className="text-[9px] py-0 px-1.5">
                      {cap}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
