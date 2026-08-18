import { NextRequest, NextResponse } from "next/server"
import { buildTree, type TreeNode } from "@/lib/tools/tools"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"
import { statSync } from "node:fs"
import path from "node:path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET /api/workspace -> returns the file tree of the workspace root
export async function GET(req: NextRequest) {
  const sub = req.nextUrl.searchParams.get("path") || ""
  const depthParam = Number(req.nextUrl.searchParams.get("depth")) || 5
  const maxDepth = Math.min(Math.max(depthParam, 1), 8)

  const root = path.resolve(WORKSPACE_ROOT)
  const target = sub ? path.resolve(root, sub) : root
  const rel = path.relative(root, target)
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return NextResponse.json(
      { error: "المسار خارج مجلد العمل" },
      { status: 400 }
    )
  }
  try {
    const st = statSync(target)
    if (!st.isDirectory()) {
      return NextResponse.json({ error: "ليس مجلداً" }, { status: 400 })
    }
    const tree: TreeNode[] = buildTree(target, rel, 0, maxDepth)
    return NextResponse.json({
      root: rel || ".",
      workspaceRoot: root,
      tree,
      depth: maxDepth,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "فشل رسم الشجرة" },
      { status: 500 }
    )
  }
}
