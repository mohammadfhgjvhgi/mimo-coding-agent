// Spreadsheet Intelligence — workbook/sheet/formula analysis.
// 8 operations, deterministic, bilingual (Arabic + English), persisted to SQLite.
//
// Design:
//   • Workbook (Prisma) — multi-sheet workbook with cells in A1 notation
//   • Formula (Prisma) — saved formulas for reuse + debugging
//   • Pure JS formula evaluator (SUM, AVERAGE, COUNT, MIN, MAX, IF, CONCAT, VLOOKUP, etc.)
//   • A1 cell reference parser (A1, B2, $A$1, ranges A1:B10)
//   • Pivot tables computed in-memory
//
// 8 operations:
//   1. spreadsheetRead        — parse CSV/JSON into a Workbook with sheets + cells
//   2. formulaAnalyze          — parse a formula, extract references, explain it
//   3. formulaGenerate         — generate a formula from a natural-language description
//   4. formulaDebug             — evaluate a formula step-by-step, return the result + errors
//   5. dataTransform            — apply transformations (sort, filter, rename, add column, compute)
//   6. pivotAnalysis             — create a pivot table (rows × cols × values)
//   7. chartGenerate            — generate SVG chart from sheet data
//   8. workbookSummarize        — generate a markdown summary of the workbook

import { db } from "@/lib/db"
import { createHash } from "node:crypto"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"
import { parseCsv } from "@/lib/data-analysis/os"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkbookSource = "csv" | "xlsx" | "google_sheets" | "inline"

export interface Cell {
  ref: string // A1 notation
  value: string | number | boolean | null
  formula?: string // without leading =
  type: "number" | "string" | "boolean" | "empty" | "formula"
}

export interface Sheet {
  name: string
  rowCount: number
  colCount: number
  headers: string[]
  // Cells indexed by A1 ref for O(1) lookup
  cells: Record<string, Cell>
  // Row-major data for easy iteration
  rows: Record<string, unknown>[]
}

export interface WorkbookRecord {
  id: string
  name: string
  source: WorkbookSource
  sourcePath: string | null
  sheets: Sheet[]
  activeSheet: string | null
  cellCount: number
  checksum: string | null
  conversationId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface FormulaRecord {
  id: string
  workbookId: string | null
  formula: string
  range: string | null
  category: string
  result: string | null
  status: "ok" | "error" | "pending"
  error: string | null
  useCount: number
  createdAt: Date
  updatedAt: Date
}

export interface FormulaAnalysis {
  formula: string
  function: string
  arguments: string[]
  references: string[] // cell/range refs
  explanation: string
}

export interface FormulaDebug {
  formula: string
  steps: Array<{ step: string; result: string }>
  finalResult: string | null
  error: string | null
}

export interface PivotResult {
  rowKeys: string[]
  colKeys: string[]
  values: Record<string, Record<string, number>> // rowKey → colKey → value
  totals: { rows: Record<string, number>; cols: Record<string, number>; grand: number }
}

export interface WorkbookSummary {
  workbookId: string
  name: string
  sheetCount: number
  totalCells: number
  sheets: Array<{
    name: string
    rowCount: number
    colCount: number
    headers: string[]
    columnTypes: Record<string, string>
    sampleRow: Record<string, unknown>
    numericStats: Record<string, { min: number; max: number; mean: number; sum: number }>
  }>
  markdown: string
}

export type SpreadsheetResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

function checksum(s: string): string {
  return createHash("sha256").update(s).digest("hex")
}

// Convert (row, col) to A1 ref (0-indexed → A1, B2, etc.)
function toA1(row: number, col: number): string {
  let colStr = ""
  let c = col
  while (c >= 0) {
    colStr = String.fromCharCode(65 + (c % 26)) + colStr
    c = Math.floor(c / 26) - 1
  }
  return `${colStr}${row + 1}`
}

// Parse A1 ref → { row, col } (0-indexed)
function fromA1(ref: string): { row: number; col: number } | null {
  const m = ref.match(/^([A-Z]+)(\d+)$/)
  if (!m) return null
  const colStr = m[1]
  let col = 0
  for (let i = 0; i < colStr.length; i++) {
    col = col * 26 + (colStr.charCodeAt(i) - 64)
  }
  col -= 1 // 0-indexed
  const row = Number(m[2]) - 1
  return { row, col }
}

// Expand a range like A1:B3 into individual cell refs
function expandRange(range: string): string[] {
  const parts = range.split(":")
  if (parts.length === 1) return [parts[0]]
  const start = fromA1(parts[0])
  const end = fromA1(parts[1])
  if (!start || !end) return [range]
  const refs: string[] = []
  const minRow = Math.min(start.row, end.row)
  const maxRow = Math.max(start.row, end.row)
  const minCol = Math.min(start.col, end.col)
  const maxCol = Math.max(start.col, end.col)
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      refs.push(toA1(r, c))
    }
  }
  return refs
}

// ---------------------------------------------------------------------------
// Row → record mappers
// ---------------------------------------------------------------------------

interface WorkbookRow {
  id: string
  name: string
  source: string
  sourcePath: string | null
  sheets: string
  activeSheet: string | null
  cellCount: number
  checksum: string | null
  conversationId: string | null
  createdAt: Date
  updatedAt: Date
}

function workbookRowToRecord(row: WorkbookRow): WorkbookRecord {
  return {
    id: row.id,
    name: row.name,
    source: row.source as WorkbookSource,
    sourcePath: row.sourcePath,
    sheets: safeParse(row.sheets, []),
    activeSheet: row.activeSheet,
    cellCount: row.cellCount,
    checksum: row.checksum,
    conversationId: row.conversationId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

interface FormulaRow {
  id: string
  workbookId: string | null
  formula: string
  range: string | null
  category: string
  result: string | null
  status: string
  error: string | null
  useCount: number
  createdAt: Date
  updatedAt: Date
}

function formulaRowToRecord(row: FormulaRow): FormulaRecord {
  return {
    id: row.id,
    workbookId: row.workbookId,
    formula: row.formula,
    range: row.range,
    category: row.category,
    result: row.result,
    status: row.status as "ok" | "error" | "pending",
    error: row.error,
    useCount: row.useCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// ---------------------------------------------------------------------------
// Build a Sheet from row-major data
// ---------------------------------------------------------------------------

function buildSheet(name: string, rows: Record<string, unknown>[]): Sheet {
  if (rows.length === 0) {
    return { name, rowCount: 0, colCount: 0, headers: [], cells: {}, rows: [] }
  }
  const headers = Object.keys(rows[0])
  const cells: Record<string, Cell> = {}
  rows.forEach((r, rowIdx) => {
    headers.forEach((h, colIdx) => {
      const ref = toA1(rowIdx, colIdx)
      const rawVal = r[h]
      let value: string | number | boolean | null = rawVal === null || rawVal === undefined ? null : (typeof rawVal === "object" ? String(rawVal) : rawVal as string | number | boolean)
      let type: Cell["type"] = "empty"
      if (typeof value === "number") type = "number"
      else if (typeof value === "boolean") type = "boolean"
      else if (typeof value === "string") {
        if (value === "") type = "empty"
        else if (!isNaN(Number(value)) && value.trim() !== "") {
          type = "number"
          value = Number(value)
        } else type = "string"
      }
      cells[ref] = { ref, value, type }
    })
  })
  return {
    name,
    rowCount: rows.length,
    colCount: headers.length,
    headers,
    cells,
    rows,
  }
}

// ---------------------------------------------------------------------------
// 1. Spreadsheet Read — parse CSV/JSON into a Workbook
// ---------------------------------------------------------------------------

export interface ReadInput {
  name: string
  source: WorkbookSource
  sourcePath?: string
  content?: string
  sheetName?: string
  conversationId?: string
}

export async function spreadsheetRead(input: ReadInput): Promise<SpreadsheetResult<WorkbookRecord>> {
  try {
    if (!input.name) {
      return { ok: false, error: "no_name", message: "❌ الاسم مطلوب / name required" }
    }
    let content = input.content ?? ""
    if (input.sourcePath) {
      const abs = path.isAbsolute(input.sourcePath) ? input.sourcePath : path.resolve(WORKSPACE_ROOT, input.sourcePath)
      if (!existsSync(abs)) {
        return { ok: false, error: "not_found", message: `❌ الملف غير موجود / file not found: ${input.sourcePath}` }
      }
      content = await readFile(abs, "utf8")
    }
    if (!content) {
      return { ok: false, error: "no_content", message: "❌ لا محتوى / no content" }
    }
    const cs = checksum(content)
    let rows: Record<string, unknown>[] = []
    if (input.source === "csv" || input.source === "xlsx") {
      const parsed = parseCsv(content)
      rows = parsed.rows as Record<string, unknown>[]
    } else if (input.source === "inline" || input.source === "google_sheets") {
      rows = JSON.parse(content) as Record<string, unknown>[]
    }
    const sheetName = input.sheetName ?? "Sheet1"
    const sheet = buildSheet(sheetName, rows)
    const cellCount = Object.keys(sheet.cells).length
    const row = await db.workbook.create({
      data: {
        name: input.name,
        source: input.source,
        sourcePath: input.sourcePath ?? null,
        sheets: JSON.stringify([sheet]),
        activeSheet: sheetName,
        cellCount,
        checksum: cs,
        conversationId: input.conversationId ?? null,
      },
    })
    return { ok: true, data: workbookRowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "read_failed",
      message: `❌ فشل القراءة / read failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Load a sheet from a workbook (by name or active sheet)
// ---------------------------------------------------------------------------

async function loadSheet(workbookId: string, sheetName?: string): Promise<SpreadsheetResult<{ sheet: Sheet; workbook: WorkbookRecord }>> {
  try {
    const row = await db.workbook.findUnique({ where: { id: workbookId } })
    if (!row) {
      return { ok: false, error: "not_found", message: `❌ المصنف غير موجود / workbook not found: ${workbookId}` }
    }
    const record = workbookRowToRecord(row)
    const sheets = record.sheets
    const target = sheetName ?? record.activeSheet ?? sheets[0]?.name
    const sheet = sheets.find((s) => s.name === target)
    if (!sheet) {
      return { ok: false, error: "sheet_not_found", message: `❌ الورقة غير موجودة / sheet not found: ${target}` }
    }
    return { ok: true, data: { sheet, workbook: record } }
  } catch (e) {
    return {
      ok: false,
      error: "load_failed",
      message: `❌ فشل التحميل / load failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Formula evaluator — SUM, AVERAGE, COUNT, MIN, MAX, IF, CONCAT, VLOOKUP, etc.
// ---------------------------------------------------------------------------

function getCellValue(sheet: Sheet, ref: string): string | number | boolean | null {
  const cell = sheet.cells[ref]
  if (!cell) return null
  return cell.value
}

function getRangeValues(sheet: Sheet, range: string): (string | number | boolean | null)[] {
  const refs = expandRange(range)
  return refs.map((r) => getCellValue(sheet, r))
}

function getNumericValues(sheet: Sheet, range: string): number[] {
  return getRangeValues(sheet, range)
    .map((v) => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN))
    .filter((n) => !isNaN(n))
}

function evaluateFunction(name: string, args: string[], sheet: Sheet): { result: string | number | boolean; error?: string } {
  const upper = name.toUpperCase()
  switch (upper) {
    case "SUM": {
      const nums = args.flatMap((a) => getNumericValues(sheet, a))
      return { result: nums.reduce((s, n) => s + n, 0) }
    }
    case "AVERAGE":
    case "AVG": {
      const nums = args.flatMap((a) => getNumericValues(sheet, a))
      if (nums.length === 0) return { result: 0, error: "DIV/0" }
      return { result: nums.reduce((s, n) => s + n, 0) / nums.length }
    }
    case "COUNT": {
      const nums = args.flatMap((a) => getNumericValues(sheet, a))
      return { result: nums.length }
    }
    case "COUNTA": {
      const vals = args.flatMap((a) => getRangeValues(sheet, a))
      return { result: vals.filter((v) => v !== null && v !== "").length }
    }
    case "MIN": {
      const nums = args.flatMap((a) => getNumericValues(sheet, a))
      if (nums.length === 0) return { result: 0 }
      return { result: Math.min(...nums) }
    }
    case "MAX": {
      const nums = args.flatMap((a) => getNumericValues(sheet, a))
      if (nums.length === 0) return { result: 0 }
      return { result: Math.max(...nums) }
    }
    case "PRODUCT": {
      const nums = args.flatMap((a) => getNumericValues(sheet, a))
      return { result: nums.reduce((p, n) => p * n, 1) }
    }
    case "CONCAT":
    case "CONCATENATE": {
      const vals = args.flatMap((a) => getRangeValues(sheet, a))
      return { result: vals.map((v) => String(v ?? "")).join("") }
    }
    case "IF": {
      // IF(condition, true_val, false_val)
      // condition is like "A1>5"
      if (args.length < 3) return { result: "", error: "IF needs 3 args" }
      const cond = args[0]
      const m = cond.match(/^([A-Z]+\d+)\s*(>=|<=|>|<|=|!=)\s*(.+)$/)
      if (!m) return { result: args[2] }
      const left = getCellValue(sheet, m[1])
      const op = m[2]
      const right = Number(m[3]) || m[3].replace(/^["']|["']$/g, "")
      let condResult = false
      const leftNum = Number(left)
      const rightNum = Number(right)
      const bothNum = !isNaN(leftNum) && !isNaN(rightNum)
      switch (op) {
        case "=": condResult = bothNum ? leftNum === rightNum : String(left) === String(right); break
        case "!=": condResult = bothNum ? leftNum !== rightNum : String(left) !== String(right); break
        case ">": condResult = bothNum ? leftNum > rightNum : String(left) > String(right); break
        case "<": condResult = bothNum ? leftNum < rightNum : String(left) < String(right); break
        case ">=": condResult = bothNum ? leftNum >= rightNum : String(left) >= String(right); break
        case "<=": condResult = bothNum ? leftNum <= rightNum : String(left) <= String(right); break
      }
      return { result: condResult ? args[1] : args[2] }
    }
    case "VLOOKUP": {
      // VLOOKUP(lookup_value, range, col_index, [exact_match])
      if (args.length < 3) return { result: "", error: "VLOOKUP needs 3+ args" }
      const lookupVal = args[0].replace(/^["']|["']$/g, "")
      const range = args[1]
      const colIdx = Number(args[2]) - 1
      const refs = expandRange(range)
      // Group refs by row
      const rowMap = new Map<number, string[]>()
      for (const r of refs) {
        const parsed = fromA1(r)
        if (!parsed) continue
        if (!rowMap.has(parsed.row)) rowMap.set(parsed.row, [])
        rowMap.get(parsed.row)!.push(r)
      }
      for (const [, rowRefs] of rowMap) {
        const firstCell = getCellValue(sheet, rowRefs[0])
        if (String(firstCell) === lookupVal) {
          if (colIdx < rowRefs.length) {
            return { result: getCellValue(sheet, rowRefs[colIdx]) ?? "" }
          }
        }
      }
      return { result: "", error: "#N/A" }
    }
    case "ABS": {
      const nums = args.flatMap((a) => getNumericValues(sheet, a))
      if (nums.length === 0) return { result: 0 }
      return { result: Math.abs(nums[0]) }
    }
    case "ROUND": {
      const nums = args.flatMap((a) => getNumericValues(sheet, a))
      if (nums.length === 0) return { result: 0 }
      const decimals = args.length > 1 ? Number(getNumericValues(sheet, args[1])[0]) : 0
      const f = Math.pow(10, decimals)
      return { result: Math.round(nums[0] * f) / f }
    }
    case "LEN": {
      const val = args.flatMap((a) => getRangeValues(sheet, a))[0]
      return { result: String(val ?? "").length }
    }
    case "UPPER": {
      const val = args.flatMap((a) => getRangeValues(sheet, a))[0]
      return { result: String(val ?? "").toUpperCase() }
    }
    case "LOWER": {
      const val = args.flatMap((a) => getRangeValues(sheet, a))[0]
      return { result: String(val ?? "").toLowerCase() }
    }
    default:
      return { result: "", error: `unknown function: ${name}` }
  }
}

function evaluateFormula(formula: string, sheet: Sheet): { result: string | number | boolean | null; error: string | null } {
  const trimmed = formula.replace(/^=/, "").trim()
  // Match FUNCTION(args)
  const m = trimmed.match(/^([A-Z]+)\((.*)\)$/i)
  if (!m) {
    // Maybe a direct cell reference
    const cellVal = getCellValue(sheet, trimmed)
    if (cellVal !== null) return { result: cellVal, error: null }
    // Maybe a literal
    if (!isNaN(Number(trimmed))) return { result: Number(trimmed), error: null }
    return { result: trimmed.replace(/^["']|["']$/g, ""), error: null }
  }
  const funcName = m[1]
  const argsStr = m[2]
  // Split args by comma (but not inside parens)
  const args: string[] = []
  let depth = 0
  let current = ""
  for (const ch of argsStr) {
    if (ch === "(") depth++
    else if (ch === ")") depth--
    if (ch === "," && depth === 0) {
      args.push(current.trim())
      current = ""
    } else {
      current += ch
    }
  }
  if (current.trim()) args.push(current.trim())
  const result = evaluateFunction(funcName, args, sheet)
  return { result: result.result, error: result.error ?? null }
}

// ---------------------------------------------------------------------------
// 2. Formula Analysis — parse + explain
// ---------------------------------------------------------------------------

export async function formulaAnalyze(formula: string): Promise<SpreadsheetResult<FormulaAnalysis>> {
  try {
    if (!formula || !formula.trim()) {
      return { ok: false, error: "no_formula", message: "❌ لا صيغة / no formula provided" }
    }
    const trimmed = formula.replace(/^=/, "").trim()
    const m = trimmed.match(/^([A-Z]+)\((.*)\)$/i)
    if (!m) {
      // Direct cell ref or literal
      const refs = trimmed.match(/[A-Z]+\d+/g) ?? []
      return {
        ok: true,
        data: {
          formula: trimmed,
          function: "(literal)",
          arguments: [trimmed],
          references: refs,
          explanation: `مرجع مباشر أو قيمة حرفية. / Direct reference or literal value.`,
        },
      }
    }
    const funcName = m[1].toUpperCase()
    const argsStr = m[2]
    const args: string[] = []
    let depth = 0
    let current = ""
    for (const ch of argsStr) {
      if (ch === "(") depth++
      else if (ch === ")") depth--
      if (ch === "," && depth === 0) {
        args.push(current.trim())
        current = ""
      } else {
        current += ch
      }
    }
    if (current.trim()) args.push(current.trim())
    const references = args.flatMap((a) => {
      const refs = a.match(/[A-Z]+\d+(?::[A-Z]+\d+)?/g) ?? []
      return refs
    })
    const explanations: Record<string, string> = {
      SUM: "يجمع القيم في النطاق المحدد. / Sums the values in the specified range.",
      AVERAGE: "يحسب المتوسط الحسابي. / Computes the arithmetic mean.",
      AVG: "يحسب المتوسط الحسابي. / Computes the arithmetic mean.",
      COUNT: "يعدّ الخلايا الرقمية. / Counts numeric cells.",
      COUNTA: "يعدّ الخلايا غير الفارغة. / Counts non-empty cells.",
      MIN: "يجد أصغر قيمة. / Finds the minimum value.",
      MAX: "يجد أكبر قيمة. / Finds the maximum value.",
      IF: "شرط: يعيد قيمة إذا كان الشرط صحيحاً وأخرى إذا كان خاطئاً. / Conditional: returns one value if true, another if false.",
      VLOOKUP: "بحث عمودي: يبحث عن قيمة في أول عمود ويعيد قيمة من عمود آخر. / Vertical lookup.",
      CONCAT: "يدمج النصوص. / Concatenates text.",
      CONCATENATE: "يدمج النصوص. / Concatenates text.",
      PRODUCT: "يضرب القيم. / Multiplies values.",
      ABS: "القيمة المطلقة. / Absolute value.",
      ROUND: "تقريب لأقرب عدد عشري. / Rounds to nearest decimal.",
      LEN: "طول النص. / Text length.",
      UPPER: "تحويل لحروف كبيرة. / Uppercase.",
      LOWER: "تحويل لحروف صغيرة. / Lowercase.",
    }
    return {
      ok: true,
      data: {
        formula: trimmed,
        function: funcName,
        arguments: args,
        references,
        explanation: explanations[funcName] ?? `دالة مخصصة: ${funcName}. / Custom function: ${funcName}.`,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "analyze_failed",
      message: `❌ فشل تحليل الصيغة / formula analyze failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Formula Generation — generate from NL description
// ---------------------------------------------------------------------------

export async function formulaGenerate(opts: { description: string; columnNames?: string[]; sampleValues?: Record<string, unknown>[] }): Promise<SpreadsheetResult<{ formula: string; explanation: string }>> {
  try {
    if (!opts.description || !opts.description.trim()) {
      return { ok: false, error: "no_desc", message: "❌ لا وصف / no description provided" }
    }
    const desc = opts.description.toLowerCase()
    const cols = opts.columnNames ?? []
    const lowerDesc = desc
    // Pattern matching for common formula types
    if (lowerDesc.includes("sum") || lowerDesc.includes("مجموع") || lowerDesc.includes("جمع")) {
      if (cols.length > 0) {
        const col = cols[0]
        return { ok: true, data: { formula: `SUM(${col}2:${col}100)`, explanation: `يجمع كل قيم عمود ${col}. / Sums all values in column ${col}.` } }
      }
      return { ok: true, data: { formula: "SUM(A1:A100)", explanation: "يجمع القيم في العمود A. / Sums values in column A." } }
    }
    if (lowerDesc.includes("average") || lowerDesc.includes("متوسط") || lowerDesc.includes("معدل")) {
      if (cols.length > 0) {
        const col = cols[0]
        return { ok: true, data: { formula: `AVERAGE(${col}2:${col}100)`, explanation: `يحسب المتوسط لعمود ${col}. / Averages column ${col}.` } }
      }
      return { ok: true, data: { formula: "AVERAGE(A1:A100)", explanation: "يحسب المتوسط للعمود A. / Averages column A." } }
    }
    if (lowerDesc.includes("count") || lowerDesc.includes("عد") || lowerDesc.includes("عدد")) {
      if (cols.length > 0) {
        const col = cols[0]
        return { ok: true, data: { formula: `COUNT(${col}2:${col}100)`, explanation: `يعدّ الخلايا الرقمية في عمود ${col}. / Counts numeric cells in column ${col}.` } }
      }
      return { ok: true, data: { formula: "COUNT(A1:A100)", explanation: "يعدّ الخلايا الرقمية في A. / Counts numeric cells in A." } }
    }
    if (lowerDesc.includes("max") || lowerDesc.includes("أكبر") || lowerDesc.includes("اقصى") || lowerDesc.includes("maxim")) {
      if (cols.length > 0) {
        const col = cols[0]
        return { ok: true, data: { formula: `MAX(${col}2:${col}100)`, explanation: `يجد أكبر قيمة في عمود ${col}. / Finds max in column ${col}.` } }
      }
      return { ok: true, data: { formula: "MAX(A1:A100)", explanation: "يجد أكبر قيمة في A. / Finds max in A." } }
    }
    if (lowerDesc.includes("min") || lowerDesc.includes("أصغر") || lowerDesc.includes("minim")) {
      if (cols.length > 0) {
        const col = cols[0]
        return { ok: true, data: { formula: `MIN(${col}2:${col}100)`, explanation: `يجد أصغر قيمة في عمود ${col}. / Finds min in column ${col}.` } }
      }
      return { ok: true, data: { formula: "MIN(A1:A100)", explanation: "يجد أصغر قيمة في A. / Finds min in A." } }
    }
    if (lowerDesc.includes("if") || lowerDesc.includes("إذا") || lowerDesc.includes("شرط")) {
      return { ok: true, data: { formula: "IF(A1>10, \"مرتفع\", \"منخفض\")", explanation: "يعيد \"مرتفع\" إذا A1>10 وإلا \"منخفض\". / Returns high/low based on A1>10." } }
    }
    if (lowerDesc.includes("vlookup") || lowerDesc.includes("بحث")) {
      return { ok: true, data: { formula: "VLOOKUP(A1, B1:D100, 2, FALSE)", explanation: "يبحث عن A1 في B1:D100 ويعيد القيمة من العمود 2. / Looks up A1 in B1:D100, returns col 2." } }
    }
    if (lowerDesc.includes("concat") || lowerDesc.includes("دمج") || lowerDesc.includes("نص")) {
      if (cols.length >= 2) {
        return { ok: true, data: { formula: `CONCAT(${cols[0]}1, " ", ${cols[1]}1)`, explanation: `يدمج ${cols[0]} و ${cols[1]} بمسافة بينهما. / Concatenates ${cols[0]} and ${cols[1]} with space.` } }
      }
      return { ok: true, data: { formula: "CONCAT(A1, \" \", B1)", explanation: "يدمج A1 و B1. / Concatenates A1 and B1." } }
    }
    // Default fallback
    return {
      ok: false,
      error: "no_match",
      message: `❌ لم أتعرف على نوع الصيغة المطلوبة. حاول: sum, average, count, max, min, if, vlookup, concat. / Could not recognize the formula type. Try: sum, average, count, max, min, if, vlookup, concat.`,
    }
  } catch (e) {
    return {
      ok: false,
      error: "gen_failed",
      message: `❌ فشل توليد الصيغة / formula generate failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Formula Debugging — evaluate step-by-step
// ---------------------------------------------------------------------------

export async function formulaDebug(opts: { workbookId: string; formula: string; sheetName?: string }): Promise<SpreadsheetResult<FormulaDebug>> {
  try {
    const loadRes = await loadSheet(opts.workbookId, opts.sheetName)
    if (!loadRes.ok) return loadRes as unknown as SpreadsheetResult<FormulaDebug>
    const { sheet } = loadRes.data
    const trimmed = opts.formula.replace(/^=/, "").trim()
    const steps: FormulaDebug["steps"] = []
    // Parse the formula
    const m = trimmed.match(/^([A-Z]+)\((.*)\)$/i)
    if (!m) {
      // Direct ref or literal
      const evalRes = evaluateFormula(trimmed, sheet)
      steps.push({ step: `تقييم مباشر / Direct eval: ${trimmed}`, result: String(evalRes.result) })
      const result = evalRes.result
      const row = await db.formula.create({
        data: {
          workbookId: opts.workbookId,
          formula: trimmed,
          category: "custom",
          result: String(result),
          status: evalRes.error ? "error" : "ok",
          error: evalRes.error,
        },
      })
      return {
        ok: true,
        data: {
          formula: trimmed,
          steps,
          finalResult: String(result),
          error: evalRes.error,
        },
      }
    }
    const funcName = m[1].toUpperCase()
    const argsStr = m[2]
    // Split args
    const args: string[] = []
    let depth = 0
    let current = ""
    for (const ch of argsStr) {
      if (ch === "(") depth++
      else if (ch === ")") depth--
      if (ch === "," && depth === 0) {
        args.push(current.trim())
        current = ""
      } else {
        current += ch
      }
    }
    if (current.trim()) args.push(current.trim())
    steps.push({ step: `تحليل الدالة / Parse function: ${funcName}(${args.length} args)`, result: args.join(", ") })
    // Evaluate each arg
    for (const arg of args) {
      if (/^[A-Z]+\d+(?::[A-Z]+\d+)?$/i.test(arg)) {
        const values = getRangeValues(sheet, arg)
        const nums = values.filter((v) => typeof v === "number") as number[]
        steps.push({
          step: `قراءة النطاق / Read range ${arg}`,
          result: `${values.length} cells, ${nums.length} numeric: [${nums.slice(0, 5).join(", ")}${nums.length > 5 ? "..." : ""}]`,
        })
      }
    }
    // Evaluate the full formula
    const evalRes = evaluateFormula(trimmed, sheet)
    steps.push({ step: `تقييم / Evaluate ${funcName}`, result: String(evalRes.result) })
    if (evalRes.error) {
      steps.push({ step: `خطأ / Error`, result: evalRes.error })
    }
    const category = funcName.toLowerCase() === "average" ? "average" : funcName.toLowerCase() === "count" ? "count" : funcName.toLowerCase() === "vlookup" ? "vlookup" : funcName.toLowerCase() === "if" ? "if" : funcName.toLowerCase() === "concat" || funcName.toLowerCase() === "concatenate" ? "concat" : "custom"
    const row = await db.formula.create({
      data: {
        workbookId: opts.workbookId,
        formula: trimmed,
        category,
        result: String(evalRes.result),
        status: evalRes.error ? "error" : "ok",
        error: evalRes.error,
      },
    })
    return {
      ok: true,
      data: {
        formula: trimmed,
        steps,
        finalResult: String(evalRes.result),
        error: evalRes.error,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "debug_failed",
      message: `❌ فشل تنقيح الصيغة / formula debug failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Data Transformation — sort, filter, rename, add column, compute
// ---------------------------------------------------------------------------

export interface TransformOpts {
  sort?: { column: string; direction: "asc" | "desc" }
  filter?: { column: string; op: "=" | "!=" | ">" | "<" | ">=" | "<="; value: string }
  rename?: { from: string; to: string }[]
  addColumn?: { name: string; formula: string } // formula evaluated per row
  removeColumns?: string[]
}

export async function dataTransform(opts: { workbookId: string; transforms: TransformOpts; sheetName?: string }): Promise<SpreadsheetResult<{ sheet: Sheet; rowCount: number; colCount: number }>> {
  try {
    const loadRes = await loadSheet(opts.workbookId, opts.sheetName)
    if (!loadRes.ok) return loadRes as unknown as SpreadsheetResult<{ sheet: Sheet; rowCount: number; colCount: number }>
    const { sheet } = loadRes.data
    let rows = [...sheet.rows]
    // Rename
    if (opts.transforms.rename && opts.transforms.rename.length > 0) {
      rows = rows.map((r) => {
        const obj: Record<string, unknown> = { ...r }
        for (const { from, to } of opts.transforms.rename!) {
          if (from in obj) {
            obj[to] = obj[from]
            delete obj[from]
          }
        }
        return obj
      })
    }
    // Remove columns
    if (opts.transforms.removeColumns && opts.transforms.removeColumns.length > 0) {
      rows = rows.map((r) => {
        const obj: Record<string, unknown> = { ...r }
        for (const c of opts.transforms.removeColumns!) delete obj[c]
        return obj
      })
    }
    // Filter
    if (opts.transforms.filter) {
      const { column, op, value } = opts.transforms.filter
      const valNum = Number(value)
      rows = rows.filter((r) => {
        const cell = r[column]
        const cellNum = Number(cell)
        const bothNum = !isNaN(cellNum) && !isNaN(valNum)
        switch (op) {
          case "=": return bothNum ? cellNum === valNum : String(cell) === value
          case "!=": return bothNum ? cellNum !== valNum : String(cell) !== value
          case ">": return bothNum ? cellNum > valNum : String(cell) > value
          case "<": return bothNum ? cellNum < valNum : String(cell) < value
          case ">=": return bothNum ? cellNum >= valNum : String(cell) >= value
          case "<=": return bothNum ? cellNum <= valNum : String(cell) <= value
          default: return true
        }
      })
    }
    // Sort
    if (opts.transforms.sort) {
      const { column, direction } = opts.transforms.sort
      rows.sort((a, b) => {
        const av = a[column]
        const bv = b[column]
        const aNum = Number(av)
        const bNum = Number(bv)
        const bothNum = !isNaN(aNum) && !isNaN(bNum)
        if (bothNum) return direction === "asc" ? aNum - bNum : bNum - aNum
        return direction === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
      })
    }
    // Add column
    if (opts.transforms.addColumn) {
      const { name, formula } = opts.transforms.addColumn
      rows = rows.map((r, rowIdx) => {
        // Build a mini sheet for this row to evaluate the formula
        const miniSheet: Sheet = {
          name: "_temp",
          rowCount: 1,
          colCount: Object.keys(r).length,
          headers: Object.keys(r),
          cells: {},
          rows: [r],
        }
        Object.entries(r).forEach(([k, v], colIdx) => {
          miniSheet.cells[toA1(0, colIdx)] = { ref: toA1(0, colIdx), value: v as string | number | boolean, type: typeof v === "number" ? "number" : "string" }
        })
        const evalRes = evaluateFormula(formula, miniSheet)
        return { ...r, [name]: evalRes.result }
      })
    }
    const newSheet = buildSheet(sheet.name + "_transformed", rows)
    // Update the workbook
    const updatedSheets = [...loadRes.data.workbook.sheets, newSheet]
    await db.workbook.update({
      where: { id: opts.workbookId },
      data: {
        sheets: JSON.stringify(updatedSheets),
        cellCount: { increment: Object.keys(newSheet.cells).length },
      },
    })
    return {
      ok: true,
      data: {
        sheet: newSheet,
        rowCount: newSheet.rowCount,
        colCount: newSheet.colCount,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "transform_failed",
      message: `❌ فشل التحويل / transform failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Pivot Analysis — create a pivot table
// ---------------------------------------------------------------------------

export interface PivotInput {
  workbookId: string
  sheetName?: string
  rowField: string
  colField: string
  valueField: string
  agg: "sum" | "count" | "average" | "max" | "min"
}

export async function pivotAnalysis(input: PivotInput): Promise<SpreadsheetResult<{ pivot: PivotResult }>> {
  try {
    const loadRes = await loadSheet(input.workbookId, input.sheetName)
    if (!loadRes.ok) return loadRes as unknown as SpreadsheetResult<{ pivot: PivotResult }>
    const { sheet } = loadRes.data
    const rows = sheet.rows
    const rowKeys = new Set<string>()
    const colKeys = new Set<string>()
    const acc: Record<string, Record<string, number[]>> = {} // rowKey → colKey → values[]
    for (const r of rows) {
      const rk = String(r[input.rowField] ?? "(null)")
      const ck = String(r[input.colField] ?? "(null)")
      const v = Number(r[input.valueField])
      rowKeys.add(rk)
      colKeys.add(ck)
      if (!acc[rk]) acc[rk] = {}
      if (!acc[rk][ck]) acc[rk][ck] = []
      if (!isNaN(v)) acc[rk][ck].push(v)
    }
    const values: Record<string, Record<string, number>> = {}
    const rowTotals: Record<string, number> = {}
    const colTotals: Record<string, number> = {}
    let grandTotal = 0
    for (const rk of rowKeys) {
      values[rk] = {}
      let rowSum = 0
      for (const ck of colKeys) {
        const vals = acc[rk]?.[ck] ?? []
        let result = 0
        switch (input.agg) {
          case "sum": result = vals.reduce((s, n) => s + n, 0); break
          case "count": result = vals.length; break
          case "average": result = vals.length > 0 ? vals.reduce((s, n) => s + n, 0) / vals.length : 0; break
          case "max": result = vals.length > 0 ? Math.max(...vals) : 0; break
          case "min": result = vals.length > 0 ? Math.min(...vals) : 0; break
        }
        values[rk][ck] = result
        rowSum += result
        colTotals[ck] = (colTotals[ck] ?? 0) + result
      }
      rowTotals[rk] = rowSum
      grandTotal += rowSum
    }
    return {
      ok: true,
      data: {
        pivot: {
          rowKeys: Array.from(rowKeys),
          colKeys: Array.from(colKeys),
          values,
          totals: { rows: rowTotals, cols: colTotals, grand: grandTotal },
        },
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "pivot_failed",
      message: `❌ فشل الجدول المحوري / pivot analysis failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Chart Generation — SVG chart from sheet data
// ---------------------------------------------------------------------------

export interface ChartInput {
  workbookId: string
  sheetName?: string
  chartType: "bar" | "line" | "pie" | "scatter"
  xColumn: string
  yColumn: string
  title?: string
}

export async function chartGenerate(input: ChartInput): Promise<SpreadsheetResult<{ svg: string; svgPath: string }>> {
  try {
    const loadRes = await loadSheet(input.workbookId, input.sheetName)
    if (!loadRes.ok) return loadRes as unknown as SpreadsheetResult<{ svg: string; svgPath: string }>
    const { sheet } = loadRes.data
    const rows = sheet.rows
    if (rows.length === 0) {
      return { ok: false, error: "no_data", message: "❌ لا بيانات / no rows" }
    }
    const width = 800
    const height = 500
    const colors = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6"]
    let svg = ""
    const dataPoints = rows.map((r) => ({
      label: String(r[input.xColumn] ?? ""),
      value: Number(r[input.yColumn]) || 0,
    })).filter((d) => !isNaN(d.value))
    if (input.chartType === "bar") {
      const maxVal = Math.max(...dataPoints.map((d) => d.value), 1)
      const padding = { top: 50, right: 40, bottom: 60, left: 70 }
      const cw = width - padding.left - padding.right
      const ch = height - padding.top - padding.bottom
      const bw = cw / dataPoints.length * 0.7
      const gap = cw / dataPoints.length * 0.3
      let bars = ""
      dataPoints.forEach((d, i) => {
        const bh = (d.value / maxVal) * ch
        const x = padding.left + i * (bw + gap) + gap / 2
        const y = padding.top + ch - bh
        bars += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="${colors[i % colors.length]}" rx="4"/>`
        bars += `<text x="${x + bw / 2}" y="${y - 8}" text-anchor="middle" font-size="11">${d.value}</text>`
        bars += `<text x="${x + bw / 2}" y="${padding.top + ch + 20}" text-anchor="middle" font-size="10" fill="#666">${d.label.slice(0, 10)}</text>`
      })
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${input.title ? `<text x="${width / 2}" y="25" text-anchor="middle" font-size="18" font-weight="bold">${input.title}</text>` : ""}${bars}</svg>`
    } else if (input.chartType === "line") {
      const maxVal = Math.max(...dataPoints.map((d) => d.value), 1)
      const padding = { top: 50, right: 40, bottom: 60, left: 70 }
      const cw = width - padding.left - padding.right
      const ch = height - padding.top - padding.bottom
      const points = dataPoints.map((d, i) => `${padding.left + i * (cw / Math.max(dataPoints.length - 1, 1))},${padding.top + ch - (d.value / maxVal) * ch}`).join(" ")
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${input.title ? `<text x="${width / 2}" y="25" text-anchor="middle" font-size="18" font-weight="bold">${input.title}</text>` : ""}<polyline points="${points}" fill="none" stroke="${colors[0]}" stroke-width="3"/></svg>`
    } else if (input.chartType === "pie") {
      const total = dataPoints.reduce((s, d) => s + d.value, 0)
      const cx = width / 2
      const cy = height / 2
      const r = Math.min(width, height) / 2 - 60
      let angle = -Math.PI / 2
      let slices = ""
      dataPoints.forEach((d, i) => {
        const sliceAngle = (d.value / total) * 2 * Math.PI
        const x1 = cx + r * Math.cos(angle)
        const y1 = cy + r * Math.sin(angle)
        const x2 = cx + r * Math.cos(angle + sliceAngle)
        const y2 = cy + r * Math.sin(angle + sliceAngle)
        const large = sliceAngle > Math.PI ? 1 : 0
        const pct = ((d.value / total) * 100).toFixed(1)
        slices += `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z" fill="${colors[i % colors.length]}" stroke="white" stroke-width="2"/>`
        slices += `<text x="${cx + (r + 20) * Math.cos(angle + sliceAngle / 2)}" y="${cy + (r + 20) * Math.sin(angle + sliceAngle / 2)}" text-anchor="middle" font-size="11">${d.label} ${pct}%</text>`
        angle += sliceAngle
      })
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${input.title ? `<text x="${width / 2}" y="25" text-anchor="middle" font-size="18" font-weight="bold">${input.title}</text>` : ""}${slices}</svg>`
    } else if (input.chartType === "scatter") {
      const maxX = Math.max(...dataPoints.map((d) => d.value), 1)
      const maxY = Math.max(...dataPoints.map((d) => d.value), 1)
      const padding = { top: 50, right: 40, bottom: 60, left: 70 }
      const cw = width - padding.left - padding.right
      const ch = height - padding.top - padding.bottom
      let dots = ""
      dataPoints.forEach((d) => {
        const x = padding.left + (d.value / maxX) * cw
        const y = padding.top + ch - (d.value / maxY) * ch
        dots += `<circle cx="${x}" cy="${y}" r="4" fill="${colors[0]}"/>`
      })
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${input.title ? `<text x="${width / 2}" y="25" text-anchor="middle" font-size="18" font-weight="bold">${input.title}</text>` : ""}${dots}</svg>`
    }
    const dir = path.join(WORKSPACE_ROOT, "upload", "spreadsheet")
    await mkdir(dir, { recursive: true })
    const filename = `chart-${input.chartType}-${Date.now()}.svg`
    const svgPath = path.join(dir, filename)
    await writeFile(svgPath, svg, "utf8")
    return { ok: true, data: { svg, svgPath } }
  } catch (e) {
    return {
      ok: false,
      error: "chart_failed",
      message: `❌ فشل الرسم / chart generation failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 8. Workbook Summarization — markdown summary
// ---------------------------------------------------------------------------

export async function workbookSummarize(workbookId: string): Promise<SpreadsheetResult<WorkbookSummary>> {
  try {
    const row = await db.workbook.findUnique({ where: { id: workbookId } })
    if (!row) {
      return { ok: false, error: "not_found", message: `❌ المصنف غير موجود / workbook not found: ${workbookId}` }
    }
    const record = workbookRowToRecord(row)
    let totalCells = 0
    const sheetSummaries: WorkbookSummary["sheets"] = []
    for (const sheet of record.sheets) {
      totalCells += Object.keys(sheet.cells).length
      const headers = sheet.headers
      const columnTypes: Record<string, string> = {}
      const numericStats: Record<string, { min: number; max: number; mean: number; sum: number }> = {}
      for (const h of headers) {
        const values = sheet.rows.map((r) => r[h])
        const numValues = values.map((v) => Number(v)).filter((n) => !isNaN(n))
        if (numValues.length > 0 && numValues.length / values.length > 0.5) {
          columnTypes[h] = "number"
          numericStats[h] = {
            min: Math.min(...numValues),
            max: Math.max(...numValues),
            mean: numValues.reduce((s, n) => s + n, 0) / numValues.length,
            sum: numValues.reduce((s, n) => s + n, 0),
          }
        } else {
          columnTypes[h] = "string"
        }
      }
      sheetSummaries.push({
        name: sheet.name,
        rowCount: sheet.rowCount,
        colCount: sheet.colCount,
        headers,
        columnTypes,
        sampleRow: sheet.rows[0] ?? {},
        numericStats,
      })
    }
    let markdown = `# ${record.name}\n\n`
    markdown += `**Source:** ${record.source} | **Sheets:** ${record.sheets.length} | **Total cells:** ${totalCells}\n\n`
    for (const s of sheetSummaries) {
      markdown += `## Sheet: ${s.name}\n\n`
      markdown += `- Rows: ${s.rowCount} | Columns: ${s.colCount}\n`
      markdown += `- Headers: ${s.headers.join(", ")}\n`
      markdown += `- Column types: ${Object.entries(s.columnTypes).map(([k, v]) => `${k}(${v})`).join(", ")}\n\n`
      if (Object.keys(s.numericStats).length > 0) {
        markdown += `### Numeric Statistics\n\n`
        markdown += `| Column | Min | Max | Mean | Sum |\n|---|---|---|---|---|\n`
        for (const [col, stats] of Object.entries(s.numericStats)) {
          markdown += `| ${col} | ${stats.min} | ${stats.max} | ${stats.mean.toFixed(2)} | ${stats.sum} |\n`
        }
        markdown += `\n`
      }
      markdown += `### Sample Row\n\n\`\`\`json\n${JSON.stringify(s.sampleRow, null, 2)}\n\`\`\`\n\n`
    }
    return {
      ok: true,
      data: {
        workbookId,
        name: record.name,
        sheetCount: record.sheets.length,
        totalCells,
        sheets: sheetSummaries,
        markdown,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "summarize_failed",
      message: `❌ فشل التلخيص / summarize failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function workbookList(opts: { source?: WorkbookSource; limit?: number; conversationId?: string } = {}): Promise<SpreadsheetResult<WorkbookRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.source) where.source = opts.source
    if (opts.conversationId) where.conversationId = opts.conversationId
    const rows = await db.workbook.findMany({ where, orderBy: { createdAt: "desc" }, take: opts.limit ?? 50 })
    return { ok: true, data: rows.map(workbookRowToRecord) }
  } catch (e) {
    return { ok: false, error: "list_failed", message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function workbookGet(id: string): Promise<SpreadsheetResult<WorkbookRecord>> {
  try {
    const row = await db.workbook.findUnique({ where: { id } })
    if (!row) return { ok: false, error: "not_found", message: `❌ غير موجود / not found: ${id}` }
    return { ok: true, data: workbookRowToRecord(row) }
  } catch (e) {
    return { ok: false, error: "get_failed", message: `❌ فشل الجلب / get failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function formulaList(opts: { workbookId?: string; category?: string; status?: string; limit?: number } = {}): Promise<SpreadsheetResult<FormulaRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.workbookId) where.workbookId = opts.workbookId
    if (opts.category) where.category = opts.category
    if (opts.status) where.status = opts.status
    const rows = await db.formula.findMany({ where, orderBy: { createdAt: "desc" }, take: opts.limit ?? 50 })
    return { ok: true, data: rows.map(formulaRowToRecord) }
  } catch (e) {
    return { ok: false, error: "list_failed", message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface SpreadsheetSnapshot {
  totalWorkbooks: number
  totalFormulas: number
  okFormulas: number
  errorFormulas: number
  bySource: Record<string, number>
  byCategory: Record<string, number>
}

export async function spreadsheetSnapshot(): Promise<SpreadsheetResult<SpreadsheetSnapshot>> {
  try {
    const workbooks = await db.workbook.findMany()
    const formulas = await db.formula.findMany({ take: 1000 })
    const bySource: Record<string, number> = {}
    const byCategory: Record<string, number> = {}
    for (const w of workbooks) bySource[w.source] = (bySource[w.source] ?? 0) + 1
    for (const f of formulas) byCategory[f.category] = (byCategory[f.category] ?? 0) + 1
    return {
      ok: true,
      data: {
        totalWorkbooks: workbooks.length,
        totalFormulas: formulas.length,
        okFormulas: formulas.filter((f) => f.status === "ok").length,
        errorFormulas: formulas.filter((f) => f.status === "error").length,
        bySource,
        byCategory,
      },
    }
  } catch (e) {
    return { ok: false, error: "snapshot_failed", message: `❌ فشل اللقطة / snapshot failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

export function formatSpreadsheetResult<T>(result: SpreadsheetResult<T>): string {
  if (!result.ok) {
    return `${result.message}\n[error: ${result.error}]`
  }
  const data = result.data as unknown
  if (data === null || data === undefined) return "✅ OK"
  if (typeof data === "string") return data
  if (typeof data === "number" || typeof data === "boolean") return String(data)
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}
