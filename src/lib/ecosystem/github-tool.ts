// GitHub Tool — fetch issues, PRs, and repo info via Octokit.
import { Octokit } from "octokit"
import type { ToolDef, ToolResult, ToolContext } from "@/lib/tools/types"
import { truncate } from "@/lib/tools/workspace"

function ok(id: string, name: string, args: Record<string, unknown>, result: string, durationMs: number): ToolResult {
  return { id, name, args, result: truncate(result, 6000), status: "success", durationMs }
}
function fail(id: string, name: string, args: Record<string, unknown>, error: string, durationMs: number): ToolResult {
  return { id, name, args, result: error, status: "error", error, durationMs }
}
function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

// The GitHub token is passed via the ToolContext (injected from settings)
// We use a global cache for the token since tools receive ctx but not the full settings
let cachedGithubToken: string | null = null
export function setGithubToken(token: string | null) {
  cachedGithubToken = token || null
}
function getOctokit(): Octokit {
  return new Octokit(cachedGithubToken ? { auth: cachedGithubToken } : {})
}

// ---- github_get_issues ----------------------------------------------------
export const githubGetIssuesTool: ToolDef = {
  name: "github_get_issues",
  description:
    "يجلب المشاكل (Issues) المفتوحة من مستودع GitHub. يحتاج المالك واسم المستودع. بدون توكن GitHub يعمل بحدود عامة (rate limited).",
  schema: {
    type: "object",
    properties: {
      owner: { type: "string", description: "المالك (مثل: facebook)" },
      repo: { type: "string", description: "اسم المستودع (مثل: react)" },
      state: { type: "string", description: "open | closed | all (افتراضي: open)" },
      limit: { type: "number", description: "عدد النتائج (افتراضي: 10، أقصى: 30)" },
    },
    required: ["owner", "repo"],
  },
  async execute(args): Promise<ToolResult> {
    const start = Date.now()
    const id = newId("ghi")
    const owner = String(args.owner || "").trim()
    const repo = String(args.repo || "").trim()
    const state = String(args.state || "open").trim() as "open" | "closed" | "all"
    const limit = Math.min(Number(args.limit) || 10, 30)

    if (!owner || !repo) {
      return fail(id, "github_get_issues", args, "المالك واسم المستودع مطلوبان", 0)
    }

    try {
      const octokit = getOctokit()
      const res = await octokit.rest.issues.listForRepo({
        owner,
        repo,
        state,
        per_page: limit,
        sort: "updated",
        direction: "desc",
      })

      if (res.data.length === 0) {
        return ok(id, "github_get_issues", args, `📭 لا مشاكل ${state === "open" ? "مفتوحة" : state} في ${owner}/${repo}`, Date.now() - start)
      }

      const lines = res.data.map((issue) => {
        const labels = issue.labels?.map((l) => (typeof l === "string" ? l : l.name)).filter(Boolean).join(", ")
        return [
          `#${issue.number} ${issue.title}`,
          `  الحالة: ${issue.state} | التعليقات: ${issue.comments} | المؤلف: ${issue.user?.login || "?"}`,
          labels ? `  التصنيفات: ${labels}` : "",
          `  الرابط: ${issue.html_url}`,
        ].filter(Boolean).join("\n")
      })

      const header = `📋 ${res.data.length} مشكلة ${state === "open" ? "مفتوحة" : ""} في ${owner}/${repo}:\n\n`
      return ok(id, "github_get_issues", args, header + lines.join("\n\n"), Date.now() - start)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Check if it's a rate limit error
      if (/rate limit/i.test(msg)) {
        return fail(id, "github_get_issues", args, `حد المعدل المسموح للـ GitHub API. أضف توكن GitHub في الإعدادات لرفع الحد.`, Date.now() - start)
      }
      return fail(id, "github_get_issues", args, `فشل جلب المشاكل: ${msg}`, Date.now() - start)
    }
  },
}

// ---- github_get_repo_info -------------------------------------------------
export const githubGetRepoInfoTool: ToolDef = {
  name: "github_get_repo_info",
  description: "يجلب معلومات مستودع GitHub (الوصف، النجوم، الفروع، اللغة، آخر تحديث).",
  schema: {
    type: "object",
    properties: {
      owner: { type: "string", description: "المالك" },
      repo: { type: "string", description: "اسم المستودع" },
    },
    required: ["owner", "repo"],
  },
  async execute(args): Promise<ToolResult> {
    const start = Date.now()
    const id = newId("gri")
    const owner = String(args.owner || "").trim()
    const repo = String(args.repo || "").trim()
    if (!owner || !repo) {
      return fail(id, "github_get_repo_info", args, "المالك واسم المستودع مطلوبان", 0)
    }
    try {
      const octokit = getOctokit()
      const res = await octokit.rest.repos.get({ owner, repo })
      const r = res.data
      return ok(
        id,
        "github_get_repo_info",
        args,
        [
          `📦 ${r.full_name}`,
          r.description ? `الوصف: ${r.description}` : "",
          `⭐ النجوم: ${r.stargazers_count} | 🍴 الفروع: ${r.forks_count}`,
          `🌐 اللغة: ${r.language || "?"} | 📊 الحجم: ${(r.size / 1024).toFixed(1)} MB`,
          `📅 آخر تحديث: ${r.updated_at}`,
          `🔔 المشاكل المفتوحة: ${r.open_issues_count}`,
          `🔗 ${r.html_url}`,
        ].filter(Boolean).join("\n"),
        Date.now() - start
      )
    } catch (e) {
      return fail(id, "github_get_repo_info", args, `فشل جلب المعلومات: ${e instanceof Error ? e.message : String(e)}`, Date.now() - start)
    }
  },
}
