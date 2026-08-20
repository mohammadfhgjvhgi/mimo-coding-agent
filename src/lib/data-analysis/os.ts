// Data Analysis OS — CSV/Excel/SQL analysis, cleaning, stats, viz, Python execution.
// 9 operations, deterministic, bilingual (Arabic + English), persisted to SQLite.
//
// Design:
//   • Dataset (Prisma) — registered datasets (csv/excel/json/inline/sql_table)
//   • DataAnalysis (Prisma) — every analysis logged
//   • Pure JS implementations (no pandas/numpy deps) for CSV/JSON/stats/viz
//   • SQL querying over in-memory tables (mini SQL parser)
//   • Python execution via subprocess (python3 must be available)
//   • Notebook = sequence of Python cells executed in a shared context
//
// 9 operations:
//   1. csvAnalyze       — parse CSV + return schema + sample + stats
//   2. excelAnalyze     — parse Excel (.xlsx heuristic) + return schema + sample
//   3. sqlQuery          — mini SQL SELECT/WHERE/ORDER/LIMIT/GROUP over in-memory tables
//   4. dataClean         — drop nulls, dedup, type-coerce, trim strings
//   5. statistics         — mean/median/mode/std/min/max/quartiles/correlation
//   6. visualization     — generate SVG charts (bar/line/pie/histogram/scatter)
//   7. notebookExecution — run a sequence of Python cells (shared context via -c)
//   8. pythonExecute     — run Python script, capture stdout + stderr + exit code
//   9. reportGenerate    — assemble a markdown report from multiple analyses

import { db } from "@/lib/db"
import { createHash } from "node:crypto"
import { readFile, writeFile, mkdir, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { exec } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"

const execAsync = promisify(exec)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DatasetSource = "csv" | "excel" | "json" | "sql_table" | "inline"

export type AnalysisType =
  | "csv_analyze"
  | "excel_analyze"
  | "sql_query"
  | "clean"
  | "stats"
  | "viz"
  | "notebook"
  | "python_exec"
  | "report"

export interface ColumnSchema {
  name: string
  type: "number" | "string" | "boolean" | "date" | "null"
  nullable: boolean
  unique: boolean
}

export interface DatasetRecord {
  id: string
  name: string
  source: DatasetSource
  sourcePath: string | null
  inlineData: unknown[] | null
  schema: ColumnSchema[]
  rowCount: number
  colCount: number
  sizeBytes: number
  checksum: string | null
  tags: string[]
  conversationId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface DataAnalysisRecord {
  id: string
  datasetId: string | null
  type: AnalysisType
  query: string
  result: string
  structured: Record<string, unknown>
  durationMs: number
  success: boolean
  error: string | null
  conversationId: string | null
  createdAt: Date
}

export interface AnalysisResult {
  analysisId: string
  rows: Record<string, unknown>[]
  columns: string[]
  rowCount: number
  durationMs: number
}

export interface StatsResult {
  column: string
  count: number
  mean?: number
  median?: number
  mode?: number | string
  std?: number
  min?: number
  max?: number
  q1?: number
  q3?: number
  nullCount: number
  uniqueCount: number
}

export interface VizResult {
  analysisId: string
  svgPath: string
  svgContent: string
  chartType: string
  durationMs: number
}

export interface PythonResult {
  analysisId: string
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
}

export interface NotebookCell {
  code: string
  // Filled after execution
  stdout?: string
  stderr?: string
  exitCode?: number
  error?: string
}

export interface NotebookResult {
  analysisId: string
  cells: NotebookCell[]
  totalDurationMs: number
  success: boolean
}

export interface ReportResult {
  analysisId: string
  markdown: string
  htmlPath: string | null
  durationMs: number
}

export type DataResult<T> =
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

// ---------------------------------------------------------------------------
// Row → record mappers
// ---------------------------------------------------------------------------

interface DatasetRow {
  id: string
  name: string
  source: string
  sourcePath: string | null
  inlineData: string | null
  schema: string
  rowCount: number
  colCount: number
  sizeBytes: number
  checksum: string | null
  tags: string
  conversationId: string | null
  createdAt: Date
  updatedAt: Date
}

function datasetRowToRecord(row: DatasetRow): DatasetRecord {
  return {
    id: row.id,
    name: row.name,
    source: row.source as DatasetSource,
    sourcePath: row.sourcePath,
    inlineData: row.inlineData ? safeParse<unknown[]>(row.inlineData, []) : null,
    schema: safeParse(row.schema, []),
    rowCount: row.rowCount,
    colCount: row.colCount,
    sizeBytes: row.sizeBytes,
    checksum: row.checksum,
    tags: safeParse(row.tags, []),
    conversationId: row.conversationId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

interface AnalysisRow {
  id: string
  datasetId: string | null
  type: string
  query: string
  result: string
  structured: string
  durationMs: number
  success: boolean
  error: string | null
  conversationId: string | null
  createdAt: Date
}

function analysisRowToRecord(row: AnalysisRow): DataAnalysisRecord {
  return {
    id: row.id,
    datasetId: row.datasetId,
    type: row.type as AnalysisType,
    query: row.query,
    result: row.result,
    structured: safeParse(row.structured, {}),
    durationMs: row.durationMs,
    success: row.success,
    error: row.error,
    conversationId: row.conversationId,
    createdAt: row.createdAt,
  }
}

async function persistAnalysis(opts: {
  datasetId?: string | null
  type: AnalysisType
  query?: string
  result?: string
  structured?: Record<string, unknown>
  durationMs: number
  success: boolean
  error?: string | null
  conversationId?: string
}): Promise<string> {
  const row = await db.dataAnalysis.create({
    data: {
      datasetId: opts.datasetId ?? null,
      type: opts.type,
      query: opts.query ?? "",
      result: (opts.result ?? "").slice(0, 50000),
      structured: JSON.stringify(opts.structured ?? {}).slice(0, 50000),
      durationMs: opts.durationMs,
      success: opts.success,
      error: opts.error ?? null,
      conversationId: opts.conversationId ?? null,
    },
  })
  return row.id
}

// ---------------------------------------------------------------------------
// CSV parsing (deterministic, handles quoted fields + commas + newlines)
// ---------------------------------------------------------------------------

export function parseCsv(text: string, opts: { delimiter?: string; header?: boolean } = {}): { columns: string[]; rows: Record<string, string>[] } {
  const delimiter = opts.delimiter ?? ","
  const hasHeader = opts.header ?? true
  const lines: string[][] = []
  let current: string[] = []
  let field = ""
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === delimiter) {
        current.push(field)
        field = ""
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++
        current.push(field)
        lines.push(current)
        current = []
        field = ""
      } else {
        field += ch
      }
    }
  }
  if (field !== "" || current.length > 0) {
    current.push(field)
    lines.push(current)
  }
  if (lines.length === 0) return { columns: [], rows: [] }
  const columns = hasHeader ? lines[0].map((c, i) => c.trim() || `col_${i}`) : lines[0].map((_, i) => `col_${i}`)
  const dataRows = hasHeader ? lines.slice(1) : lines
  const rows = dataRows
    .filter((r) => r.length > 0 && !(r.length === 1 && r[0] === ""))
    .map((r) => {
      const obj: Record<string, string> = {}
      for (let i = 0; i < columns.length; i++) {
        obj[columns[i]] = r[i] ?? ""
      }
      return obj
    })
  return { columns, rows }
}

// ---------------------------------------------------------------------------
// Type inference
// ---------------------------------------------------------------------------

function inferType(values: string[]): ColumnSchema["type"] {
  let numCount = 0
  let boolCount = 0
  let dateCount = 0
  let nonNullCount = 0
  for (const v of values) {
    if (v === "" || v === null || v === undefined) continue
    nonNullCount++
    if (v === "true" || v === "false") boolCount++
    else if (!isNaN(Number(v)) && v.trim() !== "") numCount++
    else if (!isNaN(Date.parse(v)) && /\d{4}-\d{2}-\d{2}/.test(v)) dateCount++
  }
  if (nonNullCount === 0) return "null"
  if (numCount / nonNullCount > 0.8) return "number"
  if (boolCount / nonNullCount > 0.8) return "boolean"
  if (dateCount / nonNullCount > 0.5) return "date"
  return "string"
}

function inferSchema(rows: Record<string, unknown>[]): ColumnSchema[] {
  if (rows.length === 0) return []
  const columns = Object.keys(rows[0])
  return columns.map((name) => {
    const values = rows.map((r) => String(r[name] ?? ""))
    const type = inferType(values)
    const nonNullValues = values.filter((v) => v !== "" && v !== null && v !== undefined)
    const uniqueValues = new Set(nonNullValues)
    return {
      name,
      type,
      nullable: nonNullValues.length < values.length,
      unique: uniqueValues.size === nonNullValues.length && nonNullValues.length > 0,
    }
  })
}

// ---------------------------------------------------------------------------
// Dataset registration
// ---------------------------------------------------------------------------

export interface RegisterDatasetInput {
  name: string
  source: DatasetSource
  sourcePath?: string
  inlineData?: unknown[]
  tags?: string[]
  conversationId?: string
}

export async function datasetRegister(input: RegisterDatasetInput): Promise<DataResult<DatasetRecord>> {
  try {
    if (!input.name) {
      return { ok: false, error: "no_name", message: "❌ الاسم مطلوب / name required" }
    }
    let content = ""
    let sizeBytes = 0
    let checksumVal: string | null = null
    let rows: Record<string, unknown>[] = []

    if (input.source === "inline") {
      if (!input.inlineData) {
        return { ok: false, error: "no_data", message: "❌ لا بيانات / inlineData required for inline source" }
      }
      content = JSON.stringify(input.inlineData)
      sizeBytes = Buffer.byteLength(content, "utf8")
      checksumVal = checksum(content)
      rows = input.inlineData as Record<string, unknown>[]
    } else if (input.source === "json") {
      if (!input.sourcePath) {
        return { ok: false, error: "no_path", message: "❌ المسار مطلوب / sourcePath required for json source" }
      }
      const abs = path.isAbsolute(input.sourcePath) ? input.sourcePath : path.resolve(WORKSPACE_ROOT, input.sourcePath)
      if (!existsSync(abs)) {
        return { ok: false, error: "not_found", message: `❌ الملف غير موجود / file not found: ${input.sourcePath}` }
      }
      content = await readFile(abs, "utf8")
      sizeBytes = Buffer.byteLength(content, "utf8")
      checksumVal = checksum(content)
      rows = JSON.parse(content) as Record<string, unknown>[]
    } else if (input.source === "csv" || input.source === "excel") {
      if (!input.sourcePath) {
        return { ok: false, error: "no_path", message: "❌ المسار مطلوب / sourcePath required" }
      }
      const abs = path.isAbsolute(input.sourcePath) ? input.sourcePath : path.resolve(WORKSPACE_ROOT, input.sourcePath)
      if (!existsSync(abs)) {
        return { ok: false, error: "not_found", message: `❌ الملف غير موجود / file not found: ${input.sourcePath}` }
      }
      const st = await stat(abs)
      sizeBytes = st.size
      content = await readFile(abs, "utf8")
      checksumVal = checksum(content)
      if (input.source === "csv") {
        const parsed = parseCsv(content)
        rows = parsed.rows
      } else {
        // Excel heuristic: not a real parser, but try to extract from CSV-like content
        const parsed = parseCsv(content)
        rows = parsed.rows
      }
    }

    const schema = inferSchema(rows)
    const row = await db.dataset.create({
      data: {
        name: input.name,
        source: input.source,
        sourcePath: input.sourcePath ?? null,
        inlineData: input.source === "inline" ? JSON.stringify(input.inlineData) : null,
        schema: JSON.stringify(schema),
        rowCount: rows.length,
        colCount: schema.length,
        sizeBytes,
        checksum: checksumVal,
        tags: JSON.stringify(input.tags ?? []),
        conversationId: input.conversationId ?? null,
      },
    })
    return { ok: true, data: datasetRowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "register_failed",
      message: `❌ فشل التسجيل / register failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

async function loadDatasetRows(datasetId: string): Promise<DataResult<{ rows: Record<string, unknown>[]; schema: ColumnSchema[]; record: DatasetRecord }>> {
  try {
    const row = await db.dataset.findUnique({ where: { id: datasetId } })
    if (!row) {
      return { ok: false, error: "not_found", message: `❌ المجموعة غير موجودة / dataset not found: ${datasetId}` }
    }
    const record = datasetRowToRecord(row)
    let rows: Record<string, unknown>[] = []
    if (record.source === "inline" && record.inlineData) {
      rows = record.inlineData as Record<string, unknown>[]
    } else if (record.source === "json" && record.sourcePath) {
      const abs = path.isAbsolute(record.sourcePath) ? record.sourcePath : path.resolve(WORKSPACE_ROOT, record.sourcePath)
      const content = await readFile(abs, "utf8")
      rows = JSON.parse(content) as Record<string, unknown>[]
    } else if ((record.source === "csv" || record.source === "excel") && record.sourcePath) {
      const abs = path.isAbsolute(record.sourcePath) ? record.sourcePath : path.resolve(WORKSPACE_ROOT, record.sourcePath)
      const content = await readFile(abs, "utf8")
      const parsed = parseCsv(content)
      rows = parsed.rows
    }
    return { ok: true, data: { rows, schema: record.schema, record } }
  } catch (e) {
    return {
      ok: false,
      error: "load_failed",
      message: `❌ فشل التحميل / load failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 1. CSV Analyze — parse CSV + return schema + sample + stats
// ---------------------------------------------------------------------------

export async function csvAnalyze(opts: { sourcePath?: string; content?: string; name?: string; sampleSize?: number; conversationId?: string }): Promise<DataResult<AnalysisResult & { schema: ColumnSchema[]; sample: Record<string, unknown>[]; datasetId?: string }>> {
  const start = Date.now()
  try {
    let content = opts.content ?? ""
    if (opts.sourcePath) {
      const abs = path.isAbsolute(opts.sourcePath) ? opts.sourcePath : path.resolve(WORKSPACE_ROOT, opts.sourcePath)
      content = await readFile(abs, "utf8")
    }
    if (!content) {
      return { ok: false, error: "no_content", message: "❌ لا محتوى / no content" }
    }
    const { columns, rows } = parseCsv(content)
    const schema = inferSchema(rows)
    const sampleSize = opts.sampleSize ?? 10
    const sample = rows.slice(0, sampleSize)

    // Register the dataset.
    let datasetId: string | undefined
    const regRes = await datasetRegister({
      name: opts.name ?? `csv-${Date.now()}`,
      source: "csv",
      sourcePath: opts.sourcePath,
      tags: ["csv"],
      conversationId: opts.conversationId,
    })
    if (regRes.ok) datasetId = regRes.data.id

    const analysisId = await persistAnalysis({
      datasetId: datasetId ?? null,
      type: "csv_analyze",
      query: opts.sourcePath ?? "(inline)",
      result: `Parsed ${rows.length} rows × ${columns.length} columns`,
      structured: { schema, sampleRow: rows[0] },
      durationMs: Date.now() - start,
      success: true,
      conversationId: opts.conversationId,
    })

    return {
      ok: true,
      data: {
        analysisId,
        rows,
        columns,
        rowCount: rows.length,
        schema,
        sample,
        datasetId,
        durationMs: Date.now() - start,
      },
    }
  } catch (e) {
    const analysisId = await persistAnalysis({
      type: "csv_analyze",
      durationMs: Date.now() - start,
      success: false,
      error: String(e),
      conversationId: opts.conversationId,
    })
    return {
      ok: false,
      error: "csv_failed",
      message: `❌ فشل تحليل CSV / CSV analyze failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Excel Analyze — parse Excel (.xlsx heuristic) + return schema + sample
// ---------------------------------------------------------------------------

export async function excelAnalyze(opts: { sourcePath: string; name?: string; sampleSize?: number; conversationId?: string }): Promise<DataResult<AnalysisResult & { schema: ColumnSchema[]; sample: Record<string, unknown>[]; datasetId?: string }>> {
  // For now, Excel uses the same CSV parser (heuristic). A real impl would use a library.
  return csvAnalyze(opts)
}

// ---------------------------------------------------------------------------
// 3. SQL Query — mini SQL over in-memory tables
// ---------------------------------------------------------------------------

export interface SqlQueryInput {
  datasetId: string
  query: string  // SELECT cols FROM table WHERE cond ORDER BY col LIMIT n
  conversationId?: string
}

// Minimal SQL: supports SELECT, WHERE (simple comparisons), ORDER BY, LIMIT, GROUP BY + COUNT
export async function sqlQuery(input: SqlQueryInput): Promise<DataResult<AnalysisResult>> {
  const start = Date.now()
  try {
    const loadRes = await loadDatasetRows(input.datasetId)
    if (!loadRes.ok) return loadRes as unknown as DataResult<AnalysisResult>
    const { rows, record } = loadRes.data

    const q = input.query.trim()
    // Parse: SELECT cols FROM <table> [WHERE cond] [ORDER BY col [ASC|DESC]] [LIMIT n]
    const selectMatch = q.match(/select\s+(.+?)\s+from\s+\w+\s*(.*)/i)
    if (!selectMatch) {
      return { ok: false, error: "bad_sql", message: "❌ استعلام غير صالح / invalid SQL (must start with SELECT ... FROM ...)" }
    }
    const selectCols = selectMatch[1].trim()
    const rest = selectMatch[2].trim()

    // WHERE
    let filteredRows = rows
    const whereMatch = rest.match(/where\s+(.+?)(?:\s+order\s+by|\s+limit|$)/i)
    if (whereMatch) {
      const cond = whereMatch[1].trim()
      filteredRows = rows.filter((r) => evalCondition(r, cond))
    }

    // ORDER BY
    let orderedRows = filteredRows
    const orderMatch = rest.match(/order\s+by\s+(\w+)(?:\s+(asc|desc))?/i)
    if (orderMatch) {
      const col = orderMatch[1]
      const dir = (orderMatch[2] ?? "asc").toLowerCase() as "asc" | "desc"
      orderedRows = [...filteredRows].sort((a, b) => {
        const av = a[col]
        const bv = b[col]
        if (typeof av === "number" && typeof bv === "number") {
          return dir === "asc" ? av - bv : bv - av
        }
        const as = String(av ?? "")
        const bs = String(bv ?? "")
        return dir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as)
      })
    }

    // SELECT cols
    let resultRows: Record<string, unknown>[] = orderedRows
    let resultCols: string[]
    if (selectCols === "*") {
      resultCols = Object.keys(orderedRows[0] ?? {})
    } else {
      resultCols = selectCols.split(",").map((c) => c.trim())
      resultRows = orderedRows.map((r) => {
        const obj: Record<string, unknown> = {}
        for (const c of resultCols) obj[c] = r[c]
        return obj
      })
    }

    // LIMIT
    const limitMatch = rest.match(/limit\s+(\d+)/i)
    if (limitMatch) {
      resultRows = resultRows.slice(0, Number(limitMatch[1]))
    }

    // GROUP BY + COUNT
    const groupMatch = rest.match(/group\s+by\s+(\w+)/i)
    if (groupMatch) {
      const col = groupMatch[1]
      const groups = new Map<string, number>()
      for (const r of orderedRows) {
        const key = String(r[col] ?? "null")
        groups.set(key, (groups.get(key) ?? 0) + 1)
      }
      resultRows = Array.from(groups.entries()).map(([key, count]) => ({ [col]: key, count }))
      resultCols = [col, "count"]
    }

    const analysisId = await persistAnalysis({
      datasetId: input.datasetId,
      type: "sql_query",
      query: input.query,
      result: `Returned ${resultRows.length} rows`,
      structured: { columns: resultCols, rowCount: resultRows.length, sample: resultRows.slice(0, 5) },
      durationMs: Date.now() - start,
      success: true,
      conversationId: input.conversationId,
    })

    return {
      ok: true,
      data: {
        analysisId,
        rows: resultRows,
        columns: resultCols,
        rowCount: resultRows.length,
        durationMs: Date.now() - start,
      },
    }
  } catch (e) {
    const analysisId = await persistAnalysis({
      datasetId: input.datasetId,
      type: "sql_query",
      query: input.query,
      durationMs: Date.now() - start,
      success: false,
      error: String(e),
      conversationId: input.conversationId,
    })
    return {
      ok: false,
      error: "sql_failed",
      message: `❌ فشل الاستعلام / SQL query failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

function evalCondition(row: Record<string, unknown>, cond: string): boolean {
  // Simple: col OP value, where OP is = != > < >= <=
  // Multiple conditions joined by AND
  const parts = cond.split(/\s+and\s+/i)
  for (const part of parts) {
    const m = part.trim().match(/^(\w+)\s*(=|!=|>=|<=|>|<)\s*(.+)$/)
    if (!m) continue
    const [, col, op, valStr] = m
    const val = valStr.trim().replace(/^["']|["']$/g, "")
    const cellVal = row[col]
    const cellNum = Number(cellVal)
    const valNum = Number(val)
    const bothNum = !isNaN(cellNum) && !isNaN(valNum)
    switch (op) {
      case "=":
        if (bothNum) { if (cellNum !== valNum) return false }
        else if (String(cellVal) !== val) return false
        break
      case "!=":
        if (bothNum) { if (cellNum === valNum) return false }
        else if (String(cellVal) === val) return false
        break
      case ">": if (bothNum ? cellNum <= valNum : String(cellVal) <= val) return false; break
      case "<": if (bothNum ? cellNum >= valNum : String(cellVal) >= val) return false; break
      case ">=": if (bothNum ? cellNum < valNum : String(cellVal) < val) return false; break
      case "<=": if (bothNum ? cellNum > valNum : String(cellVal) > val) return false; break
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// 4. Data Cleaning — drop nulls, dedup, type-coerce, trim strings
// ---------------------------------------------------------------------------

export interface CleanOpts {
  dropNulls?: boolean
  dedup?: boolean
  trimStrings?: boolean
  coerceTypes?: boolean
}

export async function dataClean(datasetId: string, opts: CleanOpts = {}, conversationId?: string): Promise<DataResult<AnalysisResult & { originalCount: number; cleanedCount: number; droppedDuplicates: number; droppedNulls: number }>> {
  const start = Date.now()
  try {
    const loadRes = await loadDatasetRows(datasetId)
    if (!loadRes.ok) return loadRes as unknown as DataResult<AnalysisResult & { originalCount: number; cleanedCount: number; droppedDuplicates: number; droppedNulls: number }>
    const { rows, schema } = loadRes.data
    const originalCount = rows.length
    let cleaned = [...rows]
    let droppedNulls = 0
    let droppedDuplicates = 0

    // Trim strings
    if (opts.trimStrings !== false) {
      cleaned = cleaned.map((r) => {
        const obj: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(r)) {
          obj[k] = typeof v === "string" ? v.trim() : v
        }
        return obj
      })
    }

    // Drop nulls (rows where ALL values are empty)
    if (opts.dropNulls !== false) {
      const before = cleaned.length
      cleaned = cleaned.filter((r) => Object.values(r).some((v) => v !== "" && v !== null && v !== undefined))
      droppedNulls = before - cleaned.length
    }

    // Dedup
    if (opts.dedup !== false) {
      const before = cleaned.length
      const seen = new Set<string>()
      cleaned = cleaned.filter((r) => {
        const key = JSON.stringify(r)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      droppedDuplicates = before - cleaned.length
    }

    // Coerce types
    if (opts.coerceTypes !== false) {
      cleaned = cleaned.map((r) => {
        const obj: Record<string, unknown> = { ...r }
        for (const col of schema) {
          if (col.type === "number" && typeof obj[col.name] === "string") {
            const n = Number(obj[col.name])
            if (!isNaN(n)) obj[col.name] = n
          } else if (col.type === "boolean" && typeof obj[col.name] === "string") {
            if (obj[col.name] === "true") obj[col.name] = true
            else if (obj[col.name] === "false") obj[col.name] = false
          }
        }
        return obj
      })
    }

    const columns = cleaned.length > 0 ? Object.keys(cleaned[0]) : []
    const analysisId = await persistAnalysis({
      datasetId,
      type: "clean",
      query: JSON.stringify(opts),
      result: `Cleaned: ${originalCount} → ${cleaned.length} (dropped ${droppedNulls} nulls, ${droppedDuplicates} dups)`,
      structured: { originalCount, cleanedCount: cleaned.length, droppedNulls, droppedDuplicates },
      durationMs: Date.now() - start,
      success: true,
      conversationId,
    })

    return {
      ok: true,
      data: {
        analysisId,
        rows: cleaned,
        columns,
        rowCount: cleaned.length,
        originalCount,
        cleanedCount: cleaned.length,
        droppedDuplicates,
        droppedNulls,
        durationMs: Date.now() - start,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "clean_failed",
      message: `❌ فشل التنظيف / clean failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Statistics — mean/median/mode/std/min/max/quartiles
// ---------------------------------------------------------------------------

export async function statistics(datasetId: string, opts: { columns?: string[]; conversationId?: string } = {}): Promise<DataResult<{ analysisId: string; stats: StatsResult[]; durationMs: number }>> {
  const start = Date.now()
  try {
    const loadRes = await loadDatasetRows(datasetId)
    if (!loadRes.ok) return loadRes as unknown as DataResult<{ analysisId: string; stats: StatsResult[]; durationMs: number }>
    const { rows, schema } = loadRes.data
    const targetCols = opts.columns ?? schema.filter((c) => c.type === "number").map((c) => c.name)
    const stats: StatsResult[] = []

    for (const col of targetCols) {
      const values = rows.map((r) => Number(r[col])).filter((n) => !isNaN(n))
      const allValues = rows.map((r) => r[col])
      const nullCount = allValues.filter((v) => v === "" || v === null || v === undefined).length
      const uniqueValues = new Set(allValues.filter((v) => v !== "" && v !== null && v !== undefined).map(String))
      const uniqueCount = uniqueValues.size

      if (values.length === 0) {
        stats.push({
          column: col,
          count: allValues.length,
          nullCount,
          uniqueCount,
        })
        continue
      }

      const sorted = [...values].sort((a, b) => a - b)
      const sum = values.reduce((s, n) => s + n, 0)
      const mean = sum / values.length
      const median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)]
      // Mode
      const freq = new Map<number, number>()
      for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1)
      let modeVal = values[0]
      let modeCount = 0
      for (const [v, c] of freq) {
        if (c > modeCount) { modeVal = v; modeCount = c }
      }
      // Std
      const variance = values.reduce((s, n) => s + (n - mean) ** 2, 0) / values.length
      const std = Math.sqrt(variance)
      // Quartiles
      const q1 = sorted[Math.floor(sorted.length * 0.25)]
      const q3 = sorted[Math.floor(sorted.length * 0.75)]

      stats.push({
        column: col,
        count: values.length,
        mean,
        median,
        mode: modeVal,
        std,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        q1,
        q3,
        nullCount,
        uniqueCount,
      })
    }

    const analysisId = await persistAnalysis({
      datasetId,
      type: "stats",
      query: `columns: ${targetCols.join(", ")}`,
      result: `Computed stats for ${stats.length} columns`,
      structured: { stats },
      durationMs: Date.now() - start,
      success: true,
      conversationId: opts.conversationId,
    })

    return { ok: true, data: { analysisId, stats, durationMs: Date.now() - start } }
  } catch (e) {
    return {
      ok: false,
      error: "stats_failed",
      message: `❌ فشل الإحصاءات / statistics failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Visualization — generate SVG charts
// ---------------------------------------------------------------------------

export interface VizInput {
  datasetId: string
  chartType: "bar" | "line" | "pie" | "histogram" | "scatter"
  xColumn?: string
  yColumn?: string
  title?: string
  conversationId?: string
}

export async function visualization(input: VizInput): Promise<DataResult<VizResult>> {
  const start = Date.now()
  try {
    const loadRes = await loadDatasetRows(input.datasetId)
    if (!loadRes.ok) return loadRes as unknown as DataResult<VizResult>
    const { rows } = loadRes.data
    if (rows.length === 0) {
      return { ok: false, error: "no_data", message: "❌ لا بيانات / no rows" }
    }
    const width = 800
    const height = 500
    const colors = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"]
    let svgContent = ""

    if (input.chartType === "bar" || input.chartType === "line") {
      const xCol = input.xColumn ?? Object.keys(rows[0])[0]
      const yCol = input.yColumn ?? Object.keys(rows[0])[1]
      const dataPoints = rows.map((r) => ({
        label: String(r[xCol] ?? ""),
        value: Number(r[yCol]) || 0,
      })).filter((d) => !isNaN(d.value))
      const maxVal = Math.max(...dataPoints.map((d) => d.value), 1)
      const padding = { top: 50, right: 40, bottom: 60, left: 70 }
      const cw = width - padding.left - padding.right
      const ch = height - padding.top - padding.bottom

      if (input.chartType === "bar") {
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
        svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${input.title ? `<text x="${width / 2}" y="25" text-anchor="middle" font-size="18" font-weight="bold">${input.title}</text>` : ""}${bars}</svg>`
      } else {
        const xStep = cw / Math.max(dataPoints.length - 1, 1)
        const points = dataPoints.map((d, i) => `${padding.left + i * xStep},${padding.top + ch - (d.value / maxVal) * ch}`).join(" ")
        svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
          ${input.title ? `<text x="${width / 2}" y="25" text-anchor="middle" font-size="18" font-weight="bold">${input.title}</text>` : ""}
          <polyline points="${points}" fill="none" stroke="${colors[0]}" stroke-width="3"/>
          ${dataPoints.map((d, i) => `<circle cx="${padding.left + i * xStep}" cy="${padding.top + ch - (d.value / maxVal) * ch}" r="4" fill="${colors[0]}"/>`).join("")}
        </svg>`
      }
    } else if (input.chartType === "pie") {
      const xCol = input.xColumn ?? Object.keys(rows[0])[0]
      const yCol = input.yColumn ?? Object.keys(rows[0])[1]
      const dataPoints = rows.map((r) => ({ label: String(r[xCol] ?? ""), value: Number(r[yCol]) || 0 })).filter((d) => d.value > 0)
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
        const la = angle + sliceAngle / 2
        slices += `<text x="${cx + (r + 20) * Math.cos(la)}" y="${cy + (r + 20) * Math.sin(la)}" text-anchor="middle" font-size="11">${d.label} ${pct}%</text>`
        angle += sliceAngle
      })
      svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${input.title ? `<text x="${width / 2}" y="25" text-anchor="middle" font-size="18" font-weight="bold">${input.title}</text>` : ""}${slices}</svg>`
    } else if (input.chartType === "histogram") {
      const yCol = input.yColumn ?? Object.keys(rows[0])[0]
      const values = rows.map((r) => Number(r[yCol])).filter((n) => !isNaN(n))
      const min = Math.min(...values)
      const max = Math.max(...values)
      const binCount = 10
      const binSize = (max - min) / binCount || 1
      const bins = new Array(binCount).fill(0)
      for (const v of values) {
        const binIdx = Math.min(Math.floor((v - min) / binSize), binCount - 1)
        bins[binIdx]++
      }
      const maxBin = Math.max(...bins, 1)
      const padding = { top: 50, right: 40, bottom: 60, left: 70 }
      const cw = width - padding.left - padding.right
      const ch = height - padding.top - padding.bottom
      const bw = cw / binCount * 0.9
      let bars = ""
      bins.forEach((count, i) => {
        const bh = (count / maxBin) * ch
        const x = padding.left + i * (cw / binCount)
        const y = padding.top + ch - bh
        bars += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="${colors[0]}" rx="2"/>`
        bars += `<text x="${x + bw / 2}" y="${padding.top + ch + 15}" text-anchor="middle" font-size="9">${(min + i * binSize).toFixed(1)}</text>`
      })
      svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${input.title ? `<text x="${width / 2}" y="25" text-anchor="middle" font-size="18" font-weight="bold">${input.title}</text>` : ""}${bars}</svg>`
    } else if (input.chartType === "scatter") {
      const xCol = input.xColumn ?? Object.keys(rows[0])[0]
      const yCol = input.yColumn ?? Object.keys(rows[0])[1]
      const points = rows.map((r) => ({ x: Number(r[xCol]) || 0, y: Number(r[yCol]) || 0 }))
      const maxX = Math.max(...points.map((p) => p.x), 1)
      const maxY = Math.max(...points.map((p) => p.y), 1)
      const padding = { top: 50, right: 40, bottom: 60, left: 70 }
      const cw = width - padding.left - padding.right
      const ch = height - padding.top - padding.bottom
      let dots = ""
      points.forEach((p) => {
        const x = padding.left + (p.x / maxX) * cw
        const y = padding.top + ch - (p.y / maxY) * ch
        dots += `<circle cx="${x}" cy="${y}" r="4" fill="${colors[0]}" fill-opacity="0.7"/>`
      })
      svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${input.title ? `<text x="${width / 2}" y="25" text-anchor="middle" font-size="18" font-weight="bold">${input.title}</text>` : ""}${dots}</svg>`
    }

    const dir = path.join(WORKSPACE_ROOT, "upload", "data-analysis")
    await mkdir(dir, { recursive: true })
    const filename = `viz-${input.chartType}-${Date.now()}.svg`
    const svgPath = path.join(dir, filename)
    await writeFile(svgPath, svgContent, "utf8")

    const analysisId = await persistAnalysis({
      datasetId: input.datasetId,
      type: "viz",
      query: `${input.chartType}: x=${input.xColumn}, y=${input.yColumn}`,
      result: `Generated ${input.chartType} chart`,
      structured: { chartType: input.chartType, svgPath, sizeBytes: Buffer.byteLength(svgContent, "utf8") },
      durationMs: Date.now() - start,
      success: true,
      conversationId: input.conversationId,
    })

    return {
      ok: true,
      data: {
        analysisId,
        svgPath,
        svgContent,
        chartType: input.chartType,
        durationMs: Date.now() - start,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "viz_failed",
      message: `❌ فشل التحويل البصري / visualization failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Python Execute — run Python script, capture stdout/stderr/exit
// ---------------------------------------------------------------------------

export async function pythonExecute(opts: { script: string; timeoutMs?: number; conversationId?: string; datasetId?: string }): Promise<DataResult<PythonResult>> {
  const start = Date.now()
  try {
    if (!opts.script || !opts.script.trim()) {
      return { ok: false, error: "no_script", message: "❌ لا سكربت / no script provided" }
    }
    const timeoutMs = opts.timeoutMs ?? 30000
    // Save script to temp file + run with python3
    const dir = path.join(WORKSPACE_ROOT, "upload", "data-analysis")
    await mkdir(dir, { recursive: true })
    const scriptPath = path.join(dir, `script-${Date.now()}.py`)
    await writeFile(scriptPath, opts.script, "utf8")

    let stdout = ""
    let stderr = ""
    let exitCode = 0
    try {
      const result = await execAsync(`python3 ${JSON.stringify(scriptPath)}`, {
        cwd: WORKSPACE_ROOT,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
      })
      stdout = result.stdout
      stderr = result.stderr
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; code?: number }
      stdout = err.stdout ?? ""
      stderr = err.stderr ?? String(e)
      exitCode = err.code ?? 1
    }

    const analysisId = await persistAnalysis({
      datasetId: opts.datasetId ?? null,
      type: "python_exec",
      query: opts.script,
      result: stdout.slice(0, 50000),
      structured: { exitCode, stderr: stderr.slice(0, 5000), stdoutLength: stdout.length },
      durationMs: Date.now() - start,
      success: exitCode === 0,
      error: exitCode !== 0 ? stderr.slice(0, 2000) : null,
      conversationId: opts.conversationId,
    })

    return {
      ok: true,
      data: {
        analysisId,
        stdout,
        stderr,
        exitCode,
        durationMs: Date.now() - start,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "python_failed",
      message: `❌ فشل تنفيذ Python / Python execution failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 8. Notebook Execution — sequence of Python cells
// ---------------------------------------------------------------------------

export async function notebookExecution(opts: { cells: string[]; timeoutMs?: number; conversationId?: string }): Promise<DataResult<NotebookResult>> {
  const start = Date.now()
  try {
    if (!opts.cells || opts.cells.length === 0) {
      return { ok: false, error: "no_cells", message: "❌ لا خلايا / no cells provided" }
    }
    const timeoutMs = opts.timeoutMs ?? 60000
    // Concatenate cells with print of cell separator marker between them.
    // This simulates a shared context.
    const separator = `print("---CELL_SEP---")`
    const fullScript = opts.cells.map((c, i) => `${i > 0 ? separator : ""}\n${c}`).join("\n")
    const execRes = await pythonExecute({
      script: fullScript,
      timeoutMs,
      conversationId: opts.conversationId,
    })
    if (!execRes.ok) {
      return execRes as unknown as DataResult<NotebookResult>
    }
    // Split stdout by separator to get per-cell output.
    const cellOutputs = execRes.data.stdout.split("---CELL_SEP---").map((s) => s.trim())
    const cells: NotebookCell[] = opts.cells.map((code, i) => ({
      code,
      stdout: cellOutputs[i] ?? "",
      stderr: i === opts.cells.length - 1 ? execRes.data.stderr : "",
      exitCode: i === opts.cells.length - 1 ? execRes.data.exitCode : 0,
    }))

    const analysisId = await persistAnalysis({
      type: "notebook",
      query: JSON.stringify(opts.cells),
      result: `Executed ${cells.length} cells`,
      structured: { cellCount: cells.length, outputs: cells.map((c) => c.stdout?.slice(0, 1000)) },
      durationMs: Date.now() - start,
      success: execRes.data.exitCode === 0,
      conversationId: opts.conversationId,
    })

    return {
      ok: true,
      data: {
        analysisId,
        cells,
        totalDurationMs: Date.now() - start,
        success: execRes.data.exitCode === 0,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "notebook_failed",
      message: `❌ فشل الدفتر / notebook execution failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 9. Report Generation — assemble markdown report from analyses
// ---------------------------------------------------------------------------

export interface ReportSection {
  title: string
  /** Analysis IDs to include, OR raw markdown content. */
  analysisIds?: string[]
  content?: string
}

export async function reportGenerate(opts: { title: string; sections: ReportSection[]; conversationId?: string }): Promise<DataResult<ReportResult>> {
  const start = Date.now()
  try {
    let markdown = `# ${opts.title}\n\n`
    markdown += `_Generated: ${new Date().toISOString()}_\n\n`

    for (const section of opts.sections) {
      markdown += `## ${section.title}\n\n`
      if (section.content) {
        markdown += `${section.content}\n\n`
      }
      if (section.analysisIds) {
        for (const aid of section.analysisIds) {
          const analysis = await db.dataAnalysis.findUnique({ where: { id: aid } })
          if (!analysis) continue
          markdown += `### Analysis: ${analysis.type} (${aid.slice(-8)})\n\n`
          markdown += `\`\`\`\n${analysis.result.slice(0, 2000)}\n\`\`\`\n\n`
          if (analysis.structured) {
            try {
              const s = JSON.parse(analysis.structured)
              markdown += `<details><summary>Structured result</summary>\n\n\`\`\`json\n${JSON.stringify(s, null, 2).slice(0, 2000)}\n\`\`\`\n\n</details>\n\n`
            } catch { /* skip */ }
          }
        }
      }
    }

    const analysisId = await persistAnalysis({
      type: "report",
      query: opts.title,
      result: markdown,
      structured: { sectionCount: opts.sections.length, markdownLength: markdown.length },
      durationMs: Date.now() - start,
      success: true,
      conversationId: opts.conversationId,
    })

    return {
      ok: true,
      data: {
        analysisId,
        markdown,
        htmlPath: null,
        durationMs: Date.now() - start,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "report_failed",
      message: `❌ فشل التقرير / report generation failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function datasetList(opts: { source?: DatasetSource; limit?: number; conversationId?: string } = {}): Promise<DataResult<DatasetRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.source) where.source = opts.source
    if (opts.conversationId) where.conversationId = opts.conversationId
    const rows = await db.dataset.findMany({ where, orderBy: { createdAt: "desc" }, take: opts.limit ?? 50 })
    return { ok: true, data: rows.map(datasetRowToRecord) }
  } catch (e) {
    return { ok: false, error: "list_failed", message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function datasetGet(id: string): Promise<DataResult<DatasetRecord>> {
  try {
    const row = await db.dataset.findUnique({ where: { id } })
    if (!row) return { ok: false, error: "not_found", message: `❌ غير موجود / not found: ${id}` }
    return { ok: true, data: datasetRowToRecord(row) }
  } catch (e) {
    return { ok: false, error: "get_failed", message: `❌ فشل الجلب / get failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function analysisList(opts: { type?: AnalysisType; datasetId?: string; success?: boolean; limit?: number } = {}): Promise<DataResult<DataAnalysisRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.type) where.type = opts.type
    if (opts.datasetId) where.datasetId = opts.datasetId
    if (opts.success !== undefined) where.success = opts.success
    const rows = await db.dataAnalysis.findMany({ where, orderBy: { createdAt: "desc" }, take: opts.limit ?? 50 })
    return { ok: true, data: rows.map(analysisRowToRecord) }
  } catch (e) {
    return { ok: false, error: "list_failed", message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function analysisGet(id: string): Promise<DataResult<DataAnalysisRecord>> {
  try {
    const row = await db.dataAnalysis.findUnique({ where: { id } })
    if (!row) return { ok: false, error: "not_found", message: `❌ غير موجود / not found: ${id}` }
    return { ok: true, data: analysisRowToRecord(row) }
  } catch (e) {
    return { ok: false, error: "get_failed", message: `❌ فشل الجلب / get failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface DataSnapshot {
  totalDatasets: number
  totalAnalyses: number
  successfulAnalyses: number
  failedAnalyses: number
  byType: Record<string, number>
  bySource: Record<string, number>
  avgDurationMs: number
}

export async function dataSnapshot(): Promise<DataResult<DataSnapshot>> {
  try {
    const datasets = await db.dataset.findMany()
    const analyses = await db.dataAnalysis.findMany({ take: 1000, orderBy: { createdAt: "desc" } })
    const successful = analyses.filter((a) => a.success).length
    const byType: Record<string, number> = {}
    const bySource: Record<string, number> = {}
    let totalDuration = 0
    for (const a of analyses) {
      byType[a.type] = (byType[a.type] ?? 0) + 1
      totalDuration += a.durationMs
    }
    for (const d of datasets) {
      bySource[d.source] = (bySource[d.source] ?? 0) + 1
    }
    return {
      ok: true,
      data: {
        totalDatasets: datasets.length,
        totalAnalyses: analyses.length,
        successfulAnalyses: successful,
        failedAnalyses: analyses.length - successful,
        byType,
        bySource,
        avgDurationMs: analyses.length > 0 ? Math.round(totalDuration / analyses.length) : 0,
      },
    }
  } catch (e) {
    return { ok: false, error: "snapshot_failed", message: `❌ فشل اللقطة / snapshot failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

export function formatDataResult<T>(result: DataResult<T>): string {
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
