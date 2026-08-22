// /api/admin-os — POST (backup/import-export actions) + GET (all managers)
import { NextRequest, NextResponse } from "next/server"
import {
  providerManager, modelManager, mcpManager, pluginManager, skillManager,
  workspaceManager, storageManager, backupManager, importExportManager,
  systemHealth, logViewer, adminSnapshot,
} from "@/lib/admin-os/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      // 8. Backup Manager (422)
      case "backup_create": return wrap(await backupManager("create"))
      case "backup_list": return wrap(await backupManager("list"))
      case "backup_restore": return wrap(await backupManager("restore", { backupId: body.backupId }))
      case "backup_delete": return wrap(await backupManager("delete", { backupId: body.backupId }))

      // 9. Import/Export Manager (423)
      case "export": return wrap(await importExportManager("export"))
      case "import": return wrap(await importExportManager("import", { data: body.data }))

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
      case "providers": return wrap(await providerManager())
      case "models": return wrap(await modelManager())
      case "mcp": return wrap(await mcpManager())
      case "plugins": return wrap(await pluginManager())
      case "skills": return wrap(await skillManager())
      case "workspace": return wrap(workspaceManager())
      case "storage": return wrap(storageManager())
      case "health": return wrap(systemHealth())
      case "logs": return wrap(logViewer({
        lines: sp.get("lines") ? Number(sp.get("lines")) : 100,
        level: sp.get("level") ?? undefined,
      }))
      case "snapshot": return wrap(await adminSnapshot())
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
