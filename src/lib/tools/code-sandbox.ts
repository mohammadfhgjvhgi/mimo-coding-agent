// Code Sandbox — safe code execution without Docker.
// Uses child_process with timeout + output limit.
// For JS: node -e. For Python: python3 -c.
// NOT as secure as Docker isolation, but works in environments without Docker.

import type { ToolDef, ToolResult, ToolContext } from "./types"
import { truncate } from "./workspace"

function ok(id: string, name: string, args: Record<string, unknown>, result: string, durationMs: number): ToolResult {
  return { id, name, args, result: truncate(result, 6000), status: "success", durationMs }
}
function fail(id: string, name: string, args: Record<string, unknown>, error: string, durationMs: number): ToolResult {
  return { id, name, args, result: error, status: "error", error, durationMs }
}
function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

// Dynamic import to avoid Turbopack static analysis issues
async function getSpawn(): Promise<typeof import("node:child_process").spawn> {
  const mod = await import("node:child_process")
  return mod.spawn
}

function runCode(language: string, code: string, timeoutMs = 10000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise(async (resolve) => {
    let cmd: string
    let args: string[]

    if (language === "python" || language === "py") {
      cmd = "python3"
      args = ["-c", code]
    } else if (language === "javascript" || language === "js") {
      cmd = "node"
      args = ["-e", code]
    } else {
      resolve({ stdout: "", stderr: `Unsupported language: ${language}`, code: -1 })
      return
    }

    try {
      const spawn = await getSpawn()
      const child = spawn(cmd, args, {
        cwd: "/tmp",
        env: { ...process.env, NODE_NO_WARNINGS: "1" },
        timeout: timeoutMs,
      })

      let stdout = ""
      let stderr = ""
      child.stdout?.on("data", (d: Buffer) => {
        const chunk = d.toString()
        if (stdout.length < 10000) stdout += chunk.slice(0, 10000 - stdout.length)
      })
      child.stderr?.on("data", (d: Buffer) => {
        const chunk = d.toString()
        if (stderr.length < 5000) stderr += chunk.slice(0, 5000 - stderr.length)
      })
      child.on("close", (code: number | null) => resolve({ stdout, stderr, code: code ?? -1 }))
      child.on("error", () => resolve({ stdout, stderr: "Failed to spawn process", code: -1 }))
    } catch {
      resolve({ stdout: "", stderr: "Failed to import child_process", code: -1 })
    }
  })
}

export const runCodeTool: ToolDef = {
  name: "run_code",
  description:
    "يشغّل كود JavaScript أو Python في بيئة معزولة (timeout 10 ثواني، output limit 10K). آمن للتجارب السريعة.",
  schema: {
    type: "object",
    properties: {
      language: {
        type: "string",
        description: "javascript | python",
      },
      code: {
        type: "string",
        description: "الكود المراد تشغيله",
      },
    },
    required: ["language", "code"],
  },
  async execute(args): Promise<ToolResult> {
    const start = Date.now()
    const id = newId("code")
    const language = String(args.language || "").trim().toLowerCase()
    const code = String(args.code || "")

    if (!code) return fail(id, "run_code", args, "الكود مطلوب", 0)
    if (!["javascript", "js", "python", "py"].includes(language)) {
      return fail(id, "run_code", args, "اللغة يجب أن تكون javascript أو python", 0)
    }

    // Denylist — block dangerous patterns
    const dangerous = [
      /require\s*\(\s*['"]child_process['"]/, /import.*child_process/,
      /require\s*\(\s*['"]fs['"]/, /import.*fs/,
      /require\s*\(\s*['"]net['"]/, /import.*net/,
      /process\.exit/, /process\.kill/,
      /__dirname/, /__filename/,
    ]
    for (const pattern of dangerous) {
      if (pattern.test(code)) {
        return fail(id, "run_code", args, `الكود يحوي نمطاً خطراً ممنوعاً`, 0)
      }
    }

    const result = await runCode(language, code)
    const status = result.code === 0 ? "success" : "error"
    const output =
      (result.stdout ? `📤 stdout:\n${result.stdout}` : "") +
      (result.stderr ? `${result.stdout ? "\n" : ""}⚠️ stderr:\n${result.stderr}` : "") +
      `\n— كود الخروج: ${result.code}${result.code === -1 ? " (timeout/error)" : ""}`

    return {
      id,
      name: "run_code",
      args,
      result: output.trim() || "— لا مخرجات —",
      status: status as "success" | "error",
      durationMs: Date.now() - start,
      ...(status === "error" ? { error: `exit code ${result.code}` } : {}),
    }
  },
}
