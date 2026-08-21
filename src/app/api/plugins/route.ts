// /api/plugins — POST (all actions) + GET (snapshot/list)
import { NextRequest, NextResponse } from "next/server"
import {
  pluginRegister, pluginList, pluginSnapshot,
  pluginActivate, pluginDeactivate, pluginUninstall,
  pluginGetManifest, pluginSetPermissions,
} from "@/lib/plugins/system"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const res = await pluginSnapshot()
    return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      case "list": {
        const res = await pluginList()
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "snapshot": {
        const res = await pluginSnapshot()
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "register": {
        const res = await pluginRegister(body)
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "activate": {
        const res = await pluginActivate(String(body.name))
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "deactivate": {
        const res = await pluginDeactivate(String(body.name))
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "uninstall": {
        const res = await pluginUninstall(String(body.name))
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "manifest": {
        const res = await pluginGetManifest(String(body.name))
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      case "set_permissions": {
        const res = await pluginSetPermissions(String(body.name), body.permissions || [])
        return res.ok ? NextResponse.json(res.data) : NextResponse.json({ error: res.message }, { status: 400 })
      }
      default:
        return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
