// /api/providers/models — GET: list models for a provider
import { NextRequest, NextResponse } from "next/server"
import { PROVIDER_REGISTRY, type ProviderId } from "@/lib/llm-providers/registry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const providerId = req.nextUrl.searchParams.get("providerId") as ProviderId
  if (!providerId || !PROVIDER_REGISTRY[providerId]) {
    return NextResponse.json({ error: "invalid providerId" }, { status: 400 })
  }
  return NextResponse.json({
    models: PROVIDER_REGISTRY[providerId].models,
  })
}
