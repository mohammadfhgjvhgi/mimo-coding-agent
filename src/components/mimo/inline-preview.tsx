"use client";

import { useState, useRef, useEffect } from "react";
import { Eye, RefreshCw, ExternalLink, Code2, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { getLanguage } from "@/lib/file-utils";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import ReactMarkdown from "react-markdown";

interface InlinePreviewProps {
  url: string;
  name?: string;
  maxHeight?: string;
  format?: string; // html | markdown | json | code | svg
}

function detectFormat(name?: string, url?: string): "html" | "markdown" | "json" | "code" | "svg" | "text" {
  const n = (name ?? url ?? "").toLowerCase();
  if (n.endsWith(".html") || n.endsWith(".htm")) return "html";
  if (n.endsWith(".md") || n.endsWith(".markdown")) return "markdown";
  if (n.endsWith(".json")) return "json";
  if (n.endsWith(".svg")) return "svg";
  if (n.endsWith(".ts") || n.endsWith(".tsx") || n.endsWith(".js") || n.endsWith(".jsx") ||
      n.endsWith(".py") || n.endsWith(".css") || n.endsWith(".sql") || n.endsWith(".prisma")) return "code";
  return "text";
}

// P-fix: getLanguage now imported from @/lib/file-utils

function JsonViewer({ data }: { data: string }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return (
      <pre className="p-3 text-xs font-mono text-rose-400 whitespace-pre-wrap">
        Invalid JSON: {data.slice(0, 200)}
      </pre>
    );
  }
  return (
    <pre className="p-3 text-xs font-mono text-zinc-100 whitespace-pre-wrap">
      {JSON.stringify(parsed, null, 2)}
    </pre>
  );
}

export function InlinePreview({ url, name, maxHeight = "400px", format }: InlinePreviewProps) {
  const [expanded, setExpanded] = useState(true);
  const [showCode, setShowCode] = useState(false);
  const [codeContent, setCodeContent] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const detectedFormat = format ?? detectFormat(name, url);
  const isHtml = detectedFormat === "html";
  const isMarkdown = detectedFormat === "markdown";
  const isJson = detectedFormat === "json";
  const isCode = detectedFormat === "code" || detectedFormat === "text";
  const isSvg = detectedFormat === "svg";

  const refresh = () => {
    setReloadKey((k) => k + 1);
    setCodeContent(null);
  };

  const openExternal = () => window.open(url, "_blank");

  const loadContent = async () => {
    try {
      const res = await fetch(url);
      setCodeContent(await res.text());
    } catch {
      setCodeContent("Failed to load content");
    }
  };

  useEffect(() => {
    if (isMarkdown || isJson || isCode) {
      // Load content asynchronously (not synchronous setState in effect)
      let cancelled = false;
      const doLoad = async () => {
        try {
          const res = await fetch(url);
          const text = await res.text();
          if (!cancelled) setCodeContent(text);
        } catch {
          if (!cancelled) setCodeContent("Failed to load content");
        }
      };
      doLoad();
      return () => { cancelled = true; };
    }
  }, [isMarkdown, isJson, isCode, reloadKey, url]);

  const toggleCode = async () => {
    if (!showCode && !codeContent) {
      await loadContent();
    }
    setShowCode(!showCode);
  };

  return (
    <div className="mt-3 rounded-lg overflow-hidden border border-violet-500/30 bg-zinc-950">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-zinc-800">
        <div className="flex items-center gap-1.5 min-w-0">
          <Eye className="w-3 h-3 text-violet-400 flex-shrink-0" />
          <span className="text-[11px] font-mono text-zinc-400 truncate">
            {name ?? "Preview"}
          </span>
          <span className="text-[9px] px-1 py-0.5 rounded bg-violet-500/20 text-violet-400 font-semibold flex-shrink-0">
            {detectedFormat.toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {(isHtml || isSvg) && (
            <button
              onClick={toggleCode}
              className={cn(
                "p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors",
                showCode && "bg-zinc-800 text-violet-400"
              )}
              title="Toggle code view"
            >
              <Code2 className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={refresh}
            className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
          <button
            onClick={openExternal}
            className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
            title="Open in new tab"
          >
            <ExternalLink className="w-3 h-3" />
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
            title={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Content */}
      {expanded && (
        <div style={{ maxHeight }} className="overflow-auto">
          {/* HTML / SVG — iframe or code toggle */}
          {(isHtml || isSvg) && (
            <>
              {showCode ? (
                <pre className="p-3 text-xs font-mono text-zinc-100 whitespace-pre-wrap">
                  {codeContent ?? "Loading..."}
                </pre>
              ) : (
                <iframe
                  key={reloadKey}
                  ref={iframeRef}
                  src={url}
                  className="w-full border-0 bg-white"
                  style={{ height: maxHeight, minHeight: "200px" }}
                  sandbox="allow-scripts"
                  title="Preview"
                />
              )}
            </>
          )}

          {/* Markdown — rendered */}
          {isMarkdown && (
            <div className="p-4 prose prose-invert prose-sm max-w-none text-zinc-100">
              {codeContent ? (
                <ReactMarkdown>{codeContent}</ReactMarkdown>
              ) : (
                <span className="text-zinc-500">Loading...</span>
              )}
            </div>
          )}

          {/* JSON — structured view */}
          {isJson && (
            codeContent ? <JsonViewer data={codeContent} /> : <span className="text-zinc-500 p-3">Loading...</span>
          )}

          {/* Code — syntax highlighted */}
          {isCode && codeContent && (
            <SyntaxHighlighter
              language={getLanguage(name ?? "")}
              style={oneDark}
              customStyle={{
                margin: 0,
                padding: "12px",
                fontSize: "12px",
                background: "transparent",
              }}
              wrapLongLines
            >
              {codeContent}
            </SyntaxHighlighter>
          )}
        </div>
      )}
    </div>
  );
}
