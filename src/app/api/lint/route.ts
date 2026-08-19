// /api/lint — POST run lint and typecheck on a project
// Adapted from mimo-life-os.
import { NextRequest, NextResponse } from "next/server";
import { lint, typecheck } from "@/lib/ai/runtime-service";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { projectId, action } = body;

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  try {
    if (action === "typecheck") {
      const result = await typecheck(String(projectId));
      return NextResponse.json(result);
    }
    const result = await lint(String(projectId));
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
