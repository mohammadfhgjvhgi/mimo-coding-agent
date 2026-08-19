import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { runAgentLoop } from "@/lib/agent";
import type { ProviderSettings } from "@/lib/llm-provider";
import type { Role, ToolCallRecord } from "@/types/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function makeTitle(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) return "محادثة جديدة";
  return clean.length > 48 ? clean.slice(0, 48) + "…" : clean;
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

    // Resolve provider settings
    const { getSettings } = await import("@/lib/llm-provider");
    const settings = providerSettings || getSettings();

    // Inject ecosystem settings (GitHub token + MCP servers) before running
    const { setGithubToken } = await import("@/lib/ecosystem/github-tool");
    const { setMcpServers } = await import("@/lib/ecosystem/mcp-tool");
    setGithubToken(settings.githubToken || null);
    setMcpServers(settings.mcpServers || []);

    // Build the agent's message list
    // Chat Intelligence: use ContextAssembler for automatic context selection
    const agentMessages = history
      .filter((m) => m && m.content)
      .slice(-20)
      .map((m) => ({
        role: (m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user") as
          | "system"
          | "user"
          | "assistant",
        content: m.content,
      }));
    agentMessages.push({ role: "user", content: userMsgText });

    // Auto-summarization: if conversation is long, compress older messages
    try {
      const { summarizeConversation } = await import("@/lib/context/summarizer")
      const { getSettings } = await import("@/lib/llm-provider")
      const settings = getSettings()
      await summarizeConversation(conversation.id, settings)
    } catch { /* best-effort */ }

    // Outbound SSE stream
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

        const collectedToolCalls: ToolCallRecord[] = [];
        let finalText = "";

        try {
          const result = await runAgentLoop({
            messages: agentMessages,
            settings,
            signal: req.signal,
            events: {
              onThought: (text) => {
                // Stream pre-tool reasoning as deltas so the UI shows progress
                enqueue({ type: "delta", delta: text });
                finalText += text;
              },
              onToolCall: (call) => {
                enqueue({
                  type: "tool_call",
                  call: { id: call.id, name: call.name, args: call.args },
                });
              },
              onToolResult: (r) => {
                const record: ToolCallRecord = {
                  id: r.id,
                  name: r.name,
                  args: r.args,
                  result: r.result,
                  status: r.status,
                  error: r.error,
                  durationMs: r.durationMs,
                };
                collectedToolCalls.push(record);
                enqueue({ type: "tool_result", result: record });
              },
              onFinalDelta: (chunk) => {
                enqueue({ type: "delta", delta: chunk });
                finalText += chunk;
              },
              onContextCompressed: (stats) => {
                enqueue({ type: "context_compressed", stats });
              },
              onRouterDecision: (worker, reason) => {
                enqueue({ type: "router_decision", worker, reason });
              },
              onError: (err) => {
                enqueue({ type: "error", error: err });
              },
            },
          });

          finalText = result.finalText || finalText;

          // Persist the assistant turn (text + tool calls)
          const textToSave = finalText.trim() || "(لا إجابة نصية)";
          await db.message.create({
            data: {
              conversationId: conversation!.id,
              role: "assistant",
              content: textToSave,
              model: settings.provider,
              toolCalls:
                collectedToolCalls.length > 0
                  ? JSON.stringify(collectedToolCalls)
                  : null,
            },
          });
          await db.conversation.update({
            where: { id: conversation!.id },
            data: { updatedAt: new Date() },
          });

          enqueue({
            type: "done",
            conversationId: conversation!.id,
            iterations: result.iterations,
            stopped: result.stopped,
          });
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "خطأ غير معروف أثناء حلقة الوكيل";
          console.error("[POST /api/chat] agent loop:", err);
          enqueue({ type: "error", error: message });

          if (finalText.trim()) {
            try {
              await db.message.create({
                data: {
                  conversationId: conversation!.id,
                  role: "assistant",
                  content: finalText,
                  model: settings.provider,
                  toolCalls:
                    collectedToolCalls.length > 0
                      ? JSON.stringify(collectedToolCalls)
                      : null,
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
