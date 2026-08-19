"use client";

import { useMimo } from "@/lib/mimo-store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Wrench, Shield, Clock } from "lucide-react";
import { t } from "@/lib/i18n";

const RISK_COLORS: Record<string, string> = {
  low: "text-emerald-500",
  medium: "text-amber-500",
  high: "text-rose-500",
};

export function ToolsPanel() {
  const { tools, locale } = useMimo();

  if (tools.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        <Wrench className="w-8 h-8 mx-auto mb-2 opacity-50" />
        {t("tools.empty", locale)}
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2">
      <div className="text-xs text-muted-foreground mb-1">
        {locale === "ar" ? `${tools.length} أداة متاحة` : `${tools.length} tools available`}
      </div>
      {tools.map((tool) => (
        <Card key={tool.name} className="p-2.5">
          <div className="flex items-start gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
              <Wrench className="w-3.5 h-3.5 text-amber-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-sm font-mono font-semibold">{tool.name}</span>
              </div>
              <p className="text-[11px] text-muted-foreground line-clamp-2">
                {tool.description}
              </p>
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <Badge
                  variant="outline"
                  className={`text-[9px] py-0 ${RISK_COLORS[tool.riskLevel] ?? ""}`}
                >
                  <Shield className="w-2 h-2 mr-0.5" />
                  {tool.riskLevel}
                </Badge>
                <Badge variant="outline" className="text-[9px] py-0">
                  <Clock className="w-2 h-2 mr-0.5" />
                  {(tool.timeoutMs / 1000).toFixed(0)}s
                </Badge>
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
