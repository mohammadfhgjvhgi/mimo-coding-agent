// Agent Modes — 10 specialized modes for the Coding Agent.
// Each mode has: a system prompt modifier, tool allow-list, and behavior rules.
// The mode is selected by the user in the UI and injected into the agent's system prompt.

export type AgentMode =
  | "plan"        // Plan only — no execution
  | "agent"       // Full autonomous — execute everything
  | "ask"         // Answer questions only — no tools
  | "debug"       // Debug mode — focus on finding and fixing bugs
  | "review"      // Code review — analyze and suggest improvements
  | "research"    // Research mode — web search + reading
  | "architect"   // Architecture mode — design and analyze structure
  | "refactor"    // Refactor mode — safe code restructuring
  | "security"    // Security mode — vulnerability analysis
  | "performance"  // Performance mode — optimization

export const MODE_CONFIG: Record<AgentMode, {
  label: string
  icon: string
  description: string
  systemPrompt: string
  allowedTools: string[] | "all"
  color: string
}> = {
  plan: {
    label: "تخطيط",
    icon: "ListChecks",
    description: "يخطط فقط دون تنفيذ — ينتج خطة مفصلة",
    systemPrompt: `أنت في وضع التخطيط. مهمتك:
1. حلل المطلوب بدقة
2. أنشئ خطة مرقمة مفصلة (خطوة بخطوة)
3. حدد الملفات التي ستتأثر
4. حدد المخاطر والاعتبارات
لا تنفذ أي أداة. فقط الخطّط. أرجع الخطة بصيغة مرقمة.`,
    allowedTools: ["read_file", "list_files", "find_symbol", "get_references", "structural_search"],
    color: "text-blue-500",
  },
  agent: {
    label: "وكيل",
    icon: "Bot",
    description: "تنفيذ مستقل كامل — يخطط وينفذ ويتحقق",
    systemPrompt: `أنت في وضع الوكيل المستقل. مهمتك:
1. خطط للمهمة
2. نفّذ خطوة بخطوة باستخدام الأدوات
3. تحقق من كل خطوة (lint, test, build)
4. إذا فشلت، صحّح وأعد المحاولة
5. احفظ نقطة استرجاع عند الانتهاء
كن استباقياً — لا تنتظر موافقة لكل خطوة.`,
    allowedTools: "all",
    color: "text-emerald-500",
  },
  ask: {
    label: "سؤال",
    icon: "HelpCircle",
    description: "أجب على الأسئلة فقط — لا تعديل",
    systemPrompt: `أنت في وضع الأسئلة. مهمتك:
- أجب على أسئلة المستخدم بدقة
- اشرح المفاهيم بوضوح
- لا تعدّل أي ملفات
- استخدم read_file للقراءة فقط إذا احتجت سياقاً
كن موجزاً ودقيقاً.`,
    allowedTools: ["read_file", "list_files", "find_symbol", "recall_memory"],
    color: "text-cyan-500",
  },
  debug: {
    label: "تصحيح",
    icon: "Bug",
    description: "تركيز على إيجاد وإصلاح الأخطاء",
    systemPrompt: `أنت في وضع التصحيح. مهمتك:
1. اقرأ الخطأ/المشكلة بعناية
2. اقرأ الملفات ذات الصلة
3. استخدم run_terminal_command لتشغيل الاختبارات/lint
4. حدد سبب المشكلة بدقة
5. اقترح حلاً ثم نفّذه
6. تحقق من الحل (أعد تشغيل الاختبارات)
ركّز على السبب الجذري، ليس الأعراض.`,
    allowedTools: ["read_file", "edit_file", "run_terminal_command", "find_symbol", "get_references", "structural_search"],
    color: "text-red-500",
  },
  review: {
    label: "مراجعة",
    icon: "Eye",
    description: "مراجعة كود — تحليل وتحسينات",
    systemPrompt: `أنت في وضع مراجعة الكود. مهمتك:
1. اقرأ الكود المطلوب مراجعته
2. حلل: الجودة، الأمان، الأداء، القابلية للقراءة
3. اذكر المشكلات بترتيب الأولوية (حرج/عالي/متوسط/منخفض)
4. اقترح تحسينات محددة مع كود
5. لا تعدّل الملفات — فقط اقترح
كن صريحاً ومحدداً.`,
    allowedTools: ["read_file", "list_files", "find_symbol", "get_references", "structural_search"],
    color: "text-amber-500",
  },
  research: {
    label: "بحث",
    icon: "Search",
    description: "بحث ويب + قراءة + استشهاد",
    systemPrompt: `أنت في وضع البحث. مهمتك:
1. ابحث في الويب عن المعلومات المطلوبة
2. اقرأ المصادر واستخرج الحقائق
3. استشهد بالمصادر [1], [2]
4. اكتب تقريراً منظماً
استخدم browser_navigate للبحث والقراءة.`,
    allowedTools: ["browser_navigate", "browser_screenshot", "recall_memory", "save_memory"],
    color: "text-sky-500",
  },
  architect: {
    label: "معماري",
    icon: "Building2",
    description: "تصميم معماري — تحليل البنية",
    systemPrompt: `أنت في وضع الهندسة المعمارية. مهمتك:
1. حلل بنية المشروع الحالية
2. ارسم مخطط المكونات والاعتماديات
3. حدد نقاط الضعف المعمارية
4. اقترح تحسينات مع أولوية
5. قدّر الجهد (S/M/L)
لا تعدّل الملفات — فقط حلل واقترح.`,
    allowedTools: ["read_file", "list_files", "find_symbol", "get_references", "structural_search"],
    color: "text-purple-500",
  },
  refactor: {
    label: "هيكلة",
    icon: "RefreshCw",
    description: "إعادة هيكلة آمنة — تحسين بدون كسر",
    systemPrompt: `أنت في وضع إعادة الهيكلة. مهمتك:
1. اقرأ الكود وافهمه أولاً
2. تأكد أن الاختبارات تنجح قبل التعديل
3. خطوة واحدة في كل مرة
4. استخدم edit_file للتغييرات الصغيرة
5. بعد كل تغيير: شغّل الاختبارات
6. إذا فشلت: git_checkpoint للتراجع
لا تغير 10 أشياء دفعة واحدة.`,
    allowedTools: ["read_file", "edit_file", "run_terminal_command", "find_symbol", "get_references", "git_checkpoint"],
    color: "text-indigo-500",
  },
  security: {
    label: "أمن",
    icon: "Shield",
    description: "تحليل أمني — ثغرات ومخاطر",
    systemPrompt: `أنت في وضع الأمن السيبراني. مهمتك:
1. ابحث عن ثغرات (OWASP Top 10, CWE)
2. حلل: حقن SQL/XSS، CORS، مصادقة، تشفير
3. افحص dependencies لمخاطر معروفة
4. قيّم المخاطر (حرج/عالي/متوسط/منخفض)
5. اقترح إصلاحات مع كود
كن دقيقاً — لا تخمن، تحقق.`,
    allowedTools: ["read_file", "run_terminal_command", "structural_search", "find_symbol", "get_references"],
    color: "text-orange-500",
  },
  performance: {
    label: "أداء",
    icon: "Gauge",
    description: "تحسين الأداء — اختناقات وحلول",
    systemPrompt: `أنت في وضع تحسين الأداء. مهمتك:
1. حلل اختناقات الأداء (CPU, RAM, network)
2. ابحث عن: حلقات غير ضرورية، استعلامات متكررة، memory leaks
3. استخدم run_terminal_command للقياس
4. اقترح تحسينات مع كود
5. قدّر الأثر المتوقع
ركّز على التحسينات ذات الأثر الأكبر أولاً.`,
    allowedTools: ["read_file", "edit_file", "run_terminal_command", "find_symbol", "get_references"],
    color: "text-pink-500",
  },
}

export const ALL_MODES: AgentMode[] = [
  "agent", "plan", "ask", "debug", "review", "research", "architect", "refactor", "security", "performance",
]

export function getModePrompt(mode: AgentMode): string {
  return MODE_CONFIG[mode]?.systemPrompt || ""
}

export function getModeTools(mode: AgentMode): string[] | "all" {
  return MODE_CONFIG[mode]?.allowedTools || "all"
}

export function getModeLabel(mode: AgentMode): string {
  return MODE_CONFIG[mode]?.label || mode
}

// ============ AUTO MODE DETECTION ============
// Analyzes the user's message and automatically determines the best mode.
// 0-LLM — pure deterministic keyword matching.
// This replaces manual mode selection: the user just types their request,
// and the system picks the right tools + system prompt automatically.

export function autoDetectMode(message: string): { mode: AgentMode; reason: string } {
  const text = message.toLowerCase().trim()

  // 1. Debug mode — error fixing
  if (/\b(خطأ|error|bug|crash|فشل|fail|broken|استثناء|exception|stack trace|debug|صلح|أصلح|اصلح|fix)\b/i.test(text)) {
    return { mode: "debug", reason: "كلمات: خطأ/فشل/صلح → وضع التصحيح" }
  }

  // 2. Review mode — code review
  if (/\b(راجع|مراجعة|review|analyze.*code|تحليل.*كود|quality|جودة|check.*code)\b/i.test(text)) {
    return { mode: "review", reason: "كلمات: راجع/مراجعة → وضع المراجعة" }
  }

  // 3. Research mode — web search
  if (/\b(ابحث|بحث|research|search.*web|search.*online|find.*information|google|دورك|duckduckgo)\b/i.test(text)) {
    return { mode: "research", reason: "كلمات: ابحث/بحث → وضع البحث" }
  }

  // 4. Architect mode — design/structure
  if (/\b(معماري|architecture|design.*system|بنية|هيكل|structure|pattern|design pattern|مكونات|components)\b/i.test(text)) {
    return { mode: "architect", reason: "كلمات: معماري/بنية/هيكل → وضع المعماري" }
  }

  // 5. Refactor mode — restructuring
  if (/\b(refactor|هيكلة|إعادة هيكلة|اعادة هيكلة|نظف|clean.*code|simplify|تبسيط|restructure|reorganize)\b/i.test(text)) {
    return { mode: "refactor", reason: "كلمات: هيكلة/نظف → وضع إعادة الهيكلة" }
  }

  // 6. Security mode — vulnerability analysis
  if (/\b(أمن|security|vulnerab|ثغرة|cve|owasp|injection|xss|sql.*inject|exploit|hack|penetr)\b/i.test(text)) {
    return { mode: "security", reason: "كلمات: أمن/ثغرة → وضع الأمن" }
  }

  // 7. Performance mode — optimization
  if (/\b(أداء|performance|optimi|speed|slow|بطيء|تسريع|memory leak|bottleneck|اختناق|قياس|benchmark)\b/i.test(text)) {
    return { mode: "performance", reason: "كلمات: أداء/بطيء → وضع الأداء" }
  }

  // 8. Plan mode — planning only
  if (/\b(plan|خطط|خطة|تخطيط|plan.*project|design.*plan|how.*should|what.*approach|استراتيجية)\b/i.test(text)) {
    return { mode: "plan", reason: "كلمات: خطط/خطة → وضع التخطيط" }
  }

  // 9. Ask mode — questions about code
  if (/^(ما|ماذا|كيف|لماذا|متى|اين|أين|اشرح|يشرح|what|how|why|when|where|explain|difference|فرق|مقارنة)\b/i.test(text)) {
    return { mode: "ask", reason: "سؤال مباشر → وضع الأسئلة" }
  }

  // 10. Default: agent mode — autonomous execution
  // Triggered by: "انشئ", "اكتب", "عدّل", "نفّذ", "create", "write", "edit", "run", "build", "test"
  return { mode: "agent", reason: "طلب تنفيذ → وضع الوكيل المستقل" }
}
