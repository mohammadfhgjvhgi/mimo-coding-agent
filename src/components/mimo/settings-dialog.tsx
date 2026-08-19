"use client";

import * as React from "react";
import { useState } from "react";
import { useMimo } from "@/lib/mimo-store";
import { t, getDirection, listLocales } from "@/lib/i18n";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import {
  Palette,
  Cpu,
  Users,
  Wrench,
  Sparkles,
  Info,
  Languages,
  Sun,
  Moon,
  Monitor,
  Type,
  Globe,
  Settings,
  Shield,
  Clock,
  BookOpen,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getAgentIcon } from "./agent-icons";

type TabKey = "appearance" | "models" | "agents" | "tools" | "skills" | "about";

const RISK_STYLES: Record<string, string> = {
  low: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
  medium: "border-amber-500/30 text-amber-600 dark:text-amber-400",
  high: "border-rose-500/30 text-rose-600 dark:text-rose-400",
};

const TEMPERATURE_KEY = "mimo.temperature";
const MAX_TOKENS_KEY = "mimo.maxTokens";
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 8192;

const MAX_SKILLS_DISPLAYED = 50;

export function SettingsDialog() {
  // Selective subscriptions to minimize re-renders
  const settingsOpen = useMimo((s) => s.settingsOpen);
  const setSettingsOpen = useMimo((s) => s.setSettingsOpen);
  const locale = useMimo((s) => s.locale);
  const setLocale = useMimo((s) => s.setLocale);
  const theme = useMimo((s) => s.theme);
  const setTheme = useMimo((s) => s.setTheme);
  const agents = useMimo((s) => s.agents);
  const tools = useMimo((s) => s.tools);
  const skills = useMimo((s) => s.skills);

  const dir = getDirection(locale);

  const [activeTab, setActiveTab] = useState<TabKey>("appearance");
  // Lazy-initialize from localStorage (client-only; server falls back to defaults).
  // The Slider that consumes this state is rendered inside a Portal-wrapped Dialog
  // that is closed during initial render, so there is no visible hydration mismatch.
  const [temperature, setTemperature] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_TEMPERATURE;
    try {
      const stored = window.localStorage.getItem(TEMPERATURE_KEY);
      if (stored === null) return DEFAULT_TEMPERATURE;
      const parsed = Number(stored);
      return Number.isNaN(parsed) ? DEFAULT_TEMPERATURE : parsed;
    } catch {
      return DEFAULT_TEMPERATURE;
    }
  });
  const [maxTokens, setMaxTokens] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_MAX_TOKENS;
    try {
      const stored = window.localStorage.getItem(MAX_TOKENS_KEY);
      if (stored === null) return DEFAULT_MAX_TOKENS;
      const parsed = Number(stored);
      return Number.isNaN(parsed) ? DEFAULT_MAX_TOKENS : parsed;
    } catch {
      return DEFAULT_MAX_TOKENS;
    }
  });

  const handleTemperatureChange = React.useCallback((value: number[]) => {
    const v = value[0];
    if (typeof v !== "number") return;
    setTemperature(v);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(TEMPERATURE_KEY, String(v));
      } catch {
        // ignore
      }
    }
  }, []);

  const handleMaxTokensChange = React.useCallback((value: number[]) => {
    const v = value[0];
    if (typeof v !== "number") return;
    setMaxTokens(v);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(MAX_TOKENS_KEY, String(v));
      } catch {
        // ignore
      }
    }
  }, []);

  const TABS: { key: TabKey; icon: LucideIcon; label: string }[] = [
    { key: "appearance", icon: Palette, label: t("settings.tab.appearance", locale) },
    { key: "models", icon: Cpu, label: t("settings.tab.models", locale) },
    { key: "agents", icon: Users, label: t("settings.tab.agents", locale) },
    { key: "tools", icon: Wrench, label: t("settings.tab.tools", locale) },
    { key: "skills", icon: Sparkles, label: t("settings.tab.skills", locale) },
    { key: "about", icon: Info, label: t("settings.tab.about", locale) },
  ];

  const visibleSkills = skills.slice(0, MAX_SKILLS_DISPLAYED);

  return (
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className="max-w-3xl p-6" dir={dir}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-4 h-4" />
            {t("settings.title", locale)}
          </DialogTitle>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as TabKey)}
          dir={dir}
          className="flex flex-row gap-4 w-full"
        >
          {/* LEFT — vertical tab list */}
          <TabsList className="flex-col h-auto w-44 shrink-0 justify-stretch items-stretch rounded-lg p-1 gap-0.5">
            {TABS.map(({ key, icon: Icon, label }) => (
              <TabsTrigger
                key={key}
                value={key}
                className="justify-start gap-2 px-3 py-2 h-auto w-full flex-none data-[state=active]:shadow-sm"
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="text-sm font-medium">{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {/* RIGHT — scrollable content area */}
          <div className="flex-1 min-w-0 max-h-[70vh] overflow-y-auto scrollbar-thin pe-1">
            {/* ─── Appearance ─── */}
            <TabsContent value="appearance" className="mt-0 space-y-5">
              {/* Language */}
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <Languages className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">
                    {t("settings.language", locale)}
                  </h3>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {listLocales().map((l) => (
                    <Button
                      key={l}
                      variant={locale === l ? "default" : "outline"}
                      size="sm"
                      onClick={() => setLocale(l)}
                      className="justify-start"
                      dir={getDirection(l)}
                    >
                      <Globe className="w-3.5 h-3.5" />
                      {l === "ar" ? "العربية" : "English"}
                    </Button>
                  ))}
                </div>
              </section>

              <Separator />

              {/* Theme */}
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <Sun className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">
                    {t("settings.theme", locale)}
                  </h3>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <ThemeButton
                    active={theme === "dark"}
                    onClick={() => setTheme("dark")}
                    icon={<Moon className="w-3.5 h-3.5" />}
                    label={t("settings.theme.dark", locale)}
                  />
                  <ThemeButton
                    active={theme === "light"}
                    onClick={() => setTheme("light")}
                    icon={<Sun className="w-3.5 h-3.5" />}
                    label={t("settings.theme.light", locale)}
                  />
                  <ThemeButton
                    active={theme === "system"}
                    onClick={() => setTheme("system")}
                    icon={<Monitor className="w-3.5 h-3.5" />}
                    label={t("settings.theme.system", locale)}
                  />
                </div>
              </section>

              <Separator />

              {/* Direction info */}
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <Type className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">
                    {t("settings.direction", locale)}
                  </h3>
                </div>
                <div className="text-xs text-muted-foreground p-2 rounded-md bg-muted/30">
                  {dir === "rtl"
                    ? locale === "ar"
                      ? "الاتجاه: يمين لليسار (RTL)"
                      : "Direction: Right to Left (RTL)"
                    : locale === "ar"
                      ? "الاتجاه: يسار لليمين (LTR)"
                      : "Direction: Left to Right (LTR)"}
                </div>
              </section>
            </TabsContent>

            {/* ─── Models ─── */}
            <TabsContent value="models" className="mt-0 space-y-5">
              {/* Current model (read-only) */}
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <Cpu className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">
                    {t("settings.models.currentModel", locale)}
                  </h3>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-md bg-muted/30">
                  <Badge variant="default" className="font-mono">
                    GLM-4-plus
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {locale === "ar" ? "(للقراءة فقط)" : "(read-only)"}
                  </span>
                </div>
              </section>

              <Separator />

              {/* Provider (read-only) */}
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">
                    {t("settings.models.provider", locale)}
                  </h3>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-md bg-muted/30">
                  <Badge variant="outline" className="font-mono">
                    z-ai-web-dev-sdk
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {locale === "ar" ? "(للقراءة فقط)" : "(read-only)"}
                  </span>
                </div>
              </section>

              <Separator />

              {/* Temperature */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Sun className="w-4 h-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold">
                      {t("settings.models.temperature", locale)}
                    </h3>
                  </div>
                  <Badge variant="outline" className="font-mono tabular-nums">
                    {temperature.toFixed(2)}
                  </Badge>
                </div>
                <Slider
                  value={[temperature]}
                  onValueChange={handleTemperatureChange}
                  min={0}
                  max={2}
                  step={0.05}
                  aria-label={t("settings.models.temperature", locale)}
                  className="w-full"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>0</span>
                  <span>1</span>
                  <span>2</span>
                </div>
              </section>

              <Separator />

              {/* Max tokens */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Type className="w-4 h-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold">
                      {t("settings.models.maxTokens", locale)}
                    </h3>
                  </div>
                  <Badge variant="outline" className="font-mono tabular-nums">
                    {maxTokens.toLocaleString()}
                  </Badge>
                </div>
                <Slider
                  value={[maxTokens]}
                  onValueChange={handleMaxTokensChange}
                  min={1024}
                  max={32768}
                  step={1024}
                  aria-label={t("settings.models.maxTokens", locale)}
                  className="w-full"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>1024</span>
                  <span>16384</span>
                  <span>32768</span>
                </div>
              </section>

              <Separator />

              {/* Server-side note */}
              <div className="flex items-start gap-2 text-xs text-muted-foreground p-2 rounded-md bg-amber-500/5 border border-amber-500/20">
                <Info className="w-3.5 h-3.5 mt-0.5 text-amber-500 shrink-0" />
                <span>{t("settings.models.note", locale)}</span>
              </div>
            </TabsContent>

            {/* ─── Agents ─── */}
            <TabsContent value="agents" className="mt-0 space-y-2">
              <div className="text-xs text-muted-foreground">
                {locale === "ar"
                  ? `${agents.length} وكيل متخصص`
                  : `${agents.length} specialized agents`}
              </div>
              <div className="max-h-80 overflow-y-auto scrollbar-thin space-y-2 pe-1">
                {agents.length === 0 ? (
                  <div className="text-xs text-muted-foreground p-4 text-center">
                    {locale === "ar" ? "لا وكلاء بعد." : "No agents loaded."}
                  </div>
                ) : (
                  agents.map((agent) => {
                    const Icon = getAgentIcon(agent.icon);
                    return (
                      <Card key={agent.name} className="p-3 gap-2 py-3 shadow-none">
                        <div className="flex items-start gap-2.5 px-3">
                          <div
                            className={cn(
                              "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                              agent.color
                            )}
                          >
                            <Icon className="w-4 h-4 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-sm font-semibold leading-tight">
                                {agent.title}
                              </span>
                              <Badge
                                variant="secondary"
                                className="text-[9px] py-0 px-1.5 font-mono"
                              >
                                {agent.role}
                              </Badge>
                            </div>
                            <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                              {agent.name}
                            </div>
                            <p className="text-[11px] text-muted-foreground line-clamp-2 mt-1">
                              {agent.description}
                            </p>
                          </div>
                        </div>
                      </Card>
                    );
                  })
                )}
              </div>
            </TabsContent>

            {/* ─── Tools ─── */}
            <TabsContent value="tools" className="mt-0 space-y-2">
              <div className="text-xs text-muted-foreground">
                {locale === "ar"
                  ? `${tools.length} أداة متاحة`
                  : `${tools.length} tools available`}
              </div>
              <div className="max-h-80 overflow-y-auto scrollbar-thin space-y-2 pe-1">
                {tools.length === 0 ? (
                  <div className="text-xs text-muted-foreground p-4 text-center">
                    {locale === "ar" ? "لا أدوات بعد." : "No tools available."}
                  </div>
                ) : (
                  tools.map((tool) => {
                    const riskClass = RISK_STYLES[tool.riskLevel] ?? "";
                    return (
                      <Card key={tool.name} className="p-3 gap-2 py-3 shadow-none">
                        <div className="flex items-start gap-2.5 px-3">
                          <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                            <Wrench className="w-4 h-4 text-amber-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-sm font-mono font-semibold leading-tight">
                                {tool.name}
                              </span>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[9px] py-0 px-1.5",
                                  riskClass
                                )}
                              >
                                <Shield className="w-2.5 h-2.5" />
                                {tool.riskLevel}
                              </Badge>
                              <Badge
                                variant="outline"
                                className="text-[9px] py-0 px-1.5"
                              >
                                <Clock className="w-2.5 h-2.5" />
                                {(tool.timeoutMs / 1000).toFixed(0)}s
                              </Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground line-clamp-2 mt-1">
                              {tool.description}
                            </p>
                          </div>
                        </div>
                      </Card>
                    );
                  })
                )}
              </div>
            </TabsContent>

            {/* ─── Skills ─── */}
            <TabsContent value="skills" className="mt-0 space-y-2">
              <div className="text-xs text-muted-foreground">
                {t("settings.skills.showing", locale)}{" "}
                <span className="font-mono tabular-nums text-foreground">
                  {Math.min(visibleSkills.length, MAX_SKILLS_DISPLAYED)}
                </span>{" "}
                {t("settings.skills.of", locale)}{" "}
                <span className="font-mono tabular-nums text-foreground">
                  {skills.length}
                </span>{" "}
                {locale === "ar" ? "مهارة" : "skills"}
              </div>
              <div className="max-h-80 overflow-y-auto scrollbar-thin space-y-2 pe-1">
                {visibleSkills.length === 0 ? (
                  <div className="text-xs text-muted-foreground p-4 text-center">
                    {locale === "ar" ? "لا مهارات بعد." : "No skills loaded."}
                  </div>
                ) : (
                  visibleSkills.map((skill) => (
                    <Card
                      key={skill.slug ?? skill.name}
                      className="p-3 gap-2 py-3 shadow-none"
                    >
                      <div className="flex items-start justify-between gap-2 px-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-mono font-semibold leading-tight">
                            {skill.name}
                          </div>
                          <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                            {skill.description}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                            {skill.license && (
                              <Badge
                                variant="outline"
                                className="text-[9px] py-0 px-1.5"
                              >
                                {skill.license}
                              </Badge>
                            )}
                            {skill.version && (
                              <Badge
                                variant="outline"
                                className="text-[9px] py-0 px-1.5"
                              >
                                v{skill.version}
                              </Badge>
                            )}
                            <span className="text-[10px] text-muted-foreground font-mono">
                              {(skill.size / 1024).toFixed(1)}KB
                            </span>
                          </div>
                        </div>
                      </div>
                    </Card>
                  ))
                )}
                {skills.length > MAX_SKILLS_DISPLAYED && (
                  <div className="text-[10px] text-muted-foreground text-center py-1">
                    {locale === "ar"
                      ? `+${skills.length - MAX_SKILLS_DISPLAYED} مهارة أخرى…`
                      : `+${skills.length - MAX_SKILLS_DISPLAYED} more skills…`}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* ─── About ─── */}
            <TabsContent value="about" className="mt-0 space-y-4">
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <Info className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">
                    {t("settings.about.systemInfo", locale)}
                  </h3>
                </div>
                <div className="text-xs space-y-2 text-muted-foreground p-3 rounded-md bg-muted/30">
                  <div className="font-medium text-foreground">
                    MiMo AI Engineering Platform v2.0
                  </div>
                  <div>
                    12 agents · 18 tools · 69 skills
                  </div>
                  <div>
                    z-ai-web-dev-sdk · GLM-4-plus
                  </div>
                  <div>
                    Next.js 16 · TypeScript 5 · Prisma
                  </div>
                </div>
              </section>

              <Separator />

              <section>
                <div className="flex items-center gap-2 mb-2">
                  <BookOpen className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">
                    {t("settings.about.resources", locale)}
                  </h3>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <a
                    href="https://nextjs.org/docs"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 p-2 rounded-md border text-xs hover:bg-accent transition-colors"
                  >
                    <BookOpen className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="flex-1">
                      {t("settings.about.docs", locale)}
                    </span>
                    <ExternalLink className="w-3 h-3 text-muted-foreground" />
                  </a>
                  <a
                    href="https://github.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 p-2 rounded-md border text-xs hover:bg-accent transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="flex-1">GitHub</span>
                    <ExternalLink className="w-3 h-3 text-muted-foreground" />
                  </a>
                </div>
              </section>

              <Separator />

              <section>
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">
                    {t("settings.about.license", locale)}
                  </h3>
                </div>
                <div className="text-xs text-muted-foreground p-2 rounded-md bg-muted/30">
                  {locale === "ar"
                    ? "ترخيص ملكية — جميع الحقوق محفوظة."
                    : "Proprietary license — all rights reserved."}
                </div>
              </section>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function ThemeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Button
      variant={active ? "default" : "outline"}
      size="sm"
      onClick={onClick}
      className="flex-col h-auto py-2 gap-1"
    >
      {icon}
      <span className="text-[10px]">{label}</span>
    </Button>
  );
}
