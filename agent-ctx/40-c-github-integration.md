# Task 40-c — GitHub integration subagent

## Mission
Build `src/lib/github/client.ts` — a comprehensive GitHub integration library module over Octokit with 8 operation groups, a client factory, an orchestrator, a bilingual formatter, and a 60-second TTL in-memory cache.

## What was produced
- **File**: `/home/z/my-project/src/lib/github/client.ts` (~2075 lines, 39 exports)
- **Packages installed**: `@octokit/rest@22.0.1`, `@octokit/graphql@9.0.4` (umbrella `octokit` was already present but `@octokit/rest` was not a direct dependency — spec mandated `import { Octokit } from "@octokit/rest"`)

## Architecture
- **Result type**: every public op returns `GitHubResult<T> = { ok: true, data } | { ok: false, error: GitHubError }` discriminated union (no throw at call sites)
- **Error normalisation**: `toGitHubError(e)` maps Octokit `RequestError` → typed codes (`rate_limited`, `auth_failed`, `not_found`, `validation_failed`, `http_error`) with bilingual Arabic+English messages
- **Cache**: `Map<string, { data, expiresAt }>` with 60s default TTL, exposed as `githubCache { get, set, clear, size }` + `clearGitHubCache()` convenience. GET ops use it; mutating ops clear it.
- **Token**: `createGitHubClient(token?)` throws bilingual `Error("❌ رمز GITHUB_TOKEN مفقود / GITHUB_TOKEN env var missing")` when no token + env var missing
- **Singleton**: internal `sharedClient()` lazily builds one Octokit for all ops

## 8 operation groups + sub-functions
| Group | Operations |
|---|---|
| 1. Repository Browser | `browseRepository`, `listUserRepos` |
| 2. Issues | `listIssues`, `getIssue`, `createIssue`, `updateIssue`, `addIssueComment` |
| 3. Pull Requests | `listPullRequests`, `getPullRequest`, `createPullRequest`, `mergePullRequest`, `requestReview` |
| 4. Reviews | `listReviews`, `createReview`, `dismissReview` |
| 5. Branches | `listBranches`, `getBranch`, `createBranch`, `deleteBranch`, `protectBranch` |
| 6. Commits | `listCommits`, `getCommit`, `compareCommits` |
| 7. Actions Status | `listWorkflowRuns`, `getWorkflowRun`, `rerunWorkflow`, `listWorkflowJobs`, `downloadWorkflowLogs` |
| 8. Release Management | `listReleases`, `getLatestRelease`, `getRelease`, `createRelease`, `deleteRelease`, `uploadReleaseAsset` |

Plus: `createGitHubClient`, `getRepositorySnapshot` (orchestrator combining 1+2+3+6+7 with per-field error capture), `formatGitHubResult` (bilingual string formatter), `githubCache` + `clearGitHubCache`.

## Safety
- `deleteBranch` refuses to delete the repo's default branch (`refused_default_branch` error code, bilingual message)
- `deleteRelease` also deletes the underlying git tag (best-effort)
- All `limit` parameters clamped to [1, 100]

## Verification
- `bun run lint`: **0 errors** (1 pre-existing warning in `src/components/mimo/files-panel.tsx`, unrelated)
- `npx tsc --noEmit --skipLibCheck`: **0 errors**
- Smoke test (`/tmp/github-smoke.ts`, since cleaned up): **14/14 passed** — bilingual token error, formatter on success/error/array, cache set/get/clear/TTL, full export surface (39 exports verified by name + type)

## Integration with existing code
- **No duplication**: `src/lib/ecosystem/github-tool.ts` (Task 10) still uses the umbrella `octokit` package and registers `github_get_issues` + `github_get_repo_info` in the tool registry. The new `src/lib/github/client.ts` is a standalone library layer that those tools MAY eventually be refactored to wrap, but no refactor was performed in this task (out of scope).
- **Style reference**: followed `src/lib/verification/os.ts` bilingual pattern (Arabic first, then English, " / " separator, emoji prefixes ❌/✅/📋/📭).

## Files touched
- NEW: `/home/z/my-project/src/lib/github/client.ts`
- MODIFIED: `/home/z/my-project/package.json` (added `@octokit/rest`, `@octokit/graphql`)
- MODIFIED: `/home/z/my-project/worklog.md` (appended Task 40-c section)
- TEMP (cleaned up): `/tmp/github-smoke.ts`

## Downstream call sites (for next agent)
If a future agent wants to wire the existing `github_get_issues` / `github_get_repo_info` tools to this library:
```ts
import { listIssues, browseRepository, formatGitHubResult } from "@/lib/github/client"

// inside the tool execute():
const r = await listIssues(owner, repo, { state, limit })
if (!r.ok) return fail(id, name, args, r.error.message, durationMs)
return ok(id, name, args, formatGitHubResult(r), durationMs)
```
The shared Octokit singleton (`sharedClient()`) reads `process.env.GITHUB_TOKEN`; the existing tool uses `setGithubToken(token)` from a settings-injected cache. A future refactor should unify these (e.g. pass the user's token to `createGitHubClient(token)` and store the returned Octokit in a module-level variable).
