// /api/ux-actions — POST (all actions) + GET (quick actions / snapshot)
import { NextRequest, NextResponse } from "next/server"
import {
  quickAIActions, inlineAI, selectionActions,
  explainSelection, refactorSelection, translateSelection,
  summarizeSelection, askAboutSelection,
  convertToTask, convertToNote, convertToKnowledge,
  uxSnapshot,
} from "@/lib/ux-actions/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      case "inline_ai": return wrap(inlineAI({ context: body.context, cursorPosition: body.cursorPosition, language: body.language }))
      case "selection_actions": return wrap(selectionActions({ text: body.text }))
      case "explain": return wrap(explainSelection(body.text, body.language))
      case "refactor": return wrap(refactorSelection(body.text, body.language))
      case "translate": return wrap(translateSelection(body.text, body.targetLang))
      case "summarize": return wrap(summarizeSelection(body.text))
      case "ask": return wrap(askAboutSelection(body.text, body.question))
      case "to_task": return wrap(await convertToTask(body.text, { priority: body.priority, projectId: body.projectId }))
      case "to_note": return wrap(await convertToNote(body.text, { title: body.title, tags: body.tags }))
      case "to_knowledge": return wrap(await convertToKnowledge(body.text, { title: body.title, tags: body.tags }))
      default: return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 })
    }
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}

export async function GET() {
  try {
    return wrap(quickAIActions())
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}

function wrap<T>(result: { ok: boolean; data?: T; error?: string; message?: string }) {
  if (result.ok) return NextResponse.json(result.data)
  return NextResponse.json({ error: result.error, message: result.message }, { status: 400 })
}
