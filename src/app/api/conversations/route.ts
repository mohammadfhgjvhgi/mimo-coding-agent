import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { makeTitle } from "@/lib/server/conversation-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

void makeTitle; // reserved — imported for re-export by callers that use it
