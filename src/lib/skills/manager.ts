// Skills Manager — domain-specific knowledge bundles injected into the system prompt.
// Skills are JSON files that contain expert instructions for specific domains.
// When the agent works on a task, relevant skills are detected and injected.

import fs from "node:fs"
import path from "node:path"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"

export interface Skill {
  name: string
  description: string
  triggers: string[] // keywords that activate this skill
  instructions: string // expert knowledge to inject
  examples?: string[]
}

// Built-in skills (could also be loaded from JSON files)
const BUILTIN_SKILLS: Skill[] = [
  {
    name: "nextjs",
    description: "خبرة في تطوير Next.js 15+ (App Router)",
    triggers: ["next", "app router", "server component", "use client", "use server", "page.tsx", "layout.tsx", "api route", "ssr", "ssg"],
    instructions: [
      "Next.js 15+ يستخدم App Router (app/ directory) وليس Pages Router.",
      "الملفات: page.tsx (صفحة), layout.tsx (تخطيط), loading.tsx (تحميل), error.tsx (خطأ).",
      "'use client' للكود الذي يعمل في المتصفح، 'use server' للـ Server Actions.",
      "API Routes في app/api/route.ts تستخدم export async function GET/POST.",
      "لا تستخدم getServerSideProps/getStaticProps — هذه من Pages Router القديم.",
      "للبيانات: استخدم Server Components افتراضياً، و 'use client' فقط عند الحاجة للـ hooks.",
    ].join("\n"),
  },
  {
    name: "typescript",
    description: "خبرة في TypeScript المتقدم",
    triggers: ["typescript", "ts", "type", "interface", "generic", "enum", "type guard", "unknown", "never"],
    instructions: [
      "استخدم strict mode دائماً (strict: true في tsconfig.json).",
      "تجنب `any` — استخدم `unknown` + type guard بدلاً منه.",
      "للأنواع المشتركة: interface للكائنات، type alias للـ unions.",
      "استخدم `as const` للثوابت الحرفية.",
      "للـ generics: أعطِ أسماء وصفية (T, K, V) وأضف قيود (constraints).",
    ].join("\n"),
  },
  {
    name: "debugging",
    description: "خبرة في تصحيح الأخطاء",
    triggers: ["debug", "fix", "error", "bug", "crash", "stack trace", "exception", "fail"],
    instructions: [
      "اقرأ رسالة الخطأ كاملة قبل أي إجراء — السطر الأول عادة يحتوي على السبب.",
      "ابحث عن الـ stack trace — آخر استدعاء هو عادة موقع الخطأ.",
      "إذا كان الخطأ في استدعاء دالة، تحقق من المدخلات (types, null, undefined).",
      "استخدم console.log للتشخيص، لكن احذفه قبل التسليم.",
      "إذا فشل بعد تعديل، استخدم git diff لمعرفة ما تغير.",
      "لا تفترض — تحقق فعلياً. اقرأ الملف قبل التعديل.",
    ].join("\n"),
  },
  {
    name: "testing",
    description: "خبرة في كتابة الاختبارات",
    triggers: ["test", "spec", "assert", "jest", "vitest", "mocha", "coverage", "mock", "stub"],
    instructions: [
      "كل اختبار يجب أن يتحقق من سلوك واحد محدد (Arrange-Act-Assert).",
      "اسم الاختبار يجب أن يصف السلوك: 'should return X when Y'.",
      "استخدم beforeEach/afterEach للإعداد والتنظيف.",
      "لا تختبر التنفيذ الداخلي — اختبر المخرجات.",
      "للـ mocks: استخدمها للتبعيات الخارجية (APIs, DB)، ليس للمنطق الداخلي.",
      "اجعل الاختبارات سريعة (< 1s لكل ملف).",
    ].join("\n"),
  },
  {
    name: "refactoring",
    description: "خبرة في إعادة الهيكلة",
    triggers: ["refactor", "clean", "simplify", "extract", "inline", "rename", "move"],
    instructions: [
      "إعادة الهيكلة بدون اختبارات = خطر. تأكد أن هناك اختبارات قبل البدء.",
      "خطوة واحدة في كل مرة — لا تعدل 10 أشياء دفعة واحدة.",
      "استخرج الدوال الطويلة (> 20 سطر) إلى دوال أصغر بأسماء وصفية.",
      "أعد التسمية: الأسماء الوصفية أهم من التعليقات.",
      "إذا كررت الكود 3+ مرات، استخرجه (DRY).",
      "بعد كل خطوة: شغل الاختبارات. إذا فشلت، تراجع.",
    ].join("\n"),
  },
  {
    name: "python",
    description: "خبرة في Python",
    triggers: ["python", "py", "django", "flask", "fastapi", "pip", "venv", "pytest", "pandas"],
    instructions: [
      "استخدم type hints دائماً (Python 3.9+).",
      "للـ async: استخدم async/await مع asyncio.",
      "إدارة الاعتمادات: pyproject.toml (حديث) أو requirements.txt.",
      "البيئة الافتراضية: python -m venv .venv ثم source .venv/bin/activate.",
      "للاختبارات: pytest مع conftest.py للـ fixtures.",
      "تنسيق الكود: black + isort (أو ruff format).",
    ].join("\n"),
  },
  {
    name: "git",
    description: "خبرة في Git",
    triggers: ["git", "commit", "branch", "merge", "rebase", "conflict", "stash", "cherry-pick"],
    instructions: [
      "رسائل الـ commit: فعلية (Add/Fix/Refactor/Remove) + وصف مختصر.",
      "افرع (branch) لكل ميزة، ادمج (merge) عند الانتهاء.",
      "إذا واجهت تعارض: اقرأ كلا الجانبين، اختر الأنسب، لا تحذف كود الآخرين بدون فهم.",
      "git stash قبل التبديل بين الفروع.",
      "لا ت force-push على main/shared branches.",
      "استخدم git log --oneline -n 10 لمعرفة آخر التغييرات.",
    ].join("\n"),
  },
]

// Detect which skills are relevant based on the task text
export function detectSkills(taskText: string): Skill[] {
  const text = taskText.toLowerCase()
  const matched = BUILTIN_SKILLS.filter((skill) =>
    skill.triggers.some((trigger) => text.includes(trigger.toLowerCase()))
  )
  return matched
}

// Format skills for injection into the system prompt
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return ""

  const sections = skills.map(
    (s) => `### 🎓 ${s.name} (${s.description})\n${s.instructions}`
  )

  return `\n\n## 🎓 Skills (حقن تلقائي)\n${sections.join("\n\n")}`
}

// Get all available skill names (for the UI)
export function listSkills(): { name: string; description: string; triggers: string[] }[] {
  return BUILTIN_SKILLS.map((s) => ({
    name: s.name,
    description: s.description,
    triggers: s.triggers,
  }))
}

// Load custom skills from the workspace (if any .mimo/skills/*.json exist)
export function loadCustomSkills(): Skill[] {
  try {
    const skillsDir = path.join(path.resolve(WORKSPACE_ROOT), ".mimo", "skills")
    if (!fs.existsSync(skillsDir)) return []

    const files = fs.readdirSync(skillsDir).filter((f) => f.endsWith(".json"))
    const custom: Skill[] = []
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(skillsDir, file), "utf8")
        const skill = JSON.parse(content) as Skill
        if (skill.name && skill.instructions) {
          custom.push(skill)
        }
      } catch {
        /* ignore malformed */
      }
    }
    return custom
  } catch {
    return []
  }
}
