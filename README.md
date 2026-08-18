# 🚀 MiMo X — Local AI Software Engineering OS

مساعد ذكاء اصطناعي محلي لهندسة البرمجيات. يعمل على عتادك القديم (i7-3770 + GTX 750 Ti) بنماذج محلية أو سحابية.

## ✨ المميزات

- 🤖 **وكيل مستقل (Goal Mode)**: أعطه هدفاً + معايير قبول، وهو يخطط، ينفذ، يتحقق ذاتياً، ويستعيد حالته بعد الانقطاع
- 🧠 **ذاكرة دائمة (Memory OS)**: يحفظ القرارات والحقائق ويُحقنها في كل محادثة
- 📐 **ذكاء الكود (Code Intelligence)**: فهرس رموز + بحث + تحليل مراجع (AST engine)
- ⚡ **عامل مزدوج (Dual-Worker)**: عامل معالج للتخطيط + عامل GPU للكود
- 🌐 **نظام بيئي خارجي**: متصفح Playwright + GitHub + MCP
- 🔧 **17 أداة**: read/write/edit/terminal/list_files/git_checkpoint/save_memory/recall_memory/set_goal/find_symbol/get_references/structural_search/browser_navigate/browser_screenshot/github_get_issues/github_get_repo_info/call_mcp_tool
- 🌍 **واجهة عربية RTL كاملة**

## 📦 التثبيت على ويندوز 10

### المتطلبات الأساسية

1. **Node.js 20+** — [تحميل](https://nodejs.org)
2. **Git** — [تحميل](https://git-scm.com)
3. **Visual C++ Build Tools** (لتجميع الإضافات الأصلية) — [تحميل](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

### الطريقة 1: تطبيق سطح المكتب (موصى)

1. حمّل ملف `MiMo-X-Setup-1.0.0.exe` من صفحة الإصدارات
2. شغّله واتبع معالج التثبيت
3. ستجد أيقونة **MiMo X** على سطح المكتب وقائمة ابدأ
4. عند الإقلاع الأول، سيُحاول تشغيل عاملَي llama.cpp تلقائياً

### الطريقة 2: من المصدر

```bash
# 1. استنسخ المستودع
git clone <repo-url> mimo-x
cd mimo-x

# 2. ثبّت الحزم
npm install

# 3. جهّز قاعدة البيانات
npx prisma db push

# 4. شغّل في وضع التطوير
npm run dev
# افتح http://localhost:3000

# أو شغّل كتطبيق سطح مكتب
npm run electron:dev
```

### بناء ملف تنفيذي (EXE)

```bash
npm run build:win
```
سينتج ملف `dist/MiMo-X-Setup-1.0.0.exe` جاهز للتوزيع.

## 🖥️ تشغيل النماذج المحلية (Dual-Worker)

لتشغيل النماذج على عتادك بدل Z.ai السحابية:

### 1. تثبيت llama.cpp

```bash
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
# للأجهزة مع كرت NVIDIA:
cmake -B build -DGGML_CUDA=ON
cmake --build build --config Release
```

### 2. تنزيل النماذج (تنسيق GGUF)

| العامل | النموذج | الحجم | الاستخدام |
|---|---|---|---|
| GPU | qwen2.5-coder-7b-instruct-q4_k_m | ~4.5GB | كتابة الكود |
| CPU | qwen3-4b-instruct-q4_k_m | ~2.5GB | التخطيط + الأدوات |

حمّلها من [HuggingFace](https://huggingface.co/Qwen) وضعها في مجلد `models/`.

### 3. تشغيل العاملين

```bash
# ويندوز
infrastructure\start-mimo-servers.bat

# لينكس/ماك
./infrastructure/start-mimo-servers.sh
```

سينتج:
- **GPU Worker** على `http://localhost:8001` (16 طبقة على كرت الشاشة)
- **CPU Worker** على `http://localhost:8002` (6 خيوط على المعالج)

### 4. ربط MiMo X

في الإعدادات → اختر مزوّد **"Dual-Worker"** وأدخل:
- CPU Worker: `http://localhost:8002` + `qwen3:4b`
- GPU Worker: `http://localhost:8001` + `qwen2.5-coder:7b`
- وضع الموزّع: `تلقائي`

## ⚙️ الإعدادات

| الإعداد | الوصف |
|---|---|
| **المزود** | Z.ai سحابي / Ollama محلي / Dual-Worker (CPU+GPU) |
| **GitHub Token** | اختياري — لرفع حدود API (بدونه يعمل بحدود عامة) |
| **خوادم MCP** | أضف خوادم MCP خارجية (JSON-RPC over HTTP) |
| **التفكير** | تفعيل Chain of Thought للنماذج السحابية |

## 🧪 اختبار التحمل (E2E)

جرّب مهمة شاملة تجمع كل الأدوات:

```
في تبويب "الأهداف"، أنشئ هدفاً:
"ابحث في GitHub عن مستودع calculator مفتوح المصدر، استخدم المتصفح 
لقراءة README، ثم أنشئ مشروعاً كاملاً (HTML+CSS+JS)، فهرس الرموز، 
واحفظ نقطة استرجاع (Git Checkpoint)"
```

الوكيل سيستخدم: `github_get_repo_info` ← `browser_navigate` ← `write_file` ← `find_symbol` ← `git_checkpoint` — تلقائياً.

## 📊 استهلاك الموارد

| المكوّن | RAM | VRAM | CPU |
|---|---|---|---|
| GPU Worker (qwen2.5-coder 7B) | ~1.5GB | ~3.8GB | منخفض |
| CPU Worker (qwen3 4B) | ~2.8GB | 0 | ~6 خيوط |
| Next.js + Prisma + Electron | ~1GB | 0 | منخفض |
| **المجموع** | **~5.3GB** | **~3.8GB** | ضمن 12GB ✅ |

## 🛠️ سكربتات البناء

| الأمر | الوصف |
|---|---|
| `npm run dev` | تشغيل في وضع التطوير (ويب) |
| `npm run electron:dev` | تشغيل كتطبيق سطح مكتب (وضع تطوير) |
| `npm run build:win` | بناء EXE لويندوز |
| `npm run build:linux` | بناء AppImage للينكس |
| `npm run build:mac` | بناء DMG للماك |
| `npm run lint` | فحص جودة الكود |

## 📁 بنية المشروع

```
mimo-x/
├── electron/           # تطبيق سطح المكتب (Electron)
│   ├── main.cjs        # العملية الرئيسية + Splash + Auto-Start
│   ├── preload.cjs     # جسر آمن
│   ├── splash.html     # شاشة البداية
│   └── icon.png        # أيقونة التطبيق
├── infrastructure/     # سكربتات البنية التحتية
│   ├── start-mimo-servers.sh   # تشغيل عاملَي llama.cpp (لينكس/ماك)
│   ├── start-mimo-servers.bat  # تشغيل عاملَي llama.cpp (ويندوز)
│   ├── docker-compose.yml      # حاوية معزولة (Sandbox)
│   └── README.md               # دليل البنية التحتية
├── src/
│   ├── app/            # واجهات Next.js (API routes + pages)
│   ├── components/     # مكونات الواجهة (شات + مستكشف + ذاكرة + أهداف + رموز)
│   ├── lib/
│   │   ├── agent/      # حلقة الوكيل (ReAct + Context OS + Router)
│   │   ├── tools/      # بوابة الأدوات (17 أداة)
│   │   ├── code-intel/ # ذكاء الكود (AST + Symbol Index)
│   │   ├── ecosystem/  # النظام البيئي (MCP + Browser + GitHub)
│   │   └── llm-provider.ts  # مزود LLM (Z.ai + Ollama + Dual-Worker)
│   ├── store/          # إدارة الحالة (Zustand)
│   └── types/          # أنواع TypeScript
├── prisma/             # قاعدة البيانات (SQLite)
└── package.json
```

## 📄 الترخيص

MIT — استخدمه حرّاً للأغراض التجارية والشخصية.

---

**MiMo X** — بيئة تشغيل ذكية محلية لهندسة البرمجيات وإدارة العمل. © 2026
