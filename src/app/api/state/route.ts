// /api/state — GET system state
// Adapted from mimo-life-os. Uses our local models (Conversation, Message,
// Memory, Task, ScheduledTask) and our agent/skill/tool registries.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { listAgents } from "@/lib/ai/agents";
import { listSkills } from "@/lib/ai/skills";
import { listTools } from "@/lib/ai/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [conversations, tasks, memories, scheduledTasks, symbols] = await Promise.all([
      db.conversation.count(),
      db.task.count(),
      db.memory.count(),
      db.scheduledTask.count(),
      db.symbol.count(),
    ]);

    const agents = listAgents();
    const tools = listTools();
    const skills = listSkills();

    // Recent conversations for the activity feed
    const recentConversations = await db.conversation.findMany({
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: {
        id: true,
        title: true,
        model: true,
        pinned: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      // Counts (only the models we actually have)
      conversations,
      tasks,
      memories,
      scheduledTasks,
      symbols,
      // Registry counts
      agents: agents.length,
      skills: skills.length,
      tools: tools.length,
      // Recent activity
      recentConversations: recentConversations.map((c) => ({
        ...c,
        updatedAt: c.updatedAt.toISOString(),
      })),
      // Observability (no ExecutionLog table — return zeroes as placeholders)
      metrics: {
        successRate: 0,
        completedTasks: 0,
        failedTasks: 0,
        avgDurationMs: 0,
        toolUsage: [] as Array<{ name: string; count: number }>,
        agentUsage: [] as Array<{ name: string; count: number }>,
      },
      // Empty event log (no ExecutionLog table)
      eventLog: [] as Array<Record<string, unknown>>,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
