// Voice OS — speech-to-text, text-to-speech, voice conversations, voice commands.
// 7 operations, deterministic, bilingual (Arabic + English), persisted to SQLite.
//
// Design:
//   • VoiceSession (Prisma) — active session with TTS/ASR settings + VAD config
//   • VoiceCommand (Prisma) — registered voice triggers (regex patterns → actions)
//   • Backed by z-ai-web-dev-sdk audio.tts + audio.asr skills
//   • Audio files saved to upload/voice/ (gitignored)
//   • Voice activity detection (VAD) settings for hands-free mode
//
// 7 operations:
//   1. voiceStt                — speech-to-text: audio base64 → text
//   2. voiceInput              — record voice input (returns session + audio path)
//   3. voiceTts                — text-to-speech: text → audio buffer
//   4. voiceConversation        — full turn: STT user audio → text → TTS response
//   5. voicePushToTalk          — toggle push-to-talk mode (start/stop on demand)
//   6. voiceHandsFree           — continuous mode with VAD (auto-record on voice)
//   7. voiceCommands            — register + match + execute voice commands
//
// Plus: voiceSessionStart/End/List, voiceCommandRegister/List/Match/Execute, snapshot.

import { db } from "@/lib/db"
import { mkdir, writeFile, readFile, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VoiceMode = "push_to_talk" | "hands_free" | "voice_command"

export type VoiceSessionStatus = "active" | "paused" | "ended"

export type VoiceCommandAction =
  | "new_chat"
  | "open_settings"
  | "switch_mode"
  | "switch_tab"
  | "stop_speaking"
  | "clear_input"
  | "send_message"
  | "read_aloud"
  | "custom"

export interface VoiceSessionRecord {
  id: string
  status: VoiceSessionStatus
  conversationId: string | null
  ttsVoice: string
  ttsSpeed: number
  ttsFormat: string
  asrLanguage: string
  mode: VoiceMode
  sttCount: number
  ttsCount: number
  totalAudioMs: number
  vadEnabled: boolean
  silenceThresholdMs: number
  startedAt: Date
  endedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface VoiceCommandRecord {
  id: string
  pattern: string
  displayName: string
  description: string | null
  action: VoiceCommandAction
  params: Record<string, unknown>
  active: boolean
  confirmRequired: boolean
  useCount: number
  lastUsedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface SttResult {
  text: string
  durationMs: number
  language: string
  confidence?: number
  audioPath: string | null
}

export interface TtsResult {
  audioPath: string
  sizeBytes: number
  durationMs: number
  format: string
  voice: string
}

export interface VoiceConversationTurn {
  userText: string
  responseText: string
  responseAudioPath: string
  durationMs: number
}

export interface VoiceCommandMatch {
  command: VoiceCommandRecord
  matchedText: string
  captures: string[]
}

export type VoiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string }

// ---------------------------------------------------------------------------
// Row → record mappers
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string
  status: string
  conversationId: string | null
  ttsVoice: string
  ttsSpeed: number
  ttsFormat: string
  asrLanguage: string
  mode: string
  sttCount: number
  ttsCount: number
  totalAudioMs: number
  vadEnabled: boolean
  silenceThresholdMs: number
  startedAt: Date
  endedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

function sessionRowToRecord(row: SessionRow): VoiceSessionRecord {
  return {
    id: row.id,
    status: row.status as VoiceSessionStatus,
    conversationId: row.conversationId,
    ttsVoice: row.ttsVoice,
    ttsSpeed: row.ttsSpeed,
    ttsFormat: row.ttsFormat,
    asrLanguage: row.asrLanguage,
    mode: row.mode as VoiceMode,
    sttCount: row.sttCount,
    ttsCount: row.ttsCount,
    totalAudioMs: row.totalAudioMs,
    vadEnabled: row.vadEnabled,
    silenceThresholdMs: row.silenceThresholdMs,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

interface CommandRow {
  id: string
  pattern: string
  displayName: string
  description: string | null
  action: string
  params: string
  active: boolean
  confirmRequired: boolean
  useCount: number
  lastUsedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

function commandRowToRecord(row: CommandRow): VoiceCommandRecord {
  return {
    id: row.id,
    pattern: row.pattern,
    displayName: row.displayName,
    description: row.description,
    action: row.action as VoiceCommandAction,
    params: safeParse(row.params, {}),
    active: row.active,
    confirmRequired: row.confirmRequired,
    useCount: row.useCount,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

// ---------------------------------------------------------------------------
// Audio file storage helper
// ---------------------------------------------------------------------------

async function saveAudioFile(buffer: Buffer, ext: string, prefix: string): Promise<string> {
  const dir = path.join(WORKSPACE_ROOT, "upload", "voice")
  await mkdir(dir, { recursive: true })
  const filename = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
  const filepath = path.join(dir, filename)
  await writeFile(filepath, buffer)
  return filepath
}

// ---------------------------------------------------------------------------
// ZAI SDK lazy loader (singleton)
// ---------------------------------------------------------------------------

let zaiInstance: { audio: { tts: { create: (b: unknown) => Promise<unknown> }; asr: { create: (b: unknown) => Promise<unknown> } } } | null = null

async function getZai(): Promise<typeof zaiInstance> {
  if (zaiInstance) return zaiInstance
  try {
    const ZAIModule = await import("z-ai-web-dev-sdk").catch(() => null)
    if (!ZAIModule) return null
    const ZAI = ZAIModule.default
    zaiInstance = await ZAI.create() as unknown as typeof zaiInstance
    return zaiInstance
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 1. Voice STT — speech-to-text: audio base64 → text
// ---------------------------------------------------------------------------

export interface SttInput {
  /** Audio as base64 string (no data: prefix). Required if audioPath not provided. */
  audioBase64?: string
  /** Optional audio file path (alternative to audioBase64). */
  audioPath?: string
  /** Language hint for ASR. Default "ar". */
  language?: string
  /** Optional session id (for stats tracking). */
  sessionId?: string
}

export async function voiceStt(input: SttInput): Promise<VoiceResult<SttResult>> {
  const start = Date.now()
  try {
    let audioBase64 = input.audioBase64
    let audioPath: string | null = input.audioPath ?? null

    // If audioPath provided, read from disk.
    if (input.audioPath) {
      const abs = path.isAbsolute(input.audioPath)
        ? input.audioPath
        : path.resolve(WORKSPACE_ROOT, input.audioPath)
      if (!existsSync(abs)) {
        return { ok: false, error: "audio_not_found", message: `❌ ملف الصوت غير موجود / audio file not found: ${input.audioPath}` }
      }
      const buffer = await readFile(abs)
      audioBase64 = buffer.toString("base64")
      audioPath = abs
    }

    if (!audioBase64) {
      return { ok: false, error: "no_audio", message: "❌ لا صوت مُدخل / no audio input" }
    }

    const zai = await getZai()
    if (!zai) {
      return { ok: false, error: "no_sdk", message: "❌ z-ai-web-dev-sdk غير متاح / SDK not available" }
    }

    const result = await zai.audio.asr.create({ file_base64: audioBase64 }) as { text?: string }
    const text = result?.text ?? ""

    // Update session stats.
    if (input.sessionId) {
      await db.voiceSession.update({
        where: { id: input.sessionId },
        data: {
          sttCount: { increment: 1 },
          totalAudioMs: { increment: Date.now() - start },
        },
      }).catch(() => {})
    }

    return {
      ok: true,
      data: {
        text,
        durationMs: Date.now() - start,
        language: input.language ?? "ar",
        audioPath,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "stt_failed",
      message: `❌ فشل التحويل للنص / STT failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Voice Input — record voice input (returns session + audio path)
//    This is a UI-side operation (browser captures mic). Server-side we just
//    persist the recording + run STT. The "record" part happens client-side.
// ---------------------------------------------------------------------------

export interface VoiceInputInput {
  /** Audio buffer (from client-side MediaRecorder). */
  audioBuffer: Buffer
  /** Format: "webm" | "wav" | "mp3" | "ogg". */
  format: string
  /** Session id (creates one if not provided). */
  sessionId?: string
  /** Whether to transcribe immediately. Default true. */
  transcribe?: boolean
  /** Optional conversation id to link. */
  conversationId?: string
}

export interface VoiceInputResult {
  sessionId: string
  audioPath: string
  audioSizeBytes: number
  transcription: string | null
  transcriptionMs: number | null
}

export async function voiceInput(input: VoiceInputInput): Promise<VoiceResult<VoiceInputResult>> {
  try {
    // Create a session if not provided.
    let sessionId = input.sessionId
    if (!sessionId) {
      const session = await voiceSessionStart({
        conversationId: input.conversationId,
        mode: "push_to_talk",
      })
      if (!session.ok) return session as unknown as VoiceResult<VoiceInputResult>
      sessionId = session.data.id
    }

    // Save the audio file.
    const audioPath = await saveAudioFile(input.audioBuffer, input.format, "input")
    const st = await stat(audioPath)

    let transcription: string | null = null
    let transcriptionMs: number | null = null

    if (input.transcribe !== false) {
      const sttRes = await voiceStt({
        audioPath,
        sessionId,
      })
      if (sttRes.ok) {
        transcription = sttRes.data.text
        transcriptionMs = sttRes.data.durationMs
      }
    }

    return {
      ok: true,
      data: {
        sessionId,
        audioPath,
        audioSizeBytes: st.size,
        transcription,
        transcriptionMs,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "input_failed",
      message: `❌ فشل إدخال الصوت / voice input failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Voice TTS — text-to-speech: text → audio buffer
// ---------------------------------------------------------------------------

export interface TtsInput {
  text: string
  voice?: string  // "tongtong" | "alloy" | etc.
  speed?: number  // 0.5 - 2.0
  format?: string  // "mp3" | "wav" | "opus"
  sessionId?: string
  /** Save to disk and return path. Default true. */
  save?: boolean
}

export async function voiceTts(input: TtsInput): Promise<VoiceResult<TtsResult>> {
  const start = Date.now()
  try {
    if (!input.text || !input.text.trim()) {
      return { ok: false, error: "no_text", message: "❌ لا نص مُدخل / no text input" }
    }
    const zai = await getZai()
    if (!zai) {
      return { ok: false, error: "no_sdk", message: "❌ z-ai-web-dev-sdk غير متاح / SDK not available" }
    }
    // Z.ai supported voices (verified working). Map OpenAI-style names → Z.ai equivalents.
    const SUPPORTED_VOICES = ["tongtong", "xiaochen", "yatian", "guiu"] as const
    const VOICE_MAP: Record<string, string> = {
      alloy: "tongtong",
      echo: "tongtong",
      nova: "xiaochen",
      shimmer: "yatian",
      onyx: "guiu",
      female: "tongtong",
      male: "guiu",
    }
    let voice = input.voice ?? "tongtong"
    // Map OpenAI-style voice names to Z.ai equivalents
    if (VOICE_MAP[voice]) voice = VOICE_MAP[voice]
    // Fallback: if voice not supported, use tongtong (safest)
    if (!SUPPORTED_VOICES.includes(voice as never)) voice = "tongtong"
    const speed = input.speed ?? 1.0
    const format = input.format ?? "wav"

    const response = await zai.audio.tts.create({
      input: input.text,
      voice,
      speed,
      response_format: format,
      stream: false,
    }) as { arrayBuffer?: () => Promise<ArrayBuffer> }

    if (!response?.arrayBuffer) {
      return { ok: false, error: "tts_no_audio", message: "❌ لم يُرجع TTS صوتاً / TTS returned no audio" }
    }
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(new Uint8Array(arrayBuffer))

    let audioPath = ""
    let sizeBytes = buffer.length
    if (input.save !== false) {
      audioPath = await saveAudioFile(buffer, format, "tts")
    }

    // Update session stats.
    if (input.sessionId) {
      await db.voiceSession.update({
        where: { id: input.sessionId },
        data: {
          ttsCount: { increment: 1 },
          totalAudioMs: { increment: Date.now() - start },
        },
      }).catch(() => {})
    }

    return {
      ok: true,
      data: {
        audioPath,
        sizeBytes,
        durationMs: Date.now() - start,
        format,
        voice,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "tts_failed",
      message: `❌ فشل تحويل النص لصوت / TTS failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Voice Conversation — full turn: STT user audio → text → TTS response
//    The "response text" must be provided by the caller (this is the agent's
//    reply). Voice OS just orchestrates the audio I/O.
// ---------------------------------------------------------------------------

export interface VoiceConversationInput {
  /** User audio as base64 (or audioPath). */
  audioBase64?: string
  audioPath?: string
  /** The agent's response text to speak back. */
  responseText: string
  /** Session id. */
  sessionId?: string
  /** TTS settings override. */
  ttsVoice?: string
  ttsSpeed?: number
}

export async function voiceConversation(input: VoiceConversationInput): Promise<VoiceResult<VoiceConversationTurn>> {
  const start = Date.now()
  try {
    // 1. Transcribe user audio.
    const sttRes = await voiceStt({
      audioBase64: input.audioBase64,
      audioPath: input.audioPath,
      sessionId: input.sessionId,
    })
    if (!sttRes.ok) return sttRes as unknown as VoiceResult<VoiceConversationTurn>
    const userText = sttRes.data.text

    // 2. Synthesize response audio.
    const ttsRes = await voiceTts({
      text: input.responseText,
      voice: input.ttsVoice,
      speed: input.ttsSpeed,
      sessionId: input.sessionId,
    })
    if (!ttsRes.ok) return ttsRes as unknown as VoiceResult<VoiceConversationTurn>

    return {
      ok: true,
      data: {
        userText,
        responseText: input.responseText,
        responseAudioPath: ttsRes.data.audioPath,
        durationMs: Date.now() - start,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "conversation_failed",
      message: `❌ فشل المحادثة الصوتية / voice conversation failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Push-to-Talk — toggle push-to-talk mode (start/stop on demand)
//    UI-side: while button held, record. On release, send to STT.
//    Server-side: we just toggle the session mode + return state.
// ---------------------------------------------------------------------------

export async function voicePushToTalk(opts: {
  sessionId?: string
  conversationId?: string
  /** Start a new PTT session or end the current one. */
  action: "start" | "stop"
}): Promise<VoiceResult<{ sessionId: string; mode: VoiceMode; active: boolean }>> {
  try {
    if (opts.action === "start") {
      const session = await voiceSessionStart({
        conversationId: opts.conversationId,
        mode: "push_to_talk",
      })
      if (!session.ok) return session as unknown as VoiceResult<{ sessionId: string; mode: VoiceMode; active: boolean }>
      return { ok: true, data: { sessionId: session.data.id, mode: "push_to_talk", active: true } }
    }
    // stop
    if (!opts.sessionId) {
      return { ok: false, error: "no_session", message: "❌ لا جلسة / no session id to stop" }
    }
    const ended = await voiceSessionEnd(opts.sessionId)
    if (!ended.ok) return ended as unknown as VoiceResult<{ sessionId: string; mode: VoiceMode; active: boolean }>
    return { ok: true, data: { sessionId: opts.sessionId, mode: "push_to_talk", active: false } }
  } catch (e) {
    return {
      ok: false,
      error: "ptt_failed",
      message: `❌ فشل الضغط للتحدث / push-to-talk failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Hands-Free Mode — continuous mode with VAD (auto-record on voice)
//    Server-side: just toggles session to hands_free mode + configures VAD.
//    Client-side: continuous listening + VAD detection happens in browser.
// ---------------------------------------------------------------------------

export async function voiceHandsFree(opts: {
  sessionId?: string
  conversationId?: string
  action: "start" | "stop"
  vadEnabled?: boolean
  silenceThresholdMs?: number
}): Promise<VoiceResult<{ sessionId: string; mode: VoiceMode; vadEnabled: boolean; silenceThresholdMs: number; active: boolean }>> {
  try {
    if (opts.action === "start") {
      const session = await voiceSessionStart({
        conversationId: opts.conversationId,
        mode: "hands_free",
        vadEnabled: opts.vadEnabled ?? true,
        silenceThresholdMs: opts.silenceThresholdMs ?? 2000,
      })
      if (!session.ok) return session as unknown as VoiceResult<{ sessionId: string; mode: VoiceMode; vadEnabled: boolean; silenceThresholdMs: number; active: boolean }>
      return {
        ok: true,
        data: {
          sessionId: session.data.id,
          mode: "hands_free",
          vadEnabled: session.data.vadEnabled,
          silenceThresholdMs: session.data.silenceThresholdMs,
          active: true,
        },
      }
    }
    if (!opts.sessionId) {
      return { ok: false, error: "no_session", message: "❌ لا جلسة / no session id to stop" }
    }
    const ended = await voiceSessionEnd(opts.sessionId)
    if (!ended.ok) return ended as unknown as VoiceResult<{ sessionId: string; mode: VoiceMode; vadEnabled: boolean; silenceThresholdMs: number; active: boolean }>
    return {
      ok: true,
      data: {
        sessionId: opts.sessionId,
        mode: "hands_free",
        vadEnabled: false,
        silenceThresholdMs: 0,
        active: false,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "hands_free_failed",
      message: `❌ فشل الوضع الحر / hands-free failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Voice Commands — register + match + execute
// ---------------------------------------------------------------------------

export interface VoiceCommandRegisterInput {
  pattern: string  // regex or literal
  displayName: string
  description?: string
  action: VoiceCommandAction
  params?: Record<string, unknown>
  confirmRequired?: boolean
  active?: boolean
  /** If true, pattern is a literal string (not regex). Default false. */
  isLiteral?: boolean
}

export async function voiceCommandRegister(input: VoiceCommandRegisterInput): Promise<VoiceResult<VoiceCommandRecord>> {
  try {
    if (!input.pattern || !input.displayName || !input.action) {
      return { ok: false, error: "bad_input", message: "❌ المدخلات غير مكتملة / incomplete input (pattern + displayName + action required)" }
    }
    // Validate regex if not literal.
    if (!input.isLiteral) {
      try {
        new RegExp(input.pattern, "i")
      } catch {
        return { ok: false, error: "bad_pattern", message: `❌ نمط غير صالح / invalid regex pattern: ${input.pattern}` }
      }
    }
    const row = await db.voiceCommand.upsert({
      where: { pattern: input.pattern },
      update: {
        displayName: input.displayName,
        description: input.description,
        action: input.action,
        params: JSON.stringify(input.params ?? {}),
        confirmRequired: input.confirmRequired ?? false,
        active: input.active ?? true,
      },
      create: {
        pattern: input.pattern,
        displayName: input.displayName,
        description: input.description,
        action: input.action,
        params: JSON.stringify(input.params ?? {}),
        confirmRequired: input.confirmRequired ?? false,
        active: input.active ?? true,
      },
    })
    return { ok: true, data: commandRowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "register_failed",
      message: `❌ فشل تسجيل الأمر / command register failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function voiceCommandList(): Promise<VoiceResult<VoiceCommandRecord[]>> {
  try {
    const rows = await db.voiceCommand.findMany({ where: { active: true }, orderBy: { createdAt: "desc" } })
    return { ok: true, data: rows.map(commandRowToRecord) }
  } catch (e) {
    return {
      ok: false,
      error: "list_failed",
      message: `❌ فشل سرد الأوامر / command list failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

/**
 * Match a transcribed text against all active voice commands.
 * Returns the first match (commands are tried in registration order).
 */
export async function voiceCommandMatch(text: string): Promise<VoiceResult<VoiceCommandMatch | null>> {
  try {
    if (!text.trim()) return { ok: true, data: null }
    const rows = await db.voiceCommand.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } })
    for (const row of rows) {
      const cmd = commandRowToRecord(row)
      let match: RegExpMatchArray | null = null
      try {
        const re = new RegExp(cmd.pattern, "i")
        match = text.match(re)
      } catch {
        // Bad regex — try literal match.
        if (text.toLowerCase().includes(cmd.pattern.toLowerCase())) {
          return {
            ok: true,
            data: {
              command: cmd,
              matchedText: cmd.pattern,
              captures: [],
            },
          }
        }
        continue
      }
      if (match) {
        return {
          ok: true,
          data: {
            command: cmd,
            matchedText: match[0],
            captures: match.slice(1),
          },
        }
      }
    }
    return { ok: true, data: null }
  } catch (e) {
    return {
      ok: false,
      error: "match_failed",
      message: `❌ فشل المطابقة / command match failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

/**
 * Execute a matched voice command. Returns the action + params for the
 * client to dispatch (the actual side-effect happens client-side or via
 * a dedicated API).
 */
export async function voiceCommandExecute(
  commandId: string,
  opts: { captures?: string[]; sessionId?: string } = {}
): Promise<VoiceResult<{ action: VoiceCommandAction; params: Record<string, unknown>; captures: string[]; confirmed: boolean }>> {
  try {
    const row = await db.voiceCommand.findUnique({ where: { id: commandId } })
    if (!row) {
      return { ok: false, error: "not_found", message: `❌ الأمر غير موجود / command not found: ${commandId}` }
    }
    if (!row.active) {
      return { ok: false, error: "inactive", message: `❌ الأمر غير نشط / command is inactive` }
    }
    // Increment use count.
    await db.voiceCommand.update({
      where: { id: commandId },
      data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
    })
    return {
      ok: true,
      data: {
        action: row.action as VoiceCommandAction,
        params: safeParse(row.params, {}),
        captures: opts.captures ?? [],
        confirmed: !row.confirmRequired,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "execute_failed",
      message: `❌ فشل التنفيذ / command execute failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function voiceCommandDelete(id: string): Promise<VoiceResult<{ deleted: boolean }>> {
  try {
    await db.voiceCommand.delete({ where: { id } })
    return { ok: true, data: { deleted: true } }
  } catch (e) {
    return {
      ok: false,
      error: "delete_failed",
      message: `❌ فشل الحذف / delete failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

export interface SessionStartInput {
  conversationId?: string
  mode?: VoiceMode
  ttsVoice?: string
  ttsSpeed?: number
  asrLanguage?: string
  vadEnabled?: boolean
  silenceThresholdMs?: number
}

export async function voiceSessionStart(input: SessionStartInput = {}): Promise<VoiceResult<VoiceSessionRecord>> {
  try {
    const row = await db.voiceSession.create({
      data: {
        status: "active",
        conversationId: input.conversationId,
        mode: input.mode ?? "push_to_talk",
        ttsVoice: input.ttsVoice ?? "tongtong",
        ttsSpeed: input.ttsSpeed ?? 1.0,
        asrLanguage: input.asrLanguage ?? "ar",
        vadEnabled: input.vadEnabled ?? true,
        silenceThresholdMs: input.silenceThresholdMs ?? 2000,
      },
    })
    return { ok: true, data: sessionRowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "session_start_failed",
      message: `❌ فشل بدء الجلسة / session start failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function voiceSessionEnd(sessionId: string): Promise<VoiceResult<VoiceSessionRecord>> {
  try {
    const row = await db.voiceSession.update({
      where: { id: sessionId },
      data: { status: "ended", endedAt: new Date() },
    })
    return { ok: true, data: sessionRowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "session_end_failed",
      message: `❌ فشل إنهاء الجلسة / session end failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function voiceSessionPause(sessionId: string): Promise<VoiceResult<VoiceSessionRecord>> {
  try {
    const row = await db.voiceSession.update({
      where: { id: sessionId },
      data: { status: "paused" },
    })
    return { ok: true, data: sessionRowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "session_pause_failed",
      message: `❌ فشل إيقاف الجلسة / session pause failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function voiceSessionResume(sessionId: string): Promise<VoiceResult<VoiceSessionRecord>> {
  try {
    const row = await db.voiceSession.update({
      where: { id: sessionId },
      data: { status: "active" },
    })
    return { ok: true, data: sessionRowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "session_resume_failed",
      message: `❌ فشل استئناف الجلسة / session resume failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function voiceSessionList(opts: { status?: VoiceSessionStatus; limit?: number } = {}): Promise<VoiceResult<VoiceSessionRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.status) where.status = opts.status
    const rows = await db.voiceSession.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 50,
    })
    return { ok: true, data: rows.map(sessionRowToRecord) }
  } catch (e) {
    return {
      ok: false,
      error: "session_list_failed",
      message: `❌ فشل سرد الجلسات / session list failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function voiceSessionGet(sessionId: string): Promise<VoiceResult<VoiceSessionRecord>> {
  try {
    const row = await db.voiceSession.findUnique({ where: { id: sessionId } })
    if (!row) {
      return { ok: false, error: "not_found", message: `❌ الجلسة غير موجودة / session not found: ${sessionId}` }
    }
    return { ok: true, data: sessionRowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "session_get_failed",
      message: `❌ فشل جلب الجلسة / session get failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Default commands — seeded once via voiceSeedDefaultCommands()
// ---------------------------------------------------------------------------

const DEFAULT_COMMANDS: VoiceCommandRegisterInput[] = [
  {
    pattern: "(?:محادثة|chat) جديدة|new chat|start new",
    displayName: "محادثة جديدة / New Chat",
    description: "بدء محادثة جديدة",
    action: "new_chat",
    isLiteral: false,
  },
  {
    pattern: "(?:افتح|open) (?:الإعدادات|settings)",
    displayName: "افتح الإعدادات / Open Settings",
    description: "فتح نافذة الإعدادات",
    action: "open_settings",
    isLiteral: false,
  },
  {
    pattern: "(?:بدّل|switch) (?:الوضع|mode) (?:إلى|to) (engineering|personal|هندسة|شخصي)",
    displayName: "بدّل الوضع / Switch Mode",
    description: "التبديل بين الوضع الهندسي والشخصي",
    action: "switch_mode",
    isLiteral: false,
    params: {},
  },
  {
    pattern: "(?:أوقف|stop) (?:الكلام|speaking|talking)",
    displayName: "أوقف الكلام / Stop Speaking",
    description: "إيقاف تشغيل الصوت فوراً",
    action: "stop_speaking",
    isLiteral: false,
  },
  {
    pattern: "(?:امسح|clear) (?:الإدخال|input)",
    displayName: "امسح الإدخال / Clear Input",
    description: "مسح حقل الإدخال",
    action: "clear_input",
    isLiteral: false,
  },
  {
    pattern: "(?:أرسل|send) (?:الرسالة|message)",
    displayName: "أرسل الرسالة / Send Message",
    description: "إرسال الرسالة الحالية",
    action: "send_message",
    isLiteral: false,
  },
  {
    pattern: "(?:اقرأ|read) (?:هذا|this) (?:بصوت|aloud|out loud)",
    displayName: "اقرأ بصوت / Read Aloud",
    description: "قراءة الرد الحالي بصوت عالٍ",
    action: "read_aloud",
    isLiteral: false,
  },
]

export async function voiceSeedDefaultCommands(): Promise<VoiceResult<{ seeded: string[]; skipped: string[] }>> {
  try {
    const seeded: string[] = []
    const skipped: string[] = []
    for (const cmd of DEFAULT_COMMANDS) {
      const existing = await db.voiceCommand.findUnique({ where: { pattern: cmd.pattern } })
      if (existing) {
        skipped.push(cmd.pattern)
        continue
      }
      const res = await voiceCommandRegister(cmd)
      if (res.ok) seeded.push(cmd.pattern)
    }
    return { ok: true, data: { seeded, skipped } }
  } catch (e) {
    return {
      ok: false,
      error: "seed_failed",
      message: `❌ فشل البذر / seed failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface VoiceSnapshot {
  totalSessions: number
  activeSessions: number
  totalCommands: number
  activeCommands: number
  totalStt: number
  totalTts: number
  totalAudioMs: number
  recentCommands: Array<{ pattern: string; displayName: string; useCount: number; lastUsedAt: Date | null }>
}

export async function voiceSnapshot(): Promise<VoiceResult<VoiceSnapshot>> {
  try {
    const sessions = await db.voiceSession.findMany()
    const activeSessions = sessions.filter((s) => s.status === "active").length
    const totalStt = sessions.reduce((sum, s) => sum + s.sttCount, 0)
    const totalTts = sessions.reduce((sum, s) => sum + s.ttsCount, 0)
    const totalAudioMs = sessions.reduce((sum, s) => sum + s.totalAudioMs, 0)
    const commands = await db.voiceCommand.findMany({ orderBy: { useCount: "desc" }, take: 10 })
    const totalCommands = await db.voiceCommand.count()
    const activeCommands = await db.voiceCommand.count({ where: { active: true } })
    return {
      ok: true,
      data: {
        totalSessions: sessions.length,
        activeSessions,
        totalCommands,
        activeCommands,
        totalStt,
        totalTts,
        totalAudioMs,
        recentCommands: commands.map((c) => ({
          pattern: c.pattern,
          displayName: c.displayName,
          useCount: c.useCount,
          lastUsedAt: c.lastUsedAt,
        })),
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "snapshot_failed",
      message: `❌ فشل اللقطة / snapshot failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

export function formatVoiceResult<T>(result: VoiceResult<T>): string {
  if (!result.ok) {
    return `${result.message}\n[error: ${result.error}]`
  }
  const data = result.data as unknown
  if (data === null || data === undefined) return "✅ OK"
  if (typeof data === "string") return data
  if (typeof data === "number" || typeof data === "boolean") return String(data)
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}
