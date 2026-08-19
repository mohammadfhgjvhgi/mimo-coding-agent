import { NextRequest, NextResponse } from "next/server"
import { exec } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"
const execAsync = promisify(exec)

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const file = req.nextUrl.searchParams.get("file")
    const commit = req.nextUrl.searchParams.get("commit")
    if (!file) return NextResponse.json({ error: "file required" }, { status: 400 })
    
    const root = path.resolve(WORKSPACE_ROOT)
    const cmd = commit 
      ? `git diff ${commit} -- ${JSON.stringify(file)}`
      : `git diff -- ${JSON.stringify(file)}`
    const { stdout } = await execAsync(cmd, { cwd: root, timeout: 10000 })
    return NextResponse.json({ diff: stdout })
  } catch (e) {
    return NextResponse.json({ diff: "", error: "No changes or error" })
  }
}
