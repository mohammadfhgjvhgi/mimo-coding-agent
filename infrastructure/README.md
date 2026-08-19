# 🏗️ MiMo X — Infrastructure (Dual-Worker + Sandbox)

هذا المجلد يحتوي على سكريبتات البنية التحتية لتشغيل MiMo X على عتادك الحقيقي
(Intel i7-3770 + 12GB RAM + GTX 750 Ti 4GB VRAM).

## 📁 الملفات

| الملف | الوصف |
|---|---|
| `start-mimo-servers.sh` | يُشغّل عاملَي llama.cpp (GPU على 8001، CPU على 8002) |
| `docker-compose.yml` | حاوية معزولة (Sandbox) لتنفيذ أوامر الوكيل بأمان |

## 🚀 التشغيل السريع

### 1) تثبيت llama.cpp

```bash
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
# للأجهزة مع كرت NVIDIA:
make GGML_CUDA=1
# للمعالج فقط:
make
```

### 2) تنزيل النماذج

حمّل نماذج بتنسيق GGUF (مضغوطة Q4_K_M لتوفير الذاكرة):

```bash
mkdir -p models
# GPU Worker — لكتابة الكود (7B، ~4.5GB)
wget -O models/qwen2.5-coder-7b-instruct-q4_k_m.gguf \
  https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf

# CPU Worker — للتخطيط + الأدوات (4B، ~2.5GB)
wget -O models/qwen3-4b-instruct-q4_k_m.gguf \
  https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/qwen3-4b-instruct-q4_k_m.gguf
```

### 3) تشغيل العاملين

```bash
cd infrastructure
chmod +x start-mimo-servers.sh
./start-mimo-servers.sh
```

سينتج:
- **GPU Worker** على `http://localhost:8001` (16 طبقة على كرت الشاشة، flash attention)
- **CPU Worker** على `http://localhost:8002` (6 خيوط على المعالج، بدون GPU)

### 4) تشغيل Sandbox (اختياري)

```bash
cd infrastructure
docker compose up -d
```

هذا يُنشئ حاوية معزولة لتنفيذ أوامر الوكيل فيها بأمان.

### 5) ربط MiMo X

افتح واجهة MiMo X → الإعدادات → اختر مزوّد **"Dual-Worker"** وأدخل:
- CPU Worker URL: `http://localhost:8002` (أو `http://host.docker.internal:8002` داخل Sandbox)
- GPU Worker URL: `http://localhost:8001`
- النماذج: `qwen3:4b` و `qwen2.5-coder:7b`

## 🧠 كيف يعمل الموزّع (MiMo Router)

عند تفعيل وضع `auto`، يصنّف النظام كل خطوة من حلقة الوكيل:

| نوع الخطوة | العامل المستخدم | السبب |
|---|---|---|
| التخطيط الأولي، الأسئلة العامة | 🧠 CPU Worker | نموذج صغير سريع يكفي |
| بعد `list_files` / `save_memory` | 🧠 CPU Worker | خطوة تنظيمية |
| بعد `read_file` / `run_terminal_command` | ⚡ GPU Worker | الخطوة التالية غالباً كتابة كود |
| كتابة/تعديل ملف، إصلاح خطأ | ⚡ GPU Worker | نموذج coder أقوى |

إذا كان أحد العاملين غير متاح، يتحوّل تلقائياً إلى Z.ai السحابية كـ fallback.

## ⚙️ ضبط العتاد

عدّل المتغيرات في أعلى `start-mimo-servers.sh`:

| المتغير | الافتراضي | الوصف |
|---|---|---|
| `GPU_NGL` | 16 | عدد طبقات GPU (زيد/أنقص حسب VRAM) |
| `CPU_THREADS` | 6 | خيوط المعالج (i7-3770 له 8) |
| `GPU_PORT` | 8001 | منفذ عامل GPU |
| `CPU_PORT` | 8002 | منفذ عامل CPU |

## 📊 استهلاك الموارد المتوقع

| المكوّن | RAM | VRAM | CPU |
|---|---|---|---|
| GPU Worker (qwen2.5-coder 7B Q4) | ~1.5GB | ~3.8GB | منخفض |
| CPU Worker (qwen3 4B Q4) | ~2.8GB | 0 | ~6 خيوط |
| Next.js + Prisma | ~0.5GB | 0 | منخفض |
| **المجموع** | **~4.8GB** | **~3.8GB** | ضمن 12GB ✅ |

باقي الذاكرة (~7GB) متاح لنظام التشغيل والمتصفح وأدوات التطوير.
