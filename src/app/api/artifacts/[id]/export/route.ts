// /api/artifacts/[id]/export?format=html|svg|md|json|raw — GET download
import { NextRequest, NextResponse } from "next/server"
import { artifactExport } from "@/lib/artifacts/system"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sp = req.nextUrl.searchParams
  const format = (sp.get("format") ?? "raw") as "raw" | "html" | "svg" | "md" | "json"
  const version = sp.get("version") ? Number(sp.get("version")) : undefined
  const res = await artifactExport(id, { format, version })
  if (!res.ok) {
    return NextResponse.json({ error: res.error, message: res.message }, { status: 400 })
  }
  return new NextResponse(res.data.content, {
    status: 200,
    headers: {
      "Content-Type": res.data.mimeType,
      "Content-Disposition": `attachment; filename="${res.data.filename}"`,
      "Content-Length": String(res.data.sizeBytes),
    },
  })
}
