// Git Intelligence — comprehensive, deterministic git introspection & control.
// 0 LLM calls. Bilingual messages (Arabic + English).
//
// 12 operations:
//   1.  getGitStatus()       — porcelain v2 structured status
//   2.  getGitDiff(opts)     — diff with numstat + patch
//   3.  getGitHistory(opts)  — log with numstat per commit
//   4.  getGitBlame(path)    — line-porcelain blame
//   5.  listBranches(opts)   — branch list + for-each-ref last-commit
//   6.  getCheckpoints()     — re-exports self-repair checkpoints + git tags
//   7.  listWorktrees()      — worktree list + create/remove helpers
//   8.  generateCommit(opts) — deterministic conventional-commits message
//   9.  explainCommit(hash) — deterministic commit explanation
//   10. getChangeSummary()   — top-level uncommitted state summary
//   11. rollback(opts)       — safe rollback wrapping recovery/manager
//   12. safeRestore(opts)    — stash | checkpoint | branch restore modes
//
// Plus:
//   • analyzeGitState()       — orchestrator (status + summary + branches + head)
//   • formatGitIntelligence() — bilingual formatter for any result
//
// Composes with the existing recovery stack:
//   - @/lib/recovery/manager  → rollbackToCheckpoint
//   - @/lib/recovery/self-repair → saveCheckpoint, listCheckpoints

import { exec } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"
import { rollbackToCheckpoint } from "@/lib/recovery/manager"
import {
  saveCheckpoint,
  listCheckpoints,
  type Checkpoint,
} from "@/lib/recovery/self-repair"

const execAsync = promisify(exec)

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const ROOT = () => path.resolve(WORKSPACE_ROOT)
const DEFAULT_TIMEOUT = 10_000
const LONG_TIMEOUT = 30_000

/** Shell-quote a single argument — used for branch names, messages, paths. */
function shellescape(s: string): string {
  if (s === "") return "''"
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

/** Run a git command with cwd=workspace root + timeout + try/catch. */
async function git(
  args: string,
  timeout = DEFAULT_TIMEOUT
): Promise<{ ok: true; stdout: string; stderr: string } | { ok: false; error: string }> {
  try {
    const { stdout, stderr } = await execAsync(`git ${args}`, {
      cwd: ROOT(),
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    })
    return { ok: true, stdout, stderr }
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string }
    const msg = err.stderr?.trim() || err.message || "git command failed"
    return { ok: false, error: msg }
  }
}

/** Bilingual structured error used by all 12 ops on hard failure. */
export interface GitError {
  ok: false
  operation: string
  reason: string
  stderr?: string
}

// ---------------------------------------------------------------------------
// 1. getGitStatus
// ---------------------------------------------------------------------------

export interface FileChange {
  path: string
  oldPath?: string
  /** Staged "XY" code from porcelain v2 (e.g. "M ", "A ", "R " etc.) */
  x: string
  y: string
  /** Normalized change kind. */
  kind: "added" | "modified" | "deleted" | "renamed" | "copied" | "unmerged" | "unknown"
}

export interface GitStatus {
  ok: true
  operation: "getGitStatus"
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  staged: FileChange[]
  unstaged: FileChange[]
  untracked: string[]
  detached: boolean
  /** Bilingual headline. */
  message: string
}

/**
 * 1. getGitStatus — `git status --porcelain=v2 --branch` parsed into a
 * structured object: branch, upstream, ahead/behind, staged/unstaged/untracked.
 */
export async function getGitStatus(): Promise<GitStatus | GitError> {
  const r = await git("status --porcelain=v2 --branch")
  if (!r.ok) {
    return {
      ok: false,
      operation: "getGitStatus",
      reason: `فشل قراءة حالة git / failed to read git status`,
      stderr: r.error,
    }
  }

  let branch: string | null = null
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  let detached = false
  const staged: FileChange[] = []
  const unstaged: FileChange[] = []
  const untracked: string[] = []

  for (const raw of r.stdout.split("\n")) {
    const line = raw.replace(/\r$/, "")
    if (!line) continue
    if (line.startsWith("# branch.head")) {
      const v = line.split("\t")[1]?.trim() || ""
      if (v === "(detached)") {
        detached = true
        branch = null
      } else {
        branch = v || null
      }
      continue
    }
    if (line.startsWith("# branch.upstream")) {
      upstream = line.split("\t")[1]?.trim() || null
      continue
    }
    if (line.startsWith("# branch.ab")) {
      const m = line.match(/\+(\d+) -(\d+)/)
      if (m) {
        ahead = parseInt(m[1]!, 10)
        behind = parseInt(m[2]!, 10)
      }
      continue
    }
    if (line.startsWith("#")) continue
    // Change line: "1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>"
    // All fields are space-separated (path is fields 8+ joined).
    if (line.startsWith("1 ")) {
      const tokens = line.split(" ")
      // tokens[0]="1", [1]=XY, [2]=sub, [3..7]=mH mI mW hH hI, [8..]=path
      const xy = tokens[1] || "  "
      const x = xy[0] || "."
      const y = xy[1] || "."
      const rest = tokens.slice(8).join(" ")
      let p = rest
      let oldPath: string | undefined
      const arrow = rest.indexOf(" -> ")
      if (arrow >= 0) {
        oldPath = rest.slice(0, arrow)
        p = rest.slice(arrow + 4)
      }
      const kind = classifyChange(x, y)
      const fc: FileChange = { path: p, x, y, kind }
      if (oldPath) fc.oldPath = oldPath
      if (x !== "." && x !== " ") staged.push(fc)
      if (y !== "." && y !== " ") unstaged.push(fc)
      continue
    }
    if (line.startsWith("2 ")) {
      // Rename/copy: "2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>\t<origPath>"
      // Split on tab to separate path from origPath, then space-split the left side.
      const tabIdx = line.indexOf("\t")
      const leftSide = tabIdx >= 0 ? line.slice(0, tabIdx) : line
      const oldPath = tabIdx >= 0 ? line.slice(tabIdx + 1) : undefined
      const tokens = leftSide.split(" ")
      const xy = tokens[1] || "  "
      const x = xy[0] || "."
      const y = xy[1] || "."
      const p = tokens.slice(8).join(" ")
      const kind = classifyChange(x, y)
      const fc: FileChange = { path: p, x, y, kind, oldPath }
      if (x !== "." && x !== " ") staged.push(fc)
      if (y !== "." && y !== " ") unstaged.push(fc)
      continue
    }
    if (line.startsWith("u ")) continue // unmerged — skip for now
    if (line.startsWith("? ")) {
      untracked.push(line.slice(2).trim())
      continue
    }
  }

  const dirty =
    staged.length + unstaged.length + untracked.length > 0
  const message = dirty
    ? `📊 حالة git: ${staged.length} مُرقَّم، ${unstaged.length} غير مُرقَّم، ${untracked.length} غير متتبَّع / staged ${staged.length}, unstaged ${unstaged.length}, untracked ${untracked.length}`
    : `✅ شجرة git نظيفة / clean working tree${branch ? ` (${branch})` : ""}`

  return {
    ok: true,
    operation: "getGitStatus",
    branch,
    upstream,
    ahead,
    behind,
    staged,
    unstaged,
    untracked,
    detached,
    message,
  }
}

function classifyChange(x: string, y: string): FileChange["kind"] {
  const xy = (x + y).toUpperCase()
  if (xy.includes("R")) return "renamed"
  if (xy.includes("C")) return "copied"
  if (xy.includes("A")) return "added"
  if (xy.includes("D")) return "deleted"
  if (xy.includes("U")) return "unmerged"
  if (xy.includes("M") || xy.includes("T")) return "modified"
  return "unknown"
}

// ---------------------------------------------------------------------------
// 2. getGitDiff
// ---------------------------------------------------------------------------

export interface DiffFile {
  path: string
  oldPath?: string
  additions: number
  deletions: number
  /** From --name-status if available (A/M/D/R/C). */
  status?: string
}

export interface GitDiff {
  ok: true
  operation: "getGitDiff"
  files: DiffFile[]
  totalAdditions: number
  totalDeletions: number
  patch: string
  truncated: boolean
  message: string
}

export interface GitDiffOptions {
  /** Compare against a ref (e.g. "HEAD", "HEAD~3", "main"). Defaults to working tree. */
  ref?: string
  /** Staged (--cached). */
  cached?: boolean
  /** Restrict to specific paths. */
  paths?: string[]
  /** Return only --stat (no patch body). */
  stat?: boolean
}

/**
 * 2. getGitDiff — `git diff` with `--numstat` for additions/deletions per file,
 * plus an optional unified patch body.
 */
export async function getGitDiff(
  opts: GitDiffOptions = {}
): Promise<GitDiff | GitError> {
  const flags: string[] = []
  if (opts.cached) flags.push("--cached")
  if (opts.ref) flags.push(shellescape(opts.ref))
  if (opts.stat) flags.push("--stat")
  flags.push("--numstat")

  let pathArg = ""
  if (opts.paths && opts.paths.length > 0) {
    pathArg = " -- " + opts.paths.map((p) => shellescape(p)).join(" ")
  }

  // numstat run
  const numstatArgs = `${flags.filter((f) => f !== "--stat").join(" ")}${pathArg}`
  const ns = await git(`diff ${numstatArgs}`)
  if (!ns.ok) {
    return {
      ok: false,
      operation: "getGitDiff",
      reason: `فشل جلب الفروقات / failed to fetch diff`,
      stderr: ns.error,
    }
  }

  const files: DiffFile[] = []
  let totalAdditions = 0
  let totalDeletions = 0
  for (const raw of ns.stdout.split("\n")) {
    const line = raw.replace(/\r$/, "")
    if (!line) continue
    // numstat: "<add>\t<del>\t<path>"
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/)
    if (!m) continue
    const add = m[1] === "-" ? 0 : parseInt(m[1]!, 10)
    const del = m[2] === "-" ? 0 : parseInt(m[2]!, 10)
    let p = m[3]!
    let oldPath: string | undefined
    const arrow = p.indexOf(" => ")
    if (arrow >= 0) {
      oldPath = p.slice(0, arrow)
      p = p.slice(arrow + 4)
    }
    // Strip surrounding braces from {old => new} form
    p = p.replace(/^\{[^}]*=>\s*/, "").replace(/\}$/, "")
    files.push({ path: p, additions: add, deletions: del, oldPath })
    totalAdditions += add
    totalDeletions += del
  }

  // Optional --name-status for A/M/D/R detection
  const nsFlags: string[] = []
  if (opts.cached) nsFlags.push("--cached")
  if (opts.ref) nsFlags.push(shellescape(opts.ref))
  const nameStatusArgs = `${nsFlags.join(" ")} --name-status${pathArg}`
  const nst = await git(`diff ${nameStatusArgs}`)
  if (nst.ok) {
    const map = new Map<string, string>()
    for (const raw of nst.stdout.split("\n")) {
      const line = raw.replace(/\r$/, "")
      if (!line) continue
      const sep = line.indexOf("\t")
      if (sep < 0) continue
      const code = line.slice(0, sep)
      const rest = line.slice(sep + 1)
      // R100\told -> new  (porcelain rename form not used by default)
      const p = rest.split("\t").pop() || rest
      map.set(p, code[0] || "M")
    }
    for (const f of files) {
      f.status = map.get(f.path) || f.status
    }
  }

  // Patch body (unless stat-only)
  let patch = ""
  let truncated = false
  if (!opts.stat) {
    const patchFlags: string[] = []
    if (opts.cached) patchFlags.push("--cached")
    if (opts.ref) patchFlags.push(shellescape(opts.ref))
    const patchArgs = `${patchFlags.join(" ")} --no-color${pathArg}`
    const pr = await git(`diff ${patchArgs}`, LONG_TIMEOUT)
    if (pr.ok) {
      patch = pr.stdout
      const MAX_PATCH = 50_000
      if (patch.length > MAX_PATCH) {
        truncated = true
        patch = patch.slice(0, MAX_PATCH) + `\n…[truncated ${patch.length - MAX_PATCH} chars]…\n`
      }
    }
  }

  const message = `🧾 فروقات ${files.length} ملف / diff across ${files.length} file(s): +${totalAdditions} −${totalDeletions}`

  return {
    ok: true,
    operation: "getGitDiff",
    files,
    totalAdditions,
    totalDeletions,
    patch,
    truncated,
    message,
  }
}

// ---------------------------------------------------------------------------
// 3. getGitHistory
// ---------------------------------------------------------------------------

export interface CommitLog {
  hash: string
  author: string
  date: string
  message: string
  filesChanged: number
  insertions: number
  deletions: number
}

export interface GitHistory {
  ok: true
  operation: "getGitHistory"
  commits: CommitLog[]
  count: number
  message: string
}

export interface GitHistoryOptions {
  path?: string
  limit?: number
  author?: string
  since?: string
}

/**
 * 3. getGitHistory — `git log` with `--pretty=format` + `--numstat` per commit.
 */
export async function getGitHistory(
  opts: GitHistoryOptions = {}
): Promise<GitHistory | GitError> {
  const limit = opts.limit && opts.limit > 0 ? opts.limit : 20
  const fmt = "--pretty=format:%x01%H%x02%an%x02%ad%x02%s"
  const args: string[] = ["log", `-n ${limit}`, fmt, "--date=iso"]
  if (opts.author) args.push(`--author=${shellescape(opts.author)}`)
  if (opts.since) args.push(`--since=${shellescape(opts.since)}`)
  if (opts.path) args.push("--", shellescape(opts.path))
  args.push("--numstat")

  const r = await git(args.join(" "), LONG_TIMEOUT)
  if (!r.ok) {
    return {
      ok: false,
      operation: "getGitHistory",
      reason: `فشل قراءة سجل git / failed to read git log`,
      stderr: r.error,
    }
  }

  // Parse: commits separated by \x01, fields separated by \x02, numstat lines after message.
  const commits: CommitLog[] = []
  const blocks = r.stdout.split("\x01").map((b) => b.replace(/^\n+/, "")).filter(Boolean)
  for (const block of blocks) {
    const lines = block.split("\n")
    const head = lines[0] || ""
    const [hash, author, date, message] = head.split("\x02")
    if (!hash) continue
    let filesChanged = 0
    let insertions = 0
    let deletions = 0
    for (let i = 1; i < lines.length; i++) {
      const m = (lines[i] || "").match(/^(\d+|-)\t(\d+|-)\t(.+)$/)
      if (!m) continue
      filesChanged++
      insertions += m[1] === "-" ? 0 : parseInt(m[1]!, 10)
      deletions += m[2] === "-" ? 0 : parseInt(m[2]!, 10)
    }
    commits.push({
      hash: hash.trim(),
      author: (author || "").trim(),
      date: (date || "").trim(),
      message: (message || "").trim(),
      filesChanged,
      insertions,
      deletions,
    })
  }

  const message = `📚 ${commits.length} commit(s) — آخرها "${commits[0]?.message ?? "—"}"`
  return {
    ok: true,
    operation: "getGitHistory",
    commits,
    count: commits.length,
    message,
  }
}

// ---------------------------------------------------------------------------
// 4. getGitBlame
// ---------------------------------------------------------------------------

export interface BlameLine {
  line: number
  hash: string
  author: string
  authorTime: string
  summary: string
  content: string
}

export interface GitBlame {
  ok: true
  operation: "getGitBlame"
  file: string
  lines: BlameLine[]
  count: number
  message: string
}

export interface GitBlameOptions {
  start?: number
  end?: number
}

/**
 * 4. getGitBlame — `git blame --line-porcelain` parsed into BlameLine[].
 * Supports optional `start`/`end` line range.
 */
export async function getGitBlame(
  filePath: string,
  opts: GitBlameOptions = {}
): Promise<GitBlame | GitError> {
  const range =
    opts.start && opts.end
      ? `-L ${opts.start},${opts.end}`
      : opts.start
      ? `-L ${opts.start},${opts.start}`
      : ""

  const args: string[] = ["blame", "--line-porcelain"]
  if (range) args.push(range)
  args.push("--", shellescape(filePath))

  const r = await git(args.join(" "), LONG_TIMEOUT)
  if (!r.ok) {
    return {
      ok: false,
      operation: "getGitBlame",
      reason: `فشل تنفيذ git blame على "${filePath}" / git blame failed for "${filePath}"`,
      stderr: r.error,
    }
  }

  const out: BlameLine[] = []
  // porcelain format walk:
  //   <hash> <orig-line> <final-line> [<num-lines>]
  //   author <name>
  //   author-mail <email>
  //   author-time <unix-seconds>
  //   author-tz <tz>
  //   ... (committer fields, summary, etc.) ...
  //   filename <path>
  //   \t<content of final-line>
  //   \t<content of final-line+1>  (if num-lines > 1, multiple content lines follow)
  // We walk line by line; when we see the hash header we reset; when we see
  // `\t...` we emit a BlameLine using the most-recent commit-block metadata.
  const all = r.stdout.split("\n")
  let curHash = ""
  let curAuthor = ""
  let curAuthorTime = ""
  let curSummary = ""
  let nextLineNo = opts.start ?? 1
  let inCommitBlock = false

  for (const raw of all) {
    const line = raw.replace(/\r$/, "")
    if (!line) continue
    const headerMatch = line.match(/^([0-9a-f]{6,40})\s+\d+\s+(\d+)(?:\s+(\d+))?/)
    if (headerMatch) {
      curHash = headerMatch[1]!.slice(0, 8)
      const finalLine = parseInt(headerMatch[2]!, 10) || nextLineNo
      nextLineNo = finalLine
      inCommitBlock = true
      // reset metadata until we see it
      curAuthor = ""
      curAuthorTime = ""
      curSummary = ""
      continue
    }
    if (!inCommitBlock) continue
    if (line.startsWith("author ")) {
      curAuthor = line.slice(7)
    } else if (line.startsWith("author-time ")) {
      const ts = parseInt(line.slice(12), 10)
      curAuthorTime = ts ? new Date(ts * 1000).toISOString() : ""
    } else if (line.startsWith("summary ")) {
      curSummary = line.slice(8)
    } else if (line.startsWith("\t")) {
      // Content line — emit one BlameLine per content line.
      out.push({
        line: nextLineNo,
        hash: curHash,
        author: curAuthor,
        authorTime: curAuthorTime,
        summary: curSummary,
        content: line.slice(1),
      })
      nextLineNo++
    }
    // Other header lines (author-mail, committer, filename, ...) are ignored.
  }

  const message = `🔎 blame: ${out.length} سطر / ${out.length} line(s) for "${filePath}"`
  return {
    ok: true,
    operation: "getGitBlame",
    file: filePath,
    lines: out,
    count: out.length,
    message,
  }
}

// ---------------------------------------------------------------------------
// 5. listBranches
// ---------------------------------------------------------------------------

export interface Branch {
  name: string
  current: boolean
  remote: boolean
  tracked: boolean
  lastCommit: {
    hash: string
    date: string
    subject: string
  } | null
}

export interface GitBranches {
  ok: true
  operation: "listBranches"
  branches: Branch[]
  current: string | null
  count: number
  message: string
}

export interface ListBranchesOptions {
  /** Include remote branches. Default true. */
  remotes?: boolean
}

/**
 * 5. listBranches — `git branch -a --format` combined with `git for-each-ref`
 * to fetch last-commit info per branch.
 */
export async function listBranches(
  opts: ListBranchesOptions = {}
): Promise<GitBranches | GitError> {
  const includeRemotes = opts.remotes !== false
  const fmt = "%(objecttype)%00%(refname)%00%(HEAD)%00%(upstream:short)"
  const args = [
    "for-each-ref",
    `--format=${shellescape(fmt)}`,
    "refs/heads/",
    ...(includeRemotes ? ["refs/remotes/"] : []),
  ]

  const r = await git(args.join(" "))
  if (!r.ok) {
    return {
      ok: false,
      operation: "listBranches",
      reason: `فشل جلب قائمة الفروع / failed to list branches`,
      stderr: r.error,
    }
  }

  // Pull last-commit info per ref in one query.
  const lastFmt = "%(refname)%00%(objectname:short)%00%(committerdate:iso)%00%(subject)"
  const lastArgs = [
    "for-each-ref",
    `--format=${shellescape(lastFmt)}`,
    "refs/heads/",
    ...(includeRemotes ? ["refs/remotes/"] : []),
  ]
  const last = await git(lastArgs.join(" "))
  const lastMap = new Map<string, { hash: string; date: string; subject: string }>()
  if (last.ok) {
    for (const line of last.stdout.split("\n")) {
      const [ref, hash, date, subject] = line.split("\u0000")
      if (!ref) continue
      lastMap.set(ref, {
        hash: hash || "",
        date: date || "",
        subject: subject || "",
      })
    }
  }

  const branches: Branch[] = []
  let current: string | null = null
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue
    const [_type, ref, head, upstream] = line.split("\u0000")
    if (!ref) continue
    const isHead = head === "*"
    const isRemote = ref.startsWith("refs/remotes/")
    let name: string
    if (isRemote) {
      name = ref.replace(/^refs\/remotes\//, "")
    } else {
      name = ref.replace(/^refs\/heads\//, "")
    }
    if (isHead) current = name
    const tracked = !!(upstream && upstream.trim())
    branches.push({
      name,
      current: isHead,
      remote: isRemote,
      tracked,
      lastCommit: lastMap.get(ref) || null,
    })
  }

  const message = `🌿 ${branches.length} فرع / ${branches.length} branch(es) — الحالي/current: ${current ?? "(detached)"}`
  return {
    ok: true,
    operation: "listBranches",
    branches,
    current,
    count: branches.length,
    message,
  }
}

// ---------------------------------------------------------------------------
// 6. getCheckpoints
// ---------------------------------------------------------------------------

export interface GitCheckpointEntry {
  /** Source of the checkpoint: "self-repair" (disk JSON) or "git-tag" (git tag). */
  source: "self-repair" | "git-tag"
  id: string
  createdAt: string
  gitHash: string | null
  description: string
}

export interface GitCheckpoints {
  ok: true
  operation: "getCheckpoints"
  checkpoints: GitCheckpointEntry[]
  count: number
  message: string
}

/**
 * 6. getCheckpoints — re-exports the existing recovery self-repair checkpoint
 * list (from `@/lib/recovery/self-repair`) AND lists git tags matching
 * `checkpoint-*` as additional checkpoints.
 */
export async function getCheckpoints(): Promise<GitCheckpoints | GitError> {
  let cps: Checkpoint[] = []
  try {
    cps = await listCheckpoints()
  } catch {
    cps = []
  }

  const entries: GitCheckpointEntry[] = cps.map((c) => ({
    source: "self-repair",
    id: c.id,
    createdAt: c.createdAt,
    gitHash: c.gitHash,
    description: c.description,
  }))

  // git tags matching checkpoint-*
  const tr = await git(`tag -l "checkpoint-*"`)
  if (tr.ok) {
    for (const tag of tr.stdout.split("\n").map((s) => s.trim()).filter(Boolean)) {
      const dr = await git(`for-each-ref --format="%(objectname:short)%09%(creatordate:iso)%09%(subject)" refs/tags/${shellescape(tag)}`)
      let hash = ""
      let date = ""
      let subject = ""
      if (dr.ok) {
        const parts = dr.stdout.split("\t")
        hash = (parts[0] || "").trim()
        date = (parts[1] || "").trim()
        subject = (parts[2] || "").trim()
      }
      entries.push({
        source: "git-tag",
        id: tag,
        createdAt: date,
        gitHash: hash || null,
        description: subject || tag,
      })
    }
  }

  entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const message = `🔖 ${entries.length} نقطة استرجاع / ${entries.length} checkpoint(s)`
  return {
    ok: true,
    operation: "getCheckpoints",
    checkpoints: entries,
    count: entries.length,
    message,
  }
}

// ---------------------------------------------------------------------------
// 7. listWorktrees
// ---------------------------------------------------------------------------

export interface Worktree {
  path: string
  head: string
  branch: string | null
  detached: boolean
}

export interface GitWorktrees {
  ok: true
  operation: "listWorktrees"
  worktrees: Worktree[]
  count: number
  message: string
}

/**
 * 7. listWorktrees — `git worktree list --porcelain` parsed into Worktree[].
 */
export async function listWorktrees(): Promise<GitWorktrees | GitError> {
  const r = await git("worktree list --porcelain")
  if (!r.ok) {
    return {
      ok: false,
      operation: "listWorktrees",
      reason: `فشل جلب قائمة worktrees / failed to list worktrees`,
      stderr: r.error,
    }
  }

  const worktrees: Worktree[] = []
  let cur: Partial<Worktree> & { detached?: boolean } = {}
  for (const raw of r.stdout.split("\n")) {
    const line = raw.replace(/\r$/, "")
    if (!line) {
      if (cur.path) {
        worktrees.push({
          path: cur.path,
          head: cur.head || "",
          branch: cur.branch ?? null,
          detached: !!cur.detached,
        })
      }
      cur = {}
      continue
    }
    if (line.startsWith("worktree ")) {
      cur.path = line.slice("worktree ".length)
    } else if (line.startsWith("HEAD ")) {
      cur.head = line.slice("HEAD ".length)
    } else if (line.startsWith("branch ")) {
      cur.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "")
    } else if (line === "detached") {
      cur.detached = true
    }
  }
  if (cur.path) {
    worktrees.push({
      path: cur.path,
      head: cur.head || "",
      branch: cur.branch ?? null,
      detached: !!cur.detached,
    })
  }

  const message = `🌲 ${worktrees.length} worktree(s)`
  return {
    ok: true,
    operation: "listWorktrees",
    worktrees,
    count: worktrees.length,
    message,
  }
}

/**
 * 7a. createWorktree — `git worktree add <path> <branch>`.
 */
export async function createWorktree(
  wtPath: string,
  branch: string
): Promise<{ ok: true; path: string; branch: string; message: string } | GitError> {
  const r = await git(`worktree add ${shellescape(wtPath)} ${shellescape(branch)}`)
  if (!r.ok) {
    return {
      ok: false,
      operation: "createWorktree",
      reason: `فشل إنشاء worktree / failed to create worktree`,
      stderr: r.error,
    }
  }
  return {
    ok: true,
    path: wtPath,
    branch,
    message: `✅ تم إنشاء worktree في "${wtPath}" على الفرع "${branch}" / worktree created at "${wtPath}" on branch "${branch}"`,
  }
}

/**
 * 7b. removeWorktree — `git worktree remove <path>`.
 */
export async function removeWorktree(
  wtPath: string
): Promise<{ ok: true; path: string; message: string } | GitError> {
  const r = await git(`worktree remove ${shellescape(wtPath)}`)
  if (!r.ok) {
    return {
      ok: false,
      operation: "removeWorktree",
      reason: `فشل حذف worktree / failed to remove worktree`,
      stderr: r.error,
    }
  }
  return {
    ok: true,
    path: wtPath,
    message: `🗑️ تم حذف worktree "${wtPath}" / removed worktree "${wtPath}"`,
  }
}

// ---------------------------------------------------------------------------
// 8. generateCommit (deterministic, NO LLM)
// ---------------------------------------------------------------------------

export type ConventionalCommitType =
  | "feat"
  | "fix"
  | "refactor"
  | "docs"
  | "chore"
  | "test"
  | "style"
  | "perf"
  | "build"
  | "ci"

export interface GeneratedCommit {
  ok: true
  operation: "generateCommit"
  type: ConventionalCommitType
  scope: string | null
  subject: string
  fullMessage: string
  filesAnalyzed: string[]
  message: string
}

export interface GenerateCommitOptions {
  /** Optional scope override. */
  scope?: string
  /** Use staged changes (default true). If false, use the working tree. */
  staged?: boolean
}

/**
 * 8. generateCommit — deterministic conventional-commits message generator.
 * NO LLM. Derives the type from file-path patterns and the subject from the
 * most-changed file's name.
 *
 * Rules:
 *   - `*.test.ts` / `*.spec.ts`            → test
 *   - `docs/**` / `*.md` / `README*`        → docs
 *   - `package.json` / `*.config.*` / `.github/**` → chore
 *   - `prisma/**`                          → chore
 *   - `src/lib/**`                          → feat
 *   - everything else                       → refactor
 */
export async function generateCommit(
  opts: GenerateCommitOptions = {}
): Promise<GeneratedCommit | GitError> {
  const staged = opts.staged !== false
  const diffArgs = staged ? "diff --cached --numstat" : "diff --numstat"
  const r = await git(diffArgs)
  if (!r.ok) {
    return {
      ok: false,
      operation: "generateCommit",
      reason: `فشل جلب الفروقات المرحَّلة / failed to fetch ${staged ? "staged" : "unstaged"} diff`,
      stderr: r.error,
    }
  }

  type Row = { path: string; additions: number; deletions: number; churn: number }
  const rows: Row[] = []
  for (const line of r.stdout.split("\n")) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/)
    if (!m) continue
    const add = m[1] === "-" ? 0 : parseInt(m[1]!, 10)
    const del = m[2] === "-" ? 0 : parseInt(m[2]!, 10)
    rows.push({ path: m[3]!, additions: add, deletions: del, churn: add + del })
  }

  if (rows.length === 0) {
    return {
      ok: false,
      operation: "generateCommit",
      reason: `لا توجد تغييرات${staged ? " مرحَّلة" : ""} لتحليلها / no ${staged ? "staged" : "unstaged"} changes to analyze`,
    }
  }

  // Derive type by scanning all paths.
  let type: ConventionalCommitType = "refactor"
  for (const row of rows) {
    const p = row.path
    if (/\.test\.[tj]sx?$/.test(p) || /\.spec\.[tj]sx?$/.test(p)) {
      type = "test"
      break
    }
    if (/^docs\//.test(p) || /\.md$/i.test(p) || /^README/i.test(p)) {
      type = "docs"
      break
    }
    if (
      p === "package.json" ||
      /package-lock\.json$/.test(p) ||
      /\.config\.[tjms]/.test(p) ||
      /^\.github\//.test(p) ||
      /^prisma\//.test(p)
    ) {
      type = "chore"
      break
    }
    if (/^src\/lib\//.test(p)) {
      type = "feat"
      break
    }
  }

  // Subject from the most-changed file.
  const top = [...rows].sort((a, b) => b.churn - a.churn)[0]!
  const base = path.basename(top.path).replace(/\.[tj]sx?$/, "").replace(/\.[^.]+$/, "")
  const VERB_BY_TYPE: Record<ConventionalCommitType, string> = {
    feat: "add",
    fix: "fix",
    docs: "document",
    test: "test",
    refactor: "refactor",
    chore: "update",
    style: "format",
    perf: "optimize",
    build: "update build",
    ci: "update ci",
  }
  const verb = VERB_BY_TYPE[type]
  const subject = `${verb} ${base}`

  // Scope: optional override, else directory of top file.
  const scope = opts.scope ?? (path.dirname(top.path) === "." ? null : path.dirname(top.path))

  const full = scope
    ? `${type}(${scope}): ${subject}`
    : `${type}: ${subject}`

  return {
    ok: true,
    operation: "generateCommit",
    type,
    scope,
    subject,
    fullMessage: full,
    filesAnalyzed: rows.map((r) => r.path),
    message: `📝 رسالة commit مقترحة / proposed commit message: "${full}"`,
  }
}

// ---------------------------------------------------------------------------
// 9. explainCommit (deterministic)
// ---------------------------------------------------------------------------

export interface CommitFileBreakdown {
  file: string
  additions: number
  deletions: number
  changeType: "added" | "modified" | "deleted" | "renamed" | "copied" | "unknown"
  oldPath?: string
}

export interface CommitExplanation {
  ok: true
  operation: "explainCommit"
  hash: string
  author: string
  date: string
  message: string
  filesChanged: number
  insertions: number
  deletions: number
  fileBreakdown: CommitFileBreakdown[]
  explanation: string
  message_summary: string
}

/**
 * 9. explainCommit — deterministic commit explanation using
 * `git show --stat --numstat --format=fuller --name-status <hash>`.
 */
export async function explainCommit(
  hash: string
): Promise<CommitExplanation | GitError> {
  const statArgs = `show --no-patch --format=fuller ${shellescape(hash)}`
  const sr = await git(statArgs, LONG_TIMEOUT)
  if (!sr.ok) {
    return {
      ok: false,
      operation: "explainCommit",
      reason: `فشل جلب بيانات الـ commit "${hash}" / failed to fetch commit "${hash}"`,
      stderr: sr.error,
    }
  }

  // `--no-patch` conflicts with `--numstat`/`--name-status`; use `--format=""` to
  // suppress the commit message body and only get the stat table.
  const numstatArgs = `show --numstat --format=${shellescape("")} ${shellescape(hash)}`
  const nr = await git(numstatArgs, LONG_TIMEOUT)
  const nsArgs = `show --name-status --format=${shellescape("")} ${shellescape(hash)}`
  const nsr = await git(nsArgs, LONG_TIMEOUT)

  // Parse stat output (fuller format).
  const lines = sr.stdout.split("\n")
  const author = lines.find((l) => l.startsWith("Author:"))?.slice("Author:".length).trim() || ""
  const date = lines.find((l) => l.startsWith("CommitDate:"))?.slice("CommitDate:".length).trim() ||
    lines.find((l) => l.startsWith("Date:"))?.slice("Date:".length).trim() || ""
  // First non-empty line that doesn't start with a known header.
  const knownPrefixes = ["commit", "Merge:", "Author:", "AuthorDate:", "Commit:", "CommitDate:", "Date:"]
  const messageBody =
    lines.find((l) => l.trim() && !knownPrefixes.some((p) => l.startsWith(p)))?.trim() ||
    (lines[lines.length - 1] || "").trim()

  // numstat rows
  const breakdown: CommitFileBreakdown[] = []
  if (nr.ok) {
    for (const line of nr.stdout.split("\n")) {
      const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/)
      if (!m) continue
      const add = m[1] === "-" ? 0 : parseInt(m[1]!, 10)
      const del = m[2] === "-" ? 0 : parseInt(m[2]!, 10)
      let p = m[3]!
      let oldPath: string | undefined
      const arrow = p.indexOf(" => ")
      if (arrow >= 0) {
        oldPath = p.slice(0, arrow)
        p = p.slice(arrow + 4)
      }
      p = p.replace(/^\{[^}]*=>\s*/, "").replace(/\}$/, "")
      breakdown.push({
        file: p,
        additions: add,
        deletions: del,
        changeType: "unknown",
        oldPath,
      })
    }
  }

  // name-status → changeType
  if (nsr.ok) {
    const map = new Map<string, string>()
    for (const line of nsr.stdout.split("\n")) {
      const sep = line.indexOf("\t")
      if (sep < 0) continue
      const code = line.slice(0, sep)
      const rest = line.slice(sep + 1)
      const p = rest.split("\t").pop() || rest
      map.set(p, code[0] || "M")
    }
    for (const b of breakdown) {
      const code = map.get(b.file) || "M"
      b.changeType =
        code === "A" ? "added"
        : code === "M" ? "modified"
        : code === "D" ? "deleted"
        : code === "R" ? "renamed"
        : code === "C" ? "copied"
        : "unknown"
    }
  }

  const insertions = breakdown.reduce((a, b) => a + b.additions, 0)
  const deletions = breakdown.reduce((a, b) => a + b.deletions, 0)
  const filesChanged = breakdown.length

  const changeTypes = new Set(breakdown.map((b) => b.changeType))
  const verb =
    changeTypes.has("added") && !changeTypes.has("modified") ? "أضاف / added"
    : changeTypes.has("deleted") && !changeTypes.has("modified") ? "حذف / deleted"
    : changeTypes.has("renamed") ? "أعاد تسمية / renamed"
    : "عدَّل / modified"

  const explanation =
    `🔍 الـ commit ${hash.slice(0, 8)} بواسطة ${author || "—"} بتاريخ ${date || "—"}.\n` +
    `${verb} ${filesChanged} ملفًا (${insertions} إضافة، ${deletions} حذف).\n` +
    `الرسالة: "${messageBody}"\n` +
    `Commit ${hash.slice(0, 8)} by ${author || "—"} on ${date || "—"}.\n` +
    `${verb} ${filesChanged} file(s) (+${insertions} −${deletions}).\n` +
    `Message: "${messageBody}"`

  return {
    ok: true,
    operation: "explainCommit",
    hash,
    author,
    date,
    message: messageBody,
    filesChanged,
    insertions,
    deletions,
    fileBreakdown: breakdown,
    explanation,
    message_summary: `🔍 ${hash.slice(0, 8)} — ${messageBody}`,
  }
}

// ---------------------------------------------------------------------------
// 10. getChangeSummary
// ---------------------------------------------------------------------------

export type ChangeCategory = "src" | "test" | "docs" | "config" | "other"
export type ChangeType = "added" | "modified" | "deleted" | "renamed"

export interface ChangeSummary {
  ok: true
  operation: "getChangeSummary"
  totalFiles: number
  stagedFiles: number
  unstagedFiles: number
  untrackedFiles: number
  byType: Record<ChangeType, number>
  byCategory: Record<ChangeCategory, number>
  netAdditions: number
  netDeletions: number
  message: string
}

/**
 * 10. getChangeSummary — top-level summary of uncommitted changes.
 * Optional `status` lets you reuse a previously-computed status without
 * re-running `git status`.
 */
export async function getChangeSummary(
  status?: GitStatus
): Promise<ChangeSummary | GitError> {
  const st = status ?? (await getGitStatus())
  if (!st.ok) return st

  const byType: Record<ChangeType, number> = {
    added: 0,
    modified: 0,
    deleted: 0,
    renamed: 0,
  }
  const byCategory: Record<ChangeCategory, number> = {
    src: 0,
    test: 0,
    docs: 0,
    config: 0,
    other: 0,
  }

  const all = [...st.staged, ...st.unstaged]
  for (const fc of all) {
    if (fc.kind === "copied" || fc.kind === "unknown") byType.modified++
    else if (fc.kind in byType) byType[fc.kind as ChangeType]++

    byCategory[categorizePath(fc.path)]++
  }

  // Untracked count as "added / other"
  byType.added += st.untracked.length
  byCategory.other += st.untracked.length
  const totalFiles = all.length + st.untracked.length

  // Net add/del from diff
  const diff = await getGitDiff({ cached: false })
  let netAdditions = 0
  let netDeletions = 0
  if (diff.ok) {
    netAdditions = diff.totalAdditions
    netDeletions = diff.totalDeletions
  }

  const message =
    `📦 ملخص التغييرات / change summary: ${totalFiles} ملف — ` +
    `+${st.staged.length} مرحَّل، ~${st.unstaged.length} غير مرحَّل، ?${st.untracked.length} غير متتبَّع ` +
    `(+${netAdditions} −${netDeletions})`

  return {
    ok: true,
    operation: "getChangeSummary",
    totalFiles,
    stagedFiles: st.staged.length,
    unstagedFiles: st.unstaged.length,
    untrackedFiles: st.untracked.length,
    byType,
    byCategory,
    netAdditions,
    netDeletions,
    message,
  }
}

function categorizePath(p: string): ChangeCategory {
  if (/\.test\.[tj]sx?$/.test(p) || /\.spec\.[tj]sx?$/.test(p) || /^tests?\//.test(p)) return "test"
  if (/^docs\//.test(p) || /\.md$/i.test(p) || /^README/i.test(p)) return "docs"
  if (
    p === "package.json" ||
    /package-lock\.json$/.test(p) ||
    /\.config\.[tjms]/.test(p) ||
    /^\.github\//.test(p) ||
    /^prisma\//.test(p) ||
    /^tsconfig/.test(p)
  ) return "config"
  if (/^src\//.test(p) || /^lib\//.test(p) || /^app\//.test(p)) return "src"
  return "other"
}

// ---------------------------------------------------------------------------
// 11. rollback (safe)
// ---------------------------------------------------------------------------

export interface RollbackResult {
  ok: boolean
  operation: "rollback"
  success: boolean
  hash: string
  reason: string
}

export interface RollbackOptions {
  hash: string
  /** Skip the uncommitted-changes safety check (default false). */
  force?: boolean
}

/**
 * 11. rollback — safe wrapper around `rollbackToCheckpoint` from
 * `@/lib/recovery/manager`. Refuses to rollback if there are uncommitted
 * changes that aren't backed up (unless `force` is true).
 */
export async function rollback(
  opts: RollbackOptions
): Promise<RollbackResult> {
  const hash = opts.hash.trim()
  if (!hash) {
    return {
      ok: false,
      operation: "rollback",
      success: false,
      hash: "",
      reason: `❌ الهاش مطلوب / hash is required`,
    }
  }

  if (!opts.force) {
    const status = await getGitStatus()
    if (status.ok) {
      const hasUncommitted =
        status.staged.length + status.unstaged.length + status.untracked.length > 0
      if (hasUncommitted) {
        return {
          ok: false,
          operation: "rollback",
          success: false,
          hash,
          reason:
            `⚠️ توجد تغييرات غير مُلتزمة — التزم أو خزّن أولاً قبل التراجع / ` +
            `uncommitted changes present — commit or stash before rolling back ` +
            `(staged=${status.staged.length}, unstaged=${status.unstaged.length}, untracked=${status.untracked.length}). ` +
            `مرّر force=true لتجاوز هذا الفحص / pass force=true to bypass.`,
        }
      }
    }
  }

  const ok = await rollbackToCheckpoint(hash)
  return {
    ok,
    operation: "rollback",
    success: ok,
    hash,
    reason: ok
      ? `✅ تم التراجع إلى ${hash} / rolled back to ${hash}`
      : `❌ فشل التراجع إلى ${hash} / failed to rollback to ${hash}`,
  }
}

// ---------------------------------------------------------------------------
// 12. safeRestore — safer alternative to hard reset
// ---------------------------------------------------------------------------

export type SafeRestoreMode = "stash" | "checkpoint" | "branch"

export interface SafeRestoreResult {
  ok: boolean
  operation: "safeRestore"
  mode: SafeRestoreMode
  recovered: boolean
  /** Stash ref, checkpoint id, or new branch name — depending on mode. */
  ref: string | null
  reason: string
}

export interface SafeRestoreOptions {
  mode: SafeRestoreMode
  /** Label for stash message, checkpoint description, or new branch name. */
  label?: string
}

/**
 * 12. safeRestore — a safer alternative to hard reset.
 *
 *   - `mode: "stash"`       → `git stash push -m <label>` (recoverable via stash list)
 *   - `mode: "checkpoint"`  → save state as a checkpoint via `saveCheckpoint(label)`
 *                             from `@/lib/recovery/self-repair`, THEN `git reset --hard`.
 *                             Returns the checkpoint id so it can be restored.
 *   - `mode: "branch"`      → `git checkout -b <label>` (move changes to a new branch)
 */
export async function safeRestore(
  opts: SafeRestoreOptions
): Promise<SafeRestoreResult> {
  const label = opts.label || `restore-${Date.now()}`
  const mode = opts.mode

  if (mode === "stash") {
    const r = await git(`stash push -m ${shellescape(label)} --include-untracked`)
    if (!r.ok) {
      return {
        ok: false,
        operation: "safeRestore",
        mode,
        recovered: false,
        ref: null,
        reason: `❌ فشل git stash / git stash failed: ${r.error}`,
      }
    }
    // Extract the stash ref from `git stash list` (e.g. "stash@{0}: On main: label")
    const lr = await git("stash list -n 1")
    const stashRef = lr.ok ? (lr.stdout.match(/^(stash@\{\d+\})/)?.[1] || null) : null
    return {
      ok: true,
      operation: "safeRestore",
      mode,
      recovered: true,
      ref: stashRef,
      reason: `✅ تم تخزين التغييرات في stash / changes stashed (${stashRef ?? label})`,
    }
  }

  if (mode === "checkpoint") {
    const cp = await saveCheckpoint(label)
    if (!cp) {
      return {
        ok: false,
        operation: "safeRestore",
        mode,
        recovered: false,
        ref: null,
        reason: `❌ فشل حفظ نقطة الاسترجاع قبل التراجع / failed to save checkpoint before reset`,
      }
    }
    const head = cp.gitHash || "HEAD"
    const r = await git(`reset --hard ${shellescape(head)}`)
    if (!r.ok) {
      return {
        ok: false,
        operation: "safeRestore",
        mode,
        recovered: false,
        ref: cp.id,
        reason: `✅ تم حفظ نقطة الاسترجاع (${cp.id}) لكن فشل reset / checkpoint saved (${cp.id}) but reset failed: ${r.error}`,
      }
    }
    return {
      ok: true,
      operation: "safeRestore",
      mode,
      recovered: true,
      ref: cp.id,
      reason: `✅ تم حفظ التغييرات كنقطة استرجاع (${cp.id}) ثم تراجع git / changes saved as checkpoint (${cp.id}), then hard-reset to ${head}`,
    }
  }

  if (mode === "branch") {
    const r = await git(`checkout -b ${shellescape(label)}`)
    if (!r.ok) {
      return {
        ok: false,
        operation: "safeRestore",
        mode,
        recovered: false,
        ref: null,
        reason: `❌ فشل إنشاء فرع جديد "${label}" / failed to create new branch "${label}": ${r.error}`,
      }
    }
    return {
      ok: true,
      operation: "safeRestore",
      mode,
      recovered: true,
      ref: label,
      reason: `✅ تم نقل التغييرات إلى فرع جديد "${label}" / changes moved to a new branch "${label}"`,
    }
  }

  return {
    ok: false,
    operation: "safeRestore",
    mode,
    recovered: false,
    ref: null,
    reason: `❌ وضع غير معروف "${mode}" / unknown mode "${mode}"`,
  }
}

// ---------------------------------------------------------------------------
// Orchestrator — analyzeGitState
// ---------------------------------------------------------------------------

export interface GitStateAnalysis {
  ok: boolean
  operation: "analyzeGitState"
  status: GitStatus | GitError
  summary: ChangeSummary | GitError
  branches: GitBranches | GitError
  currentBranch: string | null
  head: string
  message: string
}

/**
 * Orchestrator — analyzeGitState. A single "where am I?" call used by the
 * agent loop. Runs `getStatus + getChangeSummary + listBranches` and returns
 * a unified view.
 */
export async function analyzeGitState(): Promise<GitStateAnalysis> {
  // Run status once; reuse for summary to avoid double-work.
  const status = await getGitStatus()
  const summary = await getChangeSummary(status.ok ? status : undefined)
  const branches = await listBranches()

  const headR = await git("rev-parse --short HEAD")
  const head = headR.ok ? headR.stdout.trim() : "(unknown)"

  const currentBranch =
    status.ok
      ? status.branch
      : branches.ok
      ? branches.current
      : null

  const dirty = status.ok
    ? status.staged.length + status.unstaged.length + status.untracked.length > 0
    : true

  const message = dirty
    ? `📍 على ${currentBranch ?? "(detached)"} — ${status.ok ? status.staged.length + status.unstaged.length + status.untracked.length : "?"} تغيير غير ملتزم (HEAD ${head}) / on ${currentBranch ?? "(detached)"} — uncommitted changes present (HEAD ${head})`
    : `📍 على ${currentBranch ?? "(detached)"} — نظيف (HEAD ${head}) / on ${currentBranch ?? "(detached)"} — clean (HEAD ${head})`

  return {
    ok: status.ok && summary.ok && branches.ok,
    operation: "analyzeGitState",
    status,
    summary,
    branches,
    currentBranch,
    head,
    message,
  }
}

// ---------------------------------------------------------------------------
// Formatter — formatGitIntelligence
// ---------------------------------------------------------------------------

/** Discriminated union of all 12 operation results (the "ok" variants). */
export type GitIntelligenceResult =
  | GitStatus
  | GitDiff
  | GitHistory
  | GitBlame
  | GitBranches
  | GitCheckpoints
  | GitWorktrees
  | GeneratedCommit
  | CommitExplanation
  | ChangeSummary
  | RollbackResult
  | SafeRestoreResult
  | GitStateAnalysis
  | GitError

/**
 * formatGitIntelligence — turns any operation result into an Arabic + English
 * bilingual string suitable for the agent loop to read.
 */
export function formatGitIntelligence(result: GitIntelligenceResult): string {
  if (!("ok" in result)) return String(result)
  const op = (result as { operation?: string }).operation
  // analyzeGitState returns a partial view even when one subcall fails,
  // so a falsy `ok` here is not a hard error — fall through to its case below.
  if (!result.ok && op !== "analyzeGitState") {
    const err = result as GitError
    return `❌ ${err.operation} فشل / failed: ${err.reason}${err.stderr ? `\n   stderr: ${err.stderr.slice(0, 300)}` : ""}`
  }

  switch (op) {
    case "getGitStatus": {
      const r = result as GitStatus
      const lines = [
        r.message,
        `   branch: ${r.branch ?? "(detached)"}${r.upstream ? ` ← ${r.upstream}` : ""} (ahead=${r.ahead}, behind=${r.behind})`,
        r.staged.length
          ? `   staged (${r.staged.length}):\n${r.staged.slice(0, 12).map((f) => `     ${f.x}${f.y} ${f.kind.padEnd(8)} ${f.path}`).join("\n")}`
          : `   staged: 0`,
        r.unstaged.length
          ? `   unstaged (${r.unstaged.length}):\n${r.unstaged.slice(0, 12).map((f) => `     ${f.x}${f.y} ${f.kind.padEnd(8)} ${f.path}`).join("\n")}`
          : `   unstaged: 0`,
        r.untracked.length
          ? `   untracked (${r.untracked.length}):\n${r.untracked.slice(0, 12).map((p) => `     ?? ${p}`).join("\n")}`
          : `   untracked: 0`,
      ]
      return lines.join("\n")
    }

    case "getGitDiff": {
      const r = result as GitDiff
      const lines = [
        r.message,
        ...r.files.slice(0, 20).map(
          (f) => `   ${f.status || "?"} ${f.path}  +${f.additions} −${f.deletions}`
        ),
        r.truncated ? `   …[patch truncated]…` : ``,
        r.patch ? `\n   --- patch ---\n${r.patch.split("\n").slice(0, 30).map((l) => `   ${l}`).join("\n")}` : ``,
      ]
      return lines.filter(Boolean).join("\n")
    }

    case "getGitHistory": {
      const r = result as GitHistory
      const lines = [r.message]
      for (const c of r.commits.slice(0, 20)) {
        lines.push(`   ${c.hash.slice(0, 8)} ${c.date} ${c.author}`)
        lines.push(`     ${c.message}  (+${c.insertions} −${c.deletions} in ${c.filesChanged} files)`)
      }
      return lines.join("\n")
    }

    case "getGitBlame": {
      const r = result as GitBlame
      const lines = [r.message]
      for (const l of r.lines.slice(0, 30)) {
        lines.push(`   ${String(l.line).padStart(4)} ${l.hash.slice(0, 8)} ${l.author.slice(0, 16).padEnd(16)} ${l.content}`)
      }
      return lines.join("\n")
    }

    case "listBranches": {
      const r = result as GitBranches
      const lines = [r.message]
      for (const b of r.branches.slice(0, 30)) {
        const mark = b.current ? "*" : " "
        const track = b.tracked ? " (tracked)" : ""
        const last = b.lastCommit ? `${b.lastCommit.hash} ${b.lastCommit.subject.slice(0, 40)}` : "(no commits)"
        lines.push(`   ${mark} ${b.name}${b.remote ? " (remote)" : ""}${track} — ${last}`)
      }
      return lines.join("\n")
    }

    case "getCheckpoints": {
      const r = result as GitCheckpoints
      const lines = [r.message]
      for (const c of r.checkpoints.slice(0, 20)) {
        lines.push(`   [${c.source}] ${c.id} (${c.gitHash ?? "—"}) ${c.description}`)
      }
      return lines.join("\n")
    }

    case "listWorktrees": {
      const r = result as GitWorktrees
      const lines = [r.message]
      for (const w of r.worktrees) {
        lines.push(`   ${w.path}  HEAD=${w.head.slice(0, 8)}  branch=${w.branch ?? (w.detached ? "(detached)" : "—")}`)
      }
      return lines.join("\n")
    }

    case "generateCommit": {
      const r = result as GeneratedCommit
      return [
        r.message,
        `   files analyzed (${r.filesAnalyzed.length}): ${r.filesAnalyzed.slice(0, 8).join(", ")}`,
        `   → ${r.fullMessage}`,
      ].join("\n")
    }

    case "explainCommit": {
      const r = result as CommitExplanation
      const lines = [r.message_summary]
      lines.push(`   ${r.author} — ${r.date}`)
      lines.push(`   message: ${r.message}`)
      lines.push(`   +${r.insertions} −${r.deletions} across ${r.filesChanged} files:`)
      for (const f of r.fileBreakdown.slice(0, 20)) {
        lines.push(`     ${f.changeType.padEnd(8)} ${f.file}  +${f.additions} −${f.deletions}`)
      }
      return lines.join("\n")
    }

    case "getChangeSummary": {
      const r = result as ChangeSummary
      return [
        r.message,
        `   byType: added=${r.byType.added} modified=${r.byType.modified} deleted=${r.byType.deleted} renamed=${r.byType.renamed}`,
        `   byCategory: src=${r.byCategory.src} test=${r.byCategory.test} docs=${r.byCategory.docs} config=${r.byCategory.config} other=${r.byCategory.other}`,
        `   net: +${r.netAdditions} −${r.netDeletions}`,
      ].join("\n")
    }

    case "rollback": {
      const r = result as RollbackResult
      return `🔄 rollback → ${r.hash}: ${r.reason}`
    }

    case "safeRestore": {
      const r = result as SafeRestoreResult
      return `🛡️ safeRestore[${r.mode}] → ref=${r.ref ?? "(none)"}: ${r.reason}`
    }

    case "analyzeGitState": {
      const r = result as GitStateAnalysis
      const lines = [r.message]
      if (r.status.ok) {
        const s = r.status
        lines.push(`   status: ${s.staged.length} staged, ${s.unstaged.length} unstaged, ${s.untracked.length} untracked`)
      } else {
        lines.push(`   status: ❌ failed`)
      }
      if (r.summary.ok) {
        lines.push(`   summary: +${r.summary.netAdditions} −${r.summary.netDeletions}, ${r.summary.totalFiles} files`)
      } else {
        lines.push(`   summary: ❌ failed`)
      }
      if (r.branches.ok) {
        lines.push(`   branches: ${r.branches.count} (current: ${r.branches.current ?? "detached"})`)
      } else {
        lines.push(`   branches: ❌ failed`)
      }
      return lines.join("\n")
    }

    default:
      return JSON.stringify(result, null, 2)
  }
}

// Re-export the recovery Checkpoint type for callers using a single import surface.
export type { Checkpoint } from "@/lib/recovery/self-repair"
