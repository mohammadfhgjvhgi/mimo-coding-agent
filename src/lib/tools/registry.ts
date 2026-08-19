import {
  readFileTool,
  writeFileTool,
  editFileTool,
  runTerminalTool,
  listFilesTool,
  gitCheckpointTool,
} from "./tools"
import { saveMemoryTool, recallMemoryTool } from "./memory"
import { setGoalTool } from "./goals"
import { verifyFile } from "./auto-verify"
import { findSymbolTool, getReferencesTool, structuralSearchTool } from "@/lib/code-intel/code-intel-tools"
import { browserNavigateTool, browserScreenshotTool } from "@/lib/ecosystem/browser-tool"
import { githubGetIssuesTool, githubGetRepoInfoTool } from "@/lib/ecosystem/github-tool"
import { callMcpToolTool } from "@/lib/ecosystem/mcp-tool"
import { runCodeTool } from "@/lib/tools/code-sandbox"
import type { ToolCall, ToolDef, ToolResult, ToolContext } from "./types"

// Registry of available tools
export const REGISTRY: Record<string, ToolDef> = {
  read_file: readFileTool,
  write_file: writeFileTool,
  edit_file: editFileTool,
  run_terminal_command: runTerminalTool,
  list_files: listFilesTool,
  git_checkpoint: gitCheckpointTool,
  save_memory: saveMemoryTool,
  recall_memory: recallMemoryTool,
  set_goal: setGoalTool,
  find_symbol: findSymbolTool,
  get_references: getReferencesTool,
  structural_search: structuralSearchTool,
  browser_navigate: browserNavigateTool,
  browser_screenshot: browserScreenshotTool,
  github_get_issues: githubGetIssuesTool,
  github_get_repo_info: githubGetRepoInfoTool,
  call_mcp_tool: callMcpToolTool,
  run_code: runCodeTool,
}

export function listToolNames(): string[] {
  return Object.keys(REGISTRY)
}

export function getTool(name: string): ToolDef | undefined {
  return REGISTRY[name]
}

// Basic argument validation against the tool's JSON schema (presence of
// required keys + type checks for primitives). This catches obvious model
// mistakes before the tool runs.
function validateArgs(
  args: Record<string, unknown>,
  schema: Record<string, unknown>
): { ok: boolean; error?: string } {
  const required = (schema.required as string[]) || []
  const properties = (schema.properties as Record<string, unknown>) || {}
  for (const key of required) {
    if (!(key in args) || args[key] === undefined || args[key] === null) {
      return { ok: false, error: `الحقل المطلوب مفقود: ${key}` }
    }
  }
  for (const [key, val] of Object.entries(args)) {
    const spec = properties[key] as { type?: string } | undefined
    if (spec?.type) {
      const t = spec.type
      if (t === "string" && typeof val !== "string") {
        return { ok: false, error: `${key} يجب أن يكون نصاً` }
      }
      if (t === "boolean" && typeof val !== "boolean") {
        return { ok: false, error: `${key} يجب أن يكون قيمة منطقية` }
      }
      if (t === "number" && typeof val !== "number") {
        return { ok: false, error: `${key} يجب أن يكون رقماً` }
      }
    }
  }
  return { ok: true }
}

// Execute a tool call end-to-end: lookup → validate → run.
export async function dispatchTool(
  call: ToolCall,
  ctx: ToolContext
): Promise<ToolResult> {
  const tool = REGISTRY[call.name]
  if (!tool) {
    return {
      id: call.id,
      name: call.name,
      args: call.args,
      result: `الأداة غير معروفة: ${call.name}. الأدوات المتاحة: ${Object.keys(REGISTRY).join(", ")}`,
      status: "error",
      error: "unknown tool",
      durationMs: 0,
    }
  }
  const validation = validateArgs(call.args, tool.schema)
  if (!validation.ok) {
    return {
      id: call.id,
      name: call.name,
      args: call.args,
      result: `خطأ في المدخلات: ${validation.error}`,
      status: "error",
      error: validation.error,
      durationMs: 0,
    }
  }
  try {
    const result = await tool.execute(call.args, ctx)
    // Force the result id to match the call id so the UI can correlate
    // tool_call ↔ tool_result events reliably (tools generate their own ids
    // internally; we override here to keep them consistent with the agent loop).
    result.id = call.id

    // Verification Ladder: after write_file/edit_file, run multi-stage verification
    // (syntax → lint → test) so the agent sees errors and can self-correct.
    if (
      (call.name === "write_file" || call.name === "edit_file") &&
      result.status === "success" &&
      typeof call.args?.path === "string"
    ) {
      try {
        const { runVerificationLadder, formatLadderResult } = await import("@/lib/verification/ladder")
        const ladder = await runVerificationLadder(String(call.args.path))
        result.result += `\n\n${formatLadderResult(ladder)}`
        if (!ladder.allPassed) {
          result.error = `verification: ${ladder.summary}`
        }
      } catch {
        // Fallback to simple verifyFile
        try {
          const verification = await verifyFile(String(call.args.path))
          if (!verification.ok) {
            result.result += `\n\n🔍 ${verification.summary}\n${verification.details}`
            result.error = `verification: ${verification.summary}`
          } else {
            result.result += `\n\n🔍 ${verification.summary}`
          }
        } catch {
          // best-effort; never fail the tool
        }
      }

      // Code Intelligence Hook: reindex the modified file's symbols
      try {
        const { indexFile } = await import("@/lib/code-intel/symbol-index")
        await indexFile(String(call.args.path))
      } catch {
        // best-effort; never fail the tool
      }
    }

    // STEP 1: Sanitize tool output before returning (Prompt Injection Defense)
    try {
      const { sanitizeToolOutput } = await import("@/lib/security/sanitizer")
      result.result = sanitizeToolOutput(result.result)
    } catch { /* best-effort */ }

    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      id: call.id,
      name: call.name,
      args: call.args,
      result: `خطأ غير متوقع: ${msg}`,
      status: "error",
      error: msg,
      durationMs: 0,
    }
  }
}

// Build a human-readable manifest of tools for the system prompt.
export function buildToolManifest(): string {
  return Object.values(REGISTRY)
    .map((t) => {
      const props = t.schema.properties as Record<string, { type?: string; description?: string }>
      const required = (t.schema.required as string[]) || []
      const params = Object.entries(props)
        .map(
          ([k, v]) =>
            `    - ${k}${required.includes(k) ? " (مطلوب)" : ""}: ${v.description || ""} (${v.type || "any"})`
        )
        .join("\n")
      return `### ${t.name}\n${t.description}\nالمعلمات:\n${params}`
    })
    .join("\n\n")
}

// ---------------------------------------------------------------------------
// MERGED FROM mimo-life-os/src/lib/ai/tool-caller.ts
// Adds: parseToolCallsFromResponse + formatToolResultsForModel — patterns
// for converting between ZAI SDK chat completions tool_calls format and
// our internal ToolCall / ToolResult representation.
// The DB-coupled executeToolCall / checkToolPermission are NOT merged.
// ---------------------------------------------------------------------------


/**
 * Parse tool_calls from a ZAI SDK chat.completions response.
 *
 * ZAI returns tool_calls as an array of:
 *   { id, type: "function", function: { name, arguments: "<json-string>" } }
 *
 * This helper parses them into our internal ToolCall[] representation.
 * Malformed arguments are captured into a `_parseError` field so downstream
 * validation can surface the error to the model.
 */
export function parseToolCallsFromResponse(
  response: unknown
): ToolCall[] {
  const choices = (response as { choices?: Array<{ message?: { tool_calls?: unknown[] } }> })?.choices
  if (!choices || choices.length === 0) return []

  const toolCalls = choices[0]?.message?.tool_calls
  if (!Array.isArray(toolCalls)) return []

  const results: ToolCall[] = []

  for (const tc of toolCalls) {
    const call = tc as {
      id?: string
      function?: { name?: string; arguments?: string | Record<string, unknown> }
      type?: string
    }
    if (!call || call.type !== "function" || !call.function) continue

    const name = call.function.name
    if (!name) continue

    const id = call.id ?? `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    let args: Record<string, unknown> = {}
    if (typeof call.function.arguments === "string") {
      try {
        args = JSON.parse(call.function.arguments)
      } catch {
        args = { _parseError: call.function.arguments }
      }
    } else if (typeof call.function.arguments === "object" && call.function.arguments !== null) {
      args = call.function.arguments as Record<string, unknown>
    }

    results.push({ id, name, args })
  }

  return results
}

/**
 * Convert our internal ToolResult[] back to the ZAI SDK message format for the
 * follow-up chat.completions call (role: "tool" with tool_call_id).
 */
export function formatToolResultsForModel(
  results: ToolResult[]
): Array<{ role: "tool"; content: string; tool_call_id: string }> {
  return results.map((r) => ({
    role: "tool" as const,
    content: r.status === "success"
      ? String(r.result).slice(0, 8000)
      : `Error: ${r.error ?? "unknown"}`,
    tool_call_id: r.id,
  }))
}
