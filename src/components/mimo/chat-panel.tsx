"use client";

import { useState, useRef, useEffect } from "react";
import { useMimo } from "@/lib/mimo-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Send,
  Loader2,
  Zap,
  Bot,
  User,
  Sparkles,
  Square,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Layout,
  LayoutDashboard,
  Server,
  Bug,
  Search,
  ClipboardList,
  Recycle,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { getAgentIcon } from "./agent-icons";
import { Markdown } from "./markdown";
import { InlinePreview } from "./inline-preview";
import { ToolCallCard } from "./tool-call-card";
import { ArtifactCard } from "./artifact-card";
import { useMentionAutocomplete, MentionPopover } from "./mention-autocomplete";
import { artifactParser, type Artifact } from "@/lib/ai/artifact-parser";
import { cn } from "@/lib/utils";
import { t, getDirection } from "@/lib/i18n";
import {
  PROMPT_TEMPLATES,
  TEMPLATE_CATEGORIES,
  CAPABILITIES,
  type PromptTemplate,
} from "@/lib/templates";

// Icon resolver for template categories
const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  Layout,
  LayoutDashboard,
  Server,
  Bug,
  Search,
  ClipboardList,
  Recycle,
  ShieldCheck,
};

export function ChatPanel() {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const {
    messages,
    isStreaming,
    streamingContent,
    activeTools,
    activeAgents,
    pendingPreview,
    autonomousMode,
    selectedAgent,
    agents,
    currentConversation,
    currentProjectId,
    locale,
    startStreaming,
    handleStreamEvent,
    endStreaming,
    setError,
    setAutonomousMode,
    setSelectedAgent,
    resetStreaming,
    setActivePanel,
  } = useMimo();

  // @-mention file autocomplete hook
  const mention = useMentionAutocomplete(textareaRef, input, setInput);

  const dir = getDirection(locale);

  // Auto-scroll to bottom on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent, activeTools]);

  const stop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    // Save what we have so far as a message
    const current = useMimo.getState().streamingContent;
    if (current.trim()) {
      endStreaming(current);
    } else {
      resetStreaming();
    }
  };

  const send = async () => {
    if (!input.trim() || isStreaming) return;
    const userMessage = input.trim();
    const filesToAttach = [...mention.attachedFiles];
    setInput("");
    mention.clearAttached();
    await sendWithMessage(userMessage, autonomousMode, filesToAttach);
  };

  // Core send logic — accepts an explicit message (used by template cards + composer)
  const sendWithMessage = async (
    message: string,
    useAutonomous: boolean,
    filesToAttach?: Array<{ path: string; content: string; size: number }>
  ) => {
    if (!message.trim() || isStreaming) return;

    // Prepend attached file contents to the message for context
    let msg = message.trim();
    const currentAttached = filesToAttach ?? [];
    if (currentAttached.length > 0) {
      const fileContext = currentAttached
        .map(
          (f) =>
            `<file path="${f.path}">\n\`\`\`\n${f.content.slice(0, 8000)}\n\`\`\`\n</file>`
        )
        .join("\n\n");
      msg = `${fileContext}\n\n${msg}`;
    }

    // Add user message immediately to UI
    const userMsg = {
      id: `user-${Date.now()}`,
      conversationId: currentConversation?.id ?? "",
      role: "user" as const,
      content: msg,
      agentName: null,
      toolName: null,
      tokenInput: 0,
      tokenOutput: 0,
      durationMs: 0,
      createdAt: new Date().toISOString(),
    };

    useMimo.setState((s) => ({ messages: [...s.messages, userMsg] }));

    startStreaming();
    // Reset artifact parser for new streaming message
    artifactParser.reset("streaming");

    try {
      abortRef.current = new AbortController();
      // P-fix: Read temperature/maxTokens from localStorage (set by Settings dialog)
      const temperature = typeof window !== "undefined"
        ? Number(localStorage.getItem("mimo.temperature")) || undefined
        : undefined;
      const maxTokens = typeof window !== "undefined"
        ? Number(localStorage.getItem("mimo.maxTokens")) || undefined
        : undefined;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: currentConversation?.id,
          message: msg,
          agentName: selectedAgent,
          autonomous: useAutonomous,
          ...(temperature !== undefined ? { temperature } : {}),
          ...(maxTokens !== undefined ? { maxTokens } : {}),
        }),
        signal: abortRef.current.signal,
      });

      // Check if server returned HTML (server down / error page)
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok || !contentType.includes("text/event-stream")) {
        // Try to get error message
        let errMsg = `HTTP ${res.status}`;
        if (contentType.includes("application/json")) {
          try {
            const errData = await res.json();
            errMsg = errData.error ?? errMsg;
          } catch {
            // ignore
          }
        } else if (contentType.includes("text/html")) {
          errMsg = "Server returned HTML instead of SSE stream. The dev server may be down or misconfigured.";
        }
        throw new Error(errMsg);
      }

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;
            try {
              const event = JSON.parse(jsonStr);
              handleStreamEvent(event);
            } catch {
              // skip malformed
            }
          }
        }
      }

      // Process any remaining buffer
      if (buffer.startsWith("data: ")) {
        try {
          const event = JSON.parse(buffer.slice(6).trim());
          handleStreamEvent(event);
        } catch {
          // ignore
        }
      }
    } catch (err) {
      // Don't show error if user aborted (pressed Stop)
      if (err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"))) {
        // User stopped — keep partial content if any
        const current = useMimo.getState().streamingContent;
        if (current.trim()) {
          endStreaming(current);
        } else {
          resetStreaming();
        }
        return;
      }
      // Network/model errors — show but don't crash
      const msg = err instanceof Error ? err.message : "Stream failed";
      // Don't show "Failed to fetch" as error if we already have content
      const hasContent = useMimo.getState().streamingContent.trim().length > 0;
      if (hasContent && (msg.includes("Failed to fetch") || msg.includes("network"))) {
        endStreaming(useMimo.getState().streamingContent);
      } else {
        setError(msg);
        endStreaming("");
      }
    }
    abortRef.current = null;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // ─── @-mention popover keyboard navigation ───
    // When the mention popover is open, intercept ArrowUp/ArrowDown/Enter/Escape/Tab
    // so the user can navigate the suggestion list without losing focus on the textarea.
    if (mention.mentionOpen) {
      // Compute the filtered file list using the same logic as MentionPopover
      // (filter to files only, match query case-insensitively, cap at 20).
      const q = mention.mentionQuery.toLowerCase();
      const filteredFiles = mention.files
        .filter((f) => f.type === "file")
        .filter((f) => (q ? f.path.toLowerCase().includes(q) : true))
        .slice(0, 20);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        mention.setHighlightIndex((i) => Math.min(i + 1, filteredFiles.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        mention.setHighlightIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        // Select the highlighted file (if any) instead of sending the message.
        if (filteredFiles.length > 0) {
          e.preventDefault();
          const idx = Math.min(mention.highlightIndex, filteredFiles.length - 1);
          const target = filteredFiles[idx];
          if (target) {
            void mention.insertMention(target.path);
          }
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        mention.closeMention();
        return;
      }
      if (e.key === "Tab") {
        // Tab also selects the highlighted file (autocomplete-style).
        if (filteredFiles.length > 0) {
          e.preventDefault();
          const idx = Math.min(mention.highlightIndex, filteredFiles.length - 1);
          const target = filteredFiles[idx];
          if (target) {
            void mention.insertMention(target.path);
          }
        }
        return;
      }
    }

    // ─── Default: Enter sends, Shift+Enter inserts newline ───
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const selectedAgentDef = agents.find((a) => a.name === selectedAgent);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header — compact, no redundant avatar (topbar has brand) */}
      <div className="h-10 border-b border-border px-4 flex items-center justify-between gap-2 flex-shrink-0">
        <h2 className="text-xs font-medium text-muted-foreground truncate">
          {currentConversation?.title ?? t("chat.new", locale)}
        </h2>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <TokenHud messages={messages} locale={locale} />
          )}
          <Button
            variant={autonomousMode ? "default" : "outline"}
            size="sm"
            onClick={() => setAutonomousMode(!autonomousMode)}
            className={cn("h-7 gap-1.5 text-[11px]", autonomousMode && "bg-primary hover:bg-primary/90 text-primary-foreground border-0")}
          >
            <Zap className="w-3 h-3" />
            Autonomous
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-5 scrollbar-thin">
        {messages.length === 0 && !isStreaming && (
          <EmptyState
            locale={locale}
            onSelect={(template) => {
              if (template.autonomous && !autonomousMode) {
                setAutonomousMode(true);
              }
              // Auto-send after a tick so autonomous mode state flushes
              setTimeout(() => {
                sendWithMessage(template.prompt, template.autonomous ?? false);
                setInput("");
              }, 50);
            }}
          />
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Active agents indicator */}
        {isStreaming && activeAgents.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            {activeAgents.map((a, i) => {
              const agent = agents.find((ag) => ag.name === a.name);
              const Icon = agent ? getAgentIcon(agent.icon) : Bot;
              return (
                <span key={i} className="flex items-center gap-1">
                  <Icon className="w-3 h-3" />
                  {a.name} ({a.phase})
                </span>
              );
            })}
          </div>
        )}

        {/* Active tools — rendered as rich ToolCallCards with diff view for file mods */}
        {activeTools.length > 0 && (
          <div className="space-y-2">
            {activeTools.map((tool, i) => (
              <ToolCallCard
                key={`${tool.name}-${tool.timestamp}-${i}`}
                tool={tool}
                onViewFile={(_filename) => {
                  setActivePanel("files");
                }}
              />
            ))}
          </div>
        )}

        {/* Streaming content */}
        {isStreaming && streamingContent && (
          <StreamingContent
            content={streamingContent}
            agentTitle={selectedAgentDef?.title ?? t("chat.assistant", locale)}
            dir={dir}
            pendingPreview={pendingPreview}
          />
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border bg-card/30 backdrop-blur-xl px-4 py-3 space-y-2">
        {/* Agent selector */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium mr-1">Agent</span>
          <button
            onClick={() => setSelectedAgent(null)}
            className={cn(
              "text-[11px] px-2 py-0.5 rounded-md transition-smooth font-medium",
              !selectedAgent
                ? "bg-primary text-primary-foreground"
                : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            auto
          </button>
          {agents.map((a) => {
            const Icon = getAgentIcon(a.icon);
            return (
              <button
                key={a.name}
                onClick={() => setSelectedAgent(a.name)}
                title={a.description}
                className={cn(
                  "text-[11px] px-2 py-0.5 rounded-md flex items-center gap-1 transition-colors",
                  selectedAgent === a.name
                    ? `${a.color} text-white`
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                )}
              >
                <Icon className="w-2.5 h-2.5" />
                {a.title}
              </button>
            );
          })}
        </div>

        <div className="flex items-end gap-2 relative">
          <MentionPopover
            open={mention.mentionOpen}
            onOpenChange={(open) => {
              if (!open) {
                mention.closeMention();
              }
            }}
            query={mention.mentionQuery}
            onQueryChange={mention.setMentionQuery}
            files={mention.files}
            loading={mention.loading}
            highlightIndex={mention.highlightIndex}
            onHighlightChange={mention.setHighlightIndex}
            onSelect={mention.insertMention}
            attachedFiles={mention.attachedFiles}
            onDetach={mention.detachFile}
            hasProject={!!currentProjectId}
          />
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              mention.handleInputChange(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              autonomousMode
                ? t("chat.autonomous.placeholder", locale)
                : t("chat.placeholder", locale) + (mention.attachedFiles.length === 0 ? " · @ to mention files" : "")
            }
            disabled={isStreaming}
            className="min-h-[56px] max-h-[200px] resize-none bg-muted/30 border border-border rounded-xl px-3 py-2.5 text-sm focus-visible:ring-1 focus-visible:ring-primary transition-smooth"
            rows={2}
            dir={dir}
          />
          {isStreaming ? (
            <Button
              onClick={stop}
              variant="destructive"
              size="icon"
              className="h-[56px] w-12 rounded-xl"
              title={t("chat.stop", locale)}
            >
              <Square className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              onClick={send}
              disabled={!input.trim()}
              size="icon"
              className="h-[56px] w-12 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-smooth"
            >
              <Send className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  locale,
  onSelect,
}: {
  locale: "ar" | "en";
  onSelect: (template: PromptTemplate) => void;
}) {
  const [activeCategory, setActiveCategory] = useState<PromptTemplate["category"] | "all">("all");

  const filtered =
    activeCategory === "all"
      ? PROMPT_TEMPLATES
      : PROMPT_TEMPLATES.filter((t) => t.category === activeCategory);

  const isAr = locale === "ar";

  return (
    <div className="h-full flex flex-col items-center justify-start text-center py-12 px-4 overflow-y-auto scrollbar-thin">
      {/* Hero badge */}
      <div className="relative mb-5">
        <div className="relative w-20 h-20 rounded-3xl bg-secondary border border-border flex items-center justify-center">
          <Sparkles className="w-10 h-10 text-foreground" />
        </div>
      </div>

      {/* Greeting */}
      <h2 className="text-2xl font-bold mb-2 text-foreground font-semibold">
        {isAr ? "ماذا تريد أن تبني اليوم؟" : "What do you want to build today?"}
      </h2>
      <p className="text-sm text-muted-foreground max-w-md mb-6 leading-relaxed">
        {isAr
          ? "منصة ذكاء اصطناعي مستقلة — صف هدفاً وسيتولّى MiMo البحث والتخطيط والبناء والاختبار والتسليم."
          : "An autonomous AI engineering platform — describe a goal and MiMo will research, plan, build, test, and deliver."}
      </p>

      {/* Capability badges */}
      <div className="flex items-center gap-3 mb-6 flex-wrap justify-center">
        {CAPABILITIES.map((cap) => (
          <div
            key={cap.label.en}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted/50 border text-xs"
          >
            <span className="font-bold text-primary">{cap.value}</span>
            <span className="text-muted-foreground">{isAr ? cap.label.ar : cap.label.en}</span>
          </div>
        ))}
      </div>

      {/* Category filter */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap justify-center max-w-2xl">
        <CategoryChip
          active={activeCategory === "all"}
          onClick={() => setActiveCategory("all")}
          label={isAr ? "الكل" : "All"}
        />
        {TEMPLATE_CATEGORIES.map((cat) => (
          <CategoryChip
            key={cat.id}
            active={activeCategory === cat.id}
            onClick={() => setActiveCategory(cat.id)}
            label={isAr ? cat.label.ar : cat.label.en}
          />
        ))}
      </div>

      {/* Template cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-4xl w-full">
        {filtered.map((template) => {
          const Icon = TEMPLATE_ICONS[template.icon] ?? Sparkles;
          return (
            <button
              key={template.id}
              onClick={() => onSelect(template)}
              className="group text-left p-3.5 rounded-xl border border-border bg-card/50 hover:border-primary/40 hover-lift transition-smooth"
            >
              <div className="flex items-start gap-2.5">
                <div
                  className={cn(
                    "w-8 h-8 rounded-lg bg-gradient-to-br flex items-center justify-center flex-shrink-0 transition-transform",
                    template.gradient
                  )}
                >
                  <Icon className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-xs font-semibold">
                      {isAr ? template.title.ar : template.title.en}
                    </span>
                    {template.autonomous && (
                      <Zap className="w-2.5 h-2.5 text-primary flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground line-clamp-2">
                    {isAr ? template.description.ar : template.description.en}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer hint */}
      <div className="mt-6 text-[11px] text-muted-foreground/70 flex items-center gap-2">
        <kbd className="px-1.5 py-0.5 rounded border bg-muted/50 font-mono text-[10px]">⌘K</kbd>
        <span>{isAr ? "لفتح لوحة الأوامر" : "to open command palette"}</span>
        <span className="mx-1">·</span>
        <kbd className="px-1.5 py-0.5 rounded border bg-muted/50 font-mono text-[10px]">Enter</kbd>
        <span>{isAr ? "للإرسال" : "to send"}</span>
      </div>
    </div>
  );
}

function CategoryChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}

function MessageBubble({ message }: { message: import("@/lib/ai-client").Message }) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const { agents, locale } = useMimo();
  const agent = message.agentName ? agents.find((a) => a.name === message.agentName) : null;
  const [copied, setCopied] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);

  if (isTool) {
    return null;
  }

  // Extract reasoning from <think>...</think> tags (some models emit these)
  const thinkMatch = message.content.match(/<think>([\s\S]*?)<\/think>/);
  const reasoning = thinkMatch?.[1]?.trim();
  const displayContent = reasoning
    ? message.content.replace(/<think>[\s\S]*?<\/think>/, "").trim()
    : message.content;

  const copy = () => {
    navigator.clipboard.writeText(displayContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Resolve agent icon — wrap in IIFE to satisfy react-hooks/static-components
  const renderAgentAvatar = () => {
    if (isUser) return <User className="w-3.5 h-3.5" />;
    const Icon = agent ? getAgentIcon(agent.icon) : Bot;
    return <Icon className="w-3.5 h-3.5 text-white" />;
  };

  return (
    <div className="flex gap-3 group max-w-3xl mx-auto" dir={getDirection(locale)}>
      <div
        className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5",
          isUser
            ? "bg-muted"
            : agent
            ? agent.color
            : "bg-secondary"
        )}
      >
        {renderAgentAvatar()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-xs font-semibold">
            {isUser ? t("chat.you", locale) : agent?.title ?? t("chat.assistant", locale)}
          </span>
          {agent && (
            <span className="text-[9px] text-muted-foreground/70 font-mono bg-muted/40 px-1.5 py-0.5 rounded">
              {agent.name}
            </span>
          )}
          {!isUser && message.durationMs > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {(message.durationMs / 1000).toFixed(1)}s · {message.tokenOutput} tok
            </span>
          )}
          {!isUser && (
            <button
              onClick={copy}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
            >
              {copied ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
              {copied ? "copied" : "copy"}
            </button>
          )}
        </div>

        {/* Reasoning collapsible (if <think> tags present) */}
        {reasoning && (
          <div className="mb-2">
            <button
              onClick={() => setShowReasoning(!showReasoning)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {showReasoning ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              <Sparkles className="w-3 h-3" />
              {showReasoning
                ? locale === "ar" ? "إخفاء التفكير" : "Hide reasoning"
                : locale === "ar" ? "إظهار التفكير" : "Show reasoning"}
            </button>
            {showReasoning && (
              <div className="mt-1.5 p-2.5 rounded-md bg-secondary/40 border border-border text-[11px] text-muted-foreground italic whitespace-pre-wrap">
                {reasoning}
              </div>
            )}
          </div>
        )}

        {isUser ? (
          <div className="prose prose-sm dark:prose-invert max-w-none break-words whitespace-pre-wrap text-sm leading-relaxed">
            {displayContent}
          </div>
        ) : (
          <>
            {/* Parse and render artifacts from saved message */}
            {(() => {
              const msgId = `msg-${message.id}`;
              const parsed = artifactParser.parse(msgId, displayContent);
              return (
                <>
                  {parsed.text.trim() && (
                    <Markdown content={parsed.text} className="text-sm leading-relaxed" />
                  )}
                  {parsed.artifacts.map((artifact) => (
                    <ArtifactCard
                      key={artifact.id}
                      artifactId={artifact.id}
                      title={artifact.title}
                      actions={artifact.actions}
                      previewUrl={message.previewUrl ?? undefined}
                      onViewPreview={() => useMimo.getState().setActivePanel("preview")}
                    />
                  ))}
                  {/* Inline preview for saved messages (only if no artifacts) */}
                  {message.previewUrl && !parsed.artifacts.length && (
                    <InlinePreview url={message.previewUrl} name={message.previewName ?? "Preview"} />
                  )}
                </>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Token / cost HUD — shows cumulative token usage for the current conversation.
 * Displays: ↑ input tokens · ↓ output tokens · total messages
 * Hover shows per-agent breakdown.
 */
function TokenHud({
  messages,
  locale,
}: {
  messages: import("@/lib/ai-client").Message[];
  locale: "ar" | "en";
}) {
  const totalIn = messages.reduce((sum, m) => sum + (m.tokenInput || 0), 0);
  const totalOut = messages.reduce((sum, m) => sum + (m.tokenOutput || 0), 0);
  const assistantMsgs = messages.filter((m) => m.role === "assistant").length;

  if (totalIn === 0 && totalOut === 0) return null;

  const formatK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

  return (
    <div
      className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-muted/40 border text-[11px]"
      title={locale === "ar" ? "إجمالي استخدام الرموز لهذه المحادثة" : "Total token usage for this conversation"}
    >
      <span className="flex items-center gap-1 text-emerald-500" title={locale === "ar" ? "رموز الإدخال" : "Input tokens"}>
        <span className="text-[9px]">↑</span>
        <span className="font-mono font-semibold">{formatK(totalIn)}</span>
      </span>
      <span className="text-muted-foreground/30">·</span>
      <span className="flex items-center gap-1 text-muted-foreground" title={locale === "ar" ? "رموز الإخراج" : "Output tokens"}>
        <span className="text-[9px]">↓</span>
        <span className="font-mono font-semibold">{formatK(totalOut)}</span>
      </span>
      <span className="text-muted-foreground/30">·</span>
      <span className="text-muted-foreground font-mono" title={locale === "ar" ? "رسائل المساعد" : "Assistant messages"}>
        {assistantMsgs} {locale === "ar" ? "رد" : "replies"}
      </span>
    </div>
  );
}

/**
 * StreamingContent — renders streaming model output with real-time artifact parsing.
 * Shows ArtifactCard cards as the model outputs <mimoAction> tags.
 */
function StreamingContent({
  content,
  agentTitle,
  dir,
  pendingPreview,
}: {
  content: string;
  agentTitle: string;
  dir: "rtl" | "ltr";
  pendingPreview: { url: string; name: string } | null;
}) {
  // Parse artifacts from streaming content (uses singleton parser with state)
  const messageId = "streaming";
  const parsed = artifactParser.parse(messageId, content);

  return (
    <div className="flex gap-3 max-w-3xl mx-auto" dir={dir}>
      <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0 mt-0.5">
        <Bot className="w-4 h-4 text-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-muted-foreground mb-1.5">
          {agentTitle}
        </div>

        {/* Render non-artifact text as markdown */}
        {parsed.text.trim() && (
          <Markdown content={parsed.text} className="text-sm leading-relaxed" />
        )}

        {/* Render artifacts as ArtifactCard */}
        {parsed.artifacts.map((artifact) => (
          <ArtifactCard
            key={artifact.id}
            artifactId={artifact.id}
            title={artifact.title}
            actions={artifact.actions}
            previewUrl={pendingPreview?.url}
            onViewPreview={(id) => {
              // Switch to preview panel
              useMimo.getState().setActivePanel("preview");
            }}
          />
        ))}

        {/* Cursor */}
        <span className="inline-block w-1.5 h-4 bg-foreground ml-0.5 animate-pulse align-middle" />

        {/* Inline preview during streaming */}
        {pendingPreview && !parsed.artifacts.length && (
          <InlinePreview url={pendingPreview.url} name={pendingPreview.name} />
        )}
      </div>
    </div>
  );
}
