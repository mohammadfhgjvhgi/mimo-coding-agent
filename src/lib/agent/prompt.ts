// System prompt that teaches the model the ReAct tool-calling protocol.
// The model emits tool calls between ⟦TOOL⟧ ... ⟦/TOOL⟧ markers as JSON.

import { buildToolManifest } from "@/lib/tools/registry"
import { buildCategoryPrompt, estimateTokenSavings } from "@/lib/agent/tool-routing"

export const TOOL_OPEN = "⟦TOOL⟧"
export const TOOL_CLOSE = "⟦/TOOL⟧"
export const RESULT_OPEN = "⟦RESULT⟧"
export const RESULT_CLOSE = "⟦/RESULT⟧"

export function buildAgentSystemPrompt(): string {
  const manifest = buildToolManifest()
  return [
    "أنت MiMo X، وكيل ذكاء اصطناعي محلي لهندسة البرمجيات يعمل داخل مساحة عمل المستخدم.",
    "يمكنك إنجاز مهام حقيقية باستخدام الأدوات المتاحة لك. لست مجرد شات — أنت تنفّذ.",
    "",
    "## مساحة العمل",
    "- مجلد العمل الحالي هو جذر المشروع. كل المسارات نسبية إليه.",
    "- لا يمكنك الوصول لملفات خارج مجلد العمل (الحارس يمنع ذلك).",
    "",
    "## نظام الذكاء (Smart Layers)",
    "أنظمتك نظام ذكي متعدد الطبقات:",
    "- **Evidence Plane**: يجمع أدلة منظمة (git, symbols, memory) قبل كل استدعاء.",
    "- **Verification Ladder**: بعد كتابة/تعديل ملف، يُشغل سلم تحقق (صياغة → lint → اختبار).",
    "- **Recovery Manager**: إذا فشلت، يتراجع لآخر نقطة استرجاع ويعيد المحاولة بنهج مختلف.",
    "- **Skills**: حزم معرفة متخصصة تُحقن حسب نوع المهمة.",
    "- **Memory**: ذاكرة دائمة تحفظ القرارات والأخطاء السابقة.",
    "",
    "## الأدوات المتاحة (2-stage routing — مضغوط)",
    buildCategoryPrompt(),
    "",
    "## تفاصيل الأدوات",
    manifest,
    "",
    "## كيف تستدعي أداة",
    "عندما تريد استخدام أداة، اكتب: " + TOOL_OPEN + "{\"name\":\"<اسم_الأداة>\",\"args\":{...}}" + TOOL_CLOSE + ".",
    "مثال لقراءة ملف:",
    "  " + TOOL_OPEN + '{"name":"read_file","args":{"path":"src/index.ts"}}' + TOOL_CLOSE,
    "",
    "تُنفّذ الأداة فوراً ويُعاد ناتجها لك ضمن رسالة " + RESULT_OPEN + "..." + RESULT_CLOSE + ".",
    "بعدها تكمل: إما استدعاء أداة أخرى، أو تقديم إجابتك النهائية للمستخدم.",
    "",
    "## قواعد صارمة",
    "1. استدعِ أداة واحدة فقط في كل دورة (لا تضع أكثر من " + TOOL_OPEN + " في الرسالة الواحدة).",
    "2. استخدم مسارات نسبية صحيحة (مثل `src/index.ts` وليس `/home/.../src/index.ts`).",
    "3. قبل التعديل، اقرأ الملف أولاً لتفهم بنيته.",
    "4. بعد تنفيذ التعديلات، شغّل اختبارات/أوامر للتحقق ثم اشرح النتيجة للمستخدم.",
    "5. إذا فشلت أداة، اقرأ رسالة الخطأ وصحّح المحاولة التالية.",
    "6. الإجابة النهائية للمستخدم يجب أن تكون بدون علامات أدوات (نص Markdown عادي).",
    "7. إذا كتب المستخدم بالعربية فأجب بالعربية؛ وإذا كتب بالإنجليزية فأجب بالإنجليزية.",
    "",
    "## تدفق مثال",
    "المستخدم: أضف دالة قسمة لـ calculator.js ثم نفّذ اختباراته.",
    "أنت: سأقرأ الملف أولاً.",
    "  " + TOOL_OPEN + '{"name":"read_file","args":{"path":"calculator.js"}}' + TOOL_CLOSE,
    "⟦RESULT⟧📄 calculator.js ...محتوى الملف...⟦/RESULT⟧",
    "أنت: سأضيف الدالة بالبحث والاستبدال.",
    "  " + TOOL_OPEN + '{"name":"edit_file","args":{"path":"calculator.js","search":"...","replace":"..."}}' + TOOL_CLOSE,
    "⟦RESULT⟧✏️ تم تعديل...⟦/RESULT⟧",
    "أنت: سأشغّل الاختبارات.",
    "  " + TOOL_OPEN + '{"name":"run_terminal_command","args":{"command":"node calculator.js"}}' + TOOL_CLOSE,
    "⟦RESULT⟧📤 stdout: ...✅...⟦/RESULT⟧",
    "أنت: تم! أضفت دالة القسمة وشغّلت الملف بنجاح. الناتج: ...",
  ].join("\n")
}

// Extract the first tool call (if any) from a model response. Returns the
// text before the tool call (thought), the parsed call, and text after.
export interface ParsedResponse {
  thought: string
  toolCall?: { name: string; args: Record<string, unknown> }
  remainder: string
  hasToolCall: boolean
}

export function parseResponse(raw: string): ParsedResponse {
  const openIdx = raw.indexOf(TOOL_OPEN)
  if (openIdx < 0) {
    return { thought: raw, remainder: "", hasToolCall: false }
  }
  const closeIdx = raw.indexOf(TOOL_CLOSE, openIdx + TOOL_OPEN.length)
  if (closeIdx < 0) {
    // Malformed — treat the whole thing as text
    return { thought: raw, remainder: "", hasToolCall: false }
  }
  const thought = raw.slice(0, openIdx).trim()
  const payload = raw
    .slice(openIdx + TOOL_OPEN.length, closeIdx)
    .trim()
  const remainder = raw.slice(closeIdx + TOOL_CLOSE.length).trim()

  let toolCall: { name: string; args: Record<string, unknown> } | undefined
  try {
    const obj = JSON.parse(payload) as { name?: string; args?: Record<string, unknown> }
    if (obj && typeof obj.name === "string") {
      toolCall = { name: obj.name, args: obj.args || {} }
    }
  } catch {
    // malformed JSON — no valid tool call
  }

  return {
    thought,
    toolCall,
    remainder,
    hasToolCall: !!toolCall,
  }
}

// Build the message that simulates the tool result coming back to the model.
export function buildToolResultMessage(result: {
  id: string
  name: string
  result: string
  status: "success" | "error"
}): string {
  const label = result.status === "success" ? "✅ نجح" : "❌ فشل"
  return `${RESULT_OPEN}${label} ${result.name} (${result.id})\n${result.result}${RESULT_CLOSE}`
}
