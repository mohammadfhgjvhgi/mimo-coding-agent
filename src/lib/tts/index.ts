import type { MixedLanguageSegment, TtsOptions, TtsResult, TtsEngine } from './types';
import { segmentMixedLanguage, detectLanguage, sanitizeForTts } from './mixed-language';
import { DEFAULT_ARABIC_VOICE, DEFAULT_ENGLISH_VOICE } from './types';

export async function speakWebSpeech(text: string, options: TtsOptions = {}): Promise<TtsResult> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) throw new Error('Web Speech API not available');
  window.speechSynthesis.cancel();
  const segments = options.mixedLanguage ? segmentMixedLanguage(text) : [{ text, lang: options.lang ?? 'ar' }];
  const voices = window.speechSynthesis.getVoices();
  const arVoice = voices.find(v => v.lang?.startsWith('ar-SA')) || voices.find(v => v.lang?.startsWith('ar-EG')) || voices.find(v => v.lang?.startsWith('ar')) || null;
  const enVoice = voices.find(v => v.lang?.startsWith('en-US')) || voices.find(v => v.lang?.startsWith('en')) || null;
  for (let i = 0; i < segments.length; i++) {
    if (options.signal?.aborted) break;
    const seg = segments[i];
    if (!seg.text.trim()) continue;
    if (options.onChunk) options.onChunk({ text: seg.text, lang: seg.lang, index: i, total: segments.length });
    const utterance = new SpeechSynthesisUtterance(seg.text);
    utterance.lang = seg.lang === 'en' ? 'en-US' : 'ar-SA';
    const baseRate = options.rate ?? 1.0;
    utterance.rate = seg.lang === 'ar' ? Math.min(baseRate * 1.1, 2.0) : Math.min(baseRate, 2.0);
    utterance.pitch = options.pitch ?? 1.0;
    utterance.volume = options.volume ?? 1.0;
    if (seg.lang === 'ar' && arVoice) utterance.voice = arVoice;
    else if (seg.lang === 'en' && enVoice) utterance.voice = enVoice;
    await new Promise<void>((resolve) => { utterance.onend = () => resolve(); utterance.onerror = () => resolve(); window.speechSynthesis.speak(utterance); });
  }
  return { engineUsed: 'web-speech', segmentsCount: segments.length };
}

export async function speakEdge(text: string, options: TtsOptions = {}): Promise<TtsResult> {
  const segments = options.mixedLanguage ? segmentMixedLanguage(text) : [{ text, lang: options.lang ?? 'ar' }];
  const audioChunks: Blob[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (options.signal?.aborted) break;
    const seg = segments[i];
    if (!seg.text.trim()) continue;
    if (options.onChunk) options.onChunk({ text: seg.text, lang: seg.lang, index: i, total: segments.length });
    const segVoice = seg.lang === 'en' ? DEFAULT_ENGLISH_VOICE : options.voice || DEFAULT_ARABIC_VOICE;
    const rateDelta = Math.round(((options.rate ?? 1.0) - 1) * 100);
    const rateStr = `${rateDelta >= 0 ? '+' : ''}${rateDelta}%`;
    const pitchDelta = Math.round(((options.pitch ?? 1.0) - 1) * 50);
    const pitchStr = `${pitchDelta >= 0 ? '+' : ''}${pitchDelta}Hz`;
    const res = await fetch('/api/voice/tts/edge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: seg.text, voice: segVoice, rate: rateStr, pitch: pitchStr }), signal: options.signal });
    if (!res.ok) throw new Error(`Edge TTS failed: ${res.status}`);
    audioChunks.push(await res.blob());
  }
  const blob = new Blob(audioChunks, { type: 'audio/mpeg' });
  return { audioUrl: URL.createObjectURL(blob), engineUsed: 'edge', segmentsCount: segments.length };
}

export async function speakZai(text: string, options: TtsOptions = {}): Promise<TtsResult> {
  const res = await fetch('/api/voice/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: 'tongtong', speed: options.rate ?? 1.0, format: 'mp3', save: true }), signal: options.signal });
  if (!res.ok) throw new Error(`Z.ai TTS failed: ${res.status}`);
  const data = await res.json();
  if (!data.audioUrl) throw new Error('Z.ai TTS returned no audio URL');
  return { audioUrl: data.audioUrl, engineUsed: 'zai', segmentsCount: 1 };
}

export async function speakAuto(text: string, options: TtsOptions = {}): Promise<TtsResult> {
  const lang = detectLanguage(text);
  if (lang === 'ar') return speakEdge(text, { ...options, engine: 'edge' });
  else if (lang === 'en') { try { return await speakEdge(text, { ...options, engine: 'edge', voice: options.voice ?? DEFAULT_ENGLISH_VOICE }); } catch { return speakZai(text, options); } }
  else return speakZai(text, options);
}

export async function speak(text: string, options: TtsOptions = {}): Promise<TtsResult> {
  const engine: TtsEngine = options.engine ?? 'auto';
  switch (engine) {
    case 'web-speech': return speakWebSpeech(text, options);
    case 'edge': return speakEdge(text, options);
    case 'zai': return speakZai(text, options);
    case 'auto': return speakAuto(text, options);
    default: throw new Error(`Unknown TTS engine: ${engine}`);
  }
}

export function stopSpeak() { if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel(); }
export function pauseSpeak() { if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.pause(); }
export function resumeSpeak() { if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.resume(); }
