"use client";

import { useState, useEffect, useRef } from "react";
import { useMimo } from "@/lib/mimo-store";
import { Badge } from "@/components/ui/badge";
import {
  Eye,
  RefreshCw,
  ExternalLink,
  Code2,
  Monitor,
  Smartphone,
  Tablet,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ViewMode = "preview" | "code";
type Device = "desktop" | "tablet" | "mobile";

const DEVICE_WIDTHS: Record<Device, string> = {
  desktop: "100%",
  tablet: "768px",
  mobile: "375px",
};

export function PreviewPanel() {
  const { locale, activePreview } = useMimo();
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [device, setDevice] = useState<Device>("desktop");
  const [artifactContent, setArtifactContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Derive preview URL from store state directly (no duplication)
  const previewUrl = activePreview?.url ?? null;
  const artifactName = activePreview?.name ?? "Preview";

  // Load artifact content when preview changes
  useEffect(() => {
    if (!activePreview?.artifactId) return;
    let cancelled = false;
    fetch(`/api/preview/${activePreview.artifactId}`)
      .then((r) => r.text())
      .then((text) => {
        if (!cancelled) setArtifactContent(text);
      })
      .catch(() => {
        if (!cancelled) setArtifactContent(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activePreview?.artifactId]);

  const refresh = () => {
    if (iframeRef.current && previewUrl) {
      iframeRef.current.src = previewUrl + "?t=" + Date.now();
    }
  };

  const openExternal = () => {
    if (previewUrl) {
      window.open(previewUrl, "_blank");
    }
  };

  if (!previewUrl) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        <Eye className="w-8 h-8 mx-auto mb-2 opacity-50" />
        {locale === "ar"
          ? "لا معاينة بعد. اطلب من MiMo إنشاء ملف HTML لرؤيته هنا."
          : "No preview yet. Ask MiMo to create an HTML file to see it here."}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="border-b px-3 py-2 flex items-center justify-between gap-2 bg-card/30">
        <div className="flex items-center gap-2 min-w-0">
          <Eye className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
          <span className="text-xs font-semibold truncate">{artifactName}</span>
          <Badge variant="outline" className="text-[9px] py-0 flex-shrink-0">
            LIVE
          </Badge>
        </div>

        <div className="flex items-center gap-1">
          {/* View mode toggle */}
          <button
            onClick={() => setViewMode("preview")}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              viewMode === "preview"
                ? "bg-violet-500 text-white"
                : "text-muted-foreground hover:bg-muted/50"
            )}
            title="Preview"
          >
            <Eye className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setViewMode("code")}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              viewMode === "code"
                ? "bg-violet-500 text-white"
                : "text-muted-foreground hover:bg-muted/50"
            )}
            title="Code"
          >
            <Code2 className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 bg-border mx-1" />

          {/* Device toggles */}
          {viewMode === "preview" && (
            <>
              <button
                onClick={() => setDevice("desktop")}
                className={cn(
                  "p-1.5 rounded-md transition-colors",
                  device === "desktop"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50"
                )}
                title="Desktop"
              >
                <Monitor className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setDevice("tablet")}
                className={cn(
                  "p-1.5 rounded-md transition-colors",
                  device === "tablet"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50"
                )}
                title="Tablet"
              >
                <Tablet className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setDevice("mobile")}
                className={cn(
                  "p-1.5 rounded-md transition-colors",
                  device === "mobile"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50"
                )}
                title="Mobile"
              >
                <Smartphone className="w-3.5 h-3.5" />
              </button>

              <div className="w-px h-4 bg-border mx-1" />
            </>
          )}

          {/* Refresh */}
          <button
            onClick={refresh}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-muted/50 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          {/* Open external */}
          <button
            onClick={openExternal}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-muted/50 transition-colors"
            title="Open in new tab"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden bg-zinc-950">
        {viewMode === "preview" ? (
          <div className="w-full h-full flex justify-center items-start overflow-auto p-2">
            <div
              style={{ width: DEVICE_WIDTHS[device], maxWidth: "100%", height: "100%" }}
              className="bg-white rounded-md overflow-hidden border border-border"
            >
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/50 z-10">
                  <RefreshCw className="w-5 h-5 text-violet-500 animate-spin" />
                </div>
              )}
              <iframe
                ref={iframeRef}
                src={previewUrl}
                className="w-full h-full border-0"
                sandbox="allow-scripts"
                onLoad={() => setIsLoading(false)}
                title="Preview"
              />
            </div>
          </div>
        ) : (
          <div className="w-full h-full overflow-auto p-3">
            <pre className="text-xs font-mono text-zinc-100 whitespace-pre-wrap">
              {artifactContent ?? "Loading code..."}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
