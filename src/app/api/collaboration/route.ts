// /api/collaboration — POST (all actions) + GET (lists + snapshot)
import { NextRequest, NextResponse } from "next/server"
import {
  listSharedProjects, createSharedProject, deleteSharedProject,
  listSharedKnowledge, createSharedKnowledge, deleteSharedKnowledge,
  listSharedAgents, createSharedAgent, deleteSharedAgent,
  listPromptLibrary, createPrompt, applyPrompt, deletePrompt,
  listSkillLibrary, createSkill, deleteSkill,
  listSharedArtifacts, createSharedArtifact, deleteSharedArtifact,
  listReviewRequests, createReviewRequest, resolveReviewRequest, deleteReviewRequest,
  listTeamPermissions, grantPermission, revokePermission,
  listProjectRoles, createProjectRole, assignRole, deleteProjectRole,
  collabSnapshot,
} from "@/lib/collaboration/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      // 1. Shared Projects (406)
      case "project_create": return wrap(await createSharedProject({
        name: body.name, description: body.description, ownerRole: body.ownerRole, metadata: body.metadata, isPublic: body.isPublic,
      }))
      case "project_delete": return wrap(await deleteSharedProject(body.id))

      // 2. Shared Knowledge (407)
      case "knowledge_create": return wrap(await createSharedKnowledge({
        title: body.title, content: body.content, source: body.source, tags: body.tags, visibility: body.visibility,
      }))
      case "knowledge_delete": return wrap(await deleteSharedKnowledge(body.id))

      // 3. Shared Agents (408)
      case "agent_create": return wrap(await createSharedAgent({
        name: body.name, description: body.description, config: body.config, agentType: body.agentType, tags: body.tags, isPublic: body.isPublic,
      }))
      case "agent_delete": return wrap(await deleteSharedAgent(body.id))

      // 4. Prompt Library (409)
      case "prompt_create": return wrap(await createPrompt({
        title: body.title, prompt: body.prompt, category: body.category, tags: body.tags, visibility: body.visibility,
      }))
      case "prompt_use": return wrap(await applyPrompt(body.id))
      case "prompt_delete": return wrap(await deletePrompt(body.id))

      // 5. Skill Library (410)
      case "skill_create": return wrap(await createSkill({
        name: body.name, description: body.description, definition: body.definition, skillType: body.skillType, tags: body.tags, visibility: body.visibility,
      }))
      case "skill_delete": return wrap(await deleteSkill(body.id))

      // 6. Shared Artifacts (411)
      case "artifact_create": return wrap(await createSharedArtifact({
        title: body.title, artifactType: body.artifactType, content: body.content, metadata: body.metadata, tags: body.tags, visibility: body.visibility,
      }))
      case "artifact_delete": return wrap(await deleteSharedArtifact(body.id))

      // 7. Review Requests (412)
      case "review_create": return wrap(await createReviewRequest({
        title: body.title, targetType: body.targetType, targetPath: body.targetPath, context: body.context, priority: body.priority,
      }))
      case "review_resolve": return wrap(await resolveReviewRequest(body.id, body.status, body.comment))

      // 8. Team Permissions (413)
      case "permission_grant": return wrap(await grantPermission({
        userId: body.userId, resourceType: body.resourceType, resourceId: body.resourceId, role: body.role,
      }))
      case "permission_revoke": return wrap(await revokePermission(body.id))

      // 9. Project Roles (414)
      case "role_create": return wrap(await createProjectRole({
        projectId: body.projectId, roleName: body.roleName, permissions: body.permissions, description: body.description,
      }))
      case "role_assign": return wrap(await assignRole(body.id, body.userId))
      case "role_delete": return wrap(await deleteProjectRole(body.id))

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
      case "projects":   return wrap(await listSharedProjects())
      case "knowledge": return wrap(await listSharedKnowledge())
      case "agents":   return wrap(await listSharedAgents())
      case "prompts":  return wrap(await listPromptLibrary())
      case "skills":  return wrap(await listSkillLibrary())
      case "artifacts": return wrap(await listSharedArtifacts())
      case "reviews":  return wrap(await listReviewRequests(sp.get("status") ?? undefined))
      case "permissions": return wrap(await listTeamPermissions(sp.get("resourceType") ?? undefined))
      case "roles":    return wrap(await listProjectRoles(sp.get("projectId") ?? undefined))
      case "snapshot": return wrap(await collabSnapshot())
      default: return NextResponse.json({ error: `unknown mode: ${mode}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status:500 })
  }
}

function wrap<T>(result: { ok: true; data: T } | { ok: false; error: string; message: string }) {
  if (result.ok) return NextResponse.json(result.data)
  return NextResponse.json({ error: result.error, message: result.message }, { status: 400 })
}
