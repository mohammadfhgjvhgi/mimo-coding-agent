// Symbol Index — manages the SQLite Symbol table, indexes files, and provides
// find_symbol + get_references. Auto-updates after write_file/edit_file.

import { db } from "@/lib/db"
import { parseSource, isParsable, type CodeSymbol } from "./ast-engine"
import { resolveWorkspacePath, WORKSPACE_ROOT } from "@/lib/tools/workspace"
import { readdirSync, statSync, readFileSync } from "node:fs"
import path from "node:path"

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".cache",
  "dist",
  "build",
  "out",
  "coverage",
  ".vercel",
  "__pycache__",
  ".aider-desk",
  "tool-results",
  "upload",
])

// Walk the workspace and collect all parsable files
function walkWorkspace(
  dirAbs: string,
  rel: string,
  results: string[]
): void {
  let entries: ReturnType<typeof readdirSync>
  try {
    entries = readdirSync(dirAbs, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue
    const childAbs = path.join(dirAbs, entry.name)
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      walkWorkspace(childAbs, childRel, results)
    } else if (isParsable(entry.name)) {
      results.push(childRel)
    }
  }
}

// Index a single file: delete old symbols for it, insert new ones
export async function indexFile(relPath: string): Promise<number> {
  const resolved = resolveWorkspacePath(relPath, { workspaceRoot: WORKSPACE_ROOT })
  if (!resolved.ok || !resolved.absolute) return 0
  if (!isParsable(resolved.rel!)) return 0

  // Delete existing symbols for this file
  await db.symbol.deleteMany({ where: { filePath: resolved.rel! } })

  let source: string
  try {
    source = readFileSync(resolved.absolute, "utf8")
  } catch {
    return 0
  }

  const result = parseSource(resolved.absolute, source)
  if (!result || result.symbols.length === 0) return 0

  // Insert new symbols in batches
  const batch = result.symbols.map((s) => ({
    name: s.name,
    type: s.type,
    filePath: s.filePath,
    line: s.line,
    column: s.column,
    endLine: s.endLine,
    signature: s.signature,
  }))

  await db.symbol.createMany({ data: batch })
  return batch.length
}

// Reindex the entire workspace
export async function reindexWorkspace(): Promise<{ files: number; symbols: number }> {
  // Clear all symbols
  await db.symbol.deleteMany({})

  const files: string[] = []
  walkWorkspace(path.resolve(WORKSPACE_ROOT), "", files)

  let totalSymbols = 0
  for (const rel of files.slice(0, 200)) {
    try {
      const count = await indexFile(rel)
      totalSymbols += count
    } catch {
      /* ignore individual file errors */
    }
  }

  return { files: files.length, symbols: totalSymbols }
}

// find_symbol: search the symbol index by name
export async function findSymbol(
  name: string
): Promise<CodeSymbol[]> {
  const exact = await db.symbol.findMany({
    where: { name },
    orderBy: [{ type: "asc" }, { filePath: "asc" }],
  })
  if (exact.length > 0) {
    return exact.map(dbRowToCodeSymbol)
  }
  // Fuzzy: name contains the search term
  const fuzzy = await db.symbol.findMany({
    where: { name: { contains: name } },
    take: 20,
    orderBy: [{ type: "asc" }, { filePath: "asc" }],
  })
  return fuzzy.map(dbRowToCodeSymbol)
}

// get_references: find all files/lines that use the symbol name
// (text-based scan — returns lines containing the symbol name, excluding declarations)
export async function getReferences(
  name: string
): Promise<{ filePath: string; line: number; text: string; isDeclaration: boolean }[]> {
  // First, find the symbol declarations
  const decls = await db.symbol.findMany({
    where: { name },
    select: { filePath: true, line: true },
  })
  const declSet = new Set(decls.map((d) => `${d.filePath}:${d.line}`))

  // Scan all parsable files for the symbol name as a word boundary
  const files: string[] = []
  walkWorkspace(path.resolve(WORKSPACE_ROOT), "", files)

  const results: { filePath: string; line: number; text: string; isDeclaration: boolean }[] = []
  const regex = new RegExp(`\\b${escapeRegex(name)}\\b`)

  for (const rel of files.slice(0, 150)) {
    const resolved = resolveWorkspacePath(rel, { workspaceRoot: WORKSPACE_ROOT })
    if (!resolved.ok || !resolved.absolute) continue
    let source: string
    try {
      source = readFileSync(resolved.absolute, "utf8")
    } catch {
      continue
    }
    const lines = source.split("\n")
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        const key = `${rel}:${i + 1}`
        results.push({
          filePath: rel,
          line: i + 1,
          text: lines[i].trim().slice(0, 120),
          isDeclaration: declSet.has(key),
        })
      }
    }
  }

  return results
}

// Get all symbols grouped by file (for the smart repo map)
export async function getRepoMap(
  maxDepth = 5
): Promise<{ filePath: string; symbols: { name: string; type: string; line: number }[] }[]> {
  const symbols = await db.symbol.findMany({
    orderBy: [{ filePath: "asc" }, { line: "asc" }],
    select: { filePath: true, name: true, type: true, line: true, signature: true },
  })

  const byFile = new Map<string, { name: string; type: string; line: number; signature: string }[]>()
  for (const s of symbols) {
    if (!byFile.has(s.filePath)) byFile.set(s.filePath, [])
    byFile.get(s.filePath)!.push({
      name: s.name,
      type: s.type,
      line: s.line,
      signature: s.signature || "",
    })
  }

  // Include files that have symbols (skip empty)
  const result: { filePath: string; symbols: { name: string; type: string; line: number }[] }[] = []
  for (const [filePath, syms] of byFile) {
    result.push({
      filePath,
      symbols: syms.slice(0, 15).map((s) => ({ name: s.name, type: s.type, line: s.line })),
    })
  }
  return result
}

// Get index stats
export async function getIndexStats(): Promise<{
  totalSymbols: number
  filesIndexed: number
  byType: Record<string, number>
}> {
  const total = await db.symbol.count()
  const byTypeRaw = await db.symbol.groupBy({
    by: ["type"],
    _count: true,
  })
  const byType: Record<string, number> = {}
  for (const r of byTypeRaw) byType[r.type] = r._count

  const filesRaw = await db.symbol.groupBy({
    by: ["filePath"],
    _count: true,
  })

  return {
    totalSymbols: total,
    filesIndexed: filesRaw.length,
    byType,
  }
}

function dbRowToCodeSymbol(row: {
  name: string
  type: string
  filePath: string
  line: number
  column: number
  endLine: number
  signature: string | null
}): CodeSymbol {
  return {
    name: row.name,
    type: row.type as CodeSymbol["type"],
    filePath: row.filePath,
    line: row.line,
    column: row.column,
    endLine: row.endLine,
    signature: row.signature || "",
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

void statSync
