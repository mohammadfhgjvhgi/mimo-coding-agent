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
    if (!file) return NextResponse.json({ error: "file required" }, { status: 400 })
    
    const root = path.resolve(WORKSPACE_ROOT)
    const { stdout } = await execAsync(
      `git log --follow --oneline --format="%h|%an|%ar|%s" -- ${JSON.stringify(file)}`,
      { cwd: root, timeout: 10000 }
    )
    const entries = stdout.trim().split("\n").filter(Boolean).map(line => {
      const [hash, author, date, message] = line.split("|")
      return { hash, author, date, message }
    })
    return NextResponse.json({ history: entries })
  } catch (e) {
    return NextResponse.json({ history: [] })
  }
}
