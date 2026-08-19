// Structured Logger — adapted from my-nextjs-project.

type LogLevel = "info" | "warn" | "error" | "debug"

interface LogEntry {
  level: LogLevel
  msg: string
  ctx?: Record<string, unknown>
  ts: number
}

const entries: LogEntry[] = []
const MAX_ENTRIES = 500

function log(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
  const entry: LogEntry = { level, msg, ctx, ts: Date.now() }
  entries.unshift(entry)
  if (entries.length > MAX_ENTRIES) entries.pop()
  if (process.env.NODE_ENV !== "production") {
    const prefix = `[${level.toUpperCase()}]`
    console.log(prefix, msg, ctx ? JSON.stringify(ctx) : "")
  }
}

export const logger = {
  info: (msg: string, ctx?: Record<string, unknown>) => log("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => log("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => log("error", msg, ctx),
  debug: (msg: string, ctx?: Record<string, unknown>) => log("debug", msg, ctx),
  getEntries: () => [...entries],
  clear: () => { entries.length = 0 },
}
