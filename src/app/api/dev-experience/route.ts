// /api/dev-experience — POST (all actions) + GET (templates/constitution/snapshot)
import { NextRequest, NextResponse } from "next/server"
import {
  listProjectTemplates, createProjectTemplate, deleteProjectTemplate,
  projectScaffolding,
  frameworkDetection, packageManagerDetection, testFrameworkDetection,
  commandDiscovery,
  listConstitution, addConstitution, deleteConstitution,
  repositoryProfile,
  projectInstructions, criticalFiles, dangerousOperations,
  definitionOfDoneTemplates, engineeringRunbooks,
  dexSnapshot,
} from "@/lib/dev-experience/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      // 1. Project Templates (393)
      case "template_create": return wrap(await createProjectTemplate({
        name: body.name, description: body.description, framework: body.framework,
        language: body.language, packageManager: body.packageManager,
        testFramework: body.testFramework, files: body.files ?? {}, commands: body.commands ?? {},
      }))
      case "template_delete": return wrap(await deleteProjectTemplate(body.id))

      // 2. Project Scaffolding (394)
      case "scaffold": return wrap(await projectScaffolding({
        templateName: body.templateName, targetPath: body.targetPath, projectName: body.projectName,
      }))

      // 3-6. Detection (395-398) — GET only, but expose via POST for convenience
      case "framework_detect": return wrap(frameworkDetection())
      case "pm_detect": return wrap(packageManagerDetection())
      case "test_detect": return wrap(testFrameworkDetection())
      case "command_discover": return wrap(commandDiscovery())
      case "repo_profile": return wrap(await repositoryProfile())

      // 7. Constitution (399) — list/add/delete
      case "constitution_add": return wrap(await addConstitution({
        type: body.type, title: body.title, content: body.content, severity: body.severity,
      }))
      case "constitution_delete": return wrap(await deleteConstitution(body.id))

      default: return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const mode = sp.get("mode") ?? "snapshot"
    switch (mode) {
      case "templates": return wrap(await listProjectTemplates())
      case "constitution": return wrap(await listConstitution(sp.get("type") ?? undefined))
      case "instructions": return wrap(await projectInstructions())
      case "critical_files": return wrap(await criticalFiles())
      case "dangerous_ops": return wrap(await dangerousOperations())
      case "dod_templates": return wrap(await definitionOfDoneTemplates())
      case "runbooks": return wrap(await engineeringRunbooks())
      case "framework": return wrap(frameworkDetection())
      case "package_manager": return wrap(packageManagerDetection())
      case "test_framework": return wrap(testFrameworkDetection())
      case "commands": return wrap(commandDiscovery())
      case "profile": return wrap(await repositoryProfile())
      case "snapshot": return wrap(await dexSnapshot())
      default: return NextResponse.json({ error: `unknown mode: ${mode}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

function wrap<T>(result: { ok: boolean; data?: T; error?: string; message?: string }) {
  if (result.ok) return NextResponse.json(result.data)
  return NextResponse.json({ error: result.error, message: result.message }, { status: 400 })
}
