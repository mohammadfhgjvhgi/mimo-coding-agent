// /api/projects — GET list, POST create
// Adapted from mimo-life-os. Since we have no Project Prisma model, projects
// are tracked as directories under <workspace>/projects/. The GET returns the
// directory listing; POST creates the directory.

import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { WORKSPACE_ROOT } from "@/lib/tools/workspace";
import { ensureProjectDir } from "@/lib/ai/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const dir = path.join(WORKSPACE_ROOT, "projects");
    if (!fs.existsSync(dir)) {
      return NextResponse.json({ projects: [], count: 0 });
    }
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const projects = entries
      .filter((e) => e.isDirectory())
      .map((d) => {
        const fullPath = path.join(dir, d.name);
        const stat = fs.statSync(fullPath);
        return {
          id: d.name,
          name: d.name,
          description: null as string | null,
          type: "software",
          createdAt: stat.birthtime.toISOString(),
          updatedAt: stat.mtime.toISOString(),
          _count: { conversations: 0, entities: 0, memories: 0 },
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return NextResponse.json({ projects, count: projects.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { name } = body;
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  // Use name as projectId (sanitized)
  const projectId = String(name).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const dirResult = await ensureProjectDir(projectId);
  if (!dirResult.success) {
    return NextResponse.json({ error: dirResult.error }, { status: 500 });
  }

  const project = {
    id: projectId,
    name: String(name),
    description: body.description ?? null,
    type: body.type ?? "software",
    goals: body.goals ?? null,
    techStack: body.techStack ?? null,
    requirements: body.requirements ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return NextResponse.json({ project });
}
