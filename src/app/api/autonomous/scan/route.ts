// Autonomous Loop — scans the workspace for issues and creates tasks.
// This is the "Health Loop" that keeps the project healthy by finding
// problems (lint errors, TODOs, missing tests) and adding them to the backlog.

import { NextRequest, NextResponse } from "next/server"
import { spawn } from "node:child_process"
import path from "node:path"
import { db } from "@/lib/db"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"
import { readdirSync, readFileSync, statSync } from "node:fs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function run(cmd: string, cwd: string, timeout = 30000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", cmd], { cwd, env: { ...process.env }, timeout })
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (d) => (stdout += d.toString()))
    child.stderr?.on("data", (d) => (stderr += d.toString()))
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? -1 }))
    child.on("error", () => resolve({ stdout, stderr, code: -1 }))
  })
}

const IGNORED = new Set(["node_modules", ".git", ".next", ".turbo", "dist", "build", "out", "coverage", ".cache", "upload", "tool-results", "skills", "examples", "testproj"])

// Scan workspace for issues
async function scanWorkspace(): Promise<{ type: string; description: string; severity: string }[]> {
  const issues: { type: string; description: string; severity: string }[] = []
  const root = path.resolve(WORKSPACE_ROOT)

  // 1. Find TODO/FIXME/HACK comments
  const todoPattern = /\b(TODO|FIXME|HACK|XXX|BUG)\b/gi
  const files: string[] = []
  function walk(dir: string, rel: string) {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const name = String(entry.name)
      if (IGNORED.has(name) || name.startsWith(".")) continue
      const abs = path.join(dir, name)
      const r = rel ? `${rel}/${name}` : name
      if (entry.isDirectory()) walk(abs, r)
      else if (/\.(js|jsx|ts|tsx|mjs|py)$/.test(name)) files.push(r)
    }
  }
  walk(root, "")

  for (const file of files.slice(0, 50)) {
    try {
      const content = readFileSync(path.join(root, file), "utf8")
      const lines = content.split("\n")
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(todoPattern)
        if (match) {
          issues.push({
            type: "todo",
            description: `${file}:${i + 1} — ${lines[i].trim().slice(0, 80)}`,
            severity: "low",
          })
        }
      }
    } catch { /* ignore */ }
  }

  // 2. Check for lint errors (quick scan)
  try {
    const lintRes = await run("npx eslint src/ --format json 2>/dev/null", root, 30000)
    if (lintRes.code !== 0 && lintRes.stdout) {
      const json = JSON.parse(lintRes.stdout) as Array<{ errorCount: number; filePath: string; messages: Array<{ message: string; line: number }> }>
      for (const f of json.slice(0, 5)) {
        if (f.errorCount > 0) {
          issues.push({
            type: "lint",
            description: `${f.filePath}: ${f.errorCount} errors (first: ${f.messages[0]?.message || "unknown"} at line ${f.messages[0]?.line || "?"})`,
            severity: "high",
          })
        }
      }
    }
  } catch { /* ignore */ }

  // 3. Check git status for uncommitted changes
  try {
    const gitRes = await run("git status --porcelain 2>/dev/null", root, 5000)
    const dirty = gitRes.stdout.trim().split("\n").filter(Boolean)
    if (dirty.length > 5) {
      issues.push({
        type: "git",
        description: `${dirty.length} ملفات غير محفوظة — يُنصح بحفظ نقطة استرجاع`,
        severity: "medium",
      })
    }
  } catch { /* ignore */ }

  return issues
}

// POST /api/autonomous/scan — scan the workspace and create tasks for found issues
export async function POST(_req: NextRequest) {
  try {
    const issues = await scanWorkspace()

    // Create tasks for high/medium severity issues
    let created = 0
    for (const issue of issues) {
      if (issue.severity === "high" || issue.severity === "medium") {
        // Check if a task already exists for this issue
        const existing = await db.task.findFirst({
          where: { goal: { contains: issue.description.slice(0, 50) } },
        })
        if (!existing) {
          await db.task.create({
            data: {
              goal: `إصلاح: ${issue.description}`,
              acceptanceCriteria: JSON.stringify([`حل المشكلة: ${issue.type} — ${issue.description}`]),
              status: "pending",
            },
          })
          created++
        }
      }
    }

    return NextResponse.json({
      scanned: true,
      issuesFound: issues.length,
      tasksCreated: created,
      issues: issues.slice(0, 20),
    })
  } catch (error) {
    console.error("[POST /api/autonomous/scan]", error)
    return NextResponse.json({ error: "فشل المسح" }, { status: 500 })
  }
}

// GET /api/autonomous/scan — get the current workspace health status
export async function GET() {
  try {
    const issues = await scanWorkspace()
    const pendingTasks = await db.task.count({ where: { status: "pending" } })
    const runningTasks = await db.task.count({ where: { status: "running" } })
    const doneTasks = await db.task.count({ where: { status: "done" } })

    return NextResponse.json({
      issuesFound: issues.length,
      highSeverity: issues.filter((i) => i.severity === "high").length,
      mediumSeverity: issues.filter((i) => i.severity === "medium").length,
      lowSeverity: issues.filter((i) => i.severity === "low").length,
      tasks: { pending: pendingTasks, running: runningTasks, done: doneTasks },
      issues: issues.slice(0, 10),
    })
  } catch (error) {
    console.error("[GET /api/autonomous/scan]", error)
    return NextResponse.json({ error: "فشل تحميل الحالة" }, { status: 500 })
  }
}

void statSync
