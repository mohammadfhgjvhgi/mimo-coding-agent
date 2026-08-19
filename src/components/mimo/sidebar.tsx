"use client";

import { useState, useRef, useEffect } from "react";
import { useMimo } from "@/lib/mimo-store";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Plus,
  MessageSquare,
  Zap,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Pencil,
  Pin,
  PinOff,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { t, getDirection } from "@/lib/i18n";

export function Sidebar() {
  const {
    conversations,
    currentConversation,
    loadConversation,
    newConversation,
    systemState,
    locale,
    renameConversation,
    deleteConversation,
    togglePinConversation,
  } = useMimo();

  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const dir = getDirection(locale);

  // Filter + sort: pinned first, then by updatedAt
  const filtered = conversations
    .filter((c) =>
      searchQuery
        ? c.title.toLowerCase().includes(searchQuery.toLowerCase())
        : true
    )
    .sort((a, b) => {
      // Pinned first
      const aPinned = (a as { pinned?: boolean }).pinned ? 1 : 0;
      const bPinned = (b as { pinned?: boolean }).pinned ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

  const startEdit = (id: string, currentTitle: string) => {
    setEditingId(id);
    setEditTitle(currentTitle);
  };

  const commitEdit = () => {
    if (editingId && editTitle.trim()) {
      renameConversation(editingId, editTitle.trim());
    }
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    if (confirm(t("conv.deleteConfirm", locale))) {
      deleteConversation(id);
    }
  };

  return (
    <div className="w-60 border-r border-border bg-background flex flex-col h-full">
      {/* Brand — minimal, no gradient */}
      <div className="px-3 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-secondary flex items-center justify-center">
            <Zap className="w-3.5 h-3.5 text-foreground" />
          </div>
          <span className="text-sm font-semibold">MiMo</span>
        </div>
      </div>

      {/* New conversation */}
      <div className="p-2 space-y-2">
        <Button
          onClick={() => newConversation()}
          variant="outline"
          className="w-full justify-start gap-2 text-xs h-8"
        >
          <Plus className="w-3.5 h-3.5" />
          {t("sidebar.new", locale)}
        </Button>

        {/* Search */}
        {conversations.length > 0 && (
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("conv.search", locale)}
              className="h-7 pl-6 text-xs"
              dir={dir}
            />
          </div>
        )}
      </div>

      {/* Conversations list */}
      <ScrollArea className="flex-1 px-2">
        <div className="space-y-1 pb-2">
          {filtered.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground p-4">
              {searchQuery
                ? locale === "ar" ? "لا نتائج." : "No results."
                : t("sidebar.noConversations", locale)}
            </div>
          ) : (
            filtered.map((conv) => {
              const isEditing = editingId === conv.id;
              const isPinned = (conv as { pinned?: boolean }).pinned;
              return (
                <div
                  key={conv.id}
                  className={cn(
                    "group w-full text-left px-2.5 py-2 rounded-md transition-smooth text-xs",
                    currentConversation?.id === conv.id
                      ? "bg-secondary text-foreground"
                      : "hover:bg-secondary/60 text-muted-foreground"
                  )}
                >
                  <div className="flex items-start gap-2">
                    <MessageSquare className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 opacity-60" />
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <Input
                          ref={editInputRef}
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEdit();
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="h-5 text-xs px-1"
                          dir={dir}
                        />
                      ) : (
                        <button
                          onClick={() => loadConversation(conv.id)}
                          className="w-full text-left"
                        >
                          <div className="font-medium line-clamp-1 flex items-center gap-1">
                            {isPinned && <Pin className="w-2.5 h-2.5 text-amber-500 flex-shrink-0" />}
                            {conv.title}
                          </div>
                          <div className="flex items-center gap-1 mt-1">
                            {conv.autonomous && (
                              <Badge variant="outline" className="text-[9px] py-0 px-1 text-amber-500">
                                <Zap className="w-2 h-2" />
                              </Badge>
                            )}
                            {conv.status === "completed" && (
                              <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" />
                            )}
                            {conv.status === "failed" && (
                              <AlertCircle className="w-2.5 h-2.5 text-rose-500" />
                            )}
                            <span className="text-[9px] text-muted-foreground">
                              {formatDistanceToNow(new Date(conv.updatedAt), { addSuffix: true })}
                            </span>
                          </div>
                        </button>
                      )}
                    </div>
                    {/* Action buttons — show on hover */}
                    {!isEditing && (
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePinConversation(conv.id, !isPinned);
                          }}
                          className="text-muted-foreground hover:text-amber-500 p-0.5"
                          title={isPinned ? t("conv.unpin", locale) : t("conv.pin", locale)}
                        >
                          {isPinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(conv.id, conv.title);
                          }}
                          className="text-muted-foreground hover:text-blue-500 p-0.5"
                          title={t("conv.rename", locale)}
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(conv.id);
                          }}
                          className="text-muted-foreground hover:text-rose-500 p-0.5"
                          title={t("conv.delete", locale)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* System state — minimal footer */}
      {systemState && (
        <div className="px-3 py-2 border-t border-border flex items-center justify-between text-[10px] text-muted-foreground/50">
          <span>{systemState.agents} agents</span>
          <span>{systemState.skills} skills</span>
          <span>{systemState.tools} tools</span>
        </div>
      )}
    </div>
  );
}
