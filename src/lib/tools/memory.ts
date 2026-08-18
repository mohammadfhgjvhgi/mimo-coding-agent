// Memory OS tools — save and recall persistent project knowledge.
import { db } from "@/lib/db"
import type { ToolDef, ToolResult, ToolContext } from "./types"
import { truncate } from "./workspace"

function ok(
  id: string,
  name: string,
  args: Record<string, unknown>,
  result: string,
  durationMs: number
): ToolResult {
  return { id, name, args, result: truncate(result, 4000), status: "success", durationMs }
}
function fail(
  id: string,
  name: string,
  args: Record<string, unknown>,
  error: string,
  durationMs: number
): ToolResult {
  return { id, name, args, result: error, status: "error", error, durationMs }
}

export const saveMemoryTool: ToolDef = {
  name: "save_memory",
  description:
    "يحفظ معلومة مهمة في ذاكرة المشروع الدائمة (تُحقن في بداية كل محادثة). استخدمه للقرارات والحقائق والتفضيلات (مثلاً: 'المشروع يستخدم Tailwind'، 'قررنا عدم استخدام مكتبة X').",
  schema: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description: "مفتاح فريد للمعرفة (مثل: tech_stack أو naming_convention)",
      },
      value: { type: "string", description: "المعلومة المراد حفظها" },
      category: {
        type: "string",
        description: "decision | fact | preference | project (افتراضي: general)",
      },
    },
    required: ["key", "value"],
  },
  async execute(args, _ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now()
    const id = `mem_${start}_${Math.random().toString(36).slice(2, 7)}`
    const key = String(args.key || "").trim()
    const value = String(args.value || "").trim()
    const category = String(args.category || "general").trim()
    if (!key || !value) {
      return fail(id, "save_memory", args, "المفتاح والقيمة مطلوبان", 0)
    }
    try {
      // upsert by key
      const existing = await db.memory.findUnique({ where: { key } })
      let memory
      if (existing) {
        memory = await db.memory.update({
          where: { key },
          data: { value, category, updatedAt: new Date() },
        })
      } else {
        memory = await db.memory.create({ data: { key, value, category } })
      }
      return ok(
        id,
        "save_memory",
        args,
        `🧠 تم حفظ الذاكرة.\nالمفتاح: ${memory.key}\nالقيمة: ${memory.value}\nالفئة: ${memory.category}\nستُحقن هذه المعلومة في بداية كل محادثة قادمة.`,
        Date.now() - start
      )
    } catch (e) {
      return fail(
        id,
        "save_memory",
        args,
        `فشل حفظ الذاكرة: ${e instanceof Error ? e.message : String(e)}`,
        Date.now() - start
      )
    }
  },
}

export const recallMemoryTool: ToolDef = {
  name: "recall_memory",
  description:
    "يسترجع معلومة محفوظة من ذاكرة المشروع. استخدمه للتذكّر بقرارات أو حقائق سابقة. إذا لم تُحدد مفتاحاً، يُرجع قائمة بكل الذاكرة المحفوظة.",
  schema: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description: "مفتاح المعلومة المطلوب استرجاعها (اختياري — بدون مفتاح = الكل)",
      },
    },
    required: [],
  },
  async execute(args, _ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now()
    const id = `rec_${start}_${Math.random().toString(36).slice(2, 7)}`
    const key = String(args.key || "").trim()
    try {
      if (key) {
        const memory = await db.memory.findUnique({ where: { key } })
        if (!memory) {
          return ok(
            id,
            "recall_memory",
            args,
            `ℹ️ لا توجد ذاكرة بالمفتاح: ${key}`,
            Date.now() - start
          )
        }
        return ok(
          id,
          "recall_memory",
          args,
          `🧠 ذاكرة: ${memory.key}\nالقيمة: ${memory.value}\nالفئة: ${memory.category}\nآخر تحديث: ${memory.updatedAt.toISOString()}`,
          Date.now() - start
        )
      }
      // List all
      const memories = await db.memory.findMany({
        orderBy: { updatedAt: "desc" },
        take: 50,
      })
      if (memories.length === 0) {
        return ok(
          id,
          "recall_memory",
          args,
          "ℹ️ الذاكرة فارغة. استخدم save_memory لحفظ معلومات مهمة.",
          Date.now() - start
        )
      }
      const list = memories
        .map((m) => `- ${m.key} [${m.category}]: ${m.value}`)
        .join("\n")
      return ok(
        id,
        "recall_memory",
        args,
        `🧠 ذاكرة المشروع (${memories.length} عنصر):\n${list}`,
        Date.now() - start
      )
    } catch (e) {
      return fail(
        id,
        "recall_memory",
        args,
        `فشل الاسترجاع: ${e instanceof Error ? e.message : String(e)}`,
        Date.now() - start
      )
    }
  },
}

// Helper: fetch all memories as a formatted block for system prompt injection
export async function getProjectMemoryBlock(): Promise<string> {
  try {
    const memories = await db.memory.findMany({
      orderBy: { updatedAt: "desc" },
      take: 30,
    })
    if (memories.length === 0) return ""
    const lines = memories.map(
      (m) => `- ${m.key} [${m.category}]: ${m.value}`
    )
    return "\n\n## 🧠 ذاكرة المشروع (حقن تلقائي)\n" + lines.join("\n")
  } catch {
    return ""
  }
}
