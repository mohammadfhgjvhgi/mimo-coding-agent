// MCP Client — connects to external MCP servers via HTTP (Streamable HTTP transport)
// and calls tools. Stateless: connects, calls, disconnects per invocation.

export interface McpServerConfig {
  name: string
  url: string // e.g. http://localhost:3001/mcp
}

interface JsonRpcResponse {
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
  id?: number | string
}

// Call an MCP tool on a remote server via JSON-RPC 2.0 over HTTP
export async function callMcpTool(
  serverUrl: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<{ ok: boolean; result: string; isError?: boolean }> {
  const id = Date.now()
  const endpoint = serverUrl.replace(/\/$/, "")

  try {
    // 1. Initialize handshake
    const initRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "mimo-x", version: "1.0.0" },
        },
      }),
    })

    if (!initRes.ok) {
      return {
        ok: false,
        result: `MCP server returned HTTP ${initRes.status}`,
      }
    }

    // 2. Send "initialized" notification
    await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    })

    // 3. Call the tool
    const callRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Session-Id": `mimo-${id}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: id + 2,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args,
        },
      }),
    })

    if (!callRes.ok) {
      return {
        ok: false,
        result: `MCP tool call failed: HTTP ${callRes.status}`,
      }
    }

    // Parse the response — could be JSON or SSE
    const contentType = callRes.headers.get("content-type") || ""
    let data: JsonRpcResponse | null = null
    if (contentType.includes("event-stream")) {
      const text = await callRes.text()
      // Extract the last data: line
      const lines = text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
      for (const line of lines.reverse()) {
        if (line === "[DONE]") continue
        try {
          data = JSON.parse(line)
          break
        } catch {
          /* ignore */
        }
      }
    } else {
      data = (await callRes.json()) as JsonRpcResponse
    }

    if (!data) {
      return { ok: false, result: "MCP: لا استجابة صالحة" }
    }
    if (data.error) {
      return {
        ok: false,
        result: `MCP error: ${data.error.message} (code ${data.error.code})`,
        isError: true,
      }
    }

    // The result is a CallToolResult: { content: [{ type: "text", text: "..." }] }
    const callResult = data.result as {
      content?: Array<{ type: string; text?: string } | Record<string, unknown>>
      isError?: boolean
    } | undefined

    if (!callResult) {
      return { ok: true, result: JSON.stringify(data.result) }
    }

    const texts = (callResult.content || [])
      .map((c) => {
        if (typeof c === "object" && c !== null && "text" in c) {
          return String((c as { text?: string }).text || "")
        }
        return JSON.stringify(c)
      })
      .filter(Boolean)

    return {
      ok: !callResult.isError,
      result: texts.join("\n") || "(no text output)",
      isError: callResult.isError,
    }
  } catch (e) {
    return {
      ok: false,
      result: `تعذر الاتصال بخادم MCP على ${serverUrl}: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// List tools available on an MCP server
export async function listMcpTools(
  serverUrl: string
): Promise<{ name: string; description?: string }[]> {
  const id = Date.now()
  const endpoint = serverUrl.replace(/\/$/, "")
  try {
    // Initialize
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "mimo-x", version: "1.0.0" },
        },
      }),
    })

    // List tools
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: id + 1,
        method: "tools/list",
        params: {},
      }),
    })
    const data = await res.json()
    const tools = (data.result as { tools?: { name: string; description?: string }[] })?.tools || []
    return tools
  } catch {
    return []
  }
}
