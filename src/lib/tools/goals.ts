// set_goal tool — defines a long-horizon task with acceptance criteria.
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

export const setGoalTool: ToolDef = {
  name: "set_goal",
  description:
    "يحدّد هدفًا طويل الأمد مع معايير قبول. استخدمه عند بدء مهمة كبيرة (مثل: بناء تطبيق كامل). النظام سيخطّط وينفّذ ويتحقق ذاتياً حتى تحقيق المعايير.",
  schema: {
    type: "object",
    properties: {
      goal: {
        type: "string",
        description: "الهدف النهائي (مثل: بناء تطبيق آلة حاسبة كامل)",
      },
      acceptanceCriteria: {
        type: "array",
        description: "قائمة معايير القبول التي سيتحقق منها النظام تلقائياً",
        items: { type: "string" },
      },
    },
    required: ["goal", "acceptanceCriteria"],
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now()
    const id = `goal_${start}_${Math.random().toString(36).slice(2, 7)}`
    const goal = String(args.goal || "").trim()
    const criteria = args.acceptanceCriteria
    if (!goal) {
      return fail(id, "set_goal", args, "الهدف مطلوب", 0)
    }
    let criteriaArr: string[]
    if (Array.isArray(criteria)) {
      criteriaArr = criteria.map((c) => String(c))
    } else if (typeof criteria === "string") {
      // Allow comma-separated string too
      criteriaArr = (criteria as string).split("\n").map((s) => s.trim()).filter(Boolean)
    } else {
      return fail(id, "set_goal", args, "معايير القبول مطلوبة (مصفوفة)", 0)
    }
    if (criteriaArr.length === 0) {
      return fail(id, "set_goal", args, "معايير القبول لا يمكن أن تكون فارغة", 0)
    }

    try {
      const task = await db.task.create({
        data: {
          goal,
          acceptanceCriteria: JSON.stringify(criteriaArr),
          status: "pending",
        },
      })
      return ok(
        id,
        "set_goal",
        args,
        `🎯 تم تحديد الهدف (المهمة #${task.id.slice(-6)}).\nالهدف: ${goal}\nمعايير القبول:\n${criteriaArr.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\nالنظام جاهز لبدء التنفيذ المستقل. سيخطط، ينفذ، ويتحقق ذاتياً.`,
        Date.now() - start
      )
    } catch (e) {
      return fail(
        id,
        "set_goal",
        args,
        `فشل إنشاء المهمة: ${e instanceof Error ? e.message : String(e)}`,
        Date.now() - start
      )
    }
  },
}
