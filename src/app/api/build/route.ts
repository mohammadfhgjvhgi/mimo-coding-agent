// /api/build — POST build a project
// Adapted from mimo-life-os. Runs the build command inside the project workspace.
import { NextRequest, NextResponse } from "next/server";
import { build } from "@/lib/ai/runtime-service";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { projectId } = body;

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  try {
    const result = await build(String(projectId));
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
