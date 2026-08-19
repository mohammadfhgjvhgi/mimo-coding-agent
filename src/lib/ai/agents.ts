// Adapter: exposes a listAgents() helper backed by our swarm-roles registry.
// The mimo-life-os routes import listAgents from "@/lib/ai/agents".
import { ROLE_PROMPTS, ROLE_TOOLS, type MiMoRole } from "@/lib/agent/swarm-roles"

export interface AgentInfo {
  name: string
  role: string
  description: string
  defaultTools: string[]
  systemPrompt: string
}

const AGENT_DESCRIPTIONS: Record<MiMoRole, string> = {
  researcher: "البحث عن المعلومات وتجميعها",
  coder: "كتابة وتعديل الكود",
  analyst: "تحليل البيانات والنتائج",
  writer: "كتابة الوثائق والمحتوى",
  generalist: "مهام عامة متعددة",
  security_analyst: "تحليل الثغرات الأمنية",
  electrical_engineer: "تصميم الدوائر الكهربائية",
  fact_checker: "التحقق من صحة الحقائق",
  bias_auditor: "مراجعة الانحياز في النتائج",
  device_controller: "التحكم في الأجهزة الطرفية",
  refactorer: "إعادة هيكلة الكود",
  tester: "كتابة الاختبارات",
  architect: "تصميم البنية المعمارية",
}

export function listAgents(): AgentInfo[] {
  return (Object.keys(ROLE_PROMPTS) as MiMoRole[]).map((role) => ({
    name: role,
    role,
    description: AGENT_DESCRIPTIONS[role] ?? role,
    defaultTools: ROLE_TOOLS[role] ?? [],
    systemPrompt: ROLE_PROMPTS[role] ?? "",
  }))
}

export function getAgent(name: string): AgentInfo | undefined {
  return listAgents().find((a) => a.name === name)
}
