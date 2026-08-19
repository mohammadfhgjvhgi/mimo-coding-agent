"use client";

import { useEffect } from "react";
import { useMimo } from "@/lib/mimo-store";
import { Sidebar } from "./sidebar";
import { ChatPanel } from "./chat-panel";
import { TasksPanel } from "./tasks-panel";
import { AgentsPanel } from "./agents-panel";
import { ArtifactsPanel } from "./artifacts-panel";
import { MemoryPanel } from "./memory-panel";
import { DecisionsPanel } from "./decisions-panel";
import { TimelinePanel } from "./timeline-panel";
import { SkillsPanel } from "./skills-panel";
import { ToolsPanel } from "./tools-panel";
import { ProjectsPanel } from "./projects-panel";
import { FilesPanel } from "./files-panel";
import { TerminalPanel } from "./terminal-panel";
import { KnowledgePanel } from "./knowledge-panel";
import { PreviewPanel } from "./preview-panel";
import { CommandPalette } from "./command-palette";
import { SettingsDialog } from "./settings-dialog";
import { cn } from "@/lib/utils";
import { t, getDirection } from "@/lib/i18n";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  MessageSquare,
  ListChecks,
  Network,
  FileText,
  FolderTree,
  TerminalSquare,
  Database,
  Brain,
  Gavel,
  Activity,
  Sparkles,
  Wrench,
  FolderKanban,
  Eye,
  Settings,
  Command as CommandIcon,
  Sun,
  Moon,
  X,
  ChevronDown,
} from "lucide-react";

const PANELS = [
  { id: "chat" as const, key: "panel.chat", icon: MessageSquare },
  { id: "preview" as const, key: "panel.preview", icon: Eye },
  { id: "tasks" as const, key: "panel.tasks", icon: ListChecks },
  { id: "files" as const, key: "panel.files", icon: FolderTree },
  { id: "terminal" as const, key: "panel.terminal", icon: TerminalSquare },
  { id: "agents" as const, key: "panel.agents", icon: Network },
  { id: "artifacts" as const, key: "panel.artifacts", icon: FileText },
  { id: "knowledge" as const, key: "panel.knowledge", icon: Database },
  { id: "memory" as const, key: "panel.memory", icon: Brain },
  { id: "decisions" as const, key: "panel.decisions", icon: Gavel },
  { id: "timeline" as const, key: "panel.timeline", icon: Activity },
  { id: "skills" as const, key: "panel.skills", icon: Sparkles },
  { id: "tools" as const, key: "panel.tools", icon: Wrench },
  { id: "projects" as const, key: "panel.projects", icon: FolderKanban },
];

export function Workspace() {
  const {
    activePanel,
    setActivePanel,
    loadAgents,
    loadSkills,
    loadTools,
    loadProjects,
    loadConversations,
    loadSystemState,
    error,
    locale,
    setLocale,
    theme,
    setTheme,
    setCommandPaletteOpen,
    setSettingsOpen,
  } = useMimo();

  const dir = getDirection(locale);

  useEffect(() => {
    loadAgents();
    loadSkills();
    loadTools();
    loadProjects();
    loadConversations();
    loadSystemState();
  }, [loadAgents, loadSkills, loadTools, loadProjects, loadConversations, loadSystemState]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadSystemState();
    }, 30000);
    return () => clearInterval(interval);
  }, [loadSystemState]);

  useEffect(() => {
    const root = document.documentElement;
    const applyTheme = (mode: "dark" | "light") => {
      if (mode === "dark") root.classList.add("dark");
      else root.classList.remove("dark");
    };
    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      applyTheme(mediaQuery.matches ? "dark" : "light");
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches ? "dark" : "light");
      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    } else {
      applyTheme(theme);
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.dir = dir;
    document.documentElement.lang = locale;
  }, [dir, locale]);

  const renderPanel = () => {
    switch (activePanel) {
      case "chat": return <ChatPanel />;
      case "preview": return <PreviewPanel />;
      case "tasks": return <TasksPanel />;
      case "agents": return <AgentsPanel />;
      case "artifacts": return <ArtifactsPanel />;
      case "files": return <FilesPanel />;
      case "terminal": return <TerminalPanel />;
      case "knowledge": return <KnowledgePanel />;
      case "memory": return <MemoryPanel />;
      case "decisions": return <DecisionsPanel />;
      case "timeline": return <TimelinePanel />;
      case "skills": return <SkillsPanel />;
      case "tools": return <ToolsPanel />;
      case "projects": return <ProjectsPanel />;
      default: return <ChatPanel />;
    }
  };

  const showSidePanel = activePanel !== "chat" && activePanel !== "preview";

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden" dir={dir}>
      {/* Left: Conversation sidebar (ZCode style) */}
      <Sidebar />

      {/* Center+Right: Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Minimal top bar — ZCode style */}
        <header className="h-11 border-b border-border flex items-center justify-between px-3 flex-shrink-0">
          {/* Left: Panel switcher (dropdown style) */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActivePanel("chat")}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-smooth",
                activePanel === "chat"
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Chat
            </button>
            {showSidePanel && (
              <div className="flex items-center gap-1 ml-1">
                <span className="text-muted-foreground/30 text-xs">/</span>
                <button className="px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 text-foreground bg-secondary">
                  {(() => {
                    const p = PANELS.find((p) => p.id === activePanel);
                    return p ? <>{t(p.key, locale)}</> : null;
                  })()}
                  <ChevronDown className="w-3 h-3 opacity-50" />
                </button>
              </div>
            )}
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setCommandPaletteOpen(true)}
              className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-smooth"
              title="Command Palette (⌘K)"
            >
              <CommandIcon className="w-4 h-4" />
            </button>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-smooth"
              title={t("settings.theme", locale)}
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
              className="px-2 py-1.5 rounded-md text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground transition-smooth"
              title={t("settings.language", locale)}
            >
              {locale === "ar" ? "EN" : "ع"}
            </button>
            <div className="w-px h-5 bg-border mx-1" />
            <button
              onClick={() => setSettingsOpen(true)}
              className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-smooth"
              title={t("settings.title", locale)}
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Error banner */}
        {error && (
          <div className="bg-destructive/10 border-b border-destructive/30 px-4 py-2 text-xs text-destructive flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold flex-shrink-0">⚠</span>
              <span className="truncate">{error}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => {
                  useMimo.setState({ error: null });
                  loadSystemState();
                  loadConversations();
                }}
                className="text-destructive hover:text-destructive/80 font-semibold underline"
              >
                {t("common.retry", locale)}
              </button>
              <button
                onClick={() => useMimo.setState({ error: null })}
                className="text-destructive/70 hover:text-destructive"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {/* Content: Chat + optional side panel */}
        <div className="flex-1 flex min-h-0">
          {showSidePanel ? (
            <PanelGroup direction="horizontal" autoSaveId="mimo-layout-v3">
              <Panel defaultSize={55} minSize={30}>
                <div className="h-full min-w-0">
                  <ChatPanel />
                </div>
              </Panel>
              <PanelResizeHandle className="w-px bg-border hover:bg-muted-foreground/30 transition-colors cursor-col-resize" />
              <Panel defaultSize={45} minSize={25} maxSize={70}>
                <aside className="h-full flex flex-col min-w-0">
                  {/* Panel header with close */}
                  <div className="h-10 border-b border-border flex items-center justify-between px-3 flex-shrink-0">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t(`panel.${activePanel}`, locale)}
                    </span>
                    <button
                      onClick={() => setActivePanel("chat")}
                      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-smooth"
                      title="Close"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto scrollbar-thin">
                    {renderPanel()}
                  </div>
                </aside>
              </Panel>
            </PanelGroup>
          ) : (
            <div className="flex-1 min-w-0">
              {renderPanel()}
            </div>
          )}
        </div>
      </div>

      <CommandPalette />
      <SettingsDialog />
    </div>
  );
}
