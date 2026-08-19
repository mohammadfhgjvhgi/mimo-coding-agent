// /api/artifacts — GET artifacts by conversationId
// Adapted from mimo-life-os. Uses the local Message table to extract code
// blocks produced by the assistant (no dedicated Artifact model in our schema).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { extractCodeBlocks } from "@/lib/agent/code-extractor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get("conversationId");
  if (!conversationId) {
    return NextResponse.json(
      { error: "conversationId is required" },
      { status: 400 }
    );
  }
  try {
    // Pull assistant messages in this conversation and extract their code blocks.
    const messages = await db.message.findMany({
      where: { conversationId, role: "assistant" },
      orderBy: { createdAt: "asc" },
      select: { id: true, content: true, createdAt: true },
    });

    const artifacts = messages.flatMap((m, i) => {
      const blocks = extractCodeBlocks(m.content);
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
      }));
    });

    // Newest first
    artifacts.reverse();

    return NextResponse.json({ artifacts, count: artifacts.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
