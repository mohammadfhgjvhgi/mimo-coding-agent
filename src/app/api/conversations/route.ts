import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { Role } from "@/types/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Helper: generate a short title from the first user message
function makeTitle(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) return "New Chat";
  return clean.length > 48 ? clean.slice(0, 48) + "…" : clean;
}

export async function GET() {
  try {
    const conversations = await db.conversation.findMany({
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      take: 200,
    });
    return NextResponse.json({ conversations });
  } catch (error) {
    console.error("[GET /api/conversations]", error);
    return NextResponse.json(
      { error: "Failed to fetch conversations" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const title: string = (body.title as string)?.trim() || "New Chat";

    const conversation = await db.conversation.create({
      data: {
        title: title.slice(0, 120),
        model: (body.model as string) || "default",
      },
    });

    return NextResponse.json({ conversation });
  } catch (error) {
    console.error("[POST /api/conversations]", error);
    return NextResponse.json(
      { error: "Failed to create conversation" },
      { status: 500 }
    );
  }
}

// Helper exported for other routes to reuse
export async function ensureConversation(message: string, conversationId?: string) {
  if (conversationId) {
    const existing = await db.conversation.findUnique({
      where: { id: conversationId },
    });
    if (existing) {
      // Auto-rename if it still has the default title
      if (existing.title === "New Chat" && message) {
        await db.conversation.update({
          where: { id: conversationId },
          data: { title: makeTitle(message) },
        });
      }
      return existing;
    }
  }
  // Create new conversation
  return db.conversation.create({
    data: {
      title: message ? makeTitle(message) : "New Chat",
      model: "default",
    },
  });
}

// Add a message (used by chat route)
export async function addMessage(
  conversationId: string,
  role: Role,
  content: string,
  model?: string
) {
  return db.message.create({
    data: {
      conversationId,
      role,
      content,
      model: model || null,
    },
  });
}

// Touch conversation updatedAt
export async function touchConversation(id: string) {
  return db.conversation.update({
    where: { id },
    data: { updatedAt: new Date() },
  });
}
