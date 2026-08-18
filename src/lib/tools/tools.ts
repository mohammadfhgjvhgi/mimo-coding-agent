import fs from "node:fs/promises"
import path from "node:path"
import { resolveWorkspacePath, canWrite, ensureDirFor, truncate } from "./workspace"
import type { ToolDef, ToolResult, ToolContext } from "./types"

function ok(
  id: string,
  name: string,
  args: Record<string, unknown>,
  result: string,
  durationMs: number
): ToolResult {
  return { id, name, args, result: truncate(result), status: "success", durationMs }
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

// ---- read_file ------------------------------------------------------------
export const readFileTool: ToolDef = {
  name: "read_file",
  description:
    "يقرأ محتوى ملف نصي داخل مجلد العمل. يعيد المحتوى كاملاً (أو مقتطعاً للملفات الضخمة).",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "مسار الملف نسبةً لمجلد العمل" },
    },
    required: ["path"],
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now()
    const id = `read_${start}_${Math.random().toString(36).slice(2, 7)}`
    const rawPath = String(args.path || "")
    const resolved = resolveWorkspacePath(rawPath, ctx)
    if (!resolved.ok) {
      return fail(id, "read_file", args, resolved.error || "مسار غير صالح", 0)
    }
    try {
      const stat = await fs.stat(resolved.absolute!)
      if (stat.isDirectory()) {
        return fail(
          id,
          "read_file",
          args,
          `المسار مجلد وليس ملفاً: ${resolved.rel}`,
          Date.now() - start
        )
      }
      // Block reading very large binary-ish files
      if (stat.size > 2_000_000) {
        return fail(
          id,
          "read_file",
          args,
          `الملف ضخم (${(stat.size / 1e6).toFixed(1)}MB). استخدم أوامر طرفية للتجزئة.`,
          Date.now() - start
        )
      }
      const content = await fs.readFile(resolved.absolute!, "utf8")
      const header = `📄 ${resolved.rel} (${stat.size} bytes)\n`
      return ok(id, "read_file", args, header + content, Date.now() - start)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return fail(
        id,
        "read_file",
        args,
        `تعذر قراءة الملف: ${msg}`,
        Date.now() - start
      )
    }
  },
}

// ---- write_file -----------------------------------------------------------
export const writeFileTool: ToolDef = {
  name: "write_file",
  description:
    "ينشئ ملفاً جديداً أو يستبدل محتوى ملف موجود بالكامل داخل مجلد العمل.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "مسار الملف نسبةً لمجلد العمل" },
      content: { type: "string", description: "المحتوى الكامل للملف" },
    },
    required: ["path", "content"],
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now()
    const id = `write_${start}_${Math.random().toString(36).slice(2, 7)}`
    const rawPath = String(args.path || "")
    const content = String(args.content ?? "")
    const resolved = resolveWorkspacePath(rawPath, ctx)
    if (!resolved.ok) {
      return fail(id, "write_file", args, resolved.error || "مسار غير صالح", 0)
    }
    const guard = canWrite(resolved.rel!)
    if (!guard.ok) {
      return fail(id, "write_file", args, guard.error || "محظور", 0)
    }
    try {
      ensureDirFor(resolved.absolute!)
      const existed = await fs
        .stat(resolved.absolute!)
        .then(() => true)
        .catch(() => false)
      await fs.writeFile(resolved.absolute!, content, "utf8")
      const lineCount = content.split("\n").length
      return ok(
        id,
        "write_file",
        args,
        `${existed ? "✏️ تم استبدال" : "✅ تم إنشاء"} ${resolved.rel} (${content.length} محرف، ${lineCount} سطر)`,
        Date.now() - start
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return fail(
        id,
        "write_file",
        args,
        `تعذر كتابة الملف: ${msg}`,
        Date.now() - start
      )
    }
  },
}

// ---- edit_file (search & replace) ----------------------------------------
export const editFileTool: ToolDef = {
  name: "edit_file",
  description:
    "يعدّل ملفاً موجوداً جزئياً عبر استبدال أول ظهور (أو كل الظهور) لنص بحث بنص بديل. استخدمه بدلاً من write_file عند تعديل جزء صغير.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "مسار الملف نسبةً لمجلد العمل" },
      search: {
        type: "string",
        description: "النص المراد البحث عنه (يجب أن يطابق تماماً جزءاً من الملف)",
      },
      replace: { type: "string", description: "النص البديل" },
      replaceAll: {
        type: "boolean",
        description: "استبدل كل الظهور (افتراضي: false = أول ظهور فقط)",
      },
    },
    required: ["path", "search", "replace"],
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now()
    const id = `edit_${start}_${Math.random().toString(36).slice(2, 7)}`
    const rawPath = String(args.path || "")
    const search = String(args.search ?? "")
    const replace = String(args.replace ?? "")
    const replaceAll = args.replaceAll === true
    const resolved = resolveWorkspacePath(rawPath, ctx)
    if (!resolved.ok) {
      return fail(id, "edit_file", args, resolved.error || "مسار غير صالح", 0)
    }
    const guard = canWrite(resolved.rel!)
    if (!guard.ok) {
      return fail(id, "edit_file", args, guard.error || "محظور", 0)
    }
    if (!search) {
      return fail(id, "edit_file", args, "حقل search مطلوب", 0)
    }
    try {
      const original = await fs.readFile(resolved.absolute!, "utf8")
      if (!original.includes(search)) {
        return fail(
          id,
          "edit_file",
          args,
          `لم يُعثر على نص البحث في الملف. تأكد من المطابقة التامة (المسافات، الأسطر الجديدة).`,
          Date.now() - start
        )
      }
      let newContent: string
      let hits: number
      if (replaceAll) {
        const parts = original.split(search)
        hits = parts.length - 1
        newContent = parts.join(replace)
      } else {
        const idx = original.indexOf(search)
        newContent =
          original.slice(0, idx) + replace + original.slice(idx + search.length)
        hits = 1
      }
      await fs.writeFile(resolved.absolute!, newContent, "utf8")
      // Produce a tiny diff-like preview
      const diffStart = Math.max(0, newContent.indexOf(replace) - 60)
      const diffEnd = Math.min(newContent.length, diffStart + replace.length + 120)
      const preview = newContent.slice(diffStart, diffEnd)
      return ok(
        id,
        "edit_file",
        args,
        `✏️ تم تعديل ${resolved.rel} — ${hits} استبدال.\nمعاينة السياق:\n…${preview}…`,
        Date.now() - start
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return fail(
        id,
        "edit_file",
        args,
        `تعذر تعديل الملف: ${msg}`,
        Date.now() - start
      )
    }
  },
}

// ---- run_terminal_command -------------------------------------------------
import { spawn } from "node:child_process"

const COMMAND_DENYLIST = [
  /\brm\s+-rf\s+\/(\s|$)/, // rm -rf /
  /\bmkfs\b/,
  /\bdd\s+.*of=\/dev\//,
  /:\(\)\s*\{\s*:\|:&\s*\};:/, // fork bomb
  /\bshutdown\b/,
  /\breboot\b/,
]

export const runTerminalTool: ToolDef = {
  name: "run_terminal_command",
  description:
    "ينفّذ أمر طرفية داخل مجلد العمل ويعيد stdout و stderr و كود الخروج. مهلة قصوى 30 ثانية.",
  schema: {
    type: "object",
    properties: {
      command: { type: "string", description: "الأمر الكامل (مثل: git status)" },
      timeoutMs: {
        type: "number",
        description: "المهلة بالملي ثانية (افتراضي 30000، أقصى 60000)",
      },
    },
    required: ["command"],
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now()
    const id = `term_${start}_${Math.random().toString(36).slice(2, 7)}`
    const command = String(args.command || "").trim()
    if (!command) {
      return fail(id, "run_terminal_command", args, "الأمر فارغ", 0)
    }
    for (const pattern of COMMAND_DENYLIST) {
      if (pattern.test(command)) {
        return fail(
          id,
          "run_terminal_command",
          args,
          `الأمر محظور لأسباب أمنية (يطابق نمطاً خطيراً).`,
          0
        )
      }
    }
    const requestedTimeout = Number(args.timeoutMs) || 30000
    const timeoutMs = Math.min(Math.max(requestedTimeout, 3000), 60000)

    return new Promise((resolve) => {
      let stdout = ""
      let stderr = ""
      let timedOut = false
      const child = spawn("bash", ["-lc", command], {
        cwd: ctx.workspaceRoot,
        env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
        timeout: timeoutMs,
      })

      child.stdout?.on("data", (d) => {
        stdout += d.toString()
      })
      child.stderr?.on("data", (d) => {
        stderr += d.toString()
      })

      child.on("error", (err) => {
        resolve(
          fail(
            id,
            "run_terminal_command",
            args,
            `خطأ في تشغيل الأمر: ${err.message}`,
            Date.now() - start
          )
        )
      })

      child.on("close", (code) => {
        const status = code === 0 && !timedOut ? "success" : "error"
        const out =
          (stdout ? `📤 stdout:\n${truncate(stdout, 6000)}\n` : "") +
          (stderr ? `⚠️ stderr:\n${truncate(stderr, 6000)}\n` : "") +
          `— كود الخروج: ${code}${timedOut ? " (انتهت المهلة)" : ""}`
        const result: ToolResult = {
          id,
          name: "run_terminal_command",
          args,
          result: out.trim() || "— لا مخرجات —",
          status,
          durationMs: Date.now() - start,
          ...(status === "error" && code !== 0 && stderr
            ? { error: `كود الخروج ${code}` }
            : {}),
        }
        resolve(result)
      })
    })
  },
}

// ---- list_files (repo map) ------------------------------------------------
import { readdirSync, statSync } from "node:fs"

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
])

export interface TreeNode {
  name: string
  path: string
  type: "dir" | "file"
  children?: TreeNode[]
}

export function buildTree(dirAbs: string, rel: string, depth: number, maxDepth: number): TreeNode[] {
  if (depth > maxDepth) return []
  let entries: ReturnType<typeof readdirSync> = []
  try {
    entries = readdirSync(dirAbs, { withFileTypes: true }) as unknown as ReturnType<typeof readdirSync>
  } catch {
    return []
  }
  const nodes: TreeNode[] = []
  // sort: dirs first, then files, alphabetical
  entries
    .filter((e) => {
      const name = String(e.name)
      return !IGNORED_DIRS.has(name) && !name.startsWith(".")
    })
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return String(a.name).localeCompare(String(b.name))
    })
    .slice(0, 200)
    .forEach((entry) => {
      const name = String(entry.name)
      const childAbs = path.join(dirAbs, name)
      const childRel = rel ? `${rel}/${name}` : name
      if (entry.isDirectory()) {
        nodes.push({
          name,
          path: childRel,
          type: "dir",
          children: buildTree(childAbs, childRel, depth + 1, maxDepth),
        })
      } else {
        nodes.push({ name, path: childRel, type: "file" })
      }
    })
  return nodes
}

function renderTree(nodes: TreeNode[], prefix: string, lines: string[]) {
  nodes.forEach((node, i) => {
    const isLast = i === nodes.length - 1
    const branch = isLast ? "└── " : "├── "
    if (node.type === "dir") {
      lines.push(`${prefix}${branch}${node.name}/`)
      const childPrefix = prefix + (isLast ? "    " : "│   ")
      renderTree(node.children || [], childPrefix, lines)
    } else {
      lines.push(`${prefix}${branch}${node.name}`)
    }
  })
}

export const listFilesTool: ToolDef = {
  name: "list_files",
  description:
    "يُرجع شجرة ملفات المشروع الحالي (تجاهل node_modules و .git و .next وغيرها). استخدمها لرؤية هيكل المشروع قبل قراءة أو تعديل الملفات.",
  schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "مسار فرعي لبدء الرسم منه (افتراضي: جذر المشروع)",
      },
      depth: {
        type: "number",
        description: "أقصى عمق للتشعب (افتراضي 4، أقصى 8)",
      },
    },
    required: [],
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now()
    const id = `list_${start}_${Math.random().toString(36).slice(2, 7)}`
    const subPath = String(args.path || "").trim()
    const requestedDepth = Number(args.depth) || 4
    const maxDepth = Math.min(Math.max(requestedDepth, 1), 8)

    const resolved = resolveWorkspacePath(subPath || ".", ctx)
    if (!resolved.ok) {
      return fail(id, "list_files", args, resolved.error || "مسار غير صالح", 0)
    }
    try {
      const st = statSync(resolved.absolute!)
      if (!st.isDirectory()) {
        return fail(id, "list_files", args, `ليس مجلداً: ${resolved.rel}`, 0)
      }
      const absPath = resolved.absolute || ""
      const tree = buildTree(absPath, resolved.rel || ".", 0, maxDepth)
      const lines: string[] = [`${resolved.rel || "."}/`]
      renderTree(tree, "", lines)
      const rendered = lines.join("\n")
      const count = rendered.split("\n").length - 1
      return ok(
        id,
        "list_files",
        args,
        `🗂️ خريطة المستودع (${count} عنصر، عمق ${maxDepth}):\n\n\`\`\`\n${rendered}\n\`\`\``,
        Date.now() - start
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return fail(id, "list_files", args, `تعذر رسم الشجرة: ${msg}`, Date.now() - start)
    }
  },
}

// ---- git_checkpoint -------------------------------------------------------
export const gitCheckpointTool: ToolDef = {
  name: "git_checkpoint",
  description:
    "يحفظ نقطة استرجاع (Checkpoint) عبر git add و git commit برسالة موحدة. استخدمها بعد كل تعديل مهم ليتسنى للمستخدم التراجع عنه لاحقاً.",
  schema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "رسالة الـ commit (افتراضي: MiMo X Checkpoint)",
      },
    },
    required: [],
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now()
    const id = `git_${start}_${Math.random().toString(36).slice(2, 7)}`
    const message = String(args.message || "MiMo X Checkpoint").trim()

    const run = (cmd: string) =>
      new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
        const child = spawn("bash", ["-lc", cmd], {
          cwd: ctx.workspaceRoot,
          env: { ...process.env },
          timeout: 20000,
        })
        let stdout = ""
        let stderr = ""
        child.stdout?.on("data", (d) => (stdout += d.toString()))
        child.stderr?.on("data", (d) => (stderr += d.toString()))
        child.on("close", (code) =>
          resolve({ stdout, stderr, code: code ?? -1 })
        )
        child.on("error", () =>
          resolve({ stdout, stderr, code: -1 })
        )
      })

    // Ensure git is initialized
    const initCheck = await run("git rev-parse --is-inside-work-tree 2>/dev/null")
    if (initCheck.code !== 0) {
      const initRes = await run("git init")
      if (initRes.code !== 0) {
        return fail(
          id,
          "git_checkpoint",
          args,
          `تعذر تهيئة git: ${initRes.stderr || initRes.stdout}`,
          Date.now() - start
        )
      }
    }

    // Ensure user config exists (for commits)
    await run('git config user.email >/dev/null 2>&1 || git config user.email "mimo-x@local"')
    await run('git config user.name >/dev/null 2>&1 || git config user.name "MiMo X"')

    // Stage everything
    const addRes = await run("git add -A")
    if (addRes.code !== 0) {
      return fail(
        id,
        "git_checkpoint",
        args,
        `فشل git add: ${addRes.stderr || addRes.stdout}`,
        Date.now() - start
      )
    }

    // Check if there is anything to commit
    const statusRes = await run("git status --porcelain")
    if (!statusRes.stdout.trim()) {
      // Nothing to commit — return the current HEAD
      const headRes = await run("git rev-parse --short HEAD")
      return ok(
        id,
        "git_checkpoint",
        args,
        `ℹ️ لا توجد تغييرات جديدة للحفظ. HEAD الحالي: ${headRes.stdout.trim() || "(none)"}`,
        Date.now() - start
      )
    }

    // Commit
    const commitRes = await run(`git commit -m ${JSON.stringify(message)}`)
    if (commitRes.code !== 0) {
      // Maybe nothing to commit after all (race) — report gracefully
      if (/nothing to commit|no changes/i.test(commitRes.stdout + commitRes.stderr)) {
        const headRes = await run("git rev-parse --short HEAD")
        return ok(
          id,
          "git_checkpoint",
          args,
          `ℹ️ لا تغييرات. HEAD: ${headRes.stdout.trim()}`,
          Date.now() - start
        )
      }
      return fail(
        id,
        "git_checkpoint",
        args,
        `فشل git commit: ${commitRes.stderr || commitRes.stdout}`,
        Date.now() - start
      )
    }

    const headRes = await run("git rev-parse --short HEAD")
    const hash = headRes.stdout.trim()
    return ok(
      id,
      "git_checkpoint",
      args,
      `✅ تم حفظ نقطة الاسترجاع (${hash}).\nالرسالة: ${message}\nيمكن للمستخدم التراجع عن هذه التغييرات عبر زر "نقاط الاسترجاع" في الواجهة.`,
      Date.now() - start
    )
  },
}
