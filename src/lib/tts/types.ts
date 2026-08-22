export type TtsEngine = 'web-speech' | 'edge' | 'azure' | 'zai' | 'auto';

export const ARABIC_VOICES_EDGE = [
  'ar-EG-SalmaNeural', 'ar-EG-ShakirNeural',
  'ar-SA-HamedNeural', 'ar-SA-AliNeural',
  'ar-AE-FatimaNeural', 'ar-AE-HamidNeural',
  'ar-MA-MounaNeural', 'ar-LY-ImanNeural', 'ar-LY-OmarNeural',
  'ar-IQ-BasselNeural', 'ar-IQ-RanaNeural',
  'ar-SY-AmanyNeural', 'ar-SY-LaithNeural',
  'ar-TN-HediNeural', 'ar-DZ-AminaNeural', 'ar-DZ-IsmaelNeural',
  'ar-BH-AliNeural', 'ar-BH-LailaNeural',
  'ar-JO-SanaNeural', 'ar-KW-FahedNeural', 'ar-KW-NouraNeural',
  'ar-LB-LaylaNeural', 'ar-LB-RamiNeural',
  'ar-OM-AbdullahNeural', 'ar-OM-AyshaNeural',
  'ar-QA-MoazNeural', 'ar-YE-SalehNeural', 'ar-YE-MaryamNeural',
] as const;

export const ENGLISH_VOICES_EDGE = [
  'en-US-AriaNeural', 'en-US-DavisNeural', 'en-US-GuyNeural', 'en-US-JennyNeural',
  'en-GB-SoniaNeural', 'en-GB-RyanNeural',
] as const;

export const DEFAULT_ARABIC_VOICE = 'ar-EG-SalmaNeural' as const;
export const DEFAULT_ENGLISH_VOICE = 'en-US-AriaNeural' as const;

export interface TtsOptions {
  engine?: TtsEngine;
  lang?: string;
  voice?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  mixedLanguage?: boolean;
  onChunk?: (chunk: { text: string; lang: string; index: number; total: number }) => void;
  signal?: AbortSignal;
}

export interface TtsResult {
  audioUrl?: string;
  durationMs?: number;
  engineUsed?: TtsEngine;
  segmentsCount?: number;
}

export type TtsStatus = 'idle' | 'loading' | 'speaking' | 'paused' | 'error';
export interface MixedLanguageSegment { text: string; lang: string; }
