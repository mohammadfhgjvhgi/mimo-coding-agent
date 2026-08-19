import { NextRequest, NextResponse } from "next/server";
import {
  ollamaIsReachable,
  listOllamaModels,
  getSettings,
  setSettings,
  DEFAULT_SETTINGS,
  type ProviderSettings,
} from "@/lib/llm-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/providers -> probe Ollama, list models, return server defaults
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("ollamaUrl");
  const settings = getSettings();
  const probeUrl = url || settings.ollamaUrl || DEFAULT_SETTINGS.ollamaUrl;

  const reachable = await ollamaIsReachable(probeUrl);
  let models: { name: string; size?: number; family?: string }[] = [];
  if (reachable) {
    try {
      models = await listOllamaModels(probeUrl);
    } catch (e) {
      console.error("[GET /api/providers] listOllamaModels:", e);
    }
  }

  return NextResponse.json({
    reachable,
    ollamaUrl: probeUrl,
    models,
    settings,
    defaults: DEFAULT_SETTINGS,
  });
}

// POST /api/providers -> persist server-side settings
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Partial<ProviderSettings>;
  const updated = setSettings(body);
  return NextResponse.json({ settings: updated });
}
