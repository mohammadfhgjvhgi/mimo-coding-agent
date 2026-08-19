// GitHub Integration Client — comprehensive library layer over Octokit.
// 8 operation groups, deterministic (0 LLM calls), bilingual (Arabic + English).
//
// Operation groups + sub-functions:
//
//   1. Repository Browser
//      - browseRepository(owner, repo)
//      - listUserRepos(username?)
//
//   2. Issues
//      - listIssues(owner, repo, opts?)
//      - getIssue(owner, repo, number)
//      - createIssue(owner, repo, opts)
//      - updateIssue(owner, repo, number, opts)
//      - addIssueComment(owner, repo, number, body)
//
//   3. Pull Requests
//      - listPullRequests(owner, repo, opts?)
//      - getPullRequest(owner, repo, number)
//      - createPullRequest(owner, repo, opts)
//      - mergePullRequest(owner, repo, number, opts)
//      - requestReview(owner, repo, number, reviewers)
//
//   4. Reviews
//      - listReviews(owner, repo, pullNumber)
//      - createReview(owner, repo, pullNumber, opts)
//      - dismissReview(owner, repo, pullNumber, reviewId, message)
//
//   5. Branches
//      - listBranches(owner, repo)
//      - getBranch(owner, repo, branch)
//      - createBranch(owner, repo, opts)        (via git.createRef)
//      - deleteBranch(owner, repo, branch)       (refuses default branch)
//      - protectBranch(owner, repo, branch, opts?)
//
//   6. Commits
//      - listCommits(owner, repo, opts?)
//      - getCommit(owner, repo, sha)
//      - compareCommits(owner, repo, base, head)
//
//   7. Actions Status
//      - listWorkflowRuns(owner, repo, opts?)
//      - getWorkflowRun(owner, repo, runId)
//      - rerunWorkflow(owner, repo, runId)
//      - listWorkflowJobs(owner, repo, runId)
//      - downloadWorkflowLogs(owner, repo, runId)
//
//   8. Release Management
//      - listReleases(owner, repo, opts?)
//      - getLatestRelease(owner, repo)
//      - getRelease(owner, repo, releaseId)
//      - createRelease(owner, repo, opts)
//      - deleteRelease(owner, repo, releaseId)    (also deletes the tag)
//      - uploadReleaseAsset(owner, repo, releaseId, opts)
//
//   Plus:
//      - createGitHubClient(token?)        — authenticated Octokit factory
//      - getRepositorySnapshot(owner, repo) — orchestrator combining 1+2+3+6+7
//      - formatGitHubResult(result)        — bilingual string formatter
//      - githubCache { get, set, clear }   — 60-second TTL GET cache
//      - clearGitHubCache()                — convenience cache flush
//
// Style reference: src/lib/verification/os.ts (bilingual Arabic + English).
// All user-facing strings are bilingual. All API calls are wrapped in try/catch
// and return structured { ok: true, data } | { ok: false, error } results
// rather than throwing, except for the token-missing precondition in
// createGitHubClient (which throws a bilingual Error so it fails fast at setup).

import { Octokit } from "@octokit/rest"
import { RequestError } from "@octokit/request-error"

// ---------------------------------------------------------------------------
// Section 0 — Shared types (errors, results, cache)
// ---------------------------------------------------------------------------

/**
 * Structured GitHub error. `error` is a machine-readable code (snake_case),
 * `status` is the HTTP status (if applicable), `message` is bilingual
 * (Arabic + English) human-readable text.
 */
export interface GitHubError {
  /** Machine-readable error code, e.g. "rate_limited", "not_found", "auth_failed". */
  error: string
  /** HTTP status code from the GitHub API, when available. */
  status?: number
  /** Bilingual (Arabic + English) human-readable error message. */
  message: string
}

/**
 * Discriminated union result wrapper. Every public operation returns either
 * `{ ok: true, data }` on success or `{ ok: false, error }` on failure.
 * This avoids try/catch at call sites and makes error handling explicit.
 */
export type GitHubResult<T> = { ok: true; data: T } | { ok: false; error: GitHubError }

/** Build a success result. */
function ok<T>(data: T): GitHubResult<T> {
  return { ok: true, data }
}

/** Build a failure result from a raw error code + bilingual message. */
function fail(error: string, message: string, status?: number): GitHubResult<never> {
  return { ok: false, error: { error, message, status } }
}

/** Build a failure result from a pre-built GitHubError object. */
function failError(err: GitHubError): GitHubResult<never> {
  return { ok: false, error: err }
}

/**
 * Convert any thrown value into a structured GitHubError. Handles Octokit
 * RequestError (with status + headers), rate-limit detection, and generic
 * Error objects.
 */
function toGitHubError(e: unknown): GitHubError {
  // Rate-limit detection: 403 + X-RateLimit-Remaining: 0
  if (e instanceof RequestError) {
    const remaining = (e.response?.headers as Record<string, string> | undefined)?.["x-ratelimit-remaining"]
    if (e.status === 403 && remaining === "0") {
      return {
        error: "rate_limited",
        status: 403,
        message:
          "❌ تم تجاوز حد المعدل لـ GitHub API. أضف توكن GITHUB_TOKEN أو انتظر قبل إعادة المحاولة. " +
          "/ GitHub API rate limit exceeded. Add a GITHUB_TOKEN or wait before retrying.",
      }
    }
    if (e.status === 401 || e.status === 403) {
      return {
        error: "auth_failed",
        status: e.status,
        message:
          `❌ فشل المصادقة (${e.status}). تحقق من توكن GITHUB_TOKEN. ` +
          `/ Authentication failed (${e.status}). Check your GITHUB_TOKEN. ` +
          `(${e.message})`,
      }
    }
    if (e.status === 404) {
      return {
        error: "not_found",
        status: 404,
        message:
          "❌ غير موجود (404). تحقق من المالك/المستودع/الرقم. " +
          `/ Not found (404). Check owner/repo/number. (${e.message})`,
      }
    }
    if (e.status === 422) {
      return {
        error: "validation_failed",
        status: 422,
        message:
          "❌ فشل التحقق (422). المدخلات غير صالحة أو المورد موجود بالفعل. " +
          `/ Validation failed (422). Invalid input or resource already exists. (${e.message})`,
      }
    }
    return {
      error: "http_error",
      status: e.status,
      message:
        `❌ خطأ HTTP ${e.status} من GitHub. / GitHub HTTP error ${e.status}. (${e.message})`,
    }
  }
  if (e instanceof Error) {
    return {
      error: "unknown",
      message: `❌ خطأ غير متوقع: ${e.message} / Unexpected error: ${e.message}`,
    }
  }
  return {
    error: "unknown",
    message: `❌ خطأ غير معروف / Unknown error: ${String(e)}`,
  }
}

// ---------------------------------------------------------------------------
// Section 1 — Repository Browser types
// ---------------------------------------------------------------------------

export interface RepositoryInfo {
  name: string
  fullName: string
  description: string | null
  defaultBranch: string
  stars: number
  forks: number
  openIssuesCount: number
  language: string | null
  license: string | null
  createdAt: string
  updatedAt: string
  homepage: string | null
  htmlUrl: string
}

export interface Repo {
  name: string
  fullName: string
  description: string | null
  private: boolean
  stars: number
  forks: number
  language: string | null
  updatedAt: string
  htmlUrl: string
  defaultBranch: string
}

// ---------------------------------------------------------------------------
// Section 2 — Issues types
// ---------------------------------------------------------------------------

export interface Issue {
  number: number
  title: string
  state: "open" | "closed"
  author: string
  labels: string[]
  assignees: string[]
  createdAt: string
  body: string | null
  commentCount: number
  htmlUrl: string
}

export interface ListIssuesOptions {
  state?: "open" | "closed" | "all"
  labels?: string[]
  assignee?: string
  /** Max items to return (default 30, max 100). */
  limit?: number
}

export interface CreateIssueOptions {
  title: string
  body?: string
  labels?: string[]
  assignees?: string[]
  milestone?: number
}

export interface UpdateIssueOptions {
  title?: string
  body?: string
  state?: "open" | "closed"
  labels?: string[]
  assignees?: string[]
  milestone?: number | null
}

// ---------------------------------------------------------------------------
// Section 3 — Pull Requests types
// ---------------------------------------------------------------------------

export interface PullRequest {
  number: number
  title: string
  state: "open" | "closed"
  author: string
  head: string
  base: string
  draft: boolean
  mergeable: boolean | null
  additions: number
  deletions: number
  changedFiles: number
  commits: number
  createdAt: string
  updatedAt: string
  htmlUrl: string
}

export interface ListPullRequestsOptions {
  state?: "open" | "closed" | "all"
  sort?: "created" | "updated" | "popularity" | "long-running"
  direction?: "asc" | "desc"
  limit?: number
}

export interface CreatePullRequestOptions {
  title: string
  head: string
  base: string
  body?: string
  draft?: boolean
  maintainerCanModify?: boolean
}

export interface MergePullRequestOptions {
  commitTitle?: string
  commitMessage?: string
  /** "merge" | "squash" | "rebase" — default "merge". */
  method?: "merge" | "squash" | "rebase"
  sha?: string
}

// ---------------------------------------------------------------------------
// Section 4 — Reviews types
// ---------------------------------------------------------------------------

export interface Review {
  id: number
  user: string
  state: string
  body: string | null
  submittedAt: string | null
}

export interface CreateReviewOptions {
  /** "APPROVE" | "REQUEST_CHANGES" | "COMMENT" — default "COMMENT". */
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"
  body?: string
  comments?: Array<{ path: string; position: number; body: string }>
}

// ---------------------------------------------------------------------------
// Section 5 — Branches types
// ---------------------------------------------------------------------------

export interface Branch {
  name: string
  lastCommitSha: string
  protected: boolean
  ahead: number
  behind: number
}

export interface CreateBranchOptions {
  name: string
  /** SHA or ref to branch from (default: repo's default branch). */
  from?: string
}

export interface ProtectBranchOptions {
  /** Required status checks before merge. */
  requiredStatusChecks?: string[]
  /** Required approving reviews count (default 1). */
  requiredApprovingReviewCount?: number
  /** Enforce admins too (default true). */
  enforceAdmins?: boolean
}

// ---------------------------------------------------------------------------
// Section 6 — Commits types
// ---------------------------------------------------------------------------

export interface Commit {
  sha: string
  message: string
  author: string
  date: string
  verified: boolean
}

export interface ListCommitsOptions {
  sha?: string
  path?: string
  /** ISO 8601 date string. */
  since?: string
  /** ISO 8601 date string. */
  until?: string
  limit?: number
}

export interface CommitComparison {
  aheadBy: number
  behindBy: number
  commits: Array<{ sha: string; message: string; author: string }>
  files: Array<{ filename: string; status: string; additions: number; deletions: number }>
  totalAdditions: number
  totalDeletions: number
}

// ---------------------------------------------------------------------------
// Section 7 — Actions / Workflows types
// ---------------------------------------------------------------------------

export interface WorkflowRun {
  id: number
  name: string
  status: string | null
  conclusion: string | null
  branch: string
  event: string
  htmlUrl: string
  createdAt: string
  updatedAt: string
}

export interface ListWorkflowRunsOptions {
  status?: "queued" | "in_progress" | "completed"
  event?: string
  branch?: string
  limit?: number
}

export interface WorkflowJob {
  id: number
  name: string
  status: string | null
  conclusion: string | null
  steps: Array<{ name: string; status: string | null; conclusion: string | null }>
}

// ---------------------------------------------------------------------------
// Section 8 — Releases types
// ---------------------------------------------------------------------------

export interface ReleaseAsset {
  name: string
  downloadCount: number
  size: number
  downloadUrl: string | null
}

export interface Release {
  id: number
  tagName: string
  name: string | null
  draft: boolean
  prerelease: boolean
  author: string
  publishedAt: string | null
  body: string | null
  assets: ReleaseAsset[]
  htmlUrl: string
}

export interface ListReleasesOptions {
  limit?: number
}

export interface CreateReleaseOptions {
  tagName: string
  name?: string
  body?: string
  targetCommitish?: string
  draft?: boolean
  prerelease?: boolean
}

export interface UploadReleaseAssetOptions {
  name: string
  /** Asset content as string or ArrayBuffer. */
  data: string | ArrayBuffer
  label?: string
}

// ---------------------------------------------------------------------------
// Section 9 — In-memory cache (60-second TTL for GET operations)
// ---------------------------------------------------------------------------

/**
 * Simple in-memory cache for GET operations (list/get calls). TTL is 60
 * seconds by default. Mutating operations (create/update/delete/merge) MUST
 * NOT read from or write to this cache — they always hit the live API.
 *
 * Implementation: a `Map<string, { data: unknown; expiresAt: number }>`
 * keyed by a deterministic string built from the operation name + args.
 */
export interface GitHubCache {
  /** Retrieve a cached value, or `null` if absent or expired. */
  get<T>(key: string): T | null
  /** Store a value with optional TTL in ms (default 60_000). */
  set<T>(key: string, data: T, ttlMs?: number): void
  /** Remove all entries. */
  clear(): void
  /** Current number of live entries (including not-yet-evicted expired ones). */
  readonly size: number
}

interface CacheEntry {
  data: unknown
  expiresAt: number
}

const DEFAULT_TTL_MS = 60_000
const _cacheStore = new Map<string, CacheEntry>()

export const githubCache: GitHubCache = {
  get<T>(key: string): T | null {
    const entry = _cacheStore.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      _cacheStore.delete(key)
      return null
    }
    return entry.data as T
  },
  set<T>(key: string, data: T, ttlMs: number = DEFAULT_TTL_MS): void {
    _cacheStore.set(key, { data, expiresAt: Date.now() + ttlMs })
  },
  clear(): void {
    _cacheStore.clear()
  },
  get size(): number {
    return _cacheStore.size
  },
}

/**
 * Flush the GitHub GET cache. Call this after a mutating operation if you
 * need subsequent reads to reflect the change immediately.
 */
export function clearGitHubCache(): void {
  githubCache.clear()
}

/** Build a deterministic cache key from a tag + JSON-serialisable args. */
function cacheKey(tag: string, args: unknown): string {
  try {
    return `${tag}:${JSON.stringify(args)}`
  } catch {
    return `${tag}:${String(args)}`
  }
}

// ---------------------------------------------------------------------------
// Section 10 — Client factory
// ---------------------------------------------------------------------------

/**
 * Create an authenticated Octokit instance.
 *
 * @param token Optional GitHub personal access token. If omitted, falls back
 *             to `process.env.GITHUB_TOKEN`. If neither is set, throws a
 *             bilingual Error so the caller fails fast at setup time.
 * @returns A configured `Octokit` instance with REST + paginate methods.
 */
export function createGitHubClient(token?: string): Octokit {
  const resolved = token || process.env.GITHUB_TOKEN
  if (!resolved) {
    throw new Error("❌ رمز GITHUB_TOKEN مفقود / GITHUB_TOKEN env var missing")
  }
  return new Octokit({ auth: resolved })
}

/**
 * Lazily-build singleton Octokit for the current process. Used internally so
 * each operation doesn't pay the construction cost on every call. Callers that
 * need a fresh client (e.g. with a different token) should use
 * `createGitHubClient(token)` directly.
 */
let _sharedClient: Octokit | null = null
function sharedClient(): Octokit {
  if (!_sharedClient) {
    _sharedClient = createGitHubClient()
  }
  return _sharedClient
}

// ---------------------------------------------------------------------------
// Section 11 — Group 1: Repository Browser
// ---------------------------------------------------------------------------

/**
 * Browse a repository's top-level metadata: name, description, default branch,
 * stars, forks, open issues count, language, license, dates, homepage.
 * Result is cached for 60 seconds.
 */
export async function browseRepository(
  owner: string,
  repo: string
): Promise<GitHubResult<RepositoryInfo>> {
  const key = cacheKey("browseRepository", { owner, repo })
  const cached = githubCache.get<RepositoryInfo>(key)
  if (cached) return ok(cached)
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.repos.get({ owner, repo })
    const r = res.data
    const info: RepositoryInfo = {
      name: r.name,
      fullName: r.full_name,
      description: r.description ?? null,
      defaultBranch: r.default_branch,
      stars: r.stargazers_count ?? 0,
      forks: r.forks_count ?? 0,
      openIssuesCount: r.open_issues_count ?? 0,
      language: r.language ?? null,
      license: r.license?.name ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      homepage: r.homepage || null,
      htmlUrl: r.html_url,
    }
    githubCache.set(key, info)
    return ok(info)
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * List repositories for a user (or the authenticated user if `username` is
 * omitted). Result is cached for 60 seconds.
 */
export async function listUserRepos(
  username?: string
): Promise<GitHubResult<Repo[]>> {
  const key = cacheKey("listUserRepos", { username })
  const cached = githubCache.get<Repo[]>(key)
  if (cached) return ok(cached)
  try {
    const octokit = sharedClient()
    const res = username
      ? await octokit.rest.repos.listForUser({ username, per_page: 100, sort: "updated" })
      : await octokit.rest.repos.listForAuthenticatedUser({ per_page: 100, sort: "updated" })
    const repos: Repo[] = res.data.map((r) => ({
      name: r.name,
      fullName: r.full_name,
      description: r.description ?? null,
      private: r.private ?? false,
      stars: r.stargazers_count ?? 0,
      forks: r.forks_count ?? 0,
      language: r.language ?? null,
      updatedAt: r.updated_at,
      htmlUrl: r.html_url,
      defaultBranch: r.default_branch,
    }))
    githubCache.set(key, repos)
    return ok(repos)
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

// ---------------------------------------------------------------------------
// Section 12 — Group 2: Issues
// ---------------------------------------------------------------------------

/**
 * List issues (PRs are excluded by GitHub's `issues` API when `pull_request`
 * is set on the item). Supports filtering by state, labels, assignee, and a
 * `limit` (default 30, max 100). Result is cached for 60 seconds.
 */
export async function listIssues(
  owner: string,
  repo: string,
  opts: ListIssuesOptions = {}
): Promise<GitHubResult<Issue[]>> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100)
  const args = { owner, repo, state: opts.state ?? "open", labels: opts.labels, assignee: opts.assignee, limit }
  const key = cacheKey("listIssues", args)
  const cached = githubCache.get<Issue[]>(key)
  if (cached) return ok(cached)
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: opts.state ?? "open",
      labels: opts.labels?.join(",") || undefined,
      assignee: opts.assignee,
      per_page: limit,
      sort: "updated",
      direction: "desc",
    })
    const issues: Issue[] = res.data
      .filter((it) => !it.pull_request)
      .map((it) => ({
        number: it.number,
        title: it.title,
        state: (it.state as "open" | "closed") ?? "open",
        author: it.user?.login ?? "unknown",
        labels: (it.labels ?? [])
          .map((l) => (typeof l === "string" ? l : l.name))
          .filter((n): n is string => Boolean(n)),
        assignees: (it.assignees ?? []).map((a) => a.login).filter(Boolean),
        createdAt: it.created_at,
        body: it.body ?? null,
        commentCount: it.comments ?? 0,
        htmlUrl: it.html_url,
      }))
      .slice(0, limit)
    githubCache.set(key, issues)
    return ok(issues)
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * Get a single issue by number. Result is cached for 60 seconds.
 */
export async function getIssue(
  owner: string,
  repo: string,
  number: number
): Promise<GitHubResult<Issue>> {
  const key = cacheKey("getIssue", { owner, repo, number })
  const cached = githubCache.get<Issue>(key)
  if (cached) return ok(cached)
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.issues.get({ owner, repo, issue_number: number })
    const it = res.data
    const issue: Issue = {
      number: it.number,
      title: it.title,
      state: (it.state as "open" | "closed") ?? "open",
      author: it.user?.login ?? "unknown",
      labels: (it.labels ?? [])
        .map((l) => (typeof l === "string" ? l : l.name))
        .filter((n): n is string => Boolean(n)),
      assignees: (it.assignees ?? []).map((a) => a.login).filter(Boolean),
      createdAt: it.created_at,
      body: it.body ?? null,
      commentCount: it.comments ?? 0,
      htmlUrl: it.html_url,
    }
    githubCache.set(key, issue)
    return ok(issue)
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * Create a new issue. Mutating — bypasses the cache and clears the listIssues
 * cache for this repo (best-effort) so the next list reflects the new entry.
 */
export async function createIssue(
  owner: string,
  repo: string,
  opts: CreateIssueOptions
): Promise<GitHubResult<Issue>> {
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.issues.create({
      owner,
      repo,
      title: opts.title,
      body: opts.body,
      labels: opts.labels,
      assignees: opts.assignees,
      milestone: opts.milestone,
    })
    const it = res.data
    clearGitHubCache()
    return ok({
      number: it.number,
      title: it.title,
      state: (it.state as "open" | "closed") ?? "open",
      author: it.user?.login ?? "unknown",
      labels: (it.labels ?? [])
        .map((l) => (typeof l === "string" ? l : l.name))
        .filter((n): n is string => Boolean(n)),
      assignees: (it.assignees ?? []).map((a) => a.login).filter(Boolean),
      createdAt: it.created_at,
      body: it.body ?? null,
      commentCount: it.comments ?? 0,
      htmlUrl: it.html_url,
    })
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * Update an existing issue (title, body, state, labels, assignees, milestone).
 * Mutating — clears the cache.
 */
export async function updateIssue(
  owner: string,
  repo: string,
  number: number,
  opts: UpdateIssueOptions
): Promise<GitHubResult<Issue>> {
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.issues.update({
      owner,
      repo,
      issue_number: number,
      title: opts.title,
      body: opts.body,
      state: opts.state,
      labels: opts.labels,
      assignees: opts.assignees,
      milestone: opts.milestone ?? undefined,
    })
    const it = res.data
    clearGitHubCache()
    return ok({
      number: it.number,
      title: it.title,
      state: (it.state as "open" | "closed") ?? "open",
      author: it.user?.login ?? "unknown",
      labels: (it.labels ?? [])
        .map((l) => (typeof l === "string" ? l : l.name))
        .filter((n): n is string => Boolean(n)),
      assignees: (it.assignees ?? []).map((a) => a.login).filter(Boolean),
      createdAt: it.created_at,
      body: it.body ?? null,
      commentCount: it.comments ?? 0,
      htmlUrl: it.html_url,
    })
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * Add a comment to an issue (or PR — GitHub's issues API serves both).
 * Returns the created comment's URL. Mutating — bypasses the cache.
 */
export async function addIssueComment(
  owner: string,
  repo: string,
  number: number,
  body: string
): Promise<GitHubResult<{ id: number; htmlUrl: string; createdAt: string }>> {
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: number,
      body,
    })
    return ok({
      id: res.data.id,
      htmlUrl: res.data.html_url,
      createdAt: res.data.created_at,
    })
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

// ---------------------------------------------------------------------------
// Section 13 — Group 3: Pull Requests
// ---------------------------------------------------------------------------

/**
 * List pull requests on a repository. Supports state/sort/direction/limit.
 * Result is cached for 60 seconds.
 */
export async function listPullRequests(
  owner: string,
  repo: string,
  opts: ListPullRequestsOptions = {}
): Promise<GitHubResult<PullRequest[]>> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100)
  const args = {
    owner,
    repo,
    state: opts.state ?? "open",
    sort: opts.sort ?? "updated",
    direction: opts.direction ?? "desc",
    limit,
  }
  const key = cacheKey("listPullRequests", args)
  const cached = githubCache.get<PullRequest[]>(key)
  if (cached) return ok(cached)
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.pulls.list({
      owner,
      repo,
      state: opts.state ?? "open",
      sort: opts.sort ?? "updated",
      direction: opts.direction ?? "desc",
      per_page: limit,
    })
    // pulls.list doesn't include additions/deletions/commits/mergeable — fetch
    // those lazily only when the caller asks for a single PR (getPullRequest).
    const prs: PullRequest[] = res.data.slice(0, limit).map((p) => ({
      number: p.number,
      title: p.title,
      state: (p.state as "open" | "closed") ?? "open",
      author: p.user?.login ?? "unknown",
      head: p.head?.ref ?? "",
      base: p.base?.ref ?? "",
      draft: p.draft ?? false,
      mergeable: null,
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      commits: 0,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      htmlUrl: p.html_url,
    }))
    githubCache.set(key, prs)
    return ok(prs)
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * Get a single PR including the rich fields (mergeable, additions, deletions,
 * changedFiles, commits) that the list endpoint omits. Cached for 60 seconds.
 */
export async function getPullRequest(
  owner: string,
  repo: string,
  number: number
): Promise<GitHubResult<PullRequest>> {
  const key = cacheKey("getPullRequest", { owner, repo, number })
  const cached = githubCache.get<PullRequest>(key)
  if (cached) return ok(cached)
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.pulls.get({ owner, repo, pull_number: number })
    const p = res.data
    const pr: PullRequest = {
      number: p.number,
      title: p.title,
      state: (p.state as "open" | "closed") ?? "open",
      author: p.user?.login ?? "unknown",
      head: p.head?.ref ?? "",
      base: p.base?.ref ?? "",
      draft: p.draft ?? false,
      mergeable: p.mergeable === null ? null : Boolean(p.mergeable),
      additions: p.additions ?? 0,
      deletions: p.deletions ?? 0,
      changedFiles: p.changed_files ?? 0,
      commits: p.commits ?? 0,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      htmlUrl: p.html_url,
    }
    githubCache.set(key, pr)
    return ok(pr)
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * Create a new pull request. Mutating — clears the cache.
 */
export async function createPullRequest(
  owner: string,
  repo: string,
  opts: CreatePullRequestOptions
): Promise<GitHubResult<PullRequest>> {
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.pulls.create({
      owner,
      repo,
      title: opts.title,
      head: opts.head,
      base: opts.base,
      body: opts.body,
      draft: opts.draft ?? false,
      maintainer_can_modify: opts.maintainerCanModify ?? true,
    })
    const p = res.data
    clearGitHubCache()
    return ok({
      number: p.number,
      title: p.title,
      state: (p.state as "open" | "closed") ?? "open",
      author: p.user?.login ?? "unknown",
      head: p.head?.ref ?? "",
      base: p.base?.ref ?? "",
      draft: p.draft ?? false,
      mergeable: null,
      additions: p.additions ?? 0,
      deletions: p.deletions ?? 0,
      changedFiles: p.changed_files ?? 0,
      commits: p.commits ?? 0,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      htmlUrl: p.html_url,
    })
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * Merge a pull request. `method` defaults to "merge". Mutating — clears cache.
 */
export async function mergePullRequest(
  owner: string,
  repo: string,
  number: number,
  opts: MergePullRequestOptions = {}
): Promise<GitHubResult<{ merged: boolean; sha: string; message: string }>> {
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.pulls.merge({
      owner,
      repo,
      pull_number: number,
      commit_title: opts.commitTitle,
      commit_message: opts.commitMessage,
      method: opts.method ?? "merge",
      sha: opts.sha,
    })
    clearGitHubCache()
    return ok({
      merged: res.data.merged ?? true,
      sha: res.data.sha ?? "",
      message: res.data.message ?? "merged",
    })
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * Request reviewers on a pull request. Mutating — bypasses cache.
 */
export async function requestReview(
  owner: string,
  repo: string,
  number: number,
  reviewers: string[]
): Promise<GitHubResult<{ requestedReviewers: string[]; requestedTeams: string[] }>> {
  if (!reviewers || reviewers.length === 0) {
    return fail("validation_failed", "❌ لا مراجعين محددين / no reviewers specified")
  }
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.pulls.requestReviewers({
      owner,
      repo,
      pull_number: number,
      reviewers,
    })
    return ok({
      requestedReviewers: (res.data.requested_reviewers ?? []).map((u) => u.login),
      requestedTeams: (res.data.requested_teams ?? []).map((t) => t.name),
    })
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

// ---------------------------------------------------------------------------
// Section 14 — Group 4: Reviews
// ---------------------------------------------------------------------------

/**
 * List reviews on a pull request. Cached for 60 seconds.
 */
export async function listReviews(
  owner: string,
  repo: string,
  pullNumber: number
): Promise<GitHubResult<Review[]>> {
  const key = cacheKey("listReviews", { owner, repo, pullNumber })
  const cached = githubCache.get<Review[]>(key)
  if (cached) return ok(cached)
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.pulls.listReviews({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    })
    const reviews: Review[] = res.data.map((rv) => ({
      id: rv.id,
      user: rv.user?.login ?? "unknown",
      state: rv.state ?? "UNKNOWN",
      body: rv.body ?? null,
      submittedAt: rv.submitted_at ?? null,
    }))
    githubCache.set(key, reviews)
    return ok(reviews)
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * Create a review on a pull request (APPROVE / REQUEST_CHANGES / COMMENT).
 * Mutating — bypasses cache.
 */
export async function createReview(
  owner: string,
  repo: string,
  pullNumber: number,
  opts: CreateReviewOptions
): Promise<GitHubResult<{ id: number; state: string; htmlUrl: string }>> {
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: pullNumber,
      event: opts.event,
      body: opts.body,
      comments: opts.comments?.map((c) => ({
        path: c.path,
        position: c.position,
        body: c.body,
      })),
    })
    return ok({
      id: res.data.id,
      state: res.data.state ?? opts.event,
      htmlUrl: res.data.html_url,
    })
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * Dismiss a previously-submitted review. Mutating — bypasses cache.
 */
export async function dismissReview(
  owner: string,
  repo: string,
  pullNumber: number,
  reviewId: number,
  message: string
): Promise<GitHubResult<{ id: number; state: string }>> {
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.pulls.dismissReview({
      owner,
      repo,
      pull_number: pullNumber,
      review_id: reviewId,
      message,
    })
    return ok({
      id: res.data.id,
      state: res.data.state ?? "DISMISSED",
    })
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

// ---------------------------------------------------------------------------
// Section 15 — Group 5: Branches
// ---------------------------------------------------------------------------

/**
 * List branches on a repository with last commit SHA, protected flag, and
 * ahead/behind counts (relative to the default branch). Cached 60s.
 */
export async function listBranches(
  owner: string,
  repo: string
): Promise<GitHubResult<Branch[]>> {
  const key = cacheKey("listBranches", { owner, repo })
  const cached = githubCache.get<Branch[]>(key)
  if (cached) return ok(cached)
  try {
    const octokit = sharedClient()
    const repoRes = await octokit.rest.repos.get({ owner, repo })
    const defaultBranch = repoRes.data.default_branch

    const res = await octokit.rest.repos.listBranches({
      owner,
      repo,
      per_page: 100,
    })

    const branches: Branch[] = await Promise.all(
      res.data.map(async (b) => {
        let ahead = 0
        let behind = 0
        if (b.name !== defaultBranch && b.commit?.sha) {
          try {
            const cmp = await octokit.rest.repos.compareCommits({
              owner,
              repo,
              base: defaultBranch,
              head: b.commit.sha,
            })
            ahead = cmp.data.ahead_by ?? 0
            behind = cmp.data.behind_by ?? 0
          } catch {
            // best-effort: leave ahead/behind at 0 on failure
          }
        }
        return {
          name: b.name,
          lastCommitSha: b.commit?.sha ?? "",
          protected: b.protected ?? false,
          ahead,
          behind,
        }
      })
    )
    githubCache.set(key, branches)
    return ok(branches)
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * Get a single branch. Cached 60 seconds.
 */
export async function getBranch(
  owner: string,
  repo: string,
  branch: string
): Promise<GitHubResult<Branch>> {
  const key = cacheKey("getBranch", { owner, repo, branch })
  const cached = githubCache.get<Branch>(key)
  if (cached) return ok(cached)
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.repos.getBranch({ owner, repo, branch })
    const b = res.data
    const result: Branch = {
      name: b.name,
      lastCommitSha: b.commit?.sha ?? "",
      protected: b.protected ?? false,
      ahead: 0,
      behind: 0,
    }
    githubCache.set(key, result)
    return ok(result)
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * Create a new branch via `git.createRef` (refs/heads/{name}) pointing at the
 * SHA resolved from `from` (defaults to the repo's default branch HEAD).
 * Mutating — clears the cache.
 */
export async function createBranch(
  owner: string,
  repo: string,
  opts: CreateBranchOptions
): Promise<GitHubResult<Branch>> {
  try {
    const octokit = sharedClient()
    let fromSha = opts.from
    if (!fromSha) {
      const repoRes = await octokit.rest.repos.get({ owner, repo })
      const defaultBranch = repoRes.data.default_branch
      const branchRes = await octokit.rest.repos.getBranch({ owner, repo, branch: defaultBranch })
      fromSha = branchRes.data.commit?.sha
    }
    if (!fromSha) {
      return fail(
        "validation_failed",
        "❌ تعذّر تحديد SHA الأساسي للفرع الجديد / could not resolve base SHA for new branch"
      )
    }
    const res = await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${opts.name}`,
      sha: fromSha,
    })
    clearGitHubCache()
    return ok({
      name: opts.name,
      lastCommitSha: res.data.object?.sha ?? fromSha,
      protected: false,
      ahead: 0,
      behind: 0,
    })
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * Delete a branch (via `git.deleteRef`). Refuses to delete the default branch
 * for safety. Mutating — clears the cache.
 */
export async function deleteBranch(
  owner: string,
  repo: string,
  branch: string
): Promise<GitHubResult<{ deleted: boolean; branch: string }>> {
  try {
    const octokit = sharedClient()
    const repoRes = await octokit.rest.repos.get({ owner, repo })
    if (branch === repoRes.data.default_branch) {
      return fail(
        "refused_default_branch",
        `❌ رفض حذف الفرع الافتراضي "${branch}" / refused to delete default branch "${branch}"`
      )
    }
    await octokit.rest.git.deleteRef({ owner, repo, ref: `heads/${branch}` })
    clearGitHubCache()
    return ok({ deleted: true, branch })
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * Apply branch protection rules. Uses a permissive default (require 1 approving
 * review + enforce admins) unless overridden via `opts`. Mutating — clears cache.
 */
export async function protectBranch(
  owner: string,
  repo: string,
  branch: string,
  opts: ProtectBranchOptions = {}
): Promise<GitHubResult<{ protected: boolean; branch: string }>> {
  try {
    const octokit = sharedClient()
    await octokit.rest.repos.updateBranchProtection({
      owner,
      repo,
      branch,
      required_status_checks: opts.requiredStatusChecks
        ? { strict: true, contexts: opts.requiredStatusChecks }
        : null,
      enforce_admins: opts.enforceAdmins ?? true,
      required_pull_request_reviews: {
        dismiss_stale_reviews: true,
        require_code_owner_reviews: false,
        required_approving_review_count: opts.requiredApprovingReviewCount ?? 1,
      },
      restrictions: null,
    })
    clearGitHubCache()
    return ok({ protected: true, branch })
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

// ---------------------------------------------------------------------------
// Section 16 — Group 6: Commits
// ---------------------------------------------------------------------------

/**
 * List commits on a repository, optionally filtered by sha/path/since/until.
 * Cached for 60 seconds.
 */
export async function listCommits(
  owner: string,
  repo: string,
  opts: ListCommitsOptions = {}
): Promise<GitHubResult<Commit[]>> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100)
  const args = {
    owner,
    repo,
    sha: opts.sha,
    path: opts.path,
    since: opts.since,
    until: opts.until,
    limit,
  }
  const key = cacheKey("listCommits", args)
  const cached = githubCache.get<Commit[]>(key)
  if (cached) return ok(cached)
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.repos.listCommits({
      owner,
      repo,
      sha: opts.sha,
      path: opts.path,
      since: opts.since,
      until: opts.until,
      per_page: limit,
    })
    const commits: Commit[] = res.data.slice(0, limit).map((c) => ({
      sha: c.sha,
      message: c.commit?.message ?? "",
      author: c.commit?.author?.name ?? c.author?.login ?? "unknown",
      date: c.commit?.author?.date ?? c.commit?.committer?.date ?? "",
      verified: Boolean(c.commit?.verification?.verified),
    }))
    githubCache.set(key, commits)
    return ok(commits)
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * Get a single commit (including stats). Cached 60 seconds.
 */
export async function getCommit(
  owner: string,
  repo: string,
  sha: string
): Promise<GitHubResult<Commit & { additions: number; deletions: number; totalFiles: number }>> {
  const key = cacheKey("getCommit", { owner, repo, sha })
  const cached = githubCache.get<Commit & { additions: number; deletions: number; totalFiles: number }>(key)
  if (cached) return ok(cached)
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.repos.getCommit({ owner, repo, ref: sha })
    const c = res.data
    const commit: Commit & { additions: number; deletions: number; totalFiles: number } = {
      sha: c.sha,
      message: c.commit?.message ?? "",
      author: c.commit?.author?.name ?? c.author?.login ?? "unknown",
      date: c.commit?.author?.date ?? c.commit?.committer?.date ?? "",
      verified: Boolean(c.commit?.verification?.verified),
      additions: c.stats?.additions ?? 0,
      deletions: c.stats?.deletions ?? 0,
      totalFiles: c.files?.length ?? 0,
    }
    githubCache.set(key, commit)
    return ok(commit)
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * Compare two commits (base vs head). Returns ahead/behind counts, the
 * commits in between, and per-file diff stats. Cached 60 seconds.
 */
export async function compareCommits(
  owner: string,
  repo: string,
  base: string,
  head: string
): Promise<GitHubResult<CommitComparison>> {
  const key = cacheKey("compareCommits", { owner, repo, base, head })
  const cached = githubCache.get<CommitComparison>(key)
  if (cached) return ok(cached)
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.repos.compareCommits({ owner, repo, base, head })
    const d = res.data
    const files = (d.files ?? []).map((f) => ({
      filename: f.filename ?? "",
      status: f.status ?? "modified",
      additions: f.additions ?? 0,
      deletions: f.deletions ?? 0,
    }))
    const comparison: CommitComparison = {
      aheadBy: d.ahead_by ?? 0,
      behindBy: d.behind_by ?? 0,
      commits: (d.commits ?? []).map((c) => ({
        sha: c.sha,
        message: c.commit?.message ?? "",
        author: c.commit?.author?.name ?? c.author?.login ?? "unknown",
      })),
      files,
      totalAdditions: files.reduce((acc, f) => acc + f.additions, 0),
      totalDeletions: files.reduce((acc, f) => acc + f.deletions, 0),
    }
    githubCache.set(key, comparison)
    return ok(comparison)
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

// ---------------------------------------------------------------------------
// Section 17 — Group 7: Actions Status
// ---------------------------------------------------------------------------

/**
 * List GitHub Actions workflow runs. Filterable by status/event/branch.
 * Cached 60 seconds.
 */
export async function listWorkflowRuns(
  owner: string,
  repo: string,
  opts: ListWorkflowRunsOptions = {}
): Promise<GitHubResult<WorkflowRun[]>> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100)
  const args = {
    owner,
    repo,
    status: opts.status,
    event: opts.event,
    branch: opts.branch,
    limit,
  }
  const key = cacheKey("listWorkflowRuns", args)
  const cached = githubCache.get<WorkflowRun[]>(key)
  if (cached) return ok(cached)
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      status: opts.status,
      event: opts.event,
      branch: opts.branch,
      per_page: limit,
    })
    const runs: WorkflowRun[] = (res.data.workflow_runs ?? []).slice(0, limit).map((r) => ({
      id: r.id,
      name: r.name ?? r.display_title ?? "(unnamed)",
      status: r.status ?? null,
      conclusion: r.conclusion ?? null,
      branch: r.head_branch ?? "",
      event: r.event ?? "",
      htmlUrl: r.html_url ?? "",
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))
    githubCache.set(key, runs)
    return ok(runs)
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * Get a single workflow run by ID. Cached 60 seconds.
 */
export async function getWorkflowRun(
  owner: string,
  repo: string,
  runId: number
): Promise<GitHubResult<WorkflowRun>> {
  const key = cacheKey("getWorkflowRun", { owner, repo, runId })
  const cached = githubCache.get<WorkflowRun>(key)
  if (cached) return ok(cached)
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.actions.getWorkflowRun({ owner, repo, run_id: runId })
    const r = res.data
    const run: WorkflowRun = {
      id: r.id,
      name: r.name ?? r.display_title ?? "(unnamed)",
      status: r.status ?? null,
      conclusion: r.conclusion ?? null,
      branch: r.head_branch ?? "",
      event: r.event ?? "",
      htmlUrl: r.html_url ?? "",
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }
    githubCache.set(key, run)
    return ok(run)
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * Re-run a workflow. Mutating — bypasses cache.
 */
export async function rerunWorkflow(
  owner: string,
  repo: string,
  runId: number
): Promise<GitHubResult<{ rerun: boolean; runId: number }>> {
  try {
    const octokit = sharedClient()
    await octokit.rest.actions.reRunWorkflow({ owner, repo, run_id: runId })
    return ok({ rerun: true, runId })
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * List jobs for a workflow run, including per-step status + conclusion.
 * Cached 60 seconds.
 */
export async function listWorkflowJobs(
  owner: string,
  repo: string,
  runId: number
): Promise<GitHubResult<WorkflowJob[]>> {
  const key = cacheKey("listWorkflowJobs", { owner, repo, runId })
  const cached = githubCache.get<WorkflowJob[]>(key)
  if (cached) return ok(cached)
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.actions.listJobsForWorkflowRun({
      owner,
      repo,
      run_id: runId,
    })
    const jobs: WorkflowJob[] = (res.data.jobs ?? []).map((j) => ({
      id: j.id,
      name: j.name ?? "(unnamed job)",
      status: j.status ?? null,
      conclusion: j.conclusion ?? null,
      steps: (j.steps ?? []).map((s) => ({
        name: s.name ?? "",
        status: s.status ?? null,
        conclusion: s.conclusion ?? null,
      })),
    }))
    githubCache.set(key, jobs)
    return ok(jobs)
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * Download workflow run logs. Returns the redirect URL that the GitHub API
 * hands back (the actual zip download is left to the caller — fetching it
 * requires following a redirect to a short-lived S3 URL). Not cached.
 */
export async function downloadWorkflowLogs(
  owner: string,
  repo: string,
  runId: number
): Promise<GitHubResult<{ url: string; note: string }>> {
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.actions.downloadWorkflowRunLogs({
      owner,
      repo,
      run_id: runId,
    })
    // The endpoint returns a 302 redirect to an S3 URL; Octokit follows it
    // transparently and `res.url` contains the final download location.
    const url = (res as unknown as { url?: string }).url || ""
    return ok({
      url,
      note:
        "رابط تنزيل مؤقت (صالح لمدة قصيرة). استخدمه مباشرةً. " +
        "Temporary download URL (short-lived). Use it directly.",
    })
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

// ---------------------------------------------------------------------------
// Section 18 — Group 8: Release Management
// ---------------------------------------------------------------------------

/**
 * List releases on a repository (newest first). Cached 60 seconds.
 */
export async function listReleases(
  owner: string,
  repo: string,
  opts: ListReleasesOptions = {}
): Promise<GitHubResult<Release[]>> {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 100)
  const key = cacheKey("listReleases", { owner, repo, limit })
  const cached = githubCache.get<Release[]>(key)
  if (cached) return ok(cached)
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.repos.listReleases({ owner, repo, per_page: limit })
    const releases: Release[] = res.data.slice(0, limit).map((r) => ({
      id: r.id,
      tagName: r.tag_name,
      name: r.name ?? null,
      draft: r.draft ?? false,
      prerelease: r.prerelease ?? false,
      author: r.author?.login ?? "unknown",
      publishedAt: r.published_at ?? null,
      body: r.body ?? null,
      assets: (r.assets ?? []).map((a) => ({
        name: a.name,
        downloadCount: a.download_count ?? 0,
        size: a.size ?? 0,
        downloadUrl: a.browser_download_url ?? null,
      })),
      htmlUrl: r.html_url,
    }))
    githubCache.set(key, releases)
    return ok(releases)
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * Get the latest non-prerelease, non-draft release. Cached 60 seconds.
 */
export async function getLatestRelease(
  owner: string,
  repo: string
): Promise<GitHubResult<Release>> {
  const key = cacheKey("getLatestRelease", { owner, repo })
  const cached = githubCache.get<Release>(key)
  if (cached) return ok(cached)
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.repos.getLatestRelease({ owner, repo })
    const r = res.data
    const release: Release = {
      id: r.id,
      tagName: r.tag_name,
      name: r.name ?? null,
      draft: r.draft ?? false,
      prerelease: r.prerelease ?? false,
      author: r.author?.login ?? "unknown",
      publishedAt: r.published_at ?? null,
      body: r.body ?? null,
      assets: (r.assets ?? []).map((a) => ({
        name: a.name,
        downloadCount: a.download_count ?? 0,
        size: a.size ?? 0,
        downloadUrl: a.browser_download_url ?? null,
      })),
      htmlUrl: r.html_url,
    }
    githubCache.set(key, release)
    return ok(release)
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * Get a single release by ID. Cached 60 seconds.
 */
export async function getRelease(
  owner: string,
  repo: string,
  releaseId: number
): Promise<GitHubResult<Release>> {
  const key = cacheKey("getRelease", { owner, repo, releaseId })
  const cached = githubCache.get<Release>(key)
  if (cached) return ok(cached)
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.repos.getRelease({ owner, repo, release_id: releaseId })
    const r = res.data
    const release: Release = {
      id: r.id,
      tagName: r.tag_name,
      name: r.name ?? null,
      draft: r.draft ?? false,
      prerelease: r.prerelease ?? false,
      author: r.author?.login ?? "unknown",
      publishedAt: r.published_at ?? null,
      body: r.body ?? null,
      assets: (r.assets ?? []).map((a) => ({
        name: a.name,
        downloadCount: a.download_count ?? 0,
        size: a.size ?? 0,
        downloadUrl: a.browser_download_url ?? null,
      })),
      htmlUrl: r.html_url,
    }
    githubCache.set(key, release)
    return ok(release)
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * Create a new release. Mutating — clears the cache.
 */
export async function createRelease(
  owner: string,
  repo: string,
  opts: CreateReleaseOptions
): Promise<GitHubResult<Release>> {
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.repos.createRelease({
      owner,
      repo,
      tag_name: opts.tagName,
      name: opts.name,
      body: opts.body,
      target_commitish: opts.targetCommitish,
      draft: opts.draft ?? false,
      prerelease: opts.prerelease ?? false,
    })
    const r = res.data
    clearGitHubCache()
    return ok({
      id: r.id,
      tagName: r.tag_name,
      name: r.name ?? null,
      draft: r.draft ?? false,
      prerelease: r.prerelease ?? false,
      author: r.author?.login ?? "unknown",
      publishedAt: r.published_at ?? null,
      body: r.body ?? null,
      assets: (r.assets ?? []).map((a) => ({
        name: a.name,
        downloadCount: a.download_count ?? 0,
        size: a.size ?? 0,
        downloadUrl: a.browser_download_url ?? null,
      })),
      htmlUrl: r.html_url,
    })
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * Delete a release AND its tag. Mutating — clears the cache.
 */
export async function deleteRelease(
  owner: string,
  repo: string,
  releaseId: number
): Promise<GitHubResult<{ deleted: boolean; releaseId: number; tagDeleted: boolean; tagName?: string }>> {
  try {
    const octokit = sharedClient()
    // Fetch the release first so we know the tag name to delete afterwards.
    const relRes = await octokit.rest.repos.getRelease({ owner, repo, release_id: releaseId })
    const tagName = relRes.data.tag_name
    await octokit.rest.repos.deleteRelease({ owner, repo, release_id: releaseId })
    let tagDeleted = false
    try {
      await octokit.rest.git.deleteRef({ owner, repo, ref: `tags/${tagName}` })
      tagDeleted = true
    } catch {
      // best-effort: tag may have been deleted already or never existed
      tagDeleted = false
    }
    clearGitHubCache()
    return ok({ deleted: true, releaseId, tagDeleted, tagName })
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

/**
 * Upload an asset to an existing release. `data` is the file content as a
 * string or ArrayBuffer. Mutating — bypasses cache.
 */
export async function uploadReleaseAsset(
  owner: string,
  repo: string,
  releaseId: number,
  opts: UploadReleaseAssetOptions
): Promise<GitHubResult<{ id: number; name: string; downloadUrl: string; size: number }>> {
  if (!opts.name) {
    return fail("validation_failed", "❌ اسم الأصل مطلوب / asset name is required")
  }
  try {
    const octokit = sharedClient()
    const res = await octokit.rest.repos.uploadReleaseAsset({
      owner,
      repo,
      release_id: releaseId,
      name: opts.name,
      label: opts.label,
      // Octokit expects `data` as string | ArrayBuffer; the underlying fetch
      // will encode it appropriately.
      data: opts.data as string,
    })
    return ok({
      id: res.data.id,
      name: res.data.name,
      downloadUrl: res.data.browser_download_url ?? "",
      size: res.data.size ?? 0,
    })
  } catch (e) {
    return failError(toGitHubError(e))
  }
}

// ---------------------------------------------------------------------------
// Section 19 — Orchestrator: getRepositorySnapshot
// ---------------------------------------------------------------------------

/**
 * Snapshot of "where is this repo at right now" — combines browseRepository
 * + open issues count + open PRs count + recent commits + last workflow run
 * into a single result. Each sub-call is independent: a failure in one does
 * not abort the others; partial snapshots are returned with the failed
 * sub-fields marked `error`.
 *
 * Not cached directly (it composes cached operations, so it benefits from
 * their cache).
 */
export interface RepositorySnapshot {
  repository: RepositoryInfo | { error: string }
  openIssuesCount: number | { error: string }
  openPullRequestsCount: number | { error: string }
  recentCommits: Commit[] | { error: string }
  lastWorkflowRun: WorkflowRun | null | { error: string }
  generatedAt: string
}

/**
 * Combine browseRepository + open issues + open PRs + recent commits + last
 * workflow run into a single "where is this repo at" view. Each sub-call
 * is independent; failures are captured per-field, not propagated.
 */
export async function getRepositorySnapshot(
  owner: string,
  repo: string
): Promise<GitHubResult<RepositorySnapshot>> {
  const [repoRes, issuesRes, prsRes, commitsRes, runsRes] = await Promise.all([
    browseRepository(owner, repo),
    listIssues(owner, repo, { state: "open", limit: 1 }),
    listPullRequests(owner, repo, { state: "open", limit: 1 }),
    listCommits(owner, repo, { limit: 5 }),
    listWorkflowRuns(owner, repo, { limit: 1 }),
  ])

  const snapshot: RepositorySnapshot = {
    repository: repoRes.ok ? repoRes.data : { error: repoRes.error.message },
    // listIssues already excludes PRs; but the count from browseRepository
    // (open_issues_count) is the canonical headline number — prefer it when
    // available, fall back to the issues list length otherwise.
    openIssuesCount: repoRes.ok
      ? repoRes.data.openIssuesCount
      : issuesRes.ok
      ? issuesRes.data.length
      : { error: issuesRes.error.message },
    openPullRequestsCount: prsRes.ok ? prsRes.data.length : { error: prsRes.error.message },
    recentCommits: commitsRes.ok ? commitsRes.data : { error: commitsRes.error.message },
    lastWorkflowRun: runsRes.ok
      ? runsRes.data.length > 0
        ? runsRes.data[0]
        : null
      : { error: runsRes.error.message },
    generatedAt: new Date().toISOString(),
  }

  return ok(snapshot)
}

// ---------------------------------------------------------------------------
// Section 20 — Formatter: formatGitHubResult
// ---------------------------------------------------------------------------

/**
 * Format any GitHubResult into a bilingual (Arabic + English) string suitable
 * for the agent loop to read. Handles arrays (rendered as bullet lists),
 * objects (key-value), errors (bilingual error block), and primitives
 * (truncated).
 *
 * @param result Any GitHubResult<T> from the operations above, or a raw value.
 * @returns A bilingual string. Arabic first, then English, separated by " / ".
 */
export function formatGitHubResult(result: unknown): string {
  // Case: GitHubResult<T> shape (ok:true/false)
  if (typeof result === "object" && result !== null && "ok" in result) {
    const r = result as { ok: boolean; data?: unknown; error?: GitHubError }
    if (!r.ok) {
      const err = r.error
      return (
        `❌ خطأ / Error\n` +
        `الكود / Code: ${err?.error ?? "unknown"}\n` +
        `الحالة / Status: ${err?.status ?? "n/a"}\n` +
        `الرسالة / Message: ${err?.message ?? "no message"}`
      )
    }
    return formatValue(r.data)
  }
  // Case: GitHubError directly
  if (typeof result === "object" && result !== null && "error" in result && !("ok" in result)) {
    const err = result as GitHubError
    return (
      `❌ خطأ / Error\n` +
      `الكود / Code: ${err.error}\n` +
      `الحالة / Status: ${err.status ?? "n/a"}\n` +
      `الرسالة / Message: ${err.message}`
    )
  }
  return formatValue(result)
}

/** Render a single value (object/array/primitive) as a bilingual-friendly string. */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "— لا قيمة / no value —"
  }
  if (typeof value === "string") {
    return value.length > 500 ? value.slice(0, 500) + " …" : value
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "📭 القائمة فارغة / empty list"
    }
    const header = `📋 ${value.length} عنصر / ${value.length} item(s):\n`
    const body = value
      .map((item, i) => {
        if (typeof item === "object" && item !== null) {
          return `${i + 1}. ${formatObject(item as Record<string, unknown>)}`
        }
        return `${i + 1}. ${String(item)}`
      })
      .join("\n")
    return header + body
  }
  if (typeof value === "object") {
    return formatObject(value as Record<string, unknown>)
  }
  return String(value)
}

/** Render an object's key fields bilingually (best-effort, no LLM). */
function formatObject(obj: Record<string, unknown>): string {
  const lines: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue
    if (Array.isArray(v)) {
      if (v.length === 0) continue
      lines.push(`${translateKey(k)}: ${v.length} عنصر / ${v.length} items`)
      continue
    }
    if (typeof v === "object") {
      lines.push(`${translateKey(k)}: ${formatObject(v as Record<string, unknown>)}`)
      continue
    }
    lines.push(`${translateKey(k)}: ${String(v)}`)
  }
  if (lines.length === 0) {
    return "— لا حقول قابلة للعرض / no displayable fields —"
  }
  return lines.join("\n")
}

/** Map common GitHub field names to bilingual labels. */
function translateKey(key: string): string {
  const map: Record<string, string> = {
    name: "الاسم / Name",
    fullName: "الاسم الكامل / Full name",
    title: "العنوان / Title",
    state: "الحالة / State",
    status: "الحالة / Status",
    author: "المؤلف / Author",
    number: "الرقم / Number",
    stars: "النجوم / Stars",
    forks: "الفروع / Forks",
    openIssuesCount: "المشاكل المفتوحة / Open issues",
    openPullRequestsCount: "PRs المفتوحة / Open PRs",
    language: "اللغة / Language",
    license: "الرخصة / License",
    defaultBranch: "الفرع الافتراضي / Default branch",
    description: "الوصف / Description",
    createdAt: "أنشئ في / Created at",
    updatedAt: "حُدّث في / Updated at",
    publishedAt: "نُشر في / Published at",
    draft: "مسودة / Draft",
    prerelease: "قبل الإصدار / Prerelease",
    tagName: "اسم الوسم / Tag name",
    head: "الرأس / Head",
    base: "الأساس / Base",
    mergeable: "قابل للدمج / Mergeable",
    additions: "الإضافات / Additions",
    deletions: "الحذوفات / Deletions",
    changedFiles: "الملفات المتغيرة / Changed files",
    commits: "الالتزامات / Commits",
    sha: "SHA",
    message: "الرسالة / Message",
    date: "التاريخ / Date",
    verified: "موثّق / Verified",
    protected: "محمي / Protected",
    ahead: "أمام / Ahead",
    behind: "خلف / Behind",
    lastCommitSha: "آخر SHA / Last commit SHA",
    conclusion: "النتيجة / Conclusion",
    event: "الحدث / Event",
    branch: "الفرع / Branch",
    htmlUrl: "الرابط / URL",
    id: "المعرّف / ID",
    body: "المحتوى / Body",
    labels: "التصنيفات / Labels",
    assignees: "المسند إليهم / Assignees",
    commentCount: "عدد التعليقات / Comments",
    assets: "الأصول / Assets",
    steps: "الخطوات / Steps",
    recentCommits: "أحدث الالتزامات / Recent commits",
    lastWorkflowRun: "آخر تشغيل / Last run",
    repository: "المستودع / Repository",
    generatedAt: "وُلّد في / Generated at",
  }
  return map[key] ?? key
}

// ---------------------------------------------------------------------------
// Section 21 — Public re-exports
// ---------------------------------------------------------------------------

export { Octokit, RequestError }
