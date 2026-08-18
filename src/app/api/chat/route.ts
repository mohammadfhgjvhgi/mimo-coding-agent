import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import ZAI from "z-ai-web-dev-sdk";
import type { Role } from "@/types/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// System prompt for the assistant
const SYSTEM_PROMPT = `You are MiMo X, a knowledgeable and friendly AI assistant integrated into a local-first workspace.
You help with software engineering, writing, research, and general questions.
- Format answers in clean Markdown.
- Use fenced code blocks with language tags for code.
- Be concise but complete. Prefer clear structure (headings, lists) for long answers.
- When the user writes in Arabic, respond in Arabic. When they write in English, respond in English.`;

function makeTitle(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) return "New Chat";
  return clean.length > 48 ? clean.slice(0, 48) + "…" : clean;
}

interface SSELine {
  choices?: Array<{
    delta?: { content?: string; role?: string };
    finish_reason?: string | null;
  }>;
  [k: string]: unknown;
}

// Parse an SSE stream from the SDK into text deltas
async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const json = JSON.parse(data) as SSELine;
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // ignore malformed line
        }
      }
    }
    // flush remaining buffer
    const tail = buffer.trim();
    if (tail.startsWith("data:")) {
      const data = tail.slice(5).trim();
      if (data && data !== "[DONE]") {
        try {
          const json = JSON.parse(data) as SSELine;
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          /* ignore */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function POST(req: NextRequest) {
  let conversationId: string | undefined;
  let userMsgText = "";

  try {
    const body = await req.json().catch(() => ({}));
    userMsgText = (body.message as string)?.trim() || "";
    conversationId = body.conversationId as string | undefined;
    const history = (body.history as { role: Role; content: string }[]) || [];
    const thinking = body.thinking === true;

    if (!userMsgText) {
      return new Response(
        JSON.stringify({ error: "Message is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Ensure conversation exists
    let conversation = conversationId
      ? await db.conversation.findUnique({ where: { id: conversationId } })
      : null;

    if (!conversation) {
      conversation = await db.conversation.create({
        data: {
          title: makeTitle(userMsgText),
          model: "default",
        },
      });
      conversationId = conversation.id;
    } else if (conversation.title === "New Chat") {
      await db.conversation.update({
        where: { id: conversation.id },
        data: { title: makeTitle(userMsgText) },
      });
    }

    // Save the user message
    await db.message.create({
      data: {
        conversationId: conversation.id,
        role: "user",
        content: userMsgText,
      },
    });
    await db.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    // Build the messages payload for the LLM
    const llmMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history
        .filter((m) => m && m.content)
        .slice(-20)
        .map((m) => ({
          role: m.role === "system" ? ("system" as const) : m.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: m.content,
        })),
      { role: "user", content: userMsgText },
    ];

    // Initialize the ZAI SDK
    const zai = await ZAI.create();

    // Send an initial metadata event then start the stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enqueue = (obj: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        };

        // Tell the client which conversation this belongs to (so a freshly
        // created conversation can be linked in the UI).
        enqueue({
          type: "meta",
          conversationId: conversation!.id,
          title: conversation!.title,
        });

        let fullText = "";
        try {
          const response = (await zai.chat.completions.create({
            messages: llmMessages,
            stream: true,
            thinking: { type: thinking ? "enabled" : "disabled" },
          } as { messages: typeof llmMessages; stream: boolean; thinking: { type: "enabled" | "disabled" } })) as
            | ReadableStream<Uint8Array>
            | { choices: Array<{ message?: { content?: string } }>; usage?: unknown };

          // The SDK returns a ReadableStream when streaming, otherwise a JSON object
          if (response instanceof ReadableStream) {
            for await (const delta of parseSSE(response)) {
              fullText += delta;
              enqueue({ type: "delta", delta });
            }
          } else if (response && typeof response === "object" && Array.isArray((response as any).choices)) {
            const text = (response as any).choices?.[0]?.message?.content || "";
            fullText = text;
            // Emit as a single delta to keep the UX consistent
            enqueue({ type: "delta", delta: text });
          } else {
            enqueue({ type: "error", error: "Unexpected response shape from model" });
          }

          // Persist the assistant message
          if (fullText.trim()) {
            await db.message.create({
              data: {
                conversationId: conversation!.id,
                role: "assistant",
                content: fullText,
                model: thinking ? "thinking" : "default",
              },
            });
            await db.conversation.update({
              where: { id: conversation!.id },
              data: { updatedAt: new Date() },
            });
          }

          enqueue({ type: "done", conversationId: conversation!.id });
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Unknown streaming error";
          console.error("[POST /api/chat] stream error:", err);
          enqueue({ type: "error", error: message });

          // Persist whatever we received so far, if anything
          if (fullText.trim()) {
            try {
              await db.message.create({
                data: {
                  conversationId: conversation!.id,
                  role: "assistant",
                  content: fullText,
                  model: "default",
                },
              });
            } catch {
              /* ignore */
            }
          }
        } finally {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("[POST /api/chat] fatal:", error);
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : "Failed to process chat",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
