# 🚀 MiMo X — دليل النشر على ويندوز (Deployment Guide)

دليل كامل لتثبيت وتشغيل MiMo X على جهازك (Windows 10 + i7-3770 + GTX 750 Ti).

---

## 1. المتطلبات قبل التثبيت (Prerequisites)

### 1.1 Node.js 20+
حمّل من [nodejs.org](https://nodejs.org) (نسخة LTS). تحقق:
```bash
node --version  # يجب أن تكون v20 أو أحدث
```

### 1.2 Git
حمّل من [git-scm.com](https://git-scm.com). تحقق:
```bash
git --version
```

### 1.3 Ollama (لتشغيل النماذج المحلية)
حمّل من [ollama.com](https://ollama.com). هذا هو محرك تشغيل النماذج الأساسي.

### 1.4 Visual C++ Build Tools (لاختياري — لبناء Electron)
حمّل من [visualstudio.microsoft.com](https://visualstudio.microsoft.com/visual-cpp-build-tools/) — مطلوب فقط لبناء ملف EXE.

### 1.5 CUDA Drivers (اختياري — لـ GPU)
إذا كنت تريد استخدام كرت الشاشة (GTX 750 Ti):
- ثبّت [NVIDIA Studio Driver](https://www.nvidia.com/Download/index.aspx) (آخر إصدار يدعم Maxwell)
- CUDA Toolkit 11.8+ (لاختياري — يُستخدم مع llama.cpp)

---

## 2. تنزيل النماذج المحلية

بعد تثبيت Ollama، اسحب النماذج الموصى بها لعتادك:

### النموذج الرئيسي (CPU — للتخطيط والبرمجة)
```bash
ollama pull qwen2.5-coder:7b
```
الحجم: ~4.7GB — مثالي لـ i7-3770 + 16GB RAM. يتفوق على GPT-4 في HumanEval.

### النموذج المساعد (GPU — للتصنيف والتوجيه) — اختياري
```bash
ollama pull qwen3:1.7b
```
الحجم: ~1.4GB VRAM — يعمل بكامله على GTX 750 Ti.

### نموذج بديل أخف (إذا كان 7B بطيئاً)
```bash
ollama pull qwen3:4b
```

---

## 3. تثبيت المشروع

### 3.1 من المصدر

```bash
# استنسخ المشروع
git clone <repo-url> mimo-x
cd mimo-x

# ثبّت الحزم (استخدم npm أو bun)
npm install

# جهّز قاعدة البيانات
npx prisma db push

# شغّل في وضع التطوير (ويب)
npm run dev
# افتح http://localhost:3000
```

### 3.2 كتطبيق سطح مكتب (Electron)

```bash
# شغّل Electron في وضع التطوير
npm run electron:dev

# أو ابنِ ملف EXE للتوزيع
npm run build:win
```

سينتج: `dist/MiMo-X-Setup-1.0.0.exe` — ثبّته كأي برنامج ويندوز.

---

## 4. إعداد الـ Dual-Worker (متقدم — اختياري)

للحصول على أقصى كفاءة، يمكنك تشغيل عاملين منفصلين (llama.cpp بدل Ollama):

### 4.1 تثبيت llama.cpp
```bash
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
# للأجهزة مع كرت NVIDIA:
cmake -B build -DGGML_CUDA=ON
cmake --build build --config Release
```

### 4.2 تشغيل العاملين
```bash
# ويندوز
infrastructure\start-mimo-servers.bat

# لينكس/ماك
./infrastructure/start-mimo-servers.sh
```

سينتج:
- **GPU Worker** على `http://localhost:8001` (16 طبقة على كرت الشاشة)
- **CPU Worker** على `http://localhost:8002` (6 خيوط على المعالج)

### 4.3 ربط MiMo X بالعاملين
في الإعدادات → مزوّد **"Dual-Worker"**:
- CPU Worker: `http://localhost:8002` + `qwen3:4b`
- GPU Worker: `http://localhost:8001` + `qwen2.5-coder:7b`
- وضع الموزّع: `تلقائي`

---

## 5. التشغيل لأول مرة

1. شغّل التطبيق (EXE أو `npm run electron:dev`)
2. سترى شاشة بداية (Splash) تُظهر تهيئة العتاد
3. عند فتح الواجهة، اذهب للإعدادات وتحقق من المزوّد:
   - **افتراضي:** Ollama على `localhost:11434` بنموذج `qwen2.5-coder:7b`
   - يمكنك التبديل لـ Dual-Worker أو Z.ai (سحابي مؤقت)
4. ابدأ محادثة جديدة في تبويب "محادثات"
5. أو أنشئ هدفاً مستقلاً في تبويب "الأهداف"

---

## 6. استكشاف الأخطاء (Troubleshooting)

### "تعذر الوصول إلى Ollama"
```bash
# تحقق من تشغيل Ollama
ollama serve

# أو أعد تشغيله
ollama serve &
```

### "النموذج بطيء جداً"
- جرّب نموذجاً أصغر: `ollama pull qwen3:4b` (أخفّ وأسرع)
- فعّل وضع "CPU only" في الإعدادات (تجاوز GPU)
- أغلق التطبيقات الأخرى لتحرير RAM

### "نفاد الذاكرة (OOM)"
- كرت 750 Ti 4GB: استخدم `qwen3:1.7b` فقط على GPU (لا تتجاوز 1.5GB VRAM)
- RAM: لا تشغّل أكثر من نموذج 7B في نفس الوقت
- فعّل Context OS (مفعّل افتراضياً) — يضغط السياق تلقائياً

### "Electron لا يفتح"
- تأكد أن Node.js مثبّت وفي PATH
- شغّل `npm run electron:dev` للتحقق من الأخطاء
- على ويندوز، قد تحتاج Visual C++ Redistributable

### "لا أرى الأيقونة على سطح المكتب"
- بعد `npm run build:win`، ستجد ملف التثبيت في `dist/`
- شغّل `MiMo-X-Setup-1.0.0.exe` واتبع المعالج

---

## 7. الميزات المتاحة

| التبويب | الوصف |
|---|---|
| **محادثات** | شات عادي مع الوكيل (ReAct + أدوات) |
| **الملفات** | مستكشف ملفات المشروع + إبراز الملفات المعدّلة |
| **الرموز** | فهرس الرموز (AST) — بحث عن دوال/كلاسات + مراجعها |
| **الذاكرة** | ذاكرة المشروع الدائمة (تُحقن تلقائياً في كل محادثة) |
| **الأهداف** | أهداف مستقلة — يخطط، ينفذ، يتحقق ذاتياً، يستعيد بعد الانقطاع |

---

## 8. استهلاك الموارد المتوقع

| المكوّن | RAM | VRAM | CPU |
|---|---|---|---|
| Ollama + qwen2.5-coder 7B | ~5GB | 0 (CPU) | عالي (~8 خيوط) |
| Ollama + qwen3 1.7B (GPU) | ~1GB | ~1.5GB | منخفض |
| Next.js + Prisma + Electron | ~1GB | 0 | منخفض |
| **المجموع (Dual-Worker)** | **~7GB** | **~1.5GB** | ضمن 16GB ✅ |

### نصائح للأداء على عتاد قديم:
1. استخدم **qwen3:4b** بدل 7B إذا كان RAM محدوداً
2. فعّل **Context OS** (مفعّل افتراضياً) — يضغط السياق تلقائياً
3. استخدم **Goal Mode** للمهام الطويلة بدل الشات المباشر — أكثر كفاءة
4. احفظ **نقاط استرجاع** (Git Checkpoints) بانتظام

---

## 9. الحصول على المساعدة

- شغّل `npm run lint` للتحقق من صحة الكود
- راجع `worklog.md` لتاريخ التطوير الكامل
- راجع `infrastructure/README.md` لتفاصيل البنية التحتية

---

**MiMo X v1.0** — بيئة تشغيل ذكية محلية لهندسة البرمجيات.
مبني ليعمل على عتادك القديم بكفاءة، محترماً قيود الذاكرة والقدرة الحسابية.
