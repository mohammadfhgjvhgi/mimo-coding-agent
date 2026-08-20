# Task 40-b — Git Intelligence subagent

## Task
Build `src/lib/git/intelligence.ts` with 12 git operations + orchestrator + formatter.

## Output
- **File**: `/home/z/my-project/src/lib/git/intelligence.ts`
- **Lines**: 1753
- **Functions exported** (12 operations + 2 helpers + 2 utilities):
  1. `getGitStatus()`
  2. `getGitDiff(opts)`
  3. `getGitHistory(opts)`
  4. `getGitBlame(filePath, opts?)`
  5. `listBranches(opts?)`
  6. `getCheckpoints()`
  7. `listWorktrees()` + `createWorktree(path, branch)` + `removeWorktree(path)`
  8. `generateCommit(opts)`
  9. `explainCommit(hash)`
  10. `getChangeSummary(status?)`
  11. `rollback(opts)`
  12. `safeRestore(opts)`
  - Orchestrator: `analyzeGitState()`
  - Formatter: `formatGitIntelligence(result)`

## Verification
- `bun run lint`: **0 errors** (1 pre-existing warning in files-panel.tsx, unrelated)
- `npx tsc --noEmit --skipLibCheck`: **0 errors**
- Smoke test (`bun /tmp/git-smoke.ts` then deleted): **passed** — all 12 ops produce sensible output on the actual repo
- Bilingual Arabic + English throughout
- 0 LLM calls (fully deterministic)
- Composes with existing `@/lib/recovery/manager` (rollbackToCheckpoint) + `@/lib/recovery/self-repair` (saveCheckpoint, listCheckpoints)

## Key Implementation Notes
- **Porcelain v2 status**: `1` lines are space-separated (8 metadata fields + path). `2` lines split on tab for origPath. Fixed initial bug where paths came back empty (was splitting on `\t` only).
- **listBranches --format shell-escaping**: format string contains parens `(objecttype)` etc. → must `shellescape()` the value, else `/bin/sh` errors on `(`.
- **explainCommit --numstat conflict**: `--no-patch` conflicts with `--numstat`/`--name-status`. Fix: use `--format=""` to suppress body instead of `--no-patch`.
- **Blame parser**: rewrote as a single-pass line-walker that tracks current commit-block metadata and emits one `BlameLine` per `\t<content>` line (handles multi-line blocks correctly).
- **TS narrowing in generateCommit**: replaced nested ternaries (which TS narrowed to exclude unassigned union members like `fix`) with a `Record<ConventionalCommitType, string>` map lookup.

## Deviations from spec
- **None of substance.** All 12 operations, the orchestrator, and the formatter are implemented exactly as specified. The `analyzeGitState` orchestrator was made slightly more efficient by reusing the precomputed status for `getChangeSummary` (the spec said "runs getStatus + getChangeSummary + listBranches" — both interpretations produce identical observable output).
- The `GitStateAnalysis.ok` field is `boolean` (not strictly `true`), because the orchestrator intentionally returns partial results when one subcall fails (vs. the strict-discriminant pattern used for hard errors). The formatter was adjusted to handle this case (fall through to the `analyzeGitState` case even when `ok: false`).

## Composes with existing modules
- `@/lib/tools/workspace` → `WORKSPACE_ROOT` (cwd for all git commands)
- `@/lib/recovery/manager` → `rollbackToCheckpoint` (wrapped by op 11 with safety check)
- `@/lib/recovery/self-repair` → `saveCheckpoint` (used by op 12 mode="checkpoint"), `listCheckpoints` (re-exported by op 6), `Checkpoint` type (re-exported)
