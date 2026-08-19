import { NextRequest, NextResponse } from "next/server"
import { spawn } from "node:child_process"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function run(cmd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", cmd], {
      cwd: WORKSPACE_ROOT,
      env: { ...process.env },
      timeout: 20000,
    })
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (d) => (stdout += d.toString()))
    child.stderr?.on("data", (d) => (stderr += d.toString()))
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? -1 }))
    child.on("error", () => resolve({ stdout, stderr, code: -1 }))
  })
}

interface Commit {
  hash: string
  short: string
  message: string
  author: string
  date: string
}

// GET /api/git -> list recent commits (checkpoints)
export async function GET() {
  const initCheck = await run("git rev-parse --is-inside-work-tree 2>/dev/null")
  if (initCheck.code !== 0) {
    return NextResponse.json({ initialized: false, commits: [] })
  }
  const logRes = await run(
    'git log -20 --pretty=format:"%H|%h|%s|%an|%cI" 2>/dev/null'
  )
  if (logRes.code !== 0) {
    return NextResponse.json({ initialized: true, commits: [] })
  }
  const commits: Commit[] = logRes.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, short, message, author, date] = line.split("|")
      return { hash, short, message, author, date }
    })
  const headRes = await run("git rev-parse --short HEAD 2>/dev/null")
  const dirtyRes = await run("git status --porcelain 2>/dev/null")
  return NextResponse.json({
    initialized: true,
    head: headRes.stdout.trim(),
    dirty: dirtyRes.stdout.trim().length > 0,
    commits,
  })
}

// POST /api/git -> create a checkpoint (add + commit)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const message = String(body.message || "MiMo X Checkpoint").trim()

  const initCheck = await run("git rev-parse --is-inside-work-tree 2>/dev/null")
  if (initCheck.code !== 0) {
    const initRes = await run("git init")
    if (initRes.code !== 0) {
      return NextResponse.json(
        { error: `تعذر تهيئة git: ${initRes.stderr}` },
        { status: 500 }
      )
    }
  }
  await run(
    'git config user.email >/dev/null 2>&1 || git config user.email "mimo-x@local"'
  )
  await run(
    'git config user.name >/dev/null 2>&1 || git config user.name "MiMo X"'
  )

  const addRes = await run("git add -A")
  if (addRes.code !== 0) {
    return NextResponse.json(
      { error: `فشل git add: ${addRes.stderr || addRes.stdout}` },
      { status: 500 }
    )
  }

  const statusRes = await run("git status --porcelain")
  if (!statusRes.stdout.trim()) {
    const headRes = await run("git rev-parse --short HEAD")
    return NextResponse.json({
      created: false,
      message: "لا توجد تغييرات جديدة",
      head: headRes.stdout.trim(),
    })
  }

  const commitRes = await run(`git commit -m ${JSON.stringify(message)}`)
  if (commitRes.code !== 0) {
    if (/nothing to commit|no changes/i.test(commitRes.stdout + commitRes.stderr)) {
      const headRes = await run("git rev-parse --short HEAD")
      return NextResponse.json({
        created: false,
        message: "لا تغييرات",
        head: headRes.stdout.trim(),
      })
    }
    return NextResponse.json(
      { error: `فشل git commit: ${commitRes.stderr || commitRes.stdout}` },
      { status: 500 }
    )
  }

  const headRes = await run("git rev-parse --short HEAD")
  return NextResponse.json({
    created: true,
    message,
    head: headRes.stdout.trim(),
  })
}

// DELETE /api/git?to=<hash> -> revert to checkpoint (git reset --hard <hash>)
export async function DELETE(req: NextRequest) {
  const to = req.nextUrl.searchParams.get("to")
  if (!to) {
    return NextResponse.json({ error: "حدد نقطة الاسترجاع (to)" }, { status: 400 })
  }
  if (!/^[0-9a-f]{4,40}$/i.test(to)) {
    return NextResponse.json({ error: "هاش غير صالح" }, { status: 400 })
  }
  const res = await run(`git reset --hard ${to}`)
  if (res.code !== 0) {
    return NextResponse.json(
      { error: `فشل التراجع: ${res.stderr || res.stdout}` },
      { status: 500 }
    )
  }
  const headRes = await run("git rev-parse --short HEAD")
  return NextResponse.json({
    reverted: true,
    to,
    head: headRes.stdout.trim(),
  })
}
