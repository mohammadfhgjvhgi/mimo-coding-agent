"use client"

import * as React from "react"
import { Terminal as TerminalIcon, Play, Trash2, Loader2, CheckCircle2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface TerminalLine {
  type: "command" | "stdout" | "stderr" | "result"
  text: string
  timestamp: string
}

export function TerminalPanel() {
  const [lines, setLines] = React.useState<TerminalLine[]>([])
  const [input, setInput] = React.useState("")
  const [running, setRunning] = React.useState(false)
  const [history, setHistory] = React.useState<string[]>([])
  const [historyIdx, setHistoryIdx] = React.useState(-1)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [lines])

  const runCommand = async (cmd: string) => {
    if (!cmd.trim() || running) return
    setRunning(true)
    setHistory(h => [...h, cmd])
    setHistoryIdx(-1)
    setLines(l => [...l, { type: "command", text: cmd, timestamp: new Date().toISOString() }])

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `شغّل هذا الأمر وأخبرني بالنتيجة: ${cmd}`,
          history: [],
          settings: { provider: "zai" },
        }),
      })

      if (!res.ok) {
        setLines(l => [...l, { type: "stderr", text: `HTTP ${res.status}`, timestamp: new Date().toISOString() }])
        return
      }

      // Read SSE stream
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (reader) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let idx: number
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, idx).trim()
          buffer = buffer.slice(idx + 2)
          if (!chunk.startsWith("data:")) continue
          const payload = chunk.slice(5).trim()
          if (payload === "[DONE]") break
          try {
            const json = JSON.parse(payload)
            if (json.type === "delta" && json.delta) {
              setLines(l => {
                const last = l[l.length - 1]
                if (last && last.type === "stdout") {
                  return [...l.slice(0, -1), { ...last, text: last.text + json.delta }]
                }
                return [...l, { type: "stdout", text: json.delta, timestamp: new Date().toISOString() }]
              })
            } else if (json.type === "tool_result") {
              const result = json.result
              if (result && result.name === "run_terminal_command") {
                setLines(l => [...l, { type: "result", text: result.result || "", timestamp: new Date().toISOString() }])
              }
            } else if (json.type === "done") {
              break
            }
          } catch {}
        }
      }

      setLines(l => [...l, { type: "result", text: "✅ اكتمل", timestamp: new Date().toISOString() }])
    } catch (e) {
      setLines(l => [...l, { type: "stderr", text: `خطأ: ${e instanceof Error ? e.message : String(e)}`, timestamp: new Date().toISOString() }])
    } finally {
      setRunning(false)
      setInput("")
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      runCommand(input)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      if (history.length > 0) {
        const newIdx = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1)
        setHistoryIdx(newIdx)
        setInput(history[newIdx])
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      if (historyIdx !== -1) {
        const newIdx = historyIdx + 1
        if (newIdx >= history.length) {
          setHistoryIdx(-1)
          setInput("")
        } else {
          setHistoryIdx(newIdx)
          setInput(history[newIdx])
        }
      }
    }
  }

  const clear = () => setLines([])

  return (
    <div className="flex h-full w-full flex-col bg-[#0d1117] text-zinc-200">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/10">
        <TerminalIcon className="h-3.5 w-3.5 text-emerald-400" />
        <span className="flex-1 text-xs font-medium">الطرفية</span>
        <Button variant="ghost" size="icon" onClick={clear} className="h-6 w-6 rounded hover:bg-white/10">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto chat-scroll p-2 font-mono text-xs space-y-0.5">
        {lines.length === 0 ? (
          <div className="text-zinc-500 text-center py-4">اكتب أمراً للتنفيذ…</div>
        ) : (
          lines.map((line, i) => (
            <div key={i} className={cn(
              "whitespace-pre-wrap break-all",
              line.type === "command" && "text-cyan-400",
              line.type === "stdout" && "text-zinc-300",
              line.type === "stderr" && "text-red-400",
              line.type === "result" && "text-emerald-400",
            )}>
              {line.type === "command" && "$ "}
              {line.text}
            </div>
          ))
        )}
        {running && <div className="text-amber-400 animate-pulse">▋</div>}
      </div>

      <div className="border-t border-white/10 p-2 flex items-center gap-2">
        <span className="text-emerald-400 font-mono text-xs">$</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={running}
          placeholder="اكتب أمراً…"
          className="flex-1 bg-transparent text-xs font-mono text-zinc-200 outline-none placeholder:text-zinc-600"
          dir="ltr"
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => runCommand(input)}
          disabled={running || !input.trim()}
          className="h-6 px-2 text-xs hover:bg-white/10"
        >
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
        </Button>
      </div>
    </div>
  )
}
