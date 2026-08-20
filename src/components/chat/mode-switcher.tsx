"use client"

import * as React from "react"
import { Bot, ListChecks, HelpCircle, Bug, Eye, Search, Building2, RefreshCw, Shield, Gauge, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useChatStore } from "@/store/chat-store"
import { cn } from "@/lib/utils"
import { MODE_CONFIG, type AgentMode } from "@/lib/agent/modes"

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Bot, ListChecks, HelpCircle, Bug, Eye, Search, Building2, RefreshCw, Shield, Gauge,
}

export function ModeSwitcher() {
  const agentMode = useChatStore((s) => s.agentMode)
  const setAgentMode = useChatStore((s) => s.setAgentMode)

  const config = MODE_CONFIG[agentMode as AgentMode] || MODE_CONFIG.agent
  const Icon = ICONS[config.icon] || Bot

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 rounded-lg text-xs">
          <Icon className={cn("h-3.5 w-3.5", config.color)} />
          <span className="hidden sm:inline">{config.label}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-64">
        <DropdownMenuItem disabled className="text-xs font-medium text-muted-foreground">
          وضع الوكيل
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {Object.entries(MODE_CONFIG).map(([mode, cfg]) => {
          const ModeIcon = ICONS[cfg.icon] || Bot
          return (
            <DropdownMenuItem
              key={mode}
              onClick={() => setAgentMode(mode)}
              className={cn("flex items-start gap-2 py-2", agentMode === mode && "bg-accent")}
            >
              <ModeIcon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", cfg.color)} />
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-medium">{cfg.label}</span>
                <span className="text-[0.65rem] text-muted-foreground line-clamp-1">{cfg.description}</span>
              </div>
              {agentMode === mode && <ModeIcon className="h-3 w-3 text-primary ml-auto" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
