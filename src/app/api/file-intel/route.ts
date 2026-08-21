// /api/file-intel — POST (all actions) + GET (snapshot)
import { NextRequest, NextResponse } from "next/server"
import {
  fileSnapshot, fileUpload, filePreview, fileExtract,
  fileParse, fileSearch, folderWatcherAdd, folderWatcherList,
  folderWatcherRemove, folderWatcherScan, folderWatcherScanAll,
  fileDedup, fileGetMetadata, fileSetMetadata, fileCreateVersion,
} from "@/lib/file-intel/system"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET() {
  try {
    const res = await fileSnapshot()
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
        const res = await fileSnapshot()
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "upload": {
        const res = await fileUpload(body)
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "preview": {
        const res = await filePreview(String(body.idOrPath), body.opts || {})
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "extract": {
        const res = await fileExtract(String(body.idOrPath))
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "parse": {
        const res = await fileParse(String(body.idOrPath))
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "search": {
        const res = await fileSearch(String(body.query || ""), body.opts || {})
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "watcher_add": {
        const res = await folderWatcherAdd(body)
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "watcher_list": {
        const res = await folderWatcherList()
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "watcher_remove": {
        const res = await folderWatcherRemove(String(body.id))
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "watcher_scan": {
        const res = await folderWatcherScan(String(body.watcherId))
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "watcher_scan_all": {
        const res = await folderWatcherScanAll()
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "dedup": {
        const res = await fileDedup(body.opts || {})
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "get_metadata": {
        const res = await fileGetMetadata(String(body.idOrPath))
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "set_metadata": {
        const res = await fileSetMetadata(String(body.idOrPath), body.patch || {})
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "create_version": {
        const res = await fileCreateVersion(String(body.idOrPath), body.opts || {})
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      default:
        return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
