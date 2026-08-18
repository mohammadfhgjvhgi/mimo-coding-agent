import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { streamChat, type ProviderSettings } from "@/lib/llm-provider";
import type { Role } from "@/types/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SYSTEM_PROMPT = [
  'أنت "MiMo X"، مساعد ذكاء اصطناعي محلي يعمل على جهاز المستخدم.',
  "ساعد المستخدم في هندسة البرمجيات، الكتابة، البحث، والأسئلة العامة.",
  "- نفّذ الإجابات بصيغة Markdown نظيفة.",
  "- استخدم كتل كود محاطة بوسوم اللغة (مثل python و javascript).",
  "- كن موجزاً ومتكاملاً. استخدم العناوين والقوائم للإجابات الطويلة.",
  "- إذا كتب المستخدم بالعربية فأجب بالعربية، وإذا كتب بالإنجليزية فأجب بالإنجليزية.",
].join("\n");

function makeTitle(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) return "محادثة جديدة";
  return clean.length > 48 ? clean.slice(0, 48) + "…" : clean;
}

interface SSELine {
  choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
  [k: string]: unknown;
}

// Parse Z.ai-style SSE stream (data: {...} \n\n) into text deltas
async function* parseZaiSSE(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<string> {
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
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
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
  try {
    const body = await req.json().catch(() => ({}));
    const userMsgText = (body.message as string)?.trim() || "";
    conversationId = body.conversationId as string | undefined;
    const history = (body.history as { role: Role; content: string }[]) || [];
    const providerSettings = (body.settings as ProviderSettings) || undefined;

    if (!userMsgText) {
      return new Response(
        JSON.stringify({ error: "الرسالة مطلوبة" }),
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
          model: providerSettings?.provider || "default",
        },
      });
      conversationId = conversation.id;
    } else if (conversation.title === "محادثة جديدة" || conversation.title === "New Chat") {
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

    // Build the messages payload
    const llmMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history
        .filter((m) => m && m.content)
        .slice(-20)
        .map((m) => ({
          role: (m.role === "system" ? "system" : m.role === "assistant" ? "assistant" : "user") as
            | "system"
            | "user"
            | "assistant",
          content: m.content,
        })),
      { role: "user", content: userMsgText },
    ];

    // Resolve provider settings (request > server cache > defaults)
    const { getSettings } = await import("@/lib/llm-provider");
    const settings = providerSettings || getSettings();

    // Set up the outbound SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enqueue = (obj: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        };

        enqueue({
          type: "meta",
          conversationId: conversation!.id,
          title: conversation!.title,
          provider: settings.provider,
        });

        let fullText = "";
        try {
          // Get the async generator for the chosen provider
          const gen = await streamChat(settings, llmMessages);

          // Ollama yields strings directly. Z.ai (via streamZai) also yields strings.
          // We normalize both through the same consumer below.
          if (settings.provider === "ollama") {
            // streamOllama already yields strings
            for await (const delta of gen) {
              fullText += delta;
              enqueue({ type: "delta", delta });
            }
          } else {
            // Z.ai: gen could be either a ReadableStream (raw from SDK) or already
            // an AsyncGenerator<string> (streamZai). Both yield string deltas.
            for await (const delta of gen) {
              fullText += delta;
              enqueue({ type: "delta", delta });
            }
          }

          if (fullText.trim()) {
            await db.message.create({
              data: {
                conversationId: conversation!.id,
                role: "assistant",
                content: fullText,
                model: settings.provider,
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
            err instanceof Error ? err.message : "خطأ غير معروف أثناء البث";
          console.error("[POST /api/chat] stream error:", err);
          enqueue({ type: "error", error: message });

          if (fullText.trim()) {
            try {
              await db.message.create({
                data: {
                  conversationId: conversation!.id,
                  role: "assistant",
                  content: fullText,
                  model: settings.provider,
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
          error instanceof Error ? error.message : "فشل معالجة المحادثة",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// Keep parseZaiSSE exported for potential reuse / tests
export { parseZaiSSE };
