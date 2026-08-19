#!/usr/bin/env bash
# ============================================================
# MiMo X — Dual-Worker Server Launcher
# ============================================================
# يُشغّل عاملين محليين عبر llama.cpp:
#   1) GPU Worker (منفذ 8001): لكتابة الكود + التعديل + الإصلاح
#      نموذج: qwen2.5-coder-7b — كل الطبقات على كرت الشاشة
#   2) CPU Worker  (منفذ 8002): للتخطيط + استدعاء الأدوات + الأسئلة العامة
#      نموذج: qwen3-4b — بدون طبقات GPU (يعمل على المعالج)
#
# العتاد المستهدف: Intel i7-3770 (4c/8t) + 12GB RAM + GTX 750 Ti (4GB VRAM)
# ============================================================
set -euo pipefail

# ---- الإعدادات (عدّلها حسب جهازك) -----------------------------------------
GPU_MODEL="${GPU_MODEL:-./models/qwen2.5-coder-7b-instruct-q4_k_m.gguf}"
CPU_MODEL="${CPU_MODEL:-./models/qwen3-4b-instruct-q4_k_m.gguf}"
LLAMA_BIN="${LLAMA_BIN:-./llama.cpp/build/bin/llama-server}"

GPU_PORT="${GPU_PORT:-8001}"
CPU_PORT="${CPU_PORT:-8002}"

# GPU: GTX 750 Ti (4GB VRAM, Maxwell, Compute 5.0, NO AVX2)
# ضع 16-20 طبقة على GPU لتستغل الـ 4GB VRAM بالكامل
GPU_NGL="${GPU_NGL:-16}"
# CPU: i7-3770 (4 cores / 8 threads)
CPU_THREADS="${CPU_THREADS:-6}"

# ---- مساعدات ---------------------------------------------------------------
log()   { printf "\033[36m[mimo]\033[0m %s\n" "$1"; }
ok()    { printf "\033[32m[mimo]\033[0m %s\n" "$1"; }
warn()  { printf "\033[33m[mimo]\033[0m %s\n" "$1"; }
die()   { printf "\033[31m[mimo]\033[0m %s\n" "$1" >&2; exit 1; }

# ---- التحقق ----------------------------------------------------------------
command -v "$LLAMA_BIN" >/dev/null 2>&1 || die "llama-server غير موجود في: $LLAMA_BIN
نزّله من https://github.com/ggerganov/llama.cpp وابنه، أو استخدم:
  git clone https://github.com/ggerganov/llama.cpp && cd llama.cpp && make GGML_CUDA=1"

[ -f "$GPU_MODEL" ] || warn "نموذج GPU غير موجود: $GPU_MODEL (حمّله من HuggingFace)"
[ -f "$CPU_MODEL" ] || warn "نموذج CPU غير موجود: $CPU_MODEL (حمّله من HuggingFace)"

# ---- تشغيل GPU Worker -----------------------------------------------------
log "تشغيل GPU Worker على المنفذ $GPU_PORT (نموذج: $(basename "$GPU_MODEL"))..."
"$LLAMA_BIN" \
  --model "$GPU_MODEL" \
  --port "$GPU_PORT" \
  --n-gpu-layers "$GPU_NGL" \
  --flash-attn on \
  --ctx-size 8192 \
  --temp 0.7 \
  --top-p 0.9 \
  --host 0.0.0.0 \
  > logs/gpu-worker.log 2>&1 &
GPU_PID=$!
ok "GPU Worker PID=$GPU_PID (منفذ $GPU_PORT، $GPU_NGL طبقات على GPU)"

# ---- تشغيل CPU Worker -----------------------------------------------------
log "تشغيل CPU Worker على المنفذ $CPU_PORT (نموذج: $(basename "$CPU_MODEL"))..."
"$LLAMA_BIN" \
  --model "$CPU_MODEL" \
  --port "$CPU_PORT" \
  --n-gpu-layers 0 \
  --threads "$CPU_THREADS" \
  --ctx-size 6144 \
  --temp 0.6 \
  --top-p 0.9 \
  --host 0.0.0.0 \
  > logs/cpu-worker.log 2>&1 &
CPU_PID=$!
ok "CPU Worker PID=$CPU_PID (منفذ $CPU_PORT، $CPU_THREADS خيوط CPU)"

# ---- الانتظار حتى الجاهزية ------------------------------------------------
log "جارٍ فحص جاهزية العاملين..."
for i in $(seq 1 30); do
  GPU_OK=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$GPU_PORT/health" 2>/dev/null || echo "000")
  CPU_OK=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$CPU_PORT/health" 2>/dev/null || echo "000")
  [ "$GPU_OK" = "200" ] && [ "$CPU_OK" = "200" ] && break
  sleep 2
done

if [ "$GPU_OK" = "200" ] && [ "$CPU_OK" = "200" ]; then
  ok "✅ كلا العاملين جاهزان!"
  ok "   GPU Worker: http://localhost:$GPU_PORT (رمز coder)"
  ok "   CPU Worker: http://localhost:$CPU_PORT (تخطيط + أدوات)"
  ok ""
  ok "الآن افتح MiMo X وانتقل للإعدادات، اختر مزوّد 'Dual-Worker' وحده العناوين."
else
  warn "⚠️ أحد العاملين غير جاهز بعد (GPU=$GPU_OK, CPU=$CPU_OK)"
  warn "   راجع logs/gpu-worker.log و logs/cpu-worker.log"
fi

ok ""
ok "لإيقاف العاملين: kill $GPU_PID $CPU_PID  (أو: pkill -f llama-server)"
ok "MiMo Router سيوجّه الطلبات تلقائياً بينهما حسب نوع المهمة."

mkdir -p logs
wait
