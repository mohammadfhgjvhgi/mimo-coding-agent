// Adapter: re-exports the skill listing from our canonical skills manager.
// The mimo-life-os routes import listSkills from "@/lib/ai/skills".
import { listSkills as listSkillsImpl } from "@/lib/skills/manager"

export interface SkillInfo {
  name: string
  description: string
  triggers: string[]
  source?: string
}

export function listSkills(): SkillInfo[] {
  return listSkillsImpl()
}
