// Conversation + message helpers shared by API routes.
// Extracted from src/app/api/conversations/route.ts so the route file
// only exports HTTP handlers (Next.js requirement).

import { db } from "@/lib/db";
import type { Role } from "@/types/chat";

// Helper: generate a short title from the first user message
export function makeTitle(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) return "New Chat";
  return clean.length > 48 ? clean.slice(0, 48) + "…" : clean;
}

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

export async function touchConversation(id: string) {
  return db.conversation.update({
    where: { id },
    data: { updatedAt: new Date() },
  });
}
