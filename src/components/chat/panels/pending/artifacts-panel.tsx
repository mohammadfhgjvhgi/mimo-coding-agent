"use client";

import { useState } from "react";
import { useMimo } from "@/lib/mimo-store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileText, Code, FileCheck, BookOpen, FileCog, Database, File } from "lucide-react";

const TYPE_ICONS: Record<string, typeof FileText> = {
  code: Code,
  document: FileText,
  research_report: BookOpen,
  architecture_diagram: FileCog,
  test_report: FileCheck,
  config: FileCog,
  plan: FileText,
  dataset: Database,
  other: File,
};

export function ArtifactsPanel() {
  const { artifacts, locale } = useMimo();
  const [selected, setSelected] = useState<(typeof artifacts)[0] | null>(null);

  if (artifacts.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
        {locale === "ar" ? "لا منتجات بعد. سينشئ MiMo كودًا ومستندات وتقارير أثناء عمله." : "No artifacts yet. MiMo will create code, docs, and reports as it works."}
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2">
      {artifacts.map((art) => {
        const Icon = TYPE_ICONS[art.type] ?? File;
        return (
          <Card
            key={art.id}
            className="p-2.5 hover:bg-muted/50 transition-colors cursor-pointer"
            onClick={() => setSelected(art)}
          >
            <div className="flex items-start gap-2">
              <Icon className="w-4 h-4 mt-0.5 text-violet-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium leading-tight truncate">{art.name}</div>
                <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                  {art.summary ?? art.content.slice(0, 120)}
                </div>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <Badge variant="outline" className="text-[9px] py-0">
                    {art.type}
                  </Badge>
                  <Badge variant="outline" className="text-[9px] py-0">
                    {art.format}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {(art.sizeBytes / 1024).toFixed(1)}KB
                  </span>
                </div>
              </div>
            </div>
          </Card>
        );
      })}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {(() => {
                if (!selected) return null;
                const Icon = TYPE_ICONS[selected.type] ?? File;
                return <Icon className="w-4 h-4 text-violet-500" />;
              })()}
              {selected?.name}
            </DialogTitle>
            <div className="flex items-center gap-2">
              {selected && (
                <>
                  <Badge variant="outline">{selected.type}</Badge>
                  <Badge variant="outline">{selected.format}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {(selected.sizeBytes / 1024).toFixed(1)}KB
                  </span>
                </>
              )}
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            <pre className="text-xs font-mono whitespace-pre-wrap p-2">
              {selected?.content}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
