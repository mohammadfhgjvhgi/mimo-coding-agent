// /api/backup-recovery — POST (all actions) + GET (archives/snapshot/integrity/recoveries)
import { NextRequest, NextResponse } from "next/server"
import {
  conversationBackup, memoryBackup, projectMetadataBackup,
  settingsBackup, checkpointArchive,
  recoveryWizard, crashRecovery, dataIntegrityCheck,
  backupRecoverySnapshot, listBackupArchives, deleteBackupArchive,
  listRecoveryOperations,
} from "@/lib/backup-recovery/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      // Backups (426-430)
      case "conversation_backup": return wrap(await conversationBackup({ label: body.label }))
      case "memory_backup": return wrap(await memoryBackup({ label: body.label }))
      case "project_backup": return wrap(await projectMetadataBackup({ label: body.label }))
      case "settings_backup": return wrap(await settingsBackup({ label: body.label }))
      case "checkpoint_archive": return wrap(await checkpointArchive({ label: body.label }))

      // Recovery (431-433)
      case "recovery_wizard": return wrap(await recoveryWizard({ archiveId: body.archiveId }))
      case "crash_recovery": return wrap(await crashRecovery())
      case "integrity_check": return wrap(await dataIntegrityCheck())

      // Archive management
      case "archive_delete": return wrap(await deleteBackupArchive(body.id))

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
      case "archives": return wrap(await listBackupArchives(sp.get("type") ?? undefined))
      case "recoveries": return wrap(await listRecoveryOperations())
      case "snapshot": return wrap(await backupRecoverySnapshot())
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
