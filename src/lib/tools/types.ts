// Tool gateway types

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ToolResult {
  id: string
  name: string
  args: Record<string, unknown>
  result: string
  status: "success" | "error"
  error?: string
  durationMs: number
}

export interface ToolContext {
  workspaceRoot: string
  /** allowed file extensions for write/edit (null = allow all in workspace) */
  allowedExtensions: string[] | null
}

export interface ToolDef {
  name: string
  description: string
  /** JSON-schema-ish parameter description for the model prompt */
  schema: Record<string, unknown>
  /** returns a plain-string result that the LLM can read */
  execute: (
    args: Record<string, unknown>,
    ctx: ToolContext
  ) => Promise<ToolResult>
}

export interface ToolEvent {
  type: "tool_call" | "tool_result"
  call: ToolCall
  result?: ToolResult
}
