// /api/decisions — GET decisions by conversationId
// Adapted from mimo-life-os. Uses our local Memory table to expose decision
// entries (category === "decision") so we don't need a dedicated Decision model.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

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
    // The local Memory model has no conversationId column; we store decisions
    // with key prefix `decision_${conversationId}_` so we can filter at query time.
    const decisions = await db.memory.findMany({
      where: {
        AND: [
          { category: "decision" },
          { key: { startsWith: `decision_${conversationId}_` } },
        ],
      },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json({
      decisions: decisions.map((d) => ({
        id: d.id,
        conversationId,
        title: d.key.replace(`decision_${conversationId}_`, ""),
        decision: d.value,
        reasoning: null,
        alternatives: null,
        consequences: null,
        status: "accepted",
        decidedBy: d.source,
        createdAt: d.createdAt.toISOString(),
      })),
      count: decisions.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
