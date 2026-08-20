"use client"

import * as React from "react"
import { File, Save, X, FileCode2, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useChatStore } from "@/store/chat-store"

// Code Editor panel — lightweight file editor with syntax highlighting hints.
// Uses a textarea with monospace font + line numbers overlay (no heavy Monaco
// dependency — keeps the bundle small and works on the sandbox i7).
// Files are read/written via /api/tools (read_file/write_file tools).

interface EditorTab {
  path: string
  content: string
  original: string
  dirty: boolean
}

export function CodeEditorPanel() {
  const [tabs, setTabs] = React.useState<EditorTab[]>([])
  const [activeTab, setActiveTab] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const activeFile = useChatStore((s) => s.activeFile)

  // Open a file when activeFile changes (from workspace explorer clicks)
  React.useEffect(() => {
    if (!activeFile) return
    // Check if already open
    const existing = tabs.findIndex((t) => t.path === activeFile)
    if (existing >= 0) {
      setActiveTab(existing)
      return
    }
    openFile(activeFile)
  }, [activeFile])

  const openFile = async (filePath: string) => {
    setLoading(true)
    try {
      const res = await fetch("/api/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "execute", tool: "read_file", args: { path: filePath } }),
      })
      const data = await res.json()
      const content = data.result?.result || data.result || ""
      // Strip the "[UNTRUSTED DATA]" wrapper if present
      const clean = typeof content === "string" ? content.replace(/^\[UNTRUSTED DATA[^\]]*\]\n?/, "").replace(/\[\/UNTRUSTED DATA\]$/, "").trim() : String(content)
      const newTab: EditorTab = { path: filePath, content: clean, original: clean, dirty: false }
      setTabs((prev) => [...prev, newTab])
      setActiveTab(tabs.length)
    } catch (e) {
      // best-effort
    } finally {
      setLoading(false)
    }
  }

  const saveFile = async () => {
    const tab = tabs[activeTab]
    if (!tab) return
    setSaving(true)
    try {
      const res = await fetch("/api/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "execute", tool: "write_file", args: { path: tab.path, content: tab.content } }),
      })
      if (res.ok) {
        setTabs((prev) => prev.map((t, i) => i === activeTab ? { ...t, original: t.content, dirty: false } : t))
      }
    } catch {} finally {
      setSaving(false)
    }
  }

  const closeTab = (idx: number) => {
    setTabs((prev) => prev.filter((_, i) => i !== idx))
    if (activeTab >= idx && activeTab > 0) setActiveTab(activeTab - 1)
  }

  const updateContent = (content: string) => {
    setTabs((prev) => prev.map((t, i) => i === activeTab ? { ...t, content, dirty: content !== t.original } : t))
  }

  const current = tabs[activeTab]
  const lines = current ? current.content.split("\n") : []

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border bg-muted/30 px-2 py-1 overflow-x-auto chat-scroll">
        {tabs.length === 0 && (
          <span className="px-2 text-xs text-muted-foreground">
            لا ملفات مفتوحة — افتح ملف من مستكشف الملفات
          </span>
        )}
        {tabs.map((tab, idx) => (
          <div
            key={idx}
            onClick={() => setActiveTab(idx)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs cursor-pointer transition",
              idx === activeTab ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.path.endsWith(".js") || tab.path.endsWith(".ts") || tab.path.endsWith(".tsx") ? (
              <FileCode2 className="h-3 w-3 text-blue-500" />
            ) : (
              <FileText className="h-3 w-3 text-amber-500" />
            )}
            <span className="max-w-32 truncate">{tab.path.split("/").pop()}</span>
            {tab.dirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
            <button
              onClick={(e) => { e.stopPropagation(); closeTab(idx) }}
              className="ml-1 rounded p-0.5 hover:bg-accent"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      {current && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
          <span className="text-[0.65rem] text-muted-foreground truncate flex-1">{current.path}</span>
          {current.dirty && <span className="text-[0.65rem] text-amber-500">غير محفوظ</span>}
          <Button size="sm" variant="ghost" onClick={saveFile} disabled={saving || !current.dirty} className="h-7 text-xs">
            <Save className="h-3 w-3" />
            حفظ
          </Button>
        </div>
      )}

      {/* Editor area */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {loading ? (
          <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
            جارٍ التحميل…
          </div>
        ) : current ? (
          <div className="flex flex-1 overflow-hidden font-mono text-xs">
            {/* Line numbers */}
            <div className="select-none bg-muted/30 px-2 py-2 text-right text-muted-foreground/50 border-l border-border overflow-hidden">
              {lines.map((_, i) => (
                <div key={i} className="leading-5">{i + 1}</div>
              ))}
            </div>
            {/* Textarea */}
            <Textarea
              value={current.content}
              onChange={(e) => updateContent(e.target.value)}
              className="flex-1 resize-none rounded-none border-0 font-mono text-xs leading-5 focus-visible:ring-0"
              style={{ minHeight: "100%", tabSize: 2 }}
              spellCheck={false}
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center text-muted-foreground">
              <File className="mx-auto mb-2 h-8 w-8 opacity-50" />
              <p className="text-xs">محرر الكود</p>
              <p className="text-[0.65rem] mt-1">Code Editor</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
