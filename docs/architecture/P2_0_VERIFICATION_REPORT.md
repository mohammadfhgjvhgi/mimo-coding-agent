# P2-0 Tech Debt Cleanup — Verification Report

> **Scope:** Bounded P1 technical-debt cleanup only. No P2 feature work.
> **Strict files touched:** 6 (3 source + 3 test). Plus `db/custom.db` (SQLite file, modified by test executions — not source).

---

## 1. Exact Files Changed

| File | Type | Lines Changed | Nature of Change |
|------|------|---------------|------------------|
| `src/lib/ai/tools/index.ts` | Source | -15 / +3 | Dead code removal |
| `src/lib/ai/runtime.ts` | Source | -11 / +1 | Vestigial field + unused variable removal |
| `src/lib/ai/agents/index.ts` | Source | -2 / +1 | Orchestrator prompt doc fix |
| `tests/tool-calling.test.ts` | Test | -112 / +146 | Robust cleanup (setup + try/finally) |
| `tests/workspace-b1.test.ts` | Test | -2 / +2 | TS type-cast fix |
| `tests/workspace-b2.test.ts` | Test | -1 / +1 | TS type-cast fix |

**No other files modified.** `db/custom.db` appears in `git diff --stat` because test executions write to the SQLite database — this is expected and not a source-code change.

---

## 2. Exact Dead Code / Type / Test-Hygiene Items Fixed

### Item 1: Dead code in `tools/index.ts` (P1 tech-debt #1)
**Removed:**
- `import { promises as fs } from "fs"` (line 5) — no longer used after dead code removal
- `import path from "path"` (line 6) — no longer used after dead code removal
- `const SANDBOX_ROOT = "/home/z/my-project"` (line 13) — duplicate of `WorkspaceService.SANDBOX_ROOT`
- `const UPLOAD_DIR = path.join(SANDBOX_ROOT, "upload")` (line 14) — duplicate of `WorkspaceService.UPLOAD_DIR`
- `async function ensureUploadDir()` (lines 16-22) — never called; `WorkspaceService.ensureWorkspaceDirs()` is the canonical directory-ensurance path

**Verification:** Grep confirmed `fs.` and `path.` were only referenced by the dead code. WorkspaceService owns the canonical constants (`workspace.ts:24-27`) and the `ensureWorkspaceDirs()` function (`workspace.ts:600-608`).

### Item 2: Vestigial `executionOrder` field (P1 tech-debt #3)
**Removed from `runtime.ts`:**
- `"executionOrder": [0, 1, 2]` line from the `planSchema` string (line 578)
- `executionOrder: number[]` from the `plan` type annotation (line 586)
- `executionOrder: [0]` from the fallback plan object (line 620)

**Removed from `agents/index.ts`:**
- `"executionOrder": [0, 1, 2, ...]` line from the orchestrator's PLANNING MODE prompt
- Added `"dependencies": [0, 1]` to the task object in the prompt (was missing — the prompt didn't mention dependencies even though the runtime schema included them)

**Verification:** Grep confirmed `plan.executionOrder` is NEVER read anywhere in `src/lib/ai/`. The field was set in 3 places (schema string, type, fallback) and never accessed. The runtime uses `TaskGraphService.getReadyTasks()` for execution ordering, not `executionOrder`. The autonomous smoke test confirmed the model still produces valid plans with dependencies after the removal.

### Item 3: Unused `topoOrder` variable (P1 tech-debt #2)
**Removed from `runtime.ts`:**
- `const topoOrder = getTopologicalOrder(graph)` (line 702) — computed but only used in a log message
- `getTopologicalOrder` import (line 36) — no longer needed
- `type TaskGraph` import (line 37) — unused type annotation
- `type TaskNode` import (line 38) — unused type annotation
- Shortened the log message to remove the `, topo order: N nodes` suffix

**Verification:** Grep confirmed `getTopologicalOrder`, `TaskGraph`, and `TaskNode` were only referenced in the removed lines. The `getTopologicalOrder` function itself remains in `task-graph.ts` (it's part of the TaskGraphService API and is tested by `task-graph-p1d.test.ts` tests 10 and 11) — only the unused import was removed.

### Item 4: TypeScript type error in `workspace-b1.test.ts:214` (P1 tech-debt #5)
**Before:**
```ts
const data = result.data as { results: Array<{ file: string }> };
const envFound = data.results.some((r) => r.path?.includes(".env") || r.file?.includes(".env"));
```
**After:**
```ts
const data = result.data as { results: Array<{ file: string; path?: string }> };
const envFound = data.results.some((r) => (r.path ?? r.file ?? "").includes(".env"));
```
**Fix:** The cast declared `file` as required but `path` as absent, yet the code accessed `r.path`. Added `path?: string` to the cast and used nullish coalescing to produce a clean `boolean` (not `boolean | undefined`).

### Item 5: TypeScript type error in `workspace-b2.test.ts:68` (P1 tech-debt #5)
**Before:**
```ts
assert(result.error?.includes("denied") || result.error?.includes("blocked"), "...");
```
**After:**
```ts
assert((result.error ?? "").includes("denied") || (result.error ?? "").includes("blocked"), "...");
```
**Fix:** `result.error?.includes(...)` returns `boolean | undefined`, but `assert` expects `boolean`. Using `(result.error ?? "").includes(...)` guarantees a `boolean` return.

### Item 6: Fragile test cleanup in `tool-calling.test.ts` (P1 tech-debt #4)
**Problem:** Tests 15, 16, 18, 19 created conversations and deleted them at the end. If any assertion failed (or the process crashed) before reaching `prisma.conversation.delete`, the conversation + its memories leaked. Because `Memory.conversationId` uses `onDelete: SetNull`, deleting a conversation orphans its memories (sets `conversationId = null`). The `retrieveMemories` function returns memories where `conversationId IS NULL` (treating them as "global"), so stale orphaned memories with test markers caused test 18 to fail spuriously on subsequent runs.

**Fix — two-layer robustness:**

1. **`setup()` function at top of file** (runs before any test): deletes all `Memory` rows whose `content` contains known test markers, and all `Conversation` rows whose `title` contains known test conversation titles. This makes the test suite hermetic — it cleans up prior failed runs before executing.

2. **`try/finally` wrappers on tests 15, 16, 18, 19**: the conversation deletion now runs in a `finally` block, so cleanup ALWAYS executes even if an assertion throws. The `.catch(() => {})` on each delete prevents a failed cleanup from masking the real test failure.

**Verification:** Injected a stale memory row manually, then ran the test suite — `setup()` cleaned it and all 57 assertions passed. Ran the suite twice consecutively — both runs passed 57/57. The test suite is now self-cleaning.

---

## 3. Test Count and Result

| Suite | Assertions | Result |
|-------|-----------|--------|
| `tests/tool-calling.test.ts` (P1-A) | 57 | ✅ ALL PASS |
| `tests/workspace-b1.test.ts` (P1-B B1) | 75 | ✅ ALL PASS |
| `tests/workspace-b2.test.ts` (P1-B B2) | 54 | ✅ ALL PASS |
| `tests/workspace-b3.test.ts` (P1-B B3) | 41 | ✅ ALL PASS |
| `tests/validation-p1c.test.ts` (P1-C) | 46 | ✅ ALL PASS |
| `tests/task-graph-p1d.test.ts` (P1-D) | 79 | ✅ ALL PASS |
| `tests/task-graph-integration-p1e.test.ts` (P1-E) | 53 | ✅ ALL PASS |
| **TOTAL** | **405** | **✅ ALL PASS** |

**Stability verification:** Ran `tool-calling.test.ts` twice consecutively — both runs 57/57. Injected a stale memory row between runs — `setup()` cleaned it and the test still passed.

---

## 4. Build / Type-Check Result

| Check | Command | Result |
|-------|---------|--------|
| TypeScript type-check | `bunx tsc --noEmit` | ✅ **0 errors** (clean exit, no output) |

**Before P2-0:** 2 TypeScript errors in test files (`workspace-b1.test.ts:214`, `workspace-b2.test.ts:68`).
**After P2-0:** 0 errors across the entire codebase (source + tests).

Note: `bun run build` is not run per project rules (`next.config.ts` has `ignoreBuildErrors` and the system instruction forbids `bun run build`). `tsc --noEmit` is the equivalent verification.

---

## 5. Lint Result

| Check | Command | Result |
|-------|---------|--------|
| ESLint | `bun run lint` | ✅ **0 errors, 0 warnings** |

---

## 6. Confirmation That Production Behavior Is Unchanged

| Verification | Method | Result |
|--------------|--------|--------|
| Dev server health | `curl http://localhost:3000/` | ✅ HTTP 200 |
| Simple chat API | `POST /api/chat` "What is 7+5?" | ✅ Returns "7+5 = 12" with validation decision event (5/5 checks passed) |
| Autonomous mission API | `POST /api/chat` autonomous landing-page mission | ✅ 1/1 tasks completed, 1 artifact created, validation decisions emitted, tool events emitted |
| Task.dependencies persistence | DB inspection after autonomous run | ✅ `deps=[]` for single-task mission (correct) |
| Graph-based execution | Event stream analysis | ✅ `task` events (planned, starting, completed), `decision` events (validation), `tool` events, `artifact` events all present |
| Orchestrator planning | Plan schema no longer includes `executionOrder` | ✅ Model still produces valid plans with `dependencies` field |

**Behavioral changes: NONE.**
- The removed `executionOrder` field was never read by runtime code — it was a vestigial schema field.
- The removed `topoOrder` variable was only used in a log message — no functional impact.
- The removed dead code (`SANDBOX_ROOT`, `UPLOAD_DIR`, `ensureUploadDir`) was never called.
- The test fixes (type casts, cleanup robustness) do not change what the tests assert — only how they clean up after themselves.

---

## 7. Confirmation That No P2 Feature Work Started

| P2 Task | Started? | Evidence |
|---------|----------|----------|
| P2-1 Project Workspace | ❌ NO | No changes to `workspace.ts`, no new `validateProjectPath`, no project directory creation in `/api/projects` |
| P2-2 File Tree UI | ❌ NO | No new `file-tree.tsx` component, no `/api/workspace/tree` route |
| P2-3 Multi-File Gen | ❌ NO | No changes to `execution-engine.ts`, no `projectId` parameter added to `executeResponse` |
| P2-4 Code Editor | ❌ NO | No new `code-editor.tsx` component |
| P2-5 File Versioning | ❌ NO | No Prisma schema changes, no `ProjectFile`/`FileVersion` models, no version recording in `WorkspaceService.write()` |
| P2-6 Diff Viewer | ❌ NO | No new `diff-viewer.tsx` component |

**Files NOT touched (verified via `git diff --name-only`):**
- `prisma/schema.prisma` — no migration
- `src/lib/ai/workspace.ts` — no architectural changes
- `src/lib/ai/tool-caller.ts` — no changes
- `src/lib/ai/validation.ts` — no changes
- `src/lib/ai/task-graph.ts` — no changes
- `src/lib/ai/execution-engine.ts` — no changes
- `src/lib/ai/memory.ts` — no changes
- `src/lib/ai/model.ts` — no changes
- `src/lib/ai/context.ts` — no changes
- Any UI component — no changes
- Any API route — no changes
- Any mini-service — no changes

---

## 8. P1 Tech-Debt Triage Status (from P1 Final Gate §10)

| # | Tech-Debt Item | Disposition | Status |
|---|----------------|-------------|--------|
| 1 | Dead code in `tools/index.ts:13-22` | Fix in P2-0 | ✅ **FIXED** |
| 2 | Unused `topoOrder` in `runtime.ts:702` | Fix in P2-0 | ✅ **FIXED** |
| 3 | Vestigial `executionOrder` in schema + prompt | Fix in P2-0 | ✅ **FIXED** |
| 4 | Fragile test cleanup in `tool-calling.test.ts` test 18 | Fix in P2-0 | ✅ **FIXED** |
| 5 | TS type errors in `workspace-b1.test.ts:214` and `workspace-b2.test.ts:68` | Fix in P2-0 | ✅ **FIXED** |
| 6 | No E2E/integration tests | Fix opportunistically in P2 | ⏳ DEFERRED (P2 feature work) |
| 7 | Sequential task execution | Defer to P4 | ⏳ DEFERRED (P4-4) |
| 8 | Cycle fallback to linear | By design | ⏳ ACCEPTED |

**5 of 8 items fixed in P2-0. 3 deferred (by design).**

---

## 9. P2-0 Gate Decision

| Criterion | Verdict |
|-----------|---------|
| Only allowed files touched | ✅ |
| Only dead code / type fixes / test hygiene | ✅ |
| No architectural modification | ✅ |
| No P2 feature work introduced | ✅ |
| All 405 existing assertions pass | ✅ |
| Lint clean (0 errors) | ✅ |
| TypeScript clean (0 errors, source + tests) | ✅ |
| Production behavior unchanged | ✅ |
| Autonomous execution verified end-to-end | ✅ |
| Test suite hermetic (self-cleaning) | ✅ |

### **P2-0: ✅ PASS**

P2-0 is complete. The codebase is now clean of the identified P1 technical debt. `tsc --noEmit` is fully clean (source + tests). The test suite is hermetic — prior failed runs can no longer pollute subsequent runs.

**Stopping here. Awaiting explicit approval to proceed to P2-1 (Project Workspace Directory).**
