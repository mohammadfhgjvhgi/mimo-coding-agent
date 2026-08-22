import { franc } from 'franc-min';
import type { MixedLanguageSegment } from './types';

export function normalizeArabic(input: string): string {
  return input
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/[\u0622\u0623\u0625]/g, '\u0627')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0640/g, '')
    .replace(/\u00A0/g, ' ');
}

function mapLangCode(francLang: string): string {
  switch (francLang) {
    case 'arb': case 'ar': return 'ar';
    case 'eng': case 'en': return 'en';
    default: return 'und';
  }
}

export function segmentMixedLanguage(text: string): MixedLanguageSegment[] {
  if (!text || !text.trim()) return [];
  const normalized = normalizeArabic(text);
  const segmenter = new Intl.Segmenter('ar', { granularity: 'word' });
  const segments: MixedLanguageSegment[] = [];
  let buffer = '';
  let currentLang = 'ar';

  for (const s of segmenter.segment(normalized)) {
    const token = s.segment;
    if (!s.isWordLike) { buffer += token; continue; }
    const isArabicChar = /[\u0600-\u06FF]/.test(token);
    const isLatinChar = /[a-zA-Z]/.test(token);
    let lang: string;
    if (isArabicChar && !isLatinChar) lang = 'ar';
    else if (isLatinChar && !isArabicChar) {
      const detected = franc(token, { minLength: 2 });
      lang = mapLangCode(detected);
      if (lang === 'und') lang = 'en';
    } else { lang = currentLang; }
    if (lang === currentLang) buffer += token;
    else { if (buffer.trim()) segments.push({ text: buffer, lang: currentLang }); buffer = token; currentLang = lang; }
  }
  if (buffer.trim()) segments.push({ text: buffer, lang: currentLang });
  return segments.length > 0 ? segments : [{ text: normalized, lang: 'ar' }];
}

export function detectLanguage(text: string): 'ar' | 'en' | 'other' {
  if (!text || text.length < 2) return 'other';
  const detected = franc(text, { minLength: 3 });
  if (detected === 'arb' || detected === 'ar') return 'ar';
  if (detected === 'eng' || detected === 'en') return 'en';
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  if (/[a-zA-Z]/.test(text)) return 'en';
  return 'other';
}

export function sanitizeForTts(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' كود برمجي ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/[#*_~>|]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
