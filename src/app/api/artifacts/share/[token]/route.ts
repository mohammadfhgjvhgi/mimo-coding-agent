// /api/artifacts/share/[token] — GET public access to a shared artifact
import { NextRequest, NextResponse } from "next/server"
import { artifactGetByShare } from "@/lib/artifacts/system"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const sp = req.nextUrl.searchParams
  const password = sp.get("password") ?? undefined
  const res = await artifactGetByShare(token, { password })
  if (!res.ok) {
    const status = res.error === "not_found" || res.error === "expired" || res.error === "max_views" ? 404
      : res.error === "password_required" || res.error === "bad_password" ? 401
      : 400
    return NextResponse.json({ error: res.error, message: res.message }, { status })
  }
  return NextResponse.json({ artifact: res.data.artifact, share: res.data.share })
}
