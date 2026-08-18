import {
  readFileTool,
  writeFileTool,
  editFileTool,
  runTerminalTool,
  listFilesTool,
  gitCheckpointTool,
} from "./tools"
import type { ToolCall, ToolDef, ToolResult, ToolContext } from "./types"

// Registry of available tools
const REGISTRY: Record<string, ToolDef> = {
  read_file: readFileTool,
  write_file: writeFileTool,
  edit_file: editFileTool,
  run_terminal_command: runTerminalTool,
  list_files: listFilesTool,
  git_checkpoint: gitCheckpointTool,
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
