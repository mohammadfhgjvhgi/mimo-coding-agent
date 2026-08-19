"use client";

import { memo, useState, useEffect, isValidElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface MarkdownProps {
  content: string;
  className?: string;
}

/**
 * Production-grade markdown renderer.
 * - GitHub Flavored Markdown (tables, strikethrough, task lists, autolinks)
 * - Syntax highlighting via highlight.js (rehype-highlight)
 * - Copy button overlay on code blocks
 * - Language badge on code blocks
 * - Streaming-safe (renders partial markdown gracefully)
 *
 * Replaces the previous hand-rolled regex parser which dropped tables,
 * nested lists, blockquotes, headings, and syntax highlighting.
 */
function MarkdownImpl({ content, className }: MarkdownProps) {
  // Force re-render on theme change by tracking document class
  const [isDark, setIsDark] = useState(true);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none break-words",
        // Tighten spacing for chat context
        "prose-p:my-1.5 prose-pre:my-2 prose-ul:my-1.5 prose-ol:my-1.5",
        "prose-li:my-0 prose-headings:mb-1 prose-headings:mt-2",
        "prose-code:before:content-none prose-code:after:content-none",
        // Inline code styling
        "prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:bg-muted prose-code:text-violet-500 dark:prose-code:text-violet-300",
        "prose-code:font-mono prose-code:text-[0.85em]",
        // Code block: override prose-pre to use our custom wrapper
        "prose-pre:bg-transparent prose-pre:p-0 prose-pre:m-0",
        // Links
        "prose-a:text-violet-500 dark:prose-a:text-violet-300 prose-a:underline prose-a:underline-offset-2",
        // Tables
        "prose-table:text-xs prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1",
        "prose-th:bg-muted/50 prose-th:font-semibold",
        // Blockquotes
        "prose-blockquote:border-l-violet-400 prose-blockquote:not-italic prose-blockquote:text-muted-foreground",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          // Custom code block renderer with copy button + language badge
          pre: ({ children }) => {
            // Extract text + language from the child <code> element
            let codeText = "";
            let language = "text";

            if (isValidElement(children)) {
              const childProps = children.props as {
                className?: string;
                children?: React.ReactNode;
              };
              if (childProps.className) {
                const match = /language-(\w+)/.exec(childProps.className);
                if (match) language = match[1];
              }
              if (childProps.children) {
                codeText = extractText(childProps.children);
              }
            }

            return (
              <CodeBlockView code={codeText} lang={language} isDark={isDark}>
                {children}
              </CodeBlockView>
            );
          },
          // Inline code: keep default prose styling (already styled via className above)
          code: ({ className: codeClassName, children, ...props }) => {
            // Block code is handled by pre renderer above
            const isInline = !codeClassName?.includes("language-");
            if (!isInline) {
              return (
                <code className={codeClassName} {...props}>
                  {children}
                </code>
              );
            }
            return <code className={codeClassName} {...props}>{children}</code>;
          },
          // Links: open in new tab safely
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          // Tables: wrap in overflow-x-auto for mobile
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** Recursively extract text content from React children (for copy button). */
function extractText(node: React.ReactNode): string {
  if (node == null || node === false) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    return extractText(props.children);
  }
  return "";
}

function CodeBlockView({
  code,
  lang,
  isDark: _isDark,
  children,
}: {
  code: string;
  lang: string;
  isDark: boolean;
  children: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  const copy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="relative group my-2 rounded-lg overflow-hidden border border-border bg-zinc-950">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-border">
        <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
          {lang}
        </span>
        <button
          onClick={copy}
          className="text-[10px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1 transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3" />
              copied
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              copy
            </>
          )}
        </button>
      </div>
      {/* highlight.js themed pre — rehype-highlight adds <code class="hljs language-x"> */}
      <div className="hljs-container overflow-x-auto text-xs leading-relaxed">
        {/* Render the highlighted children from rehype-highlight */}
        <pre className="p-3 m-0 bg-zinc-950!">{children}</pre>
      </div>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
