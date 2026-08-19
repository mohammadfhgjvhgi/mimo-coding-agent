// ===================================================================
// MiMo AI — Internationalization (Arabic + English)
// ===================================================================

export type Locale = "ar" | "en";

export type Direction = "rtl" | "ltr";

interface TranslationDict {
  [key: string]: { ar: string; en: string };
}

const translations: TranslationDict = {
  // ─── Workspace ───
  "app.title": { ar: "منصة MiMo للذكاء الهندسي", en: "MiMo AI Engineering Platform" },
  "app.subtitle": { ar: "نظام ذكاء اصطناعي مستقل", en: "Autonomous AI Engineering System" },

  // ─── Panels ───
  "panel.chat": { ar: "المحادثة", en: "Chat" },
  "panel.tasks": { ar: "المهام", en: "Tasks" },
  "panel.agents": { ar: "الوكلاء", en: "Agents" },
  "panel.artifacts": { ar: "المنتجات", en: "Artifacts" },
  "panel.memory": { ar: "الذاكرة", en: "Memory" },
  "panel.decisions": { ar: "القرارات", en: "Decisions" },
  "panel.timeline": { ar: "السجل", en: "Timeline" },
  "panel.skills": { ar: "المهارات", en: "Skills" },
  "panel.settings": { ar: "الإعدادات", en: "Settings" },
  "panel.preview": { ar: "المعاينة", en: "Preview" },

  // ─── Chat ───
  "chat.placeholder": {
    ar: "اسأل MiMo أي شيء — كود، بحث، تخطيط، تصحيح...",
    en: "Ask MiMo anything — code, research, planning, debugging...",
  },
  "chat.autonomous.placeholder": {
    ar: "صف هدفاً — سيله MiMo يخطط وينفذ تلقائياً...",
    en: "Describe a goal — MiMo will plan & execute autonomously...",
  },
  "chat.empty.title": { ar: "منصة MiMo للذكاء الهندسي", en: "MiMo AI Engineering Platform" },
  "chat.empty.desc": {
    ar: "نظام ذكاء اصطناعي مستقل مع 10 وكلاء متخصصين و6 أدوات و69 مهارة. صف هدفاً — سيله MiMo يبحث، يخطط، يبني، يختبر، ويسلّم.",
    en: "An autonomous AI engineering system with 12 specialized agents, 18 tools, and 69 skills. Describe a goal — MiMo will research, plan, build, test, and deliver.",
  },
  "chat.you": { ar: "أنت", en: "You" },
  "chat.assistant": { ar: "المساعد", en: "Assistant" },
  "chat.thinking": { ar: "يفكر...", en: "thinking..." },
  "chat.stop": { ar: "إيقاف", en: "Stop" },
  "chat.regenerate": { ar: "إعادة توليد", en: "Regenerate" },
  "chat.copy": { ar: "نسخ", en: "Copy" },

  // ─── Autonomous ───
  "autonomous.title": { ar: "تلقائي", en: "Autonomous" },
  "autonomous.on": { ar: "مُفعّل", en: "ON" },
  "autonomous.off": { ar: "مُعطّل", en: "OFF" },

  // ─── Sidebar ───
  "sidebar.new": { ar: "محادثة جديدة", en: "New Conversation" },
  "sidebar.noConversations": { ar: "لا محادثات بعد.", en: "No conversations yet." },

  // ─── Tasks ───
  "tasks.progress": { ar: "تقدّم المهمة", en: "Mission Progress" },
  "tasks.empty": {
    ar: "لا مهام بعد. ابدأ محادثة أو فعّل الوضع التلقائي لرؤية خطة المهام.",
    en: "No tasks yet. Start a conversation or enable Autonomous Mode to see the task DAG.",
  },

  // ─── Agents ───
  "agents.active": { ar: "نشط", en: "active" },
  "agents.subtitle": {
    ar: "12 وكيلاً متخصصاً. المُعلَّم منها نشط في التنفيذ الحالي.",
    en: "12 specialized agents. Highlighted ones are active in the current execution.",
  },

  // ─── Artifacts ───
  "artifacts.empty": {
    ar: "لا منتجات بعد. سينشئ MiMo كوداً ووثائق وتقارير أثناء العمل.",
    en: "No artifacts yet. MiMo will create code, docs, and reports as it works.",
  },

  // ─── Memory ───
  "memory.empty": {
    ar: "لا ذكريات بعد. يخزّن MiMo الذكريات عبر 9 أنواع أثناء العمل.",
    en: "No memories yet. MiMo stores memories across 9 types as it works.",
  },

  // ─── Decisions ───
  "decisions.empty": {
    ar: "لا قرارات معمارية بعد. يسجّل MiMo القرارات أثناء المهام التلقائية.",
    en: "No architectural decisions yet. MiMo logs ADRs during autonomous missions.",
  },
  "decisions.by": { ar: "بواسطة", en: "by" },

  // ─── Timeline ───
  "timeline.empty": {
    ar: "لا سجلات تنفيذ بعد. يسجّل MiMo كل خطوة plan, execute, observe, validate.",
    en: "No execution logs yet. MiMo logs every plan, execute, observe, and validate step.",
  },

  // ─── Settings ───
  "settings.title": { ar: "الإعدادات", en: "Settings" },
  "settings.language": { ar: "اللغة", en: "Language" },
  "settings.theme": { ar: "المظهر", en: "Theme" },
  "settings.theme.dark": { ar: "داكن", en: "Dark" },
  "settings.theme.light": { ar: "فاتح", en: "Light" },
  "settings.theme.system": { ar: "النظام", en: "System" },
  "settings.direction": { ar: "الاتجاه", en: "Direction" },
  "settings.direction.rtl": { ar: "يمين لليسار", en: "Right to Left" },
  "settings.direction.ltr": { ar: "يسار لليمين", en: "Left to Right" },

  // ─── Command palette ───
  "command.placeholder": {
    ar: "اكتب أمراً أو ابحث...",
    en: "Type a command or search...",
  },

  // ─── Conversation management ───
  "conv.rename": { ar: "إعادة تسمية", en: "Rename" },
  "conv.delete": { ar: "حذف", en: "Delete" },
  "conv.deleteConfirm": { ar: "هل أنت متأكد من حذف هذه المحادثة؟", en: "Delete this conversation?" },
  "conv.pin": { ar: "تثبيت", en: "Pin" },
  "conv.unpin": { ar: "إلغاء التثبيت", en: "Unpin" },
  "conv.search": { ar: "بحث في المحادثات...", en: "Search conversations..." },
  "conv.titlePlaceholder": { ar: "عنوان المحادثة", en: "Conversation title" },

  // ─── Projects ───
  "panel.projects": { ar: "المشاريع", en: "Projects" },
  "projects.new": { ar: "مشروع جديد", en: "New Project" },
  "projects.name": { ar: "اسم المشروع", en: "Project Name" },
  "projects.description": { ar: "الوصف", en: "Description" },
  "projects.type": { ar: "النوع", en: "Type" },
  "projects.empty": {
    ar: "لا مشاريع بعد. أنشئ مشروعاً لتنظيم محادثاتك.",
    en: "No projects yet. Create a project to organize your conversations.",
  },
  "projects.conversations": { ar: "المحادثات", en: "Conversations" },
  "projects.entities": { ar: "الكيانات", en: "Entities" },

  // ─── New agents ───
  "agent.architect": { ar: "المعماري", en: "Architect" },
  "agent.code_analyst": { ar: "محلل الكود", en: "Code Analyst" },
  "agent.refactoring": { ar: "مهندس إعادة الهيكلة", en: "Refactoring" },
  "agent.database": { ar: "مهندس قاعدة البيانات", en: "Database Engineer" },
  "agent.requirements": { ar: "محلل المتطلبات", en: "Requirements Analyst" },

  // ─── Tools ───
  "panel.tools": { ar: "الأدوات", en: "Tools" },
  "tools.empty": {
    ar: "لا أدوات بعد.",
    en: "No tools available.",
  },

  // ─── Files (P2-2/P2-4/P2-6) ───
  "panel.files": { ar: "الملفات", en: "Files" },
  "files.empty": {
    ar: "لا ملفات. أنشئ مشروعًا وابدأ محادثة لإنشاء الملفات.",
    en: "No files. Create a project and start a conversation to generate files.",
  },
  "files.noProject": {
    ar: "اختر مشروعًا لعرض ملفاته.",
    en: "Select a project to view its files.",
  },
  "files.refresh": { ar: "تحديث", en: "Refresh" },
  "files.save": { ar: "حفظ", en: "Save" },
  "files.cancel": { ar: "إلغاء", en: "Cancel" },
  "files.edit": { ar: "تعديل", en: "Edit" },
  "files.saved": { ar: "تم الحفظ", en: "Saved" },
  "files.diff": { ar: "الفروقات", en: "Diff" },
  "files.history": { ar: "السجل", en: "History" },
  "files.original": { ar: "الأصلي", en: "Original" },
  "files.modified": { ar: "المعدّل", en: "Modified" },

  "panel.knowledge": { ar: "المعرفة", en: "Knowledge" },

  // ─── Skills ───
  "skills.search.placeholder": {
    ar: "ابحث في 69 مهارة...",
    en: "Search 69 skills...",
  },

  // ─── Terminal (P3-6) ───
  "panel.terminal": { ar: "الطرفية", en: "Terminal" },
  "terminal.empty": {
    ar: "لا مخرجات بعد. نفّذ build أو test أو lint.",
    en: "No output yet. Run build, test, or lint.",
  },
  "terminal.build": { ar: "بناء", en: "Build" },
  "terminal.test": { ar: "اختبار", en: "Test" },
  "terminal.lint": { ar: "فحص", en: "Lint" },
  "terminal.typecheck": { ar: "فحص الأنواع", en: "Typecheck" },
  "terminal.running": { ar: "جارٍ التنفيذ...", en: "Running..." },
  "terminal.exit": { ar: "انتهى بكود", en: "Exited with code" },
  "terminal.duration": { ar: "المدة", en: "Duration" },
  "terminal.noProject": { ar: "اختر مشروعًا لعرض الطرفية.", en: "Select a project to use the terminal." },

  // ─── P5-2: Additional i18n (only keys not already defined above) ───
  "cmd.new": { ar: "محادثة جديدة", en: "New Conversation" },
  "cmd.settings": { ar: "فتح الإعدادات", en: "Open Settings" },
  "cmd.search": { ar: "ابحث عن أمر...", en: "Search commands..." },
  "chat.new": { ar: "محادثة جديدة", en: "New Conversation" },
  "chat.send": { ar: "إرسال", en: "Send" },
  "chat.autonomous": { ar: "تلقائي", en: "Autonomous" },
  "common.loading": { ar: "جارٍ التحميل...", en: "Loading..." },
  "common.error": { ar: "خطأ", en: "Error" },
  "common.confirm": { ar: "تأكيد", en: "Confirm" },
  "common.retry": { ar: "إعادة المحاولة", en: "Retry" },

  // ─── Observability ───
  "obs.metrics": { ar: "المقاييس", en: "Metrics" },
  "obs.recent": { ar: "النشاط الأخير", en: "Recent Activity" },
  "obs.successRate": { ar: "معدل النجاح", en: "Success Rate" },
  "obs.avgDuration": { ar: "متوسط الوقت", en: "Avg Duration" },
  "obs.totalExecutions": { ar: "إجمالي التنفيذات", en: "Total Executions" },

  // ─── Settings expansion ───
  "settings.ai": { ar: "الذكاء الاصطناعي", en: "AI" },
  "settings.autonomous": { ar: "التشغيل التلقائي", en: "Autonomous" },
  "settings.agents": { ar: "الوكلاء", en: "Agents" },
  "settings.memory": { ar: "الذاكرة", en: "Memory" },
  "settings.research": { ar: "البحث", en: "Research" },
  "settings.developer": { ar: "المطور", en: "Developer" },
  "settings.interface": { ar: "الواجهة", en: "Interface" },

  // ─── Settings tabs (UIUX-P1-5) ───
  "settings.tab.appearance": { ar: "المظهر", en: "Appearance" },
  "settings.tab.models": { ar: "النماذج", en: "Models" },
  "settings.tab.agents": { ar: "الوكلاء", en: "Agents" },
  "settings.tab.tools": { ar: "الأدوات", en: "Tools" },
  "settings.tab.skills": { ar: "المهارات", en: "Skills" },
  "settings.tab.about": { ar: "حول", en: "About" },

  // ─── Settings > Models ───
  "settings.models.currentModel": { ar: "النموذج الحالي", en: "Current Model" },
  "settings.models.provider": { ar: "المزوّد", en: "Provider" },
  "settings.models.temperature": { ar: "درجة الحرارة", en: "Temperature" },
  "settings.models.maxTokens": { ar: "الحد الأقصى للرموز", en: "Max Tokens" },
  "settings.models.note": {
    ar: "يتم إدارة تكوين النموذج من جانب الخادم",
    en: "Model configuration is managed server-side",
  },

  // ─── Settings > About ───
  "settings.about.systemInfo": { ar: "معلومات النظام", en: "System Information" },
  "settings.about.platform": { ar: "المنصة", en: "Platform" },
  "settings.about.stack": { ar: "التقنيات", en: "Tech Stack" },
  "settings.about.resources": { ar: "موارد", en: "Resources" },
  "settings.about.license": { ar: "الترخيص", en: "License" },
  "settings.about.docs": { ar: "الوثائق", en: "Documentation" },

  // ─── Settings > lists ───
  "settings.skills.showing": { ar: "عرض", en: "Showing" },
  "settings.skills.of": { ar: "من", en: "of" },
};

export function getDirection(locale: Locale): Direction {
  return locale === "ar" ? "rtl" : "ltr";
}

export function t(key: string, locale: Locale): string {
  const entry = translations[key];
  if (!entry) return key;
  return entry[locale] ?? entry.en ?? key;
}

export function getTranslations() {
  return translations;
}

export function listLocales(): Locale[] {
  return ["en", "ar"];
}
