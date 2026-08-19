"use client";

import { useMimo } from "@/lib/mimo-store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { t } from "@/lib/i18n";

export function SkillsPanel() {
  const { skills, skillSearchQuery, setSkillSearchQuery, loadSkills, locale } = useMimo();

  return (
    <div className="p-3 space-y-2">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={skillSearchQuery}
          onChange={(e) => {
            setSkillSearchQuery(e.target.value);
            loadSkills(e.target.value);
          }}
          placeholder={t("skills.search.placeholder", locale)}
          className="h-8 pl-7 text-xs"
        />
      </div>

      <div className="text-xs text-muted-foreground">
        {skills.length} skills loaded
      </div>

      {skills.map((skill) => (
        <Card key={skill.name} className="p-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-mono font-semibold leading-tight">{skill.name}</div>
              <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                {skill.description}
              </p>
              <div className="flex items-center gap-1.5 mt-1.5">
                {skill.version && (
                  <Badge variant="outline" className="text-[9px] py-0">
                    v{skill.version}
                  </Badge>
                )}
                {skill.license && (
                  <Badge variant="outline" className="text-[9px] py-0">
                    {skill.license}
                  </Badge>
                )}
                <span className="text-[10px] text-muted-foreground">
                  {(skill.size / 1024).toFixed(1)}KB
                </span>
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
