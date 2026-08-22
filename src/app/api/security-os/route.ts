// /api/security-os — POST (all actions) + GET (audit/approvals/snapshot)
import { NextRequest, NextResponse } from "next/server"
import {
  permissionCheck, approvalQueueList, approvalQueueResolve,
  pathSandbox, commandSanitizer, secretDetect, secretRedact,
  promptInjectionDetect, untrustedClassify, pluginPermissionCheck,
  mcpPermissionCheck, auditLog, auditVerify, securitySnapshot,
} from "@/lib/security-os/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      case "permission_check": return wrap(permissionCheck(body))
      case "approval_resolve": return wrap(approvalQueueResolve(body.id, body.approved))
      case "path_sandbox": return wrap(pathSandbox(body.path))
      case "command_sanitize": return wrap(commandSanitizer(body.command))
      case "secret_detect": return wrap(secretDetect(body.text))
      case "secret_redact": return wrap(secretRedact(body.text))
      case "injection_detect": return wrap(promptInjectionDetect(body.text))
      case "untrusted_classify": return wrap(untrustedClassify(body.content))
      case "plugin_perm_check": return wrap(pluginPermissionCheck(body))
      case "mcp_perm_check": return wrap(await mcpPermissionCheck(body))
      case "audit_log": return wrap(await auditLog(body))
      case "audit_verify": return wrap(await auditVerify())
      default: return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const mode = sp.get("mode") ?? "snapshot"
    switch (mode) {
      case "approvals": return wrap(approvalQueueList())
      case "snapshot": return wrap(await securitySnapshot())
      default: return NextResponse.json({ error: `unknown mode: ${mode}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

function wrap<T>(result: { ok: boolean; data?: T; error?: string; message?: string }) {
  if (result.ok) return NextResponse.json(result.data)
  return NextResponse.json({ error: result.error, message: result.message }, { status: 400 })
}
