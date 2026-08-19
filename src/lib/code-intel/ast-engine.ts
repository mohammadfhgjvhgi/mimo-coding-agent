// AST Engine (pure-JS) — extracts symbols from source files using regex +
// lightweight parsing. Supports JavaScript, TypeScript (incl. TSX), and Python.
// No native dependencies — robust across all Node.js ABIs.

import path from "node:path"
import fs from "node:fs"

export interface CodeSymbol {
  name: string
  type:
    | "function"
    | "class"
    | "method"
    | "variable"
    | "import"
    | "interface"
    | "type"
    | "constant"
  filePath: string
  line: number
  column: number
  endLine: number
  signature: string
}

export interface ParseResult {
  symbols: CodeSymbol[]
  imports: string[]
  lineCount: number
}

const PARSABLE_EXTS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py"])

export function isParsable(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return PARSABLE_EXTS.has(ext)
}

// Match patterns for each symbol type. Each pattern captures the name.
interface PatternSpec {
  type: CodeSymbol["type"]
  regex: RegExp
  // For patterns where the name is in a capture group
  nameGroup?: number
}

// JS/TS patterns (applied line by line to get line numbers)
const JS_PATTERNS: PatternSpec[] = [
  // function NAME(
  { type: "function", regex: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*\(/, nameGroup: 1 },
  // class NAME
  { type: "class", regex: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/, nameGroup: 1 },
  // interface NAME  (TS)
  { type: "interface", regex: /^\s*(?:export\s+)?interface\s+(\w+)/, nameGroup: 1 },
  // type NAME =  (TS)
  { type: "type", regex: /^\s*(?:export\s+)?type\s+(\w+)\s*=/, nameGroup: 1 },
  // const/let NAME = ... =>  (arrow function)
  { type: "function", regex: /^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(?.*?=>\s*/, nameGroup: 1 },
  // const/let NAME = function
  { type: "function", regex: /^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?function/, nameGroup: 1 },
  // const NAME = ... (top-level constant, not a function)
  { type: "constant", regex: /^\s*(?:export\s+)?const\s+(\w+)\s*=/, nameGroup: 1 },
  // let NAME = ...
  { type: "variable", regex: /^\s*let\s+(\w+)\s*=/, nameGroup: 1 },
  // method: NAME(params) {  (inside a class — detected by indentation)
  { type: "method", regex: /^\s{2,}(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/, nameGroup: 1 },
  // method: NAME = (params) =>  (inside class)
  { type: "method", regex: /^\s{2,}(?:async\s+)?(\w+)\s*=\s*\(?.*?=>/, nameGroup: 1 },
]

// Python patterns
const PY_PATTERNS: PatternSpec[] = [
  { type: "function", regex: /^\s*(?:async\s+)?def\s+(\w+)\s*\(/, nameGroup: 1 },
  { type: "class", regex: /^\s*class\s+(\w+)/, nameGroup: 1 },
]

const PY_IMPORT = /^\s*(?:from\s+[\w.]+\s+)?import\s+(.+)/

// JS/TS import patterns
const JS_IMPORT_PATTERNS = [
  // import { A, B } from 'module'
  /import\s+(?:\*\s+as\s+\w+\s*,\s*)?\{([^}]+)\}\s+from\s+['"`]([^'"`]+)['"`]/,
  // import NAME from 'module'
  /import\s+(\w+)\s+from\s+['"`]([^'"`]+)['"`]/,
  // import 'module'
  /import\s+['"`]([^'"`]+)['"`]/,
  // const X = require('module')
  /(?:const|let|var)\s+(\w+)\s*=\s*require\s*\(\s*['"`]([^'"`]+)['"`]/,
]

function getLangPatterns(ext: string): PatternSpec[] {
  if (ext === ".py") return PY_PATTERNS
  return JS_PATTERNS
}

export function parseSource(
  filePath: string,
  source: string
): ParseResult | null {
  const ext = path.extname(filePath).toLowerCase()
  if (!PARSABLE_EXTS.has(ext)) return null

  const patterns = getLangPatterns(ext)
  const lines = source.split("\n")
  const symbols: CodeSymbol[] = []
  const imports: string[] = []
  const seen = new Set<string>()

  // Track brace depth to identify class methods vs top-level functions
  let braceDepth = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Track brace depth for class detection
    const opens = (line.match(/\{/g) || []).length
    const closes = (line.match(/\}/g) || []).length
    const depthBefore = braceDepth
    braceDepth += opens - closes

    // Extract imports
    if (ext === ".py") {
      const pyImp = line.match(PY_IMPORT)
      if (pyImp) {
        imports.push(pyImp[1].trim().split(/\s+as\s+/)[0].trim().slice(0, 60))
      }
    } else {
      for (const impRegex of JS_IMPORT_PATTERNS) {
        const m = line.match(impRegex)
        if (m) {
          if (m[1] && m[2]) {
            // import { A, B } from 'mod'  or  const X = require('mod')
            if (m[1].includes(",")) {
              m[1].split(",").forEach((name) => imports.push(name.trim()))
            } else {
              imports.push(m[1].trim())
            }
          } else if (m[2]) {
            imports.push(m[2])
          }
          break
        }
      }
    }

    // Extract symbols
    for (const spec of patterns) {
      const m = line.match(spec.regex)
      if (m && spec.nameGroup && m[spec.nameGroup]) {
        const name = m[spec.nameGroup]
        // Skip reserved words / keywords
        if (RESERVED.has(name)) continue
        // Skip method patterns that are actually top-level (depth 0)
        if (spec.type === "method" && depthBefore === 0) continue
        // Skip constant/variable patterns that are actually inside classes (method = depth > 0)
        if ((spec.type === "constant" || spec.type === "variable") && depthBefore > 0) continue
        // For methods, skip constructor/setter/getter keywords
        if (spec.type === "method" && ["constructor", "get", "set"].includes(name)) continue

        const key = `${name}:${i + 1}`
        if (seen.has(key)) continue
        seen.add(key)

        const sig = line.trim().length > 120 ? line.trim().slice(0, 120) + "…" : line.trim()
        symbols.push({
          name,
          type: spec.type,
          filePath,
          line: i + 1,
          column: line.indexOf(name),
          endLine: i + 1,
          signature: sig,
        })
        break // only one match per line
      }
    }
  }

  return {
    symbols,
    imports,
    lineCount: lines.length,
  }
}

const RESERVED = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "break", "continue",
  "return", "try", "catch", "finally", "throw", "new", "delete", "typeof",
  "instanceof", "void", "this", "super", "class", "function", "var", "let",
  "const", "import", "export", "default", "async", "await", "yield", "static",
  "get", "set", "extends", "implements", "interface", "enum", "namespace",
  "module", "from", "as", "true", "false", "null", "undefined", "of", "in",
])

export function parseFile(absPath: string): ParseResult | null {
  try {
    const source = fs.readFileSync(absPath, "utf8")
    return parseSource(absPath, source)
  } catch {
    return null
  }
}
