// Repository Scanner — scans the workspace and builds a complete index.
// Produces: file index, symbol index (from AST), import graph, call graph,
// dependency graph, git history, hotspot detection, change impact analysis.
// All deterministic — 0 LLM calls.

import { db } from "@/lib/db"
import { parseSource, isParsable, type CodeSymbol } from "../ast-engine"
import { WORKSPACE_ROOT, resolveWorkspacePath } from "@/lib/tools/workspace"
import { exec } from "node:child_process"
import { promisify } from "node:util"
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const execAsync = promisify(exec)

const IGNORED = new Set([
  "node_modules", ".git", ".next", ".turbo", ".cache", "dist", "build",
  "out", "coverage", ".vercel", "__pycache__", ".aider-desk",
  "tool-results", "upload", "skills", "examples", "testproj",
])

// ============ TYPES ============
export interface FileInfo {
  path: string
  name: string
  ext: string
  size: number
  lines: number
  lastModified: string
  type: "code" | "config" | "doc" | "asset" | "test"
  language: string
}

export interface ImportEdge {
  from: string
  to: string
  type: "import" | "require"
}

export interface CallEdge {
  from: string
  to: string
  fromSymbol: string
  toSymbol: string
}

export interface DependencyEdge {
  from: string
  to: string
  type: "import" | "call" | "extends" | "implements"
}

export interface Hotspot {
  path: string
  commits: number
  churnScore: number
  lastChanged: string
}

export interface ChangeImpact {
  path: string
  impactedFiles: string[]
  impactScore: number
}

export interface RepoScanResult {
  files: FileInfo[]
  symbols: { path: string; symbols: CodeSymbol[] }[]
  imports: ImportEdge[]
  calls: CallEdge[]
  dependencies: DependencyEdge[]
  hotspots: Hotspot[]
  impacts: ChangeImpact[]
  stats: {
    totalFiles: number
    totalLines: number
    totalSymbols: number
    codeFiles: number
    testFiles: number
    configFiles: number
    docFiles: number
    languages: Record<string, number>
  }
  scanDurationMs: number
}

// ============ FILE SCANNER ============
export function scanFiles(rootDir?: string): FileInfo[] {
  const root = rootDir || path.resolve(WORKSPACE_ROOT)
  const files: FileInfo[] = []

  function walk(dir: string, rel: string) {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }

    for (const entry of entries) {
      const name = String(entry.name)
      if (IGNORED.has(name) || name.startsWith(".")) continue
      const abs = path.join(dir, name)
      const r = rel ? `${rel}/${name}` : name

      if (entry.isDirectory()) {
        walk(abs, r)
      } else {
        const ext = path.extname(name).toLowerCase()
        const stat = statSync(abs)
        const content = readFileSync(abs, "utf8").slice(0, 50000) // limit for line counting
        const lines = content.split("\n").length
        const type = getFileType(name, ext)
        const language = getLanguage(ext)

        files.push({
          path: r,
          name,
          ext,
          size: stat.size,
          lines,
          lastModified: stat.mtime.toISOString(),
          type,
          language,
        })
      }
    }
  }

  walk(root, "")
  return files
}

function getFileType(name: string, ext: string): FileInfo["type"] {
  if (/\.(test|spec)\.(js|ts|tsx|jsx|py)$/i.test(name)) return "test"
  if (/\.(js|ts|tsx|jsx|py|go|rs|java|c|cpp|rb)$/i.test(ext)) return "code"
  if (/\.(json|yaml|yml|toml|env|config|rc)$/i.test(ext)) return "config"
  if (/\.(md|txt|rst|adoc)$/i.test(ext)) return "doc"
  return "asset"
}

function getLanguage(ext: string): string {
  const map: Record<string, string> = {
    ".js": "JavaScript", ".ts": "TypeScript", ".tsx": "TypeScript React",
    ".jsx": "JavaScript React", ".py": "Python", ".json": "JSON",
    ".md": "Markdown", ".html": "HTML", ".css": "CSS", ".yaml": "YAML",
    ".yml": "YAML", ".sh": "Shell", ".sql": "SQL", ".go": "Go",
    ".rs": "Rust", ".java": "Java",
  }
  return map[ext] || "Unknown"
}

// ============ SYMBOL INDEX ============
export function indexSymbols(files: FileInfo[]): { path: string; symbols: CodeSymbol[] }[] {
  const result: { path: string; symbols: CodeSymbol[] }[] = []
  const root = path.resolve(WORKSPACE_ROOT)

  for (const file of files) {
    if (!isParsable(file.path)) continue
    try {
      const abs = path.join(root, file.path)
      const content = readFileSync(abs, "utf8")
      const parsed = parseSource(file.path, content)
      if (parsed && parsed.symbols.length > 0) {
        result.push({ path: file.path, symbols: parsed.symbols })
      }
    } catch { /* skip */ }
  }

  return result
}

// ============ IMPORT GRAPH ============
export function buildImportGraph(files: FileInfo[], symbols: { path: string; symbols: CodeSymbol[] }[]): ImportEdge[] {
  const edges: ImportEdge[] = []
  const root = path.resolve(WORKSPACE_ROOT)

  for (const file of files) {
    if (!isParsable(file.path)) continue
    try {
      const abs = path.join(root, file.path)
      const content = readFileSync(abs, "utf8")

      // Match ES imports: import X from 'path'
      const esImports = content.matchAll(/import\s+(?:[^'"]+\s+from\s+)?['"`]([^'"`]+)['"`]/g)
      for (const m of esImports) {
        const target = resolveImport(m[1], file.path)
        if (target) edges.push({ from: file.path, to: target, type: "import" })
      }

      // Match require: require('path')
      const requires = content.matchAll(/require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g)
      for (const m of requires) {
        const target = resolveImport(m[1], file.path)
        if (target) edges.push({ from: file.path, to: target, type: "require" })
      }
    } catch { /* skip */ }
  }

  return edges
}

function resolveImport(importPath: string, fromFile: string): string | null {
  // Skip external packages (node_modules)
  if (!importPath.startsWith(".") && !importPath.startsWith("/") && !importPath.startsWith("@/")) {
    return null
  }

  // Resolve @/ alias to src/
  let resolved = importPath
  if (resolved.startsWith("@/")) {
    resolved = `src/${resolved.slice(2)}`
  }

  // Resolve relative path
  if (resolved.startsWith("./") || resolved.startsWith("../")) {
    const dir = path.dirname(fromFile)
    resolved = path.normalize(path.join(dir, resolved))
  }

  // Try adding extensions
  const exts = [".ts", ".tsx", ".js", ".jsx", ".py", "/index.ts", "/index.js"]
  for (const ext of exts) {
    if (resolved.endsWith(ext)) return resolved
  }
  for (const ext of exts) {
    // Check if it's a directory index
    const withExt = resolved + ext
    // We can't check filesystem here (we're just building graph), so add both
    return withExt.replace(/\/+/g, "/")
  }

  return resolved.replace(/\/+/g, "/")
}

// ============ CALL GRAPH ============
export function buildCallGraph(symbols: { path: string; symbols: CodeSymbol[] }[]): CallEdge[] {
  const edges: CallEdge[] = []
  const root = path.resolve(WORKSPACE_ROOT)

  // Build a map of all symbol names → their paths
  const symbolMap = new Map<string, string>()
  for (const { path: filePath, symbols: syms } of symbols) {
    for (const sym of syms) {
      if (!symbolMap.has(sym.name)) {
        symbolMap.set(sym.name, filePath)
      }
    }
  }

  // For each file, find calls to known symbols
  for (const { path: filePath, symbols: syms } of symbols) {
    try {
      const abs = path.join(root, filePath)
      const content = readFileSync(abs, "utf8")

      for (const sym of syms) {
        // Find calls to other symbols in this file
        for (const [targetName, targetPath] of symbolMap) {
          if (targetName === sym.name) continue
          if (targetPath === filePath) continue

          // Check if this symbol is called in the content
          const callPattern = new RegExp(`\\b${targetName}\\s*\\(`)
          if (callPattern.test(content)) {
            edges.push({
              from: filePath,
              to: targetPath,
              fromSymbol: sym.name,
              toSymbol: targetName,
            })
          }
        }
      }
    } catch { /* skip */ }
  }

  // Deduplicate
  const seen = new Set<string>()
  return edges.filter(e => {
    const key = `${e.from}:${e.to}:${e.fromSymbol}:${e.toSymbol}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ============ DEPENDENCY GRAPH ============
export function buildDependencyGraph(imports: ImportEdge[], calls: CallEdge[]): DependencyEdge[] {
  const edges: DependencyEdge[] = []

  for (const imp of imports) {
    edges.push({ from: imp.from, to: imp.to, type: "import" })
  }

  for (const call of calls) {
    edges.push({ from: call.from, to: call.to, type: "call" })
  }

  return edges
}

// ============ GIT HISTORY + HOTSPOT DETECTION ============
export async function detectHotspots(): Promise<Hotspot[]> {
  try {
    const root = path.resolve(WORKSPACE_ROOT)
    const { stdout } = await execAsync(
      `git log --name-only --pretty=format:"%H|%ar" --since="3 months ago" 2>/dev/null | head -500`,
      { cwd: root, timeout: 10000 }
    )

    const fileCommitCount: Record<string, { commits: number; lastChanged: string }> = {}
    let currentDate = ""

    for (const line of stdout.split("\n")) {
      if (line.includes("|")) {
        // This is a commit line: hash|date
        currentDate = line.split("|")[1] || ""
        continue
      }
      const filePath = line.trim()
      if (!filePath) continue
      if (!fileCommitCount[filePath]) {
        fileCommitCount[filePath] = { commits: 0, lastChanged: currentDate }
      }
      fileCommitCount[filePath].commits++
      fileCommitCount[filePath].lastChanged = currentDate
    }

    const maxCommits = Math.max(...Object.values(fileCommitCount).map(v => v.commits), 1)

    return Object.entries(fileCommitCount)
      .map(([path, data]) => ({
        path,
        commits: data.commits,
        churnScore: Math.round((data.commits / maxCommits) * 100),
        lastChanged: data.lastChanged,
      }))
      .sort((a, b) => b.churnScore - a.churnScore)
      .slice(0, 20)
  } catch {
    return []
  }
}

// ============ CHANGE IMPACT ANALYSIS ============
export function analyzeChangeImpact(filePath: string, dependencies: DependencyEdge[]): ChangeImpact {
  // Find all files that depend on this file (reverse dependencies)
  const impacted = new Set<string>()

  function findImpacted(target: string, depth: number = 0): void {
    if (depth > 3) return // max 3 levels deep
    for (const edge of dependencies) {
      if (edge.to === target && !impacted.has(edge.from)) {
        impacted.add(edge.from)
        findImpacted(edge.from, depth + 1)
      }
    }
  }

  findImpacted(filePath)

  return {
    path: filePath,
    impactedFiles: [...impacted],
    impactScore: impacted.size,
  }
}

// ============ AIDER-STYLE REPO MAP ============
// Compact compressed representation for LLM context.
export function buildRepoMap(
  files: FileInfo[],
  symbols: { path: string; symbols: CodeSymbol[] }[],
  maxTokens: number = 2000
): string {
  const lines: string[] = []
  let tokenEstimate = 0

  // Group by directory
  const byDir: Record<string, { file: FileInfo; symbols: CodeSymbol[] }[]> = {}

  for (const file of files) {
    if (file.type !== "code") continue
    const dir = path.dirname(file.path) || "."
    if (!byDir[dir]) byDir[dir] = []
    const syms = symbols.find(s => s.path === file.path)?.symbols || []
    byDir[dir].push({ file, symbols: syms })
  }

  for (const [dir, entries] of Object.entries(byDir).sort()) {
    if (tokenEstimate > maxTokens) break
    const dirLine = `${dir}/`
    lines.push(dirLine)
    tokenEstimate += Math.ceil(dirLine.length / 3.5)

    for (const { file, symbols: syms } of entries.sort((a, b) => a.file.name.localeCompare(b.file.name))) {
      if (tokenEstimate > maxTokens) break
      const symNames = syms.slice(0, 5).map(s => s.name).join(", ")
      const line = `  ${file.name}${symNames ? ` (${symNames})` : ""} [${file.lines}L]`
      lines.push(line)
      tokenEstimate += Math.ceil(line.length / 3.5)
    }
    lines.push("")
  }

  return lines.join("\n")
}

// ============ FULL SCAN ============
export async function scanRepository(): Promise<RepoScanResult> {
  const start = Date.now()

  const files = scanFiles()
  const symbols = indexSymbols(files)
  const imports = buildImportGraph(files, symbols)
  const calls = buildCallGraph(symbols)
  const dependencies = buildDependencyGraph(imports, calls)
  const hotspots = await detectHotspots()

  // Stats
  const stats = {
    totalFiles: files.length,
    totalLines: files.reduce((sum, f) => sum + f.lines, 0),
    totalSymbols: symbols.reduce((sum, s) => sum + s.symbols.length, 0),
    codeFiles: files.filter(f => f.type === "code").length,
    testFiles: files.filter(f => f.type === "test").length,
    configFiles: files.filter(f => f.type === "config").length,
    docFiles: files.filter(f => f.type === "doc").length,
    languages: {} as Record<string, number>,
  }

  for (const f of files) {
    stats.languages[f.language] = (stats.languages[f.language] || 0) + 1
  }

  return {
    files,
    symbols,
    imports,
    calls,
    dependencies,
    hotspots,
    impacts: [], // computed on-demand per file
    stats,
    scanDurationMs: Date.now() - start,
  }
}
