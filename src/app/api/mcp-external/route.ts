// /api/mcp-external — POST (all actions) + GET (snapshot/servers list)
import { NextRequest, NextResponse } from "next/server"
import {
  mcpSnapshot, mcpListServers, mcpDiscoverServers, mcpInstallServer,
  mcpConfigureServer, mcpHealthCheck, mcpDiscoverTools, mcpSetToolPermission,
  mcpGetToolPermission, mcpAuditLog,
} from "@/lib/mcp/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET() {
  try {
    const res = await mcpSnapshot()
    return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      case "snapshot": {
        const res = await mcpSnapshot()
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "list_servers": {
        const res = await mcpListServers()
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "discover_servers": {
        const res = await mcpDiscoverServers(body.opts || {})
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "install_server": {
        const res = await mcpInstallServer(body)
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "configure_server": {
        const res = await mcpConfigureServer(String(body.name), body.config || {})
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "health_check": {
        const res = await mcpHealthCheck(String(body.name))
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "discover_tools": {
        const res = await mcpDiscoverTools(String(body.name), body.opts || {})
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "set_tool_permission": {
        const res = await mcpSetToolPermission(String(body.serverName), String(body.toolName), body.permission || "ask")
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "get_tool_permission": {
        const res = await mcpGetToolPermission(String(body.serverName), String(body.toolName))
        return NextResponse.json({ permission: res })
      }
      case "audit_log": {
        const res = await mcpAuditLog(body)
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      default:
        return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
