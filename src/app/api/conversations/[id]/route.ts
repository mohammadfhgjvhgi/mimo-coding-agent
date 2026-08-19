import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { ToolCallRecord } from "@/types/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

function parseToolCalls(raw?: string | null): ToolCallRecord[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as ToolCallRecord[];
    return null;
  } catch {
    return null;
  }
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const conversation = await db.conversation.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }
    const messages = conversation.messages.map((m) => ({
      ...m,
      toolCalls: parseToolCalls(m.toolCalls),
    }));
    return NextResponse.json({ conversation: { ...conversation, messages } });
  } catch (error) {
    console.error("[GET /api/conversations/:id]", error);
    return NextResponse.json(
      { error: "Failed to fetch conversation" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const data: { title?: string; pinned?: boolean; model?: string } = {};
    if (typeof body.title === "string") data.title = body.title.slice(0, 120);
    if (typeof body.pinned === "boolean") data.pinned = body.pinned;
    if (typeof body.model === "string") data.model = body.model;

    const updated = await db.conversation.update({
      where: { id },
      data,
    });
    return NextResponse.json({ conversation: updated });
  } catch (error) {
    console.error("[PATCH /api/conversations/:id]", error);
    return NextResponse.json(
      { error: "Failed to update conversation" },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    await db.conversation.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/conversations/:id]", error);
    return NextResponse.json(
      { error: "Failed to delete conversation" },
      { status: 500 }
    );
  }
}
