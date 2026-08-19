// Prompt Templates — onboarding cards with pre-built prompts.
// Adapted from mimo-ai templates.ts.

export interface PromptTemplate {
  id: string
  category: "build" | "debug" | "research" | "plan" | "refactor" | "test"
  icon: string
  titleAr: string
  titleEn: string
  descAr: string
  descEn: string
  prompt: string
  autonomous: boolean
  gradient: string
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "build-landing",
    category: "build",
    icon: "Rocket",
    titleAr: "بناء صفحة هبوط",
    titleEn: "Build Landing Page",
    descAr: "صفحة HTML + CSS + JS كاملة",
    descEn: "Full HTML + CSS + JS page",
    prompt: "ابنِ صفحة هبوط لموقع شركة برمجيات: HTML + CSS + JS، مع قسم بطولة، ميزات، أسعار، واتصال.",
    autonomous: true,
    gradient: "from-emerald-500 to-cyan-500",
  },
  {
    id: "debug-error",
    category: "debug",
    icon: "Bug",
    titleAr: "تصحيح خطأ",
    titleEn: "Debug Error",
    descAr: "اقرأ الكود واصلح الخطأ",
    descEn: "Read code and fix the bug",
    prompt: "اقرأ ملف calculator.js، ابحث عن أي أخطاء برمجية، أصلحها، ثم شغّل الاختبارات للتأكد.",
    autonomous: false,
    gradient: "from-red-500 to-orange-500",
  },
  {
    id: "research-topic",
    category: "research",
    icon: "Search",
    titleAr: "بحث موضوع",
    titleEn: "Research Topic",
    descAr: "ابحث في الويب واكتب تقريراً",
    descEn: "Search the web and write a report",
    prompt: "ابحث عن أفضل ممارسات Next.js 16، استخدم المتصفح لقراءة 3 مصادر، واكتب تقريراً بالعربية.",
    autonomous: true,
    gradient: "from-blue-500 to-purple-500",
  },
  {
    id: "plan-project",
    category: "plan",
    icon: "ListChecks",
    titleAr: "تخطيط مشروع",
    titleEn: "Plan Project",
    descAr: "حلل المشروع واقترح تحسينات",
    descEn: "Analyze project and suggest improvements",
    prompt: "اعرض هيكل المشروع، حلل البنية، واقترح 5 تحسينات ذات أولوية مع تقدير الجهد.",
    autonomous: false,
    gradient: "from-amber-500 to-yellow-500",
  },
  {
    id: "refactor-code",
    category: "refactor",
    icon: "RefreshCw",
    titleAr: "إعادة هيكلة",
    titleEn: "Refactor Code",
    descAr: "نظّف الكود بأمان",
    descEn: "Clean up code safely",
    prompt: "اقرأ الملف، أعد هيكلته بأمان: استخرج دوالاً أصغر، أعد التسمية، وتأكد أن الاختبارات تنجح بعد كل تغيير.",
    autonomous: true,
    gradient: "from-purple-500 to-pink-500",
  },
  {
    id: "write-tests",
    category: "test",
    icon: "FlaskConical",
    titleAr: "كتابة اختبارات",
    titleEn: "Write Tests",
    descAr: "اكتب اختبارات للكود",
    descEn: "Write tests for the code",
    prompt: "اقرأ الملف، اكتب اختبارات شاملة له (Arrange-Act-Assert)، شغّلها، وتأكد أنها تنجح.",
    autonomous: true,
    gradient: "from-cyan-500 to-teal-500",
  },
]
