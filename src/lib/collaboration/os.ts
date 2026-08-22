// Collaboration OS — 9 operations (spec section 29, features 406-414).
//
// Local-first: all data persisted to SQLite. Ready for future sync/collab.
// No external dependencies, no network calls, no LLM calls.
//
// 9 operations:
//   1. sharedProjects       — list/create/delete shared projects (406)
//   2. sharedKnowledge      — list/create/delete shared knowledge (407)
//   3. sharedAgents          — list/create/delete shared agents (408)
//   4. promptLibrary         — list/create/delete/use prompts (409)
//   5. skillLibrary          — list/create/delete/use skills (410)
//   6. sharedArtifacts       — list/create/delete shared artifacts (411)
//   7. reviewRequests        — list/create/resolve review requests (412)
//   8. teamPermissions       — list/grant/revoke permissions (413)
//   9. projectRoles          — list/create/assign roles (414)

import { db } from "@/lib/db"
import { createHash } from "node:crypto"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CollabResult<T> {
  ok: boolean
  data?: T
  error?: string
  message?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateToken(): string {
  return createHash("sha256").update(`${Date.now()}-${Math.random()}`).digest("hex").slice(0, 24)
}

// ---------------------------------------------------------------------------
// 1. Shared Projects (406)
// ---------------------------------------------------------------------------

export async function listSharedProjects(): Promise<CollabResult<any[]>> {
  try {
    const projects = await db.collabSharedProject.findMany({ orderBy: { updatedAt: "desc" } })
    return {
      ok: true,
      data: projects.map(p => ({
        ...p,
        members: JSON.parse(p.members),
        metadata: JSON.parse(p.metadata),
      })),
    }
  } catch (e) {
    return { ok: false, error: "list_failed", message: String(e) }
  }
}

export async function createSharedProject(opts: {
  name: string
  description?: string
  ownerRole?: string
  metadata?: Record<string, unknown>
  isPublic?: boolean
}): Promise<CollabResult<{ id: string; shareToken: string }>> {
  try {
    const shareToken = opts.isPublic ? generateToken() : null
    const project = await db.collabSharedProject.create({
      data: {
        name: opts.name,
        description: opts.description ?? "",
        ownerRole: opts.ownerRole ?? "owner",
        metadata: JSON.stringify(opts.metadata ?? {}),
        isPublic: opts.isPublic ?? false,
        shareToken,
      },
    })
    return { ok: true, data: { id: project.id, shareToken: shareToken ?? "" } }
  } catch (e) {
    return { ok: false, error: "create_failed", message: String(e) }
  }
}

export async function deleteSharedProject(id: string): Promise<CollabResult<{ deleted: boolean }>> {
  try {
    await db.collabSharedProject.delete({ where: { id } })
    return { ok: true, data: { deleted: true } }
  } catch (e) {
    return { ok: false, error: "delete_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 2. Shared Knowledge (407)
// ---------------------------------------------------------------------------

export async function listSharedKnowledge(): Promise<CollabResult<any[]>> {
  try {
    const items = await db.collabSharedKnowledge.findMany({ orderBy: { updatedAt: "desc" } })
    return {
      ok: true,
      data: items.map(k => ({ ...k, tags: JSON.parse(k.tags), accessList: JSON.parse(k.accessList) })),
    }
  } catch (e) {
    return { ok: false, error: "list_failed", message: String(e) }
  }
}

export async function createSharedKnowledge(opts: {
  title: string
  content: string
  source?: string
  tags?: string[]
  visibility?: string
}): Promise<CollabResult<{ id: string }>> {
  try {
    const item = await db.collabSharedKnowledge.create({
      data: {
        title: opts.title,
        content: opts.content,
        source: opts.source ?? "manual",
        tags: JSON.stringify(opts.tags ?? []),
        visibility: opts.visibility ?? "team",
      },
    })
    return { ok: true, data: { id: item.id } }
  } catch (e) {
    return { ok: false, error: "create_failed", message: String(e) }
  }
}

export async function deleteSharedKnowledge(id: string): Promise<CollabResult<{ deleted: boolean }>> {
  try {
    await db.collabSharedKnowledge.delete({ where: { id } })
    return { ok: true, data: { deleted: true } }
  } catch (e) {
    return { ok: false, error: "delete_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 3. Shared Agents (408)
// ---------------------------------------------------------------------------

export async function listSharedAgents(): Promise<CollabResult<any[]>> {
  try {
    const agents = await db.collabSharedAgent.findMany({ orderBy: { updatedAt: "desc" } })
    return {
      ok: true,
      data: agents.map(a => ({ ...a, config: JSON.parse(a.config), tags: JSON.parse(a.tags) })),
    }
  } catch (e) {
    return { ok: false, error: "list_failed", message: String(e) }
  }
}

export async function createSharedAgent(opts: {
  name: string
  description?: string
  config?: Record<string, unknown>
  agentType?: string
  tags?: string[]
  isPublic?: boolean
}): Promise<CollabResult<{ id: string }>> {
  try {
    const agent = await db.collabSharedAgent.create({
      data: {
        name: opts.name,
        description: opts.description ?? "",
        config: JSON.stringify(opts.config ?? {}),
        agentType: opts.agentType ?? "custom",
        tags: JSON.stringify(opts.tags ?? []),
        isPublic: opts.isPublic ?? false,
      },
    })
    return { ok: true, data: { id: agent.id } }
  } catch (e) {
    return { ok: false, error: "create_failed", message: String(e) }
  }
}

export async function deleteSharedAgent(id: string): Promise<CollabResult<{ deleted: boolean }>> {
  try {
    await db.collabSharedAgent.delete({ where: { id } })
    return { ok: true, data: { deleted: true } }
  } catch (e) {
    return { ok: false, error: "delete_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 4. Prompt Library (409)
// ---------------------------------------------------------------------------

const BUILTIN_PROMPTS: Array<{ title: string; prompt: string; category: string; tags: string[] }> = [
  {
    title: "Code Review",
    prompt: "Review the following code for bugs, security issues, and best practices. Provide specific suggestions:\n\n```\n{code}\n```",
    category: "code",
    tags: ["review", "quality", "security"],
  },
  {
    title: "Bug Fix",
    prompt: "Analyze this bug and suggest a fix:\n\nBug description: {description}\nError: {error}\nCode: {code}",
    category: "code",
    tags: ["debug", "fix"],
  },
  {
    title: "Documentation Generator",
    prompt: "Generate documentation for this code (function/class/module). Include parameters, return values, and examples:\n\n```\n{code}\n```",
    category: "writing",
    tags: ["docs", "readme"],
  },
  {
    title: "Test Generator",
    prompt: "Generate comprehensive tests for this code. Cover edge cases and error handling:\n\n```\n{code}\n```",
    category: "code",
    tags: ["test", "vitest", "jest"],
  },
  {
    title: "Refactoring Suggestions",
    prompt: "Analyze this code and suggest refactoring improvements. Focus on readability, maintainability, and performance:\n\n```\n{code}\n```",
    category: "code",
    tags: ["refactor", "quality"],
  },
  {
    title: "Summarize",
    prompt: "Summarize the following text in 3-5 bullet points:\n\n{text}",
    category: "analysis",
    tags: ["summary", "extract"],
  },
]

export async function listPromptLibrary(): Promise<CollabResult<any[]>> {
  try {
    // Seed builtin prompts
    for (const p of BUILTIN_PROMPTS) {
      const existing = await db.collabPromptLibrary.findFirst({ where: { title: p.title, builtin: true } })
      if (!existing) {
        await db.collabPromptLibrary.create({
          data: {
            title: p.title,
            prompt: p.prompt,
            category: p.category,
            tags: JSON.stringify(p.tags),
            visibility: "public",
            builtin: true,
          },
        })
      }
    }
    const prompts = await db.collabPromptLibrary.findMany({ orderBy: [{ useCount: "desc" }, { createdAt: "desc" }] })
    return {
      ok: true,
      data: prompts.map(p => ({ ...p, tags: JSON.parse(p.tags) })),
    }
  } catch (e) {
    return { ok: false, error: "list_failed", message: String(e) }
  }
}

export async function createPrompt(opts: {
  title: string
  prompt: string
  category?: string
  tags?: string[]
  visibility?: string
}): Promise<CollabResult<{ id: string }>> {
  try {
    const item = await db.collabPromptLibrary.create({
      data: {
        title: opts.title,
        prompt: opts.prompt,
        category: opts.category ?? "general",
        tags: JSON.stringify(opts.tags ?? []),
        visibility: opts.visibility ?? "team",
      },
    })
    return { ok: true, data: { id: item.id } }
  } catch (e) {
    return { ok: false, error: "create_failed", message: String(e) }
  }
}

export async function applyPrompt(id: string): Promise<CollabResult<{ prompt: string; useCount: number }>> {
  try {
    const item = await db.collabPromptLibrary.findUnique({ where: { id } })
    if (!item) return { ok: false, error: "not_found", message: "الـ prompt غير موجود" }
    const updated = await db.collabPromptLibrary.update({
      where: { id },
      data: { useCount: { increment: 1 } },
    })
    return { ok: true, data: { prompt: item.prompt, useCount: updated.useCount } }
  } catch (e) {
    return { ok: false, error: "use_failed", message: String(e) }
  }
}

export async function deletePrompt(id: string): Promise<CollabResult<{ deleted: boolean }>> {
  try {
    const existing = await db.collabPromptLibrary.findUnique({ where: { id } })
    if (!existing) return { ok: false, error: "not_found", message: "غير موجود" }
    if (existing.builtin) return { ok: false, error: "builtin", message: "❌ لا يمكن حذف prompt مدمج" }
    await db.collabPromptLibrary.delete({ where: { id } })
    return { ok: true, data: { deleted: true } }
  } catch (e) {
    return { ok: false, error: "delete_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 5. Skill Library (410)
// ---------------------------------------------------------------------------

const BUILTIN_SKILLS: Array<{ name: string; description: string; skillType: string; definition: Record<string, unknown>; tags: string[] }> = [
  {
    name: "file-reader",
    description: "Read a file from the workspace",
    skillType: "tool",
    definition: { type: "file_read", inputs: { path: "string" }, outputs: { content: "string" } },
    tags: ["file", "read"],
  },
  {
    name: "code-search",
    description: "Search code across the workspace using AST or text",
    skillType: "tool",
    definition: { type: "code_search", inputs: { query: "string", mode: "ast|text" }, outputs: { results: "array" } },
    tags: ["search", "ast"],
  },
  {
    name: "git-checkpoint",
    description: "Create a git checkpoint (commit) before risky operations",
    skillType: "workflow",
    definition: { steps: ["git add -A", "git commit -m 'checkpoint: before operation'"] },
    tags: ["git", "checkpoint"],
  },
  {
    name: "test-runner",
    description: "Run tests and parse results",
    skillType: "tool",
    definition: { type: "test_run", inputs: { pattern: "string?" }, outputs: { passed: "number", failed: "number", results: "array" } },
    tags: ["test", "vitest", "jest"],
  },
]

export async function listSkillLibrary(): Promise<CollabResult<any[]>> {
  try {
    // Seed builtin skills
    for (const s of BUILTIN_SKILLS) {
      const existing = await db.collabSkillLibrary.findFirst({ where: { name: s.name, builtin: true } })
      if (!existing) {
        await db.collabSkillLibrary.create({
          data: {
            name: s.name,
            description: s.description,
            skillType: s.skillType,
            definition: JSON.stringify(s.definition),
            tags: JSON.stringify(s.tags),
            visibility: "public",
            builtin: true,
          },
        })
      }
    }
    const skills = await db.collabSkillLibrary.findMany({ orderBy: [{ useCount: "desc" }, { createdAt: "desc" }] })
    return {
      ok: true,
      data: skills.map(s => ({ ...s, definition: JSON.parse(s.definition), tags: JSON.parse(s.tags) })),
    }
  } catch (e) {
    return { ok: false, error: "list_failed", message: String(e) }
  }
}

export async function createSkill(opts: {
  name: string
  description?: string
  definition?: Record<string, unknown>
  skillType?: string
  tags?: string[]
  visibility?: string
}): Promise<CollabResult<{ id: string }>> {
  try {
    const item = await db.collabSkillLibrary.create({
      data: {
        name: opts.name,
        description: opts.description ?? "",
        definition: JSON.stringify(opts.definition ?? {}),
        skillType: opts.skillType ?? "tool",
        tags: JSON.stringify(opts.tags ?? []),
        visibility: opts.visibility ?? "team",
      },
    })
    return { ok: true, data: { id: item.id } }
  } catch (e) {
    return { ok: false, error: "create_failed", message: String(e) }
  }
}

export async function deleteSkill(id: string): Promise<CollabResult<{ deleted: boolean }>> {
  try {
    const existing = await db.collabSkillLibrary.findUnique({ where: { id } })
    if (!existing) return { ok: false, error: "not_found", message: "غير موجود" }
    if (existing.builtin) return { ok: false, error: "builtin", message: "❌ لا يمكن حذف skill مدمج" }
    await db.collabSkillLibrary.delete({ where: { id } })
    return { ok: true, data: { deleted: true } }
  } catch (e) {
    return { ok: false, error: "delete_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 6. Shared Artifacts (411)
// ---------------------------------------------------------------------------

export async function listSharedArtifacts(): Promise<CollabResult<any[]>> {
  try {
    const artifacts = await db.collabSharedArtifact.findMany({ orderBy: { updatedAt: "desc" } })
    return {
      ok: true,
      data: artifacts.map(a => ({ ...a, metadata: JSON.parse(a.metadata), tags: JSON.parse(a.tags) })),
    }
  } catch (e) {
    return { ok: false, error: "list_failed", message: String(e) }
  }
}

export async function createSharedArtifact(opts: {
  title: string
  artifactType: string // "html" | "react" | "svg" | "mermaid" | "markdown" | "code"
  content: string
  metadata?: Record<string, unknown>
  tags?: string[]
  visibility?: string
}): Promise<CollabResult<{ id: string }>> {
  try {
    const item = await db.collabSharedArtifact.create({
      data: {
        title: opts.title,
        artifactType: opts.artifactType,
        content: opts.content,
        metadata: JSON.stringify(opts.metadata ?? {}),
        tags: JSON.stringify(opts.tags ?? []),
        visibility: opts.visibility ?? "team",
      },
    })
    return { ok: true, data: { id: item.id } }
  } catch (e) {
    return { ok: false, error: "create_failed", message: String(e) }
  }
}

export async function deleteSharedArtifact(id: string): Promise<CollabResult<{ deleted: boolean }>> {
  try {
    await db.collabSharedArtifact.delete({ where: { id } })
    return { ok: true, data: { deleted: true } }
  } catch (e) {
    return { ok: false, error: "delete_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 7. Review Requests (412)
// ---------------------------------------------------------------------------

export async function listReviewRequests(status?: string): Promise<CollabResult<any[]>> {
  try {
    const where = status ? { status } : {}
    const requests = await db.collabReviewRequest.findMany({
      where: where as any,
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    })
    return {
      ok: true,
      data: requests.map(r => ({ ...r, context: JSON.parse(r.context), reviews: JSON.parse(r.reviews) })),
    }
  } catch (e) {
    return { ok: false, error: "list_failed", message: String(e) }
  }
}

export async function createReviewRequest(opts: {
  title: string
  targetType: string // "file" | "snippet" | "artifact" | "diff"
  targetPath: string
  context?: Record<string, unknown>
  priority?: string
}): Promise<CollabResult<{ id: string }>> {
  try {
    const item = await db.collabReviewRequest.create({
      data: {
        title: opts.title,
        targetType: opts.targetType,
        targetPath: opts.targetPath,
        context: JSON.stringify(opts.context ?? {}),
        priority: opts.priority ?? "medium",
        status: "pending",
      },
    })
    return { ok: true, data: { id: item.id } }
  } catch (e) {
    return { ok: false, error: "create_failed", message: String(e) }
  }
}

export async function resolveReviewRequest(id: string, status: string, comment?: string): Promise<CollabResult<{ updated: boolean }>> {
  try {
    const existing = await db.collabReviewRequest.findUnique({ where: { id } })
    if (!existing) return { ok: false, error: "not_found", message: "الطلب غير موجود" }
    const reviews = JSON.parse(existing.reviews) as any[]
    reviews.push({ reviewerId: "local", status, comment: comment ?? "", timestamp: new Date().toISOString() })
    await db.collabReviewRequest.update({
      where: { id },
      data: { status, reviews: JSON.stringify(reviews) },
    })
    return { ok: true, data: { updated: true } }
  } catch (e) {
    return { ok: false, error: "resolve_failed", message: String(e) }
  }
}

export async function deleteReviewRequest(id: string): Promise<CollabResult<{ deleted: boolean }>> {
  try {
    await db.collabReviewRequest.delete({ where: { id } })
    return { ok: true, data: { deleted: true } }
  } catch (e) {
    return { ok: false, error: "delete_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 8. Team Permissions (413)
// ---------------------------------------------------------------------------

const DEFAULT_PERMISSIONS: Record<string, Record<string, boolean>> = {
  owner: { read: true, write: true, delete: true, share: true, approve: true },
  editor: { read: true, write: true, delete: false, share: true, approve: false },
  viewer: { read: true, write: false, delete: false, share: false, approve: false },
  reviewer: { read: true, write: false, delete: false, share: false, approve: true },
}

export async function listTeamPermissions(resourceType?: string): Promise<CollabResult<any[]>> {
  try {
    const where = resourceType ? { resourceType } : {}
    const perms = await db.collabTeamPermission.findMany({
      where: where as any,
      orderBy: { createdAt: "desc" },
    })
    return {
      ok: true,
      data: perms.map(p => ({ ...p, permissions: JSON.parse(p.permissions) })),
    }
  } catch (e) {
    return { ok: false, error: "list_failed", message: String(e) }
  }
}

export async function grantPermission(opts: {
  userId?: string
  resourceType: string
  resourceId: string
  role: string // "owner" | "editor" | "viewer" | "reviewer"
}): Promise<CollabResult<{ id: string }>> {
  try {
    const permissions = DEFAULT_PERMISSIONS[opts.role] ?? DEFAULT_PERMISSIONS.viewer
    const item = await db.collabTeamPermission.create({
      data: {
        userId: opts.userId ?? "local",
        resourceType: opts.resourceType,
        resourceId: opts.resourceId,
        role: opts.role,
        permissions: JSON.stringify(permissions),
      },
    })
    return { ok: true, data: { id: item.id } }
  } catch (e) {
    return { ok: false, error: "grant_failed", message: String(e) }
  }
}

export async function revokePermission(id: string): Promise<CollabResult<{ deleted: boolean }>> {
  try {
    await db.collabTeamPermission.delete({ where: { id } })
    return { ok: true, data: { deleted: true } }
  } catch (e) {
    return { ok: false, error: "revoke_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 9. Project Roles (414)
// ---------------------------------------------------------------------------

const BUILTIN_ROLES: Array<{ roleName: string; permissions: Record<string, boolean>; description: string }> = [
  { roleName: "owner", permissions: { canEdit: true, canDelete: true, canShare: true, canApprove: true, canMerge: true }, description: "مالك المشروع — صلاحيات كاملة" },
  { roleName: "maintainer", permissions: { canEdit: true, canDelete: true, canShare: true, canApprove: true, canMerge: true }, description: "مشرف — صلاحيات شبه كاملة" },
  { roleName: "contributor", permissions: { canEdit: true, canDelete: false, canShare: false, canApprove: false, canMerge: false }, description: "مساهم — تحرير فقط" },
  { roleName: "reviewer", permissions: { canEdit: false, canDelete: false, canShare: false, canApprove: true, canMerge: false }, description: "مراجع — موافقة فقط" },
  { roleName: "viewer", permissions: { canEdit: false, canDelete: false, canShare: false, canApprove: false, canMerge: false }, description: "مشاهد — قراءة فقط" },
]

export async function listProjectRoles(projectId?: string): Promise<CollabResult<any[]>> {
  try {
    // Seed builtin roles if no project-specific roles exist
    const existing = await db.collabProjectRole.count()
    if (existing === 0) {
      for (const role of BUILTIN_ROLES) {
        await db.collabProjectRole.create({
          data: {
            projectId: "default",
            roleName: role.roleName,
            permissions: JSON.stringify(role.permissions),
            description: role.description,
            builtin: true,
          },
        })
      }
    }
    const where = projectId ? { projectId } : {}
    const roles = await db.collabProjectRole.findMany({
      where: where as any,
      orderBy: { roleName: "asc" },
    })
    return {
      ok: true,
      data: roles.map(r => ({ ...r, permissions: JSON.parse(r.permissions), assignedTo: JSON.parse(r.assignedTo) })),
    }
  } catch (e) {
    return { ok: false, error: "list_failed", message: String(e) }
  }
}

export async function createProjectRole(opts: {
  projectId: string
  roleName: string
  permissions?: Record<string, boolean>
  description?: string
}): Promise<CollabResult<{ id: string }>> {
  try {
    const item = await db.collabProjectRole.create({
      data: {
        projectId: opts.projectId,
        roleName: opts.roleName,
        permissions: JSON.stringify(opts.permissions ?? { canEdit: false, canDelete: false, canShare: false, canApprove: false, canMerge: false }),
        description: opts.description ?? "",
      },
    })
    return { ok: true, data: { id: item.id } }
  } catch (e) {
    return { ok: false, error: "create_failed", message: String(e) }
  }
}

export async function assignRole(roleId: string, userId: string): Promise<CollabResult<{ assigned: boolean }>> {
  try {
    const role = await db.collabProjectRole.findUnique({ where: { id: roleId } })
    if (!role) return { ok: false, error: "not_found", message: "الدور غير موجود" }
    const assignedTo = JSON.parse(role.assignedTo) as any[]
    if (!assignedTo.find(a => a.userId === userId)) {
      assignedTo.push({ userId, assignedAt: new Date().toISOString() })
      await db.collabProjectRole.update({
        where: { id: roleId },
        data: { assignedTo: JSON.stringify(assignedTo) },
      })
    }
    return { ok: true, data: { assigned: true } }
  } catch (e) {
    return { ok: false, error: "assign_failed", message: String(e) }
  }
}

export async function deleteProjectRole(id: string): Promise<CollabResult<{ deleted: boolean }>> {
  try {
    const existing = await db.collabProjectRole.findUnique({ where: { id } })
    if (!existing) return { ok: false, error: "not_found", message: "غير موجود" }
    if (existing.builtin) return { ok: false, error: "builtin", message: "❌ لا يمكن حذف دور مدمج" }
    await db.collabProjectRole.delete({ where: { id } })
    return { ok: true, data: { deleted: true } }
  } catch (e) {
    return { ok: false, error: "delete_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export async function collabSnapshot(): Promise<CollabResult<{
  sharedProjects: number
  sharedKnowledge: number
  sharedAgents: number
  prompts: number
  skills: number
  sharedArtifacts: number
  reviewRequests: number
  pendingReviews: number
  teamPermissions: number
  projectRoles: number
}>> {
  try {
    const [
      sharedProjects, sharedKnowledge, sharedAgents, prompts,
      skills, sharedArtifacts, reviewRequests, teamPermissions, projectRoles,
    ] = await Promise.all([
      db.collabSharedProject.count(),
      db.collabSharedKnowledge.count(),
      db.collabSharedAgent.count(),
      db.collabPromptLibrary.count(),
      db.collabSkillLibrary.count(),
      db.collabSharedArtifact.count(),
      db.collabReviewRequest.count(),
      db.collabTeamPermission.count(),
      db.collabProjectRole.count(),
    ])
    const pendingReviews = await db.collabReviewRequest.count({ where: { status: "pending" } })
    return {
      ok: true,
      data: {
        sharedProjects, sharedKnowledge, sharedAgents, prompts,
        skills, sharedArtifacts, reviewRequests, pendingReviews,
        teamPermissions, projectRoles,
      },
    }
  } catch (e) {
    return { ok: false, error: "snapshot_failed", message: String(e) }
  }
}
