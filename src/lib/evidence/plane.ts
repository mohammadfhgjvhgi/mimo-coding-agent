// Evidence Plane — collects structured evidence before each LLM call.
// Instead of sending raw file content, we send compressed evidence:
// git status, symbol index summary, relevant diagnostics, file tree.
// This is the "LLM ≠ OS" principle: the system gathers context deterministically.

import { exec } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import { db } from "@/lib/db"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"

const execAsync = promisify(exec)

export interface EvidenceItem {
  source: string // "git" | "symbols" | "diagnostics" | "files"
  content: string
  tokens: number // estimated
  confidence: number // 0-1
}

export interface EvidenceBundle {
  items: EvidenceItem[]
  totalTokens: number
  summary: string
}

// Collect git status evidence
async function collectGitEvidence(): Promise<EvidenceItem | null> {
  try {
    const root = path.resolve(WORKSPACE_ROOT)
    const { stdout: status } = await execAsync("git status --porcelain 2>/dev/null", {
      cwd: root,
      timeout: 5000,
    })
    const { stdout: log } = await execAsync("git log --oneline -3 2>/dev/null", {
      cwd: root,
      timeout: 5000,
    })

    const dirtyFiles = status.trim().split("\n").filter(Boolean)
    const content = [
      dirtyFiles.length > 0
        ? `📝 ${dirtyFiles.length} ملف معدّل:`
        : "📝 لا تعديلات غير محفوظة",
      ...dirtyFiles.slice(0, 10).map((f) => `  ${f.trim()}`),
      "",
      "📋 آخر 3 نقاط استرجاع:",
      ...log.trim().split("\n").slice(0, 3).map((l) => `  ${l}`),
    ].join("\n")

    return {
      source: "git",
      content,
      tokens: Math.ceil(content.length / 3.5),
      confidence: 1.0,
    }
  } catch {
    return null
  }
}

// Collect symbol index evidence
async function collectSymbolEvidence(): Promise<EvidenceItem | null> {
  try {
    const totalSymbols = await db.symbol.count()
    if (totalSymbols === 0) return null

    const byType = await db.symbol.groupBy({
      by: ["type"],
      _count: true,
    })

    const filesIndexed = await db.symbol.groupBy({
      by: ["filePath"],
      _count: true,
    })

    const typeSummary = byType
      .map((t) => `${t.type}: ${t._count}`)
      .join(", ")

    const content = [
      `🏷️ فهرس الرموز: ${totalSymbols} رمز في ${filesIndexed.length} ملف`,
      `  التوزيع: ${typeSummary}`,
    ].join("\n")

    return {
      source: "symbols",
      content,
      tokens: Math.ceil(content.length / 3.5),
      confidence: 0.95,
    }
  } catch {
    return null
  }
}

// Collect memory evidence (project knowledge)
async function collectMemoryEvidence(): Promise<EvidenceItem | null> {
  try {
    const { getProjectMemoryBlock } = await import("@/lib/tools/memory")
    const block = await getProjectMemoryBlock()
    if (!block) return null

    return {
      source: "memory",
      content: block,
      tokens: Math.ceil(block.length / 3.5),
      confidence: 0.9,
    }
  } catch {
    return null
  }
}

// Collect active task/goal evidence
async function collectTaskEvidence(): Promise<EvidenceItem | null> {
  try {
    const activeGoals = await db.task.count({
      where: { status: "running" },
    })
    const pendingGoals = await db.task.count({
      where: { status: "pending" },
    })
    const doneGoals = await db.task.count({
      where: { status: "done" },
    })

    if (activeGoals === 0 && pendingGoals === 0 && doneGoals === 0) return null

    const content = `🎯 أهداف: ${activeGoals} نشط، ${pendingGoals} بالانتظار، ${doneGoals} مكتمل`

    return {
      source: "tasks",
      content,
      tokens: Math.ceil(content.length / 3.5),
      confidence: 1.0,
    }
  } catch {
    return null
  }
}

// Main entry: collect all evidence for the current workspace state
export async function collectEvidence(): Promise<EvidenceBundle> {
  const [git, symbols, memory, tasks] = await Promise.all([
    collectGitEvidence(),
    collectSymbolEvidence(),
    collectMemoryEvidence(),
    collectTaskEvidence(),
  ])

  const items = [git, symbols, memory, tasks].filter(
    (e): e is EvidenceItem => e !== null
  )

  const totalTokens = items.reduce((sum, e) => sum + e.tokens, 0)

  const summary = items
    .map((e) => `[${e.source}] ${e.content.split("\n")[0]}`)
    .join(" | ")

  return { items, totalTokens, summary }
}

// Format evidence for injection into the system prompt
export function formatEvidenceForPrompt(bundle: EvidenceBundle): string {
  if (bundle.items.length === 0) return ""

  const lines = bundle.items.map(
    (e) => `### ${e.source.toUpperCase()} (confidence: ${e.confidence})\n${e.content}`
  )

  return `\n\n## 📊 Evidence Plane (حقن تلقائي — ${bundle.totalTokens} tokens)\n${lines.join("\n\n")}`
}
