import { NextRequest, NextResponse } from "next/server"
import { exec } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"
const execAsync = promisify(exec)

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const file = String(body.file || "")
    if (!file) return NextResponse.json({ error: "file required" }, { status: 400 })
    
    const root = path.resolve(WORKSPACE_ROOT)
    await execAsync(`git checkout HEAD -- ${JSON.stringify(file)}`, { cwd: root, timeout: 10000 })
    return NextResponse.json({ success: true, file })
  } catch (e) {
    return NextResponse.json({ error: "Revert failed" }, { status: 500 })
  }
}
