// call_mcp_tool — generic tool for calling external MCP servers
import { callMcpTool } from "./mcp-client"
import type { ToolDef, ToolResult, ToolContext } from "@/lib/tools/types"
import { truncate } from "@/lib/tools/workspace"

// Global MCP server configs (set from settings on each /api/chat request)
export interface McpServerEntry {
  name: string
  url: string
}

let cachedMcpServers: McpServerEntry[] = []
export function setMcpServers(servers: McpServerEntry[]) {
  cachedMcpServers = servers || []
}

function ok(id: string, name: string, args: Record<string, unknown>, result: string, durationMs: number): ToolResult {
  return { id, name, args, result: truncate(result, 6000), status: "success", durationMs }
}
function fail(id: string, name: string, args: Record<string, unknown>, error: string, durationMs: number): ToolResult {
  return { id, name, args, result: error, status: "error", error, durationMs }
}
function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export const callMcpToolTool: ToolDef = {
  name: "call_mcp_tool",
  description:
    "يستدعي أداة من خادم MCP خارجي مرتبط. يحتاج اسم الخادم (مكون في الإعدادات) واسم الأداة والمدخلات. يفتح MiMo X على أي أداة خارجية (قواعد بيانات، APIs، أدوات نظام).",
  schema: {
    type: "object",
    properties: {
      server_name: { type: "string", description: "اسم خادم MCP كما هو مكون في الإعدادات" },
      tool_name: { type: "string", description: "اسم الأداة المراد استدعاؤها" },
      args: { type: "object", description: "مدخلات الأداة (JSON object)" },
    },
    required: ["server_name", "tool_name"],
  },
  async execute(args): Promise<ToolResult> {
    const start = Date.now()
    const id = newId("mcp")
    const serverName = String(args.server_name || "").trim()
    const toolName = String(args.tool_name || "").trim()
    const toolArgs = (args.args as Record<string, unknown>) || {}

    if (!serverName || !toolName) {
      return fail(id, "call_mcp_tool", args, "اسم الخادم واسم الأداة مطلوبان", 0)
    }

    // Find the server config
    const server = cachedMcpServers.find((s) => s.name === serverName)
    if (!server) {
      const available = cachedMcpServers.map((s) => s.name).join(", ") || "(لا خوادم مكونة)"
      return fail(
        id,
        "call_mcp_tool",
        args,
        `خادم MCP "${serverName}" غير مكون. الخوادم المتاحة: ${available}`,
        0
      )
    }

    const result = await callMcpTool(server.url, toolName, toolArgs)
    if (!result.ok) {
      return fail(id, "call_mcp_tool", args, result.result, Date.now() - start)
    }
    return ok(id, "call_mcp_tool", args, result.result, Date.now() - start)
  },
}
