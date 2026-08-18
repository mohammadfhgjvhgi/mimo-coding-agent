"use client"

import * as React from "react"
import {
  Cpu,
  Cloud,
  RefreshCw,
  Server,
  Loader2,
  CheckCircle2,
  XCircle,
  Brain,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/store/settings-store"
import type { ProviderKind } from "@/lib/llm-provider"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
}

interface OllamaModel {
  name: string
  size?: number
  family?: string
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const s = useSettingsStore()
  const [ollamaUrl, setOllamaUrl] = React.useState(s.ollamaUrl)
  const [probeState, setProbeState] = React.useState<"idle" | "loading" | "ok" | "fail">("idle")
  const [models, setModels] = React.useState<OllamaModel[]>([])
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!s.loaded) s.load()
  }, [s])

  React.useEffect(() => {
    setOllamaUrl(s.ollamaUrl)
  }, [s.ollamaUrl])

  const probe = React.useCallback(async (url: string) => {
    setProbeState("loading")
    setErrorMsg(null)
    try {
      const res = await fetch(`/api/providers?ollamaUrl=${encodeURIComponent(url)}`)
      const data = await res.json()
      if (data.reachable) {
        setProbeState("ok")
        setModels(data.models || [])
      } else {
        setProbeState("fail")
        setModels([])
        setErrorMsg("تعذر الوصول إلى Ollama على هذا العنوان. تأكد من تشغيل `ollama serve` محلياً.")
      }
    } catch (e) {
      setProbeState("fail")
      setModels([])
      setErrorMsg((e as Error).message)
    }
  }, [])

  // Auto-probe when opening with Ollama selected
  React.useEffect(() => {
    if (open && s.provider === "ollama" && probeState === "idle") {
      probe(ollamaUrl)
    }
    if (!open) {
      setProbeState("idle")
      setModels([])
      setErrorMsg(null)
    }

  }, [open])

  const handleProviderChange = (p: ProviderKind) => {
    s.setProvider(p)
    if (p === "ollama") {
      setProbeState("idle")
      setTimeout(() => probe(ollamaUrl), 50)
    } else {
      setProbeState("idle")
      setModels([])
    }
  }

  const modelOptions: OllamaModel[] = React.useMemo(() => {
    const base = models.length
      ? models
      : [
          { name: "llama3.2" },
          { name: "llama3.1:8b" },
          { name: "qwen2.5:3b" },
          { name: "qwen2.5:7b" },
          { name: "phi3:mini" },
          { name: "mistral:7b" },
          { name: "gemma2:2b" },
        ]
    // Ensure the currently-selected model is always present and unique
    const current = s.ollamaModel || "llama3.2"
    if (!base.find((m) => m.name === current)) {
      base.unshift({ name: current })
    }
    return base
  }, [models, s.ollamaModel])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-4 w-4" /> إعدادات مزود الذكاء الاصطناعي
          </DialogTitle>
          <DialogDescription>
            اختر مصدر النماذج: تشغيل محلي عبر Ollama أو خدمة Z.ai السحابية.
          </DialogDescription>
        </DialogHeader>

        {/* Provider tabs */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => handleProviderChange("ollama")}
            className={cn(
              "flex flex-col items-start gap-1 rounded-xl border p-3 text-right transition",
              s.provider === "ollama"
                ? "border-primary bg-accent"
                : "border-border hover:bg-accent/50"
            )}
          >
            <div className="flex w-full items-center justify-between">
              <Cpu className="h-4 w-4 text-emerald-500" />
              {s.provider === "ollama" && <Badge variant="secondary" className="text-[0.65rem]">مُفعّل</Badge>}
            </div>
            <span className="text-sm font-semibold">Ollama محلي</span>
            <span className="text-[0.7rem] text-muted-foreground">يعمل دون إنترنت على عتادك</span>
          </button>

          <button
            onClick={() => handleProviderChange("zai")}
            className={cn(
              "flex flex-col items-start gap-1 rounded-xl border p-3 text-right transition",
              s.provider === "zai"
                ? "border-primary bg-accent"
                : "border-border hover:bg-accent/50"
            )}
          >
            <div className="flex w-full items-center justify-between">
              <Cloud className="h-4 w-4 text-cyan-500" />
              {s.provider === "zai" && <Badge variant="secondary" className="text-[0.65rem]">مُفعّل</Badge>}
            </div>
            <span className="text-sm font-semibold">Z.ai سحابي</span>
            <span className="text-[0.7rem] text-muted-foreground">جاهز فوراً، نماذج قوية</span>
          </button>
        </div>

        {/* Ollama config */}
        {s.provider === "ollama" && (
          <div className="space-y-3 rounded-xl border border-border p-3">
            <div className="space-y-1.5">
              <Label htmlFor="ollama-url" className="text-xs">عنوان خادم Ollama</Label>
              <div className="flex gap-2">
                <Input
                  id="ollama-url"
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  onBlur={() => {
                    s.setOllamaUrl(ollamaUrl)
                    probe(ollamaUrl)
                  }}
                  placeholder="http://localhost:11434"
                  className="text-sm"
                  dir="ltr"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    s.setOllamaUrl(ollamaUrl)
                    probe(ollamaUrl)
                  }}
                  title="فحص الاتصال"
                >
                  <RefreshCw className={cn("h-4 w-4", probeState === "loading" && "animate-spin")} />
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs">
              {probeState === "loading" && (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
                  <span className="text-muted-foreground">جارٍ الفحص…</span>
                </>
              )}
              {probeState === "ok" && (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400">متصل · {models.length} نموذج متاح</span>
                </>
              )}
              {probeState === "fail" && (
                <>
                  <XCircle className="h-3.5 w-3.5 text-destructive" />
                  <span className="text-destructive">غير متصل</span>
                </>
              )}
            </div>

            {errorMsg && (
              <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-[0.7rem] text-destructive">
                {errorMsg}
              </p>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">النموذج</Label>
              <Select
                value={s.ollamaModel}
                onValueChange={(v) => s.setOllamaModel(v)}
              >
                <SelectTrigger className="text-sm" dir="ltr">
                  <SelectValue placeholder="اختر نموذجاً" />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((m) => (
                    <SelectItem key={m.name} value={m.name} dir="ltr">
                      <span className="flex items-center justify-between gap-2">
                        <span>{m.name}</span>
                        {m.size ? (
                          <span className="text-[0.65rem] text-muted-foreground">
                            {(m.size / 1e9).toFixed(1)}GB
                          </span>
                        ) : null}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[0.7rem] text-muted-foreground">
                نصيحة: للـ i7-3770 / 12GB RAM جرّب نماذج صغيرة مثل <code className="rounded bg-muted px-1">gemma2:2b</code> أو <code className="rounded bg-muted px-1">qwen2.5:3b</code>.
              </p>
            </div>
          </div>
        )}

        {/* Z.ai config */}
        {s.provider === "zai" && (
          <div className="space-y-3 rounded-xl border border-border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <Label className="flex items-center gap-1.5 text-xs">
                  <Brain className="h-3.5 w-3.5 text-amber-500" />
                  تفعيل التفكير المتسلسل (Chain of Thought)
                </Label>
                <p className="mt-0.5 text-[0.7rem] text-muted-foreground">
                  يحسّن جودة الاستدلال مقابل استهلاك وقت أطول.
                </p>
              </div>
              <Switch
                checked={s.zaiThinking}
                onCheckedChange={(v) => s.setZaiThinking(v)}
              />
            </div>
            <p className="rounded-md bg-muted/60 px-2.5 py-1.5 text-[0.7rem] text-muted-foreground">
              خدمة Z.ai جاهزة فوراً في هذه البيئة دون أي إعداد. بدّل إلى Ollama لتشغيل نماذج محلية على جهازك.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>تم</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
