"use client";

import { useMimo } from "@/lib/mimo-store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Gavel } from "lucide-react";
import { t } from "@/lib/i18n";

export function DecisionsPanel() {
  const { decisions, locale } = useMimo();

  if (decisions.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        <Gavel className="w-8 h-8 mx-auto mb-2 opacity-50" />
        {t("decisions.empty", locale)}
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2">
      {decisions.map((dec) => (
        <Card key={dec.id} className="p-2.5 space-y-1.5">
          <div className="flex items-center gap-2">
            <Badge
              variant={
                dec.status === "accepted"
                  ? "default"
                  : dec.status === "rejected"
                  ? "destructive"
                  : "secondary"
              }
              className="text-[9px] py-0"
            >
              {dec.status}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {t("decisions.by", locale)} {dec.decidedBy}
            </span>
          </div>
          <div className="text-sm font-semibold leading-tight">{dec.title}</div>
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">Context:</span> {dec.context}
          </div>
          <div className="text-xs">
            <span className="font-medium text-emerald-500">Decision:</span> {dec.decision}
          </div>
          {dec.reasoning && (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">Reasoning:</span> {dec.reasoning}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
