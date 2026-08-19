"use client";

import { useState, useEffect, useCallback } from "react";
import { useMimo } from "@/lib/mimo-store";
import { safeFetch } from "@/lib/safe-fetch";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BookOpen, FileText, Code, Brain, Wrench, Database, File } from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORY_ICONS: Record<string, typeof FileText> = {
  architecture: Brain,
  research: BookOpen,
  skill: Wrench,
  code: Code,
  spec: FileText,
  other: File,
};

interface KnowledgeResult {
  id: string;
  title: string;
  summary: string | null;
  category: string | null;
  sourcePath: string | null;
  tags: string | null;
  accessCount: number;
  createdAt: string;
}

interface CategoryCount {
  name: string;
  count: number;
}

export function KnowledgePanel() {
  const { locale } = useMimo();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeResult[]>([]);
  const [categories, setCategories] = useState<CategoryCount[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<KnowledgeResult | null>(null);
  const [fullContent, setFullContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (activeCategory) params.set("category", activeCategory);
      params.set("limit", "50");

      const data = await safeFetch<{
        results: KnowledgeResult[];
        categories: CategoryCount[];
      }>(`/api/knowledge?${params.toString()}`);
      setResults(data.results ?? []);
      setCategories(data.categories ?? []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, activeCategory]);

  useEffect(() => {
    search();
  }, [search]);

  const openEntry = async (entry: KnowledgeResult) => {
    setSelected(entry);
    setFullContent(null);
    try {
      const data = await safeFetch<{ content: string }>(`/api/knowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id }),
      });
      setFullContent(data.content);
    } catch {
      setFullContent("Failed to load content");
    }
  };

  return (
    <div className="p-2 space-y-2 h-full flex flex-col">
      {/* Search */}
      <Input
        placeholder={locale === "ar" ? "ابحث في قاعدة المعرفة..." : "Search knowledge base..."}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-8 text-xs"
      />

      {/* Category filters */}
      {categories.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setActiveCategory(null)}
            className={cn(
              "px-2 py-0.5 text-[10px] rounded font-medium transition-colors",
              !activeCategory ? "bg-violet-500 text-white" : "text-muted-foreground hover:bg-muted/50"
            )}
          >
            {locale === "ar" ? "الكل" : "All"} ({categories.reduce((s, c) => s + c.count, 0)})
          </button>
          {categories.map((cat) => (
            <button
              key={cat.name}
              onClick={() => setActiveCategory(cat.name)}
              className={cn(
                "px-2 py-0.5 text-[10px] rounded font-medium transition-colors",
                activeCategory === cat.name ? "bg-violet-500 text-white" : "text-muted-foreground hover:bg-muted/50"
              )}
            >
              {cat.name} ({cat.count})
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto space-y-1">
        {loading ? (
          <div className="text-xs text-muted-foreground text-center py-4">
            {locale === "ar" ? "جارٍ البحث..." : "Searching..."}
          </div>
        ) : results.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-4">
            <Database className="w-8 h-8 mx-auto mb-2 opacity-50" />
            {locale === "ar" ? "لا نتائج" : "No results"}
          </div>
        ) : (
          results.map((entry) => {
            const Icon = CATEGORY_ICONS[entry.category ?? "other"] ?? File;
            return (
              <Card
                key={entry.id}
                className="p-2 hover:bg-muted/50 transition-colors cursor-pointer"
                onClick={() => openEntry(entry)}
              >
                <div className="flex items-start gap-2">
                  <Icon className="w-3.5 h-3.5 mt-0.5 text-violet-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium leading-tight truncate">{entry.title}</div>
                    {entry.summary && (
                      <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">
                        {entry.summary}
                      </p>
                    )}
                    <div className="flex items-center gap-1.5 mt-1">
                      {entry.category && (
                        <Badge variant="outline" className="text-[9px] py-0">
                          {entry.category}
                        </Badge>
                      )}
                      {entry.sourcePath && (
                        <span className="text-[9px] text-muted-foreground truncate">
                          {entry.sourcePath.split("/").slice(-2).join("/")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Entry viewer dialog */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selected && (() => {
                const Icon = CATEGORY_ICONS[selected.category ?? "other"] ?? File;
                return <Icon className="w-4 h-4 text-violet-500" />;
              })()}
              {selected?.title}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            {selected?.sourcePath && (
              <div className="text-[10px] text-muted-foreground mb-2 font-mono">
                {selected.sourcePath}
              </div>
            )}
            <pre className="text-xs whitespace-pre-wrap break-words font-mono">
              {fullContent ?? "Loading..."}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
