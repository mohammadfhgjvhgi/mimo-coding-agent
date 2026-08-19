"use client";

import { useState, useEffect } from "react";
import { useMimo } from "@/lib/mimo-store";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import {
  MessageSquare,
  ListChecks,
  Network,
  FileText,
  Brain,
  Gavel,
  Activity,
  Sparkles,
  Settings,
  Zap,
  Plus,
} from "lucide-react";

const COMMANDS = [
  { id: "new", label: "New Conversation", icon: Plus, panel: "chat" as const },
  { id: "chat", label: "Go to Chat", icon: MessageSquare, panel: "chat" as const },
  { id: "tasks", label: "Go to Tasks", icon: ListChecks, panel: "tasks" as const },
  { id: "agents", label: "Go to Agents", icon: Network, panel: "agents" as const },
  { id: "artifacts", label: "Go to Artifacts", icon: FileText, panel: "artifacts" as const },
  { id: "memory", label: "Go to Memory", icon: Brain, panel: "memory" as const },
  { id: "decisions", label: "Go to Decisions", icon: Gavel, panel: "decisions" as const },
  { id: "timeline", label: "Go to Timeline", icon: Activity, panel: "timeline" as const },
  { id: "skills", label: "Go to Skills", icon: Sparkles, panel: "skills" as const },
  { id: "settings", label: "Open Settings", icon: Settings, panel: null },
  { id: "autonomous", label: "Toggle Autonomous Mode", icon: Zap, panel: null },
];

export function CommandPalette() {
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    setActivePanel,
    setSettingsOpen,
    autonomousMode,
    setAutonomousMode,
    newConversation,
  } = useMimo();

  const [search, setSearch] = useState("");

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      }
      if (e.key === "Escape" && commandPaletteOpen) {
        setCommandPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

  const runCommand = (cmd: (typeof COMMANDS)[0]) => {
    setCommandPaletteOpen(false);
    setSearch("");
    if (cmd.id === "new") {
      newConversation();
      setActivePanel("chat");
    } else if (cmd.id === "settings") {
      setSettingsOpen(true);
    } else if (cmd.id === "autonomous") {
      setAutonomousMode(!autonomousMode);
    } else if (cmd.panel) {
      setActivePanel(cmd.panel);
    }
  };

  return (
    <Dialog open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen}>
      <DialogContent className="p-0 overflow-hidden max-w-xl">
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Type a command or search..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-[400px]">
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup heading="Actions">
              {COMMANDS.filter((cmd) =>
                cmd.label.toLowerCase().includes(search.toLowerCase())
              ).map((cmd) => {
                const Icon = cmd.icon;
                return (
                  <CommandItem
                    key={cmd.id}
                    value={cmd.id}
                    onSelect={() => runCommand(cmd)}
                    className="cursor-pointer"
                  >
                    <Icon className="w-4 h-4 mr-2 text-muted-foreground" />
                    <span className="text-sm">{cmd.label}</span>
                    {cmd.id === "autonomous" && autonomousMode && (
                      <span className="ml-auto text-[10px] text-amber-500 font-semibold">
                        ON
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
