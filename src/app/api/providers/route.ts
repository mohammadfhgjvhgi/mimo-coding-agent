// /api/providers — GET (list all providers + DB config) + POST (save config)
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { PROVIDER_REGISTRY, type ProviderId } from "@/lib/llm-providers/registry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// GET — list all providers merged with DB config
export async function GET() {
  try {
    const dbProviders = await db.provider.findMany()
    const dbMap = new Map(dbProviders.map(p => [p.providerId, p]))

    const providers = Object.values(PROVIDER_REGISTRY).map(reg => {
      const dbEntry = dbMap.get(reg.id)
      return {
        ...reg,
        apiKey: dbEntry?.apiKey || null,
        baseURL: dbEntry?.baseURL || reg.baseURL,
        enabled: dbEntry?.enabled ?? false,
        isDefault: dbEntry?.isDefault ?? false,
        hasKey: Boolean(dbEntry?.apiKey),
        dbId: dbEntry?.id || null,
      }
    })

    const defaultProvider = dbProviders.find(p => p.isDefault)

    return NextResponse.json({
      providers,
      defaultProviderId: defaultProvider?.providerId || "zai",
      total: providers.length,
      enabled: providers.filter(p => p.enabled).length,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// POST — save/update provider config
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { providerId, name, apiKey, baseURL, enabled, isDefault } = body

    if (!providerId || !PROVIDER_REGISTRY[providerId as ProviderId]) {
      return NextResponse.json({ error: "invalid providerId" }, { status: 400 })
    }

    const reg = PROVIDER_REGISTRY[providerId as ProviderId]

    // If setting as default, unset others
    if (isDefault) {
      await db.provider.updateMany({ where: { isDefault: true }, data: { isDefault: false } })
    }

    // Upsert provider config
    const saved = await db.provider.upsert({
      where: { providerId },
      update: {
        name: name || reg.name,
        apiKey: apiKey !== undefined ? apiKey : undefined,
        baseURL: baseURL || undefined,
        enabled: enabled ?? undefined,
        isDefault: isDefault ?? undefined,
      },
      create: {
        providerId,
        name: name || reg.name,
        apiKey: apiKey || null,
        baseURL: baseURL || reg.baseURL,
        enabled: enabled ?? false,
        isDefault: isDefault ?? false,
      },
    })

    return NextResponse.json({ saved, ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// DELETE — remove provider config
export async function DELETE(req: NextRequest) {
  try {
    const providerId = req.nextUrl.searchParams.get("providerId")
    if (!providerId) return NextResponse.json({ error: "providerId required" }, { status: 400 })

    await db.provider.deleteMany({ where: { providerId } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
