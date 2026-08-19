// Skills Manager — domain-specific knowledge bundles injected into the system prompt.
// Skills are JSON files that contain expert instructions for specific domains.
// When the agent works on a task, relevant skills are detected and injected.

import fs from "node:fs"
import path from "node:path"
import yaml from "js-yaml"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"

export interface Skill {
  name: string
  description: string
  triggers: string[] // keywords that activate this skill
  instructions: string // expert knowledge to inject
  examples?: string[]
  /** Optional path/origin marker so the UI can show where a skill came from. */
  source?: "builtin" | "imported" | "custom"
  /** Optional category for grouping in the UI. */
  category?: string
  /** Optional version string from the SKILL.md frontmatter. */
  version?: string
  /** Optional license string from the SKILL.md frontmatter. */
  license?: string
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
    source: "builtin",
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
    source: "builtin",
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
    source: "builtin",
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
    source: "builtin",
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
    source: "builtin",
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
    source: "builtin",
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
    source: "builtin",
  },
]

// ---------------------------------------------------------------------------
// Imported skills — loaded from `<workspace>/skills/imported/<name>/SKILL.md`
// (recursively). The YAML frontmatter provides metadata; the body is the
// expert-instruction text. Each skill must declare a `name` to be loaded.
// ---------------------------------------------------------------------------

const IMPORTED_SKILLS_DIR = path.join(path.resolve(WORKSPACE_ROOT), "skills", "imported")

interface SkillFrontmatter {
  name?: unknown
  description?: unknown
  triggers?: unknown
  category?: unknown
  version?: unknown
  license?: unknown
}

function coerceString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value === "number") return String(value)
  return undefined
}

function coerceTriggers(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter(Boolean)
  }
  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return []
}

function parseSkillMd(raw: string): { frontmatter: SkillFrontmatter; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) {
    return { frontmatter: {}, body: raw }
  }
  let fm: SkillFrontmatter = {}
  try {
    const parsed = yaml.load(match[1])
    if (parsed && typeof parsed === "object") {
      fm = parsed as SkillFrontmatter
    }
  } catch {
    /* malformed YAML — treat as no frontmatter */
  }
  return { frontmatter: fm, body: match[2].trim() }
}

let importedSkillsCache: Skill[] | null = null

export function loadImportedSkills(force = false): Skill[] {
  if (!force && importedSkillsCache) return importedSkillsCache

  const out: Skill[] = []
  if (!fs.existsSync(IMPORTED_SKILLS_DIR)) {
    importedSkillsCache = out
    return out
  }

  // Walk one level deep — each immediate subdirectory of `skills/imported/`
  // is a single skill. Within it we look for a top-level `SKILL.md`.
  // (We deliberately avoid descending further to keep scan-time bounded.)
  let entries: string[] = []
  try {
    entries = fs.readdirSync(IMPORTED_SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    importedSkillsCache = out
    return out
  }

  for (const dirName of entries) {
    const skillMdPath = path.join(IMPORTED_SKILLS_DIR, dirName, "SKILL.md")
    if (!fs.existsSync(skillMdPath)) continue

    let raw = ""
    try {
      raw = fs.readFileSync(skillMdPath, "utf8")
    } catch {
      continue
    }
    if (!raw.trim()) continue

    const { frontmatter, body } = parseSkillMd(raw)
    const name = coerceString(frontmatter.name) ?? dirName
    const description = coerceString(frontmatter.description) ?? ""
    const triggers = coerceTriggers(frontmatter.triggers)

    // Auto-generate triggers from the skill name if none are declared so the
    // detectSkills keyword matcher still picks it up.
    const autoTriggers = triggers.length > 0 ? triggers : [name.toLowerCase().replace(/[_\s-]+/g, " ")]

    out.push({
      name,
      description,
      triggers: autoTriggers,
      instructions: body || `# ${name}\n\n${description}`,
      source: "imported",
      category: coerceString(frontmatter.category),
      version: coerceString(frontmatter.version),
      license: coerceString(frontmatter.license),
    })
  }

  importedSkillsCache = out
  return out
}

// Detect which skills are relevant based on the task text
export function detectSkills(taskText: string): Skill[] {
  const text = taskText.toLowerCase()
  const all = [...BUILTIN_SKILLS, ...loadImportedSkills()]
  const matched = all.filter((skill) =>
    skill.triggers.some((trigger) => trigger && text.includes(trigger.toLowerCase()))
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
export function listSkills(): { name: string; description: string; triggers: string[]; source?: string }[] {
  const imported = loadImportedSkills()
  return [
    ...BUILTIN_SKILLS.map((s) => ({
      name: s.name,
      description: s.description,
      triggers: s.triggers,
      source: s.source,
    })),
    ...imported.map((s) => ({
      name: s.name,
      description: s.description,
      triggers: s.triggers,
      source: s.source,
    })),
  ]
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
          custom.push({ ...skill, source: "custom" })
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

/** Force the imported-skills cache to refresh on the next read. */
export function invalidateImportedSkillsCache(): void {
  importedSkillsCache = null
}
