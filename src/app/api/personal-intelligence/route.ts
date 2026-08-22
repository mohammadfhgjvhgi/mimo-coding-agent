// /api/personal-intelligence — POST + GET
import { NextRequest, NextResponse } from "next/server"
import {
  personalProfile, preferenceEngine, goalEngine, priorityEngine,
  routineDetection, routineSuggestions, decisionHistory,
  projectRelationships, knowledgeRelationships, personalTimeline,
  personalIntelligenceSnapshot,
} from "@/lib/personal-intelligence/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      case "pref_set": return wrap(await preferenceEngine("set", { key: body.key, value: body.value }))
      case "pref_get": return wrap(await preferenceEngine("get", { key: body.key }))
      case "pref_list": return wrap(await preferenceEngine("list"))
      default: return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 })
    }
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const mode = sp.get("mode") ?? "snapshot"
    switch (mode) {
      case "profile": return wrap(await personalProfile())
      case "preferences": return wrap(await preferenceEngine("list"))
      case "goals": return wrap(await goalEngine())
      case "priorities": return wrap(await priorityEngine())
      case "routines": return wrap(await routineDetection())
      case "suggestions": return wrap(await routineSuggestions())
      case "decisions": return wrap(await decisionHistory())
      case "project_rels": return wrap(await projectRelationships())
      case "knowledge_rels": return wrap(await knowledgeRelationships())
      case "timeline": return wrap(await personalTimeline(parseInt(sp.get("limit") ?? "50")))
      case "snapshot": return wrap(await personalIntelligenceSnapshot())
      default: return NextResponse.json({ error: `unknown mode: ${mode}` }, { status: 400 })
    }
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}

function wrap<T>(result: { ok: boolean; data?: T; error?: string; message?: string }) {
  if (result.ok) return NextResponse.json(result.data)
  return NextResponse.json({ error: result.error, message: result.message }, { status: 400 })
}
