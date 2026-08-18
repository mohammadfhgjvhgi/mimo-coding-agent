// Code Intelligence Tools — find_symbol, get_references, structural_search
import { findSymbol, getReferences } from "./symbol-index"
import { indexFile } from "./symbol-index"
import { resolveWorkspacePath, WORKSPACE_ROOT, truncate } from "@/lib/tools/workspace"
import type { ToolDef, ToolResult, ToolContext } from "@/lib/tools/types"
import { spawn } from "node:child_process"
import path from "node:path"
import fs from "node:fs"

function ok(
  id: string,
  name: string,
  args: Record<string, unknown>,
  result: string,
  durationMs: number
): ToolResult {
  return { id, name, args, result: truncate(result, 4000), status: "success", durationMs }
}
function fail(
  id: string,
  name: string,
  args: Record<string, unknown>,
  error: string,
  durationMs: number
): ToolResult {
  return { id, name, args, result: error, status: "error", error, durationMs }
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

// ---- find_symbol ----------------------------------------------------------
export const findSymbolTool: ToolDef = {
  name: "find_symbol",
  description:
    "يبحث عن رمز (دالة/كلاس/متغير) في كامل المشروع عبر فهرس الرموز ويعيد موقعه وتوقيعه. أسرع بكثير من قراءة الملفات يدوياً.",
  schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "اسم الرمز المراد البحث عنه" },
    },
    required: ["name"],
  },
  async execute(args): Promise<ToolResult> {
    const start = Date.now()
    const id = newId("fsym")
    const name = String(args.name || "").trim()
    if (!name) return fail(id, "find_symbol", args, "اسم الرمز مطلوب", 0)

    try {
      const symbols = await findSymbol(name)
      if (symbols.length === 0) {
        return ok(
          id,
          "find_symbol",
          args,
          `🔍 لم يُعثر على رمز بالاسم: ${name}\nجرّب اسماً آخر أو استخدم list_files لمعرفة بنية المشروع.`,
          Date.now() - start
        )
      }
      const lines = symbols.map(
        (s) =>
          `${s.type === "function" ? "ƒ" : s.type === "class" ? "🏛" : s.type === "method" ? "⚙" : s.type === "interface" ? "📋" : "📦"} ${s.name} — ${s.filePath}:${s.line}\n  ${s.signature}`
      )
      return ok(
        id,
        "find_symbol",
        args,
        `🔍 وُجد ${symbols.length} رمز بالاسم "${name}":\n\n${lines.join("\n\n")}`,
        Date.now() - start
      )
    } catch (e) {
      return fail(
        id,
        "find_symbol",
        args,
        `فشل البحث: ${e instanceof Error ? e.message : String(e)}`,
        Date.now() - start
      )
    }
  },
}

// ---- get_references -------------------------------------------------------
export const getReferencesTool: ToolDef = {
  name: "get_references",
  description:
    "يجد جميع الأماكن التي يُستخدم فيها رمز معين (Callers) في كامل المشروع. مفيد قبل تعديل دالة لمعرفة تأثير ذلك.",
  schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "اسم الرمز (دالة/كلاس/متغير)" },
    },
    required: ["name"],
  },
  async execute(args): Promise<ToolResult> {
    const start = Date.now()
    const id = newId("gref")
    const name = String(args.name || "").trim()
    if (!name) return fail(id, "get_references", args, "اسم الرمز مطلوب", 0)

    try {
      const refs = await getReferences(name)
      if (refs.length === 0) {
        return ok(
          id,
          "get_references",
          args,
          `🔗 لم تُوجد مراجع للرمز: ${name}`,
          Date.now() - start
        )
      }
      const usages = refs.filter((r) => !r.isDeclaration)
      const decls = refs.filter((r) => r.isDeclaration)
      const lines = refs.slice(0, 30).map(
        (r) =>
          `${r.isDeclaration ? "📌 تعريف" : "🔗 استدعاء"} — ${r.filePath}:${r.line}\n  ${r.text}`
      )
      return ok(
        id,
        "get_references",
        args,
        `🔗 مراجع "${name}" (${refs.length} إجمالاً، ${usages.length} استخدام، ${decls.length} تعريف):\n\n${lines.join("\n\n")}${refs.length > 30 ? `\n\n…و ${refs.length - 30} مرجع آخر` : ""}`,
        Date.now() - start
      )
    } catch (e) {
      return fail(
        id,
        "get_references",
        args,
        `فشل البحث عن المراجع: ${e instanceof Error ? e.message : String(e)}`,
        Date.now() - start
      )
    }
  },
}

// ---- structural_search (ast-grep) ------------------------------------------
export const structuralSearchTool: ToolDef = {
  name: "structural_search",
  description:
    "بحث هيكلي عن أنماط كود (مثل: جميع دوال الـ arrow بدون return، أو جميع الدوال التي تأخذ أكثر من 3 معاملات). استخدم صيغة ast-grep.",
  schema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "نمط ast-grep (مثل: '$_($$$)' للبحث عن جميع الاستدعاءات)",
      },
      language: {
        type: "string",
        description: "لغة البحث: js | ts | tsx (افتراضي: js)",
      },
      path: {
        type: "string",
        description: "مسار فرعي للبحث (افتراضي: جذر المشروع)",
      },
    },
    required: ["pattern"],
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now()
    const id = newId("ssearch")
    const pattern = String(args.pattern || "").trim()
    const language = String(args.language || "js").trim()
    const subPath = String(args.path || "").trim()

    if (!pattern) return fail(id, "structural_search", args, "النمط مطلوب", 0)

    const resolved = resolveWorkspacePath(subPath || ".", ctx)
    if (!resolved.ok) return fail(id, "structural_search", args, resolved.error || "مسار غير صالح", 0)

    // Try ast-grep CLI (sg); fall back to regex if not installed
    const result = await new Promise<{ stdout: string; stderr: string; code: number }>(
      (resolve) => {
        const child = spawn(
          "npx",
          ["--yes", "@ast-grep/cli", `--lang=${language}`, "--json=compact", "run", pattern],
          {
            cwd: resolved.absolute,
            env: { ...process.env },
            timeout: 15000,
          }
        )
        let stdout = ""
        let stderr = ""
        child.stdout?.on("data", (d) => (stdout += d.toString()))
        child.stderr?.on("data", (d) => (stderr += d.toString()))
        child.on("close", (code) => resolve({ stdout, stderr, code: code ?? -1 }))
        child.on("error", () => resolve({ stdout, stderr, code: -1 }))
      }
    )

    if (result.code !== 0 && !result.stdout) {
      // ast-grep not available — fall back to simple text search of the pattern
      return ok(
        id,
        "structural_search",
        args,
        `⚠️ ast-grep غير متاح، استخدام بحث نصي بديل.\nالبحث عن: "${pattern}"\n\n${fallbackTextSearch(resolved.absolute!, pattern, language)}`,
        Date.now() - start
      )
    }

    try {
      // Parse ast-grep JSON output
      const data = JSON.parse(result.stdout || "[]") as Array<{
        file: string
        range?: { byteOffset?: { start: number; end: number } }
        text?: string
      }>
      if (data.length === 0) {
        return ok(
          id,
          "structural_search",
          args,
          `🔍 لا نتائج للنمط: ${pattern}`,
          Date.now() - start
        )
      }
      const lines = data.slice(0, 20).map((m) => {
        const rel = path.relative(ctx.workspaceRoot, m.file)
        return `  ${rel}${m.text ? `: ${m.text.trim().slice(0, 80)}` : ""}`
      })
      return ok(
        id,
        "structural_search",
        args,
        `🔍 ${data.length} نتيجة للنمط "${pattern}" (${language}):\n${lines.join("\n")}${data.length > 20 ? `\n…و ${data.length - 20} نتيجة أخرى` : ""}`,
        Date.now() - start
      )
    } catch {
      return ok(
        id,
        "structural_search",
        args,
        result.stdout.slice(0, 2000) || result.stderr.slice(0, 500),
        Date.now() - start
      )
    }
  },
}

// Fallback text search when ast-grep isn't available
function fallbackTextSearch(dirAbs: string, pattern: string, _language: string): string {
  const matches: string[] = []
  const walk = (dir: string, rel: string) => {
    let entries: ReturnType<typeof readdirSync>
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (IGNORED.has(e.name) || e.name.startsWith(".")) continue
      const abs = path.join(dir, e.name)
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(abs, r)
      else if (/\.(js|jsx|ts|tsx|mjs)$/.test(e.name)) {
        try {
          const src = fs.readFileSync(abs, "utf8")
          const lines = src.split("\n")
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(pattern)) {
              matches.push(`  ${r}:${i + 1}: ${lines[i].trim().slice(0, 80)}`)
            }
          }
        } catch {
          /* ignore */
        }
      }
    }
  }
  walk(dirAbs, "")
  return matches.slice(0, 20).join("\n") || "لا نتائج"
}

const IGNORED = new Set(["node_modules", ".git", ".next", ".turbo", "dist", "build", "out", ".cache"])

import { readdirSync } from "node:fs"
void fs
