// /api/automation/webhook/[token] — POST receive webhook + trigger workflow
import { NextRequest, NextResponse } from "next/server"
import { webhookReceive } from "@/lib/automation/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  try {
    const body = await req.json().catch(() => ({}))
    const signature = req.headers.get("x-signature") ?? req.headers.get("x-hub-signature-256") ?? undefined
    const res = await webhookReceive({ token, method: req.method, body, signature })
    if (!res.ok) {
      const status = res.error === "not_found" ? 404 : res.error === "disabled" ? 410 : res.error === "bad_signature" ? 401 : 400
      return NextResponse.json({ error: res.error, message: res.message }, { status })
    }
    return NextResponse.json({ triggered: true, run: res.data.run })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
