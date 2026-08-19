// Token Compression — deterministic token reduction for tool outputs + context.
// 0 LLM calls, pure string transforms, bilingual messages.
//
// Pipeline (applied in order):
//   1. ANSI escape removal      — strip terminal color codes
//   2. Whitespace collapse      — collapse runs of spaces/tabs/newlines
//   3. Line dedup               — collapse runs of identical lines (e.g. git diffs)
//   4. Block dedup (hash)       — collapse runs of identical N-line blocks
//   5. Compact mode (optional)  — verbose log → compact symbol form
//   6. Truncation               — final safety cap (re-uses workspace.truncate)
//
// Compose with the Context OS — drop in front of any tool-result-to-LLM path.

import { truncate } from "@/lib/tools/workspace"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CompressionLevel = "off" | "light" | "standard" | "aggressive"

export interface CompressionOptions {
  level?: CompressionLevel
  /** Hard character cap after compression. Default 12000. */
  maxChars?: number
  /** Enable compact-mode symbol substitution. Default true at standard+. */
  compactMode?: boolean
  /** Minimum run length to trigger line dedup. Default 3. */
  dedupMinRun?: number
  /** Block size for hash dedup. Default 4 lines. */
  dedupBlockSize?: number
  /** Drop ANSI escape codes. Default true. */
  stripAnsi?: boolean
}

export interface CompressionResult {
  original: string
  compressed: string
  originalChars: number
  compressedChars: number
  savedChars: number
  savedPct: number
  /** Estimated token savings (chars / 4 heuristic). */
  savedTokens: number
  /** Per-stage stats, for telemetry. */
  stages: Record<string, { before: number; after: number }>
  durationMs: number
}

// ---------------------------------------------------------------------------
// Stage 1: ANSI escape removal
// ---------------------------------------------------------------------------

// Matches CSI sequences (colors, cursor moves, etc.) + OSC sequences (titles).
const ANSI_RE =
  /\x1B\[[0-9;?]*[ -/]*[@-~]|\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)|\x1B[@-_]|\r/g

export function stripAnsiEscapes(s: string): string {
  return s.replace(ANSI_RE, "")
}

// ---------------------------------------------------------------------------
// Stage 2: Whitespace collapse
// ---------------------------------------------------------------------------

export function collapseWhitespace(s: string): string {
  return s
    .replace(/[ \t]+$/gm, "")      // trailing whitespace per line
    .replace(/^[ \t]+/gm, (m) => (m.length > 4 ? "    " : m))  // cap indent at 4
    .replace(/[ \t]{2,}/g, " ")     // collapse runs of spaces/tabs to one (mid-line)
    .replace(/\n{4,}/g, "\n\n\n")   // collapse 4+ blank lines to 3
    .replace(/[ \t]+\n/g, "\n")    // trim trailing space before newline
}

// ---------------------------------------------------------------------------
// Stage 3: Line dedup — collapse runs of identical lines
// ---------------------------------------------------------------------------

export function dedupConsecutiveLines(s: string, minRun = 3): string {
  const lines = s.split("\n")
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    let j = i + 1
    while (j < lines.length && lines[j] === lines[i]) j++
    const run = j - i
    if (run >= minRun) {
      out.push(lines[i])
      out.push(`…[${run - 1} سطر مكرر / repeated lines]…`)
    } else {
      for (let k = i; k < j; k++) out.push(lines[k])
    }
    i = j
  }
  return out.join("\n")
}

// ---------------------------------------------------------------------------
// Stage 4: Block dedup — collapse runs of identical N-line blocks
// ---------------------------------------------------------------------------

export function dedupBlocks(s: string, blockSize = 4): string {
  if (blockSize < 2) return s
  const lines = s.split("\n")
  if (lines.length < blockSize * 3) return s

  const blockHash = (start: number): string => {
    return lines.slice(start, start + blockSize).join("\n")
  }

  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    if (i + blockSize > lines.length) {
      // tail shorter than block — copy as-is
      out.push(...lines.slice(i))
      break
    }
    const firstBlock = blockHash(i)
    let count = 1
    let j = i + blockSize
    while (j + blockSize <= lines.length && blockHash(j) === firstBlock) {
      count++
      j += blockSize
    }
    if (count >= 3) {
      out.push(...lines.slice(i, i + blockSize))
      out.push(`…[${count - 1} كتل مكررة / repeated blocks ×${count - 1}]…`)
      i = j
    } else {
      out.push(lines[i])
      i++
    }
  }
  return out.join("\n")
}

// ---------------------------------------------------------------------------
// Stage 5: Compact mode — verbose log → compact symbols
// ---------------------------------------------------------------------------

const COMPACT_RULES: Array<{ match: RegExp; replace: string }> = [
  // HTTP request logs: "GET /api/foo 200 12ms" → "→ /api/foo 200"
  { match: /^(?:GET|POST|PUT|DELETE|PATCH)\s+(\S+)\s+(\d{3})\s+\d+ms$/gm, replace: "→ $1 $2" },
  // Build step: "Compiling..." → "…"
  { match: /^Compiling[^\n]*$/gm, replace: "…" },
  // Repeated "✓" lines: collapse
  { match: /^(✓|✗|→)\s+/gm, replace: "$1 " },
  // Stack frames: shorten file paths
  { match: /^\s+at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)$/gm, replace: "  ↳ $1 $2:$3" },
  // TTY progress dots: "...." runs
  { match: /\.{4,}/g, replace: "…" },
  // "Warning: " → "⚠ " (saves chars)
  { match: /\bWarning:\s*/g, replace: "⚠ " },
  // "Error: " stays (semantic), but "ERROR: " → "🚨 "
  { match: /\bERROR:\s*/g, replace: "🚨 " },
  // "Information: " → "ℹ "
  { match: /\bInformation:\s*/g, replace: "ℹ " },
]

export function applyCompactMode(s: string): string {
  let out = s
  for (const rule of COMPACT_RULES) {
    out = out.replace(rule.match, rule.replace)
  }
  return out
}

// ---------------------------------------------------------------------------
// Token estimation (rough heuristic — 1 token ≈ 4 chars)
// ---------------------------------------------------------------------------

export function estimateTokens(s: string): number {
  if (!s) return 0
  // Heuristic: count words + 1.3 per special char run.
  // Good enough for relative comparisons; never use for billing.
  return Math.ceil(s.length / 4)
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

const LEVEL_CONFIG: Record<
  CompressionLevel,
  { stripAnsi: boolean; whitespace: boolean; lineDedup: boolean; blockDedup: boolean; compactMode: boolean; dedupMinRun: number; dedupBlockSize: number }
> = {
  off: { stripAnsi: false, whitespace: false, lineDedup: false, blockDedup: false, compactMode: false, dedupMinRun: 99, dedupBlockSize: 99 },
  light: { stripAnsi: true, whitespace: true, lineDedup: false, blockDedup: false, compactMode: false, dedupMinRun: 99, dedupBlockSize: 99 },
  standard: { stripAnsi: true, whitespace: true, lineDedup: true, blockDedup: false, compactMode: true, dedupMinRun: 3, dedupBlockSize: 4 },
  aggressive: { stripAnsi: true, whitespace: true, lineDedup: true, blockDedup: true, compactMode: true, dedupMinRun: 2, dedupBlockSize: 3 },
}

/**
 * Compress a string deterministically. Returns the compressed string + telemetry.
 *
 * @example
 *   const r = compressToolOutput(gitDiffOutput)
 *   // r.savedPct ~ 0.45 for a typical diff
 */
export function compress(
  input: string,
  opts: CompressionOptions = {}
): CompressionResult {
  const start = Date.now()
  const level = opts.level ?? "standard"
  const cfg = LEVEL_CONFIG[level]
  const maxChars = opts.maxChars ?? 12000
  const stages: Record<string, { before: number; after: number }> = {}

  let s = input
  const original = input
  const originalChars = input.length

  // Stage 1: ANSI
  if ((opts.stripAnsi ?? cfg.stripAnsi)) {
    const before = s.length
    s = stripAnsiEscapes(s)
    stages.ansi = { before, after: s.length }
  }

  // Stage 2: Whitespace
  if (cfg.whitespace) {
    const before = s.length
    s = collapseWhitespace(s)
    stages.whitespace = { before, after: s.length }
  }

  // Stage 3: Line dedup
  if (cfg.lineDedup) {
    const before = s.length
    s = dedupConsecutiveLines(s, opts.dedupMinRun ?? cfg.dedupMinRun)
    stages.line_dedup = { before, after: s.length }
  }

  // Stage 4: Block dedup
  if (cfg.blockDedup) {
    const before = s.length
    s = dedupBlocks(s, opts.dedupBlockSize ?? cfg.dedupBlockSize)
    stages.block_dedup = { before, after: s.length }
  }

  // Stage 5: Compact mode
  if (opts.compactMode ?? cfg.compactMode) {
    const before = s.length
    s = applyCompactMode(s)
    stages.compact_mode = { before, after: s.length }
  }

  // Stage 6: Truncation
  if (s.length > maxChars) {
    const before = s.length
    s = truncate(s, maxChars)
    stages.truncate = { before, after: s.length }
  }

  const compressedChars = s.length
  const savedChars = originalChars - compressedChars
  const savedPct = originalChars > 0 ? Math.round((savedChars / originalChars) * 100) : 0
  const savedTokens = Math.ceil(savedChars / 4)

  return {
    original,
    compressed: s,
    originalChars,
    compressedChars,
    savedChars,
    savedPct,
    savedTokens,
    stages,
    durationMs: Date.now() - start,
  }
}

/**
 * Compress a tool execution result. Convenience wrapper around `compress()`
 * with standard defaults tuned for tool output (git diffs, terminal output,
 * file listings).
 */
export function compressToolOutput(output: string): string {
  return compress(output, { level: "standard" }).compressed
}

/**
 * Compress an LLM conversation message. Uses lighter defaults to preserve
 * semantic content (no compact-mode symbol substitution).
 */
export function compressMessage(content: string): string {
  return compress(content, { level: "light", maxChars: 8000 }).compressed
}

// ---------------------------------------------------------------------------
// Formatter — turn a CompressionResult into a short bilingual header the
// agent can see (so it knows compression happened and how much it saved).
// ---------------------------------------------------------------------------

export function formatCompressionResult(r: CompressionResult): string {
  const stageLines = Object.entries(r.stages)
    .map(([k, v]) => `  ${k}: ${v.before}→${v.after} (-${v.before - v.after})`)
    .join("\n")
  return [
    `🗜️ Token Compression (level: ${r.compressedChars < r.originalChars ? "applied" : "no-op"}, ${r.durationMs}ms)`,
    `  الأصل: ${r.originalChars} محرف / original: ${r.originalChars} chars`,
    `  المضغوط: ${r.compressedChars} محرف / compressed: ${r.compressedChars} chars`,
    `  التوفير: ${r.savedPct}% (~${r.savedTokens} توكن) / saved: ${r.savedPct}% (~${r.savedTokens} tokens)`,
    stageLines,
  ].join("\n")
}
