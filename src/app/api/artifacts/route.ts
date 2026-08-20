// /api/artifacts — POST create + GET list (new system on top of existing GET)
import { NextRequest, NextResponse } from "next/server"
import { artifactCreate, artifactList, artifactSnapshot } from "@/lib/artifacts/system"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const res = await artifactCreate(body)
    if (!res.ok) {
      return NextResponse.json({ error: res.error, message: res.message }, { status: 400 })
    }
    return NextResponse.json({ artifact: res.data }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    // Existing: ?conversationId=... extracts code blocks from messages
    // New: ?mode=list returns artifact records from the new system
    const mode = sp.get("mode")
    if (mode === "snapshot") {
      const snap = await artifactSnapshot()
      return NextResponse.json(snap.ok ? snap.data : { error: snap.message }, { status: snap.ok ? 200 : 500 })
    }
    if (mode === "list" || sp.has("type") || sp.has("visibility") || sp.has("authorId")) {
      const res = await artifactList({
        conversationId: sp.get("conversationId") ?? undefined,
        type: sp.get("type") as never,
        visibility: sp.get("visibility") as never,
        authorId: sp.get("authorId") ?? undefined,
        limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
      })
      return NextResponse.json(res.ok ? { artifacts: res.data } : { error: res.message }, { status: res.ok ? 200 : 500 })
    }
    // Fallback to the legacy code-block extraction behavior preserved for back-compat.
    const conversationId = sp.get("conversationId")
    if (conversationId) {
      // Lazy-load legacy extractor
      const { db } = await import("@/lib/db")
      const { extractCodeBlocks } = await import("@/lib/agent/code-extractor")
      const messages = await db.message.findMany({
        where: { conversationId, role: "assistant" },
        orderBy: { createdAt: "asc" },
        select: { id: true, content: true, createdAt: true },
      })
      const artifacts = messages.flatMap((m, i) => {
        const blocks = extractCodeBlocks(m.content)
        return blocks.map((b, j) => ({
          id: `${m.id}_${j}`,
          conversationId,
          taskId: null,
          name: b.filename ?? `block-${i}-${j}.${b.lang === "typescript" ? "ts" : b.lang === "javascript" ? "js" : "txt"}`,
          type: "code",
          format: b.lang,
          content: b.code,
          summary: `${b.lang} block from message ${i + 1}`,
          sizeBytes: b.code.length,
          createdAt: m.createdAt.toISOString(),
        }))
      })
      artifacts.reverse()
      return NextResponse.json({ artifacts, count: artifacts.length })
    }
    return NextResponse.json({ error: "conversationId or mode=list required" }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
