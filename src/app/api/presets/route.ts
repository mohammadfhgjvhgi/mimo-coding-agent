import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Prompt Presets — stored in memory (could be moved to DB later)
interface Preset {
  id: string
  name: string
  category: string
  systemPrompt: string
  icon: string
}

const PRESETS: Preset[] = [
  { id: "default", name: "افتراضي", category: "general", systemPrompt: "", icon: "MessageSquare" },
  { id: "coder", name: "مبرمج", category: "coding", systemPrompt: "أنت مبرمج خبير. اكتب كوداً نظيفاً مع تعليقات. استخدم أفضل الممارسات.", icon: "Code2" },
  { id: "researcher", name: "باحث", category: "research", systemPrompt: "أنت باحث. ابحث بدقة واستشهد بالمصادر.", icon: "Search" },
  { id: "writer", name: "كاتب", category: "writing", systemPrompt: "أنت كاتب محترف. اكتب بأسلوب واضح ومنظم.", icon: "PenLine" },
  { id: "translator", name: "مترجم", category: "general", systemPrompt: "أنت مترجم محترف بين العربية والإنجليزية.", icon: "Languages" },
  { id: "teacher", name: "معلم", category: "study", systemPrompt: "أنت معلم صبور. اشرح المفاهيم ببساطة مع أمثلة.", icon: "GraduationCap" },
  { id: "analyst", name: "محلل", category: "analysis", systemPrompt: "أنت محلل بيانات. حلل البيانات واستخرج الرؤى.", icon: "BarChart3" },
  { id: "architect", name: "مهندس معماري", category: "coding", systemPrompt: "أنت مهندس برمجيات. صمم بنية متينة وقابلة للتوسع.", icon: "Building2" },
]

export async function GET() {
  return NextResponse.json({ presets: PRESETS })
}
