// /api/tools — GET list all tools
// Adapted from mimo-life-os.
import { NextResponse } from "next/server";
import { listTools } from "@/lib/ai/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const tools = listTools().map((t) => ({
    name: t.name,
    description: t.description,
    riskLevel: t.riskLevel,
    inputSchema: t.inputSchema,
    timeoutMs: t.timeoutMs,
  }));
  return NextResponse.json({ tools, count: tools.length });
}
