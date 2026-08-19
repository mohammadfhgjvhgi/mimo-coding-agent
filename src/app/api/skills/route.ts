import { NextResponse } from "next/server"
import { readdirSync, existsSync, statSync } from "node:fs"
import path from "node:path"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const skillsDir = path.join(path.resolve(WORKSPACE_ROOT), "skills", "imported")
    if (!existsSync(skillsDir)) {
      return NextResponse.json({ skills: [] })
    }
    const entries = readdirSync(skillsDir, { withFileTypes: true })
    const skills = entries
      .filter(e => e.isDirectory())
      .map(e => {
        const skillPath = path.join(skillsDir, e.name)
        const hasSkillMd = existsSync(path.join(skillPath, "SKILL.md"))
        const scriptsDir = path.join(skillPath, "scripts")
        let scriptCount = 0
        let hasScripts = false
        if (existsSync(scriptsDir)) {
          try {
            scriptCount = readdirSync(scriptsDir).filter(f => f.endsWith(".py") || f.endsWith(".js") || f.endsWith(".ts")).length
            hasScripts = scriptCount > 0
          } catch {}
        }
        return { name: e.name, path: `skills/imported/${e.name}`, hasSkillMd, hasScripts, scriptCount }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
    return NextResponse.json({ skills, total: skills.length })
  } catch (e) {
    return NextResponse.json({ skills: [], error: "Failed" }, { status: 500 })
  }
}
