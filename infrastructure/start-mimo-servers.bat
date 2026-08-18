@echo off
REM ============================================================
REM MiMo X - Dual-Worker Server Launcher (Windows)
REM ============================================================
REM يُشغّل عاملَي llama.cpp على ويندوز:
REM   GPU Worker (منفذ 8001): qwen2.5-coder-7b لكتابة الكود
REM   CPU Worker  (منفذ 8002): qwen3-4b للتخطيط والأدوات
REM
REM العتاد المستهدف: i7-3770 + 12GB RAM + GTX 750 Ti (4GB VRAM)
REM ============================================================

setlocal enabledelayedexpansion

REM ---- الإعدادات (عدّلها حسب جهازك) ----
set GPU_MODEL=%GPU_MODEL%
if "%GPU_MODEL%"=="" set GPU_MODEL=models\qwen2.5-coder-7b-instruct-q4_k_m.gguf
set CPU_MODEL=%CPU_MODEL%
if "%CPU_MODEL%"=="" set CPU_MODEL=models\qwen3-4b-instruct-q4_k_m.gguf
set LLAMA_BIN=%LLAMA_BIN%
if "%LLAMA_BIN%"=="" set LLAMA_BIN=llama.cpp\build\bin\llama-server.exe

set GPU_PORT=8001
set CPU_PORT=8002
set GPU_NGL=16
set CPU_THREADS=6

if not exist "%LLAMA_BIN%" (
    echo [mimo] llama-server غير موجود في: %LLAMA_BIN%
    echo [mimo] نزّله من https://github.com/ggerganov/llama.cpp وابنه
    pause
    exit /b 1
)

if not exist "%GPU_MODEL%" echo [mimo] تحذير: نموذج GPU غير موجود: %GPU_MODEL%
if not exist "%CPU_MODEL%" echo [mimo] تحذير: نموذج CPU غير موجود: %CPU_MODEL%

if not exist logs mkdir logs

echo [mimo] تشغيل GPU Worker على المنفذ %GPU_PORT%...
start /b "" "%LLAMA_BIN%" --model "%GPU_MODEL%" --port %GPU_PORT% --n-gpu-layers %GPU_NGL% --flash-attn on --ctx-size 8192 --temp 0.7 --host 0.0.0.0 > logs\gpu-worker.log 2>&1

echo [mimo] تشغيل CPU Worker على المنفذ %CPU_PORT%...
start /b "" "%LLAMA_BIN%" --model "%CPU_MODEL%" --port %CPU_PORT% --n-gpu-layers 0 --threads %CPU_THREADS% --ctx-size 6144 --temp 0.6 --host 0.0.0.0 > logs\cpu-worker.log 2>&1

echo [mimo] جارٍ فحص جاهزية العاملين...
timeout /t 10 /nobreak >nul

echo [mimo] GPU Worker: http://localhost:%GPU_PORT%
echo [mimo] CPU Worker: http://localhost:%CPU_PORT%
echo [mimo] MiMo Router سيوجّه الطلبات تلقائياً بينهما.
echo [mimo] لإيقاف العاملين: شغّل taskkill /f /im llama-server.exe

REM إبقاء النافذة مفتوحة
pause
