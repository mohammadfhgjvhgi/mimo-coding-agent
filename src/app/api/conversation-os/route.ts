// /api/conversation-os — POST (all actions) + GET (search/folders/snapshot)
import { NextRequest, NextResponse } from "next/server"
import {
  chatSearch, chatFolders, chatMoveToFolder, chatTags, chatTagAdd, chatTagRemove,
  chatPin, chatBranch, chatFork, chatArchive, chatExport, chatImport,
  chatSummary, chatMemory,
  conversationToTask, conversationToProject, conversationToArtifact, conversationToKnowledge,
  conversationSnapshot,
} from "@/lib/conversation-os/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      case "search": return wrap(await chatSearch(body.query, body))
      case "move_to_folder": return wrap(await chatMoveToFolder(body.conversationId, body.folder))
      case "tags": return wrap(await chatTags(body.conversationId))
      case "tag_add": return wrap(await chatTagAdd(body.conversationId, body.tag))
      case "tag_remove": return wrap(await chatTagRemove(body.conversationId, body.tag))
      case "pin": return wrap(await chatPin(body.conversationId, body.pinned))
      case "branch": return wrap(await chatBranch(body.conversationId, body.branchAtMessageId, body.newTitle))
      case "fork": return wrap(await chatFork(body.conversationId, body.newTitle))
      case "archive": return wrap(await chatArchive(body.conversationId, body.archive))
      case "export": return wrap(await chatExport(body.conversationId, body.format ?? "markdown"))
      case "import": return wrap(await chatImport(body.content, body.format ?? "markdown", body.title))
      case "summary": return wrap(await chatSummary(body.conversationId))
      case "memory": return wrap(await chatMemory(body.conversationId))
      case "to_task": return wrap(await conversationToTask(body.conversationId))
      case "to_project": return wrap(await conversationToProject(body.conversationId))
      case "to_artifact": return wrap(await conversationToArtifact(body.conversationId))
      case "to_knowledge": return wrap(await conversationToKnowledge(body.conversationId))
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
      case "search": return wrap(await chatSearch(sp.get("q") ?? "", { folder: sp.get("folder") ?? undefined, limit: sp.get("limit") ? Number(sp.get("limit")) : undefined }))
      case "folders": return wrap(await chatFolders())
      case "snapshot": return wrap(await conversationSnapshot())
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
