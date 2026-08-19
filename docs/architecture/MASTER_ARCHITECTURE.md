# MiMo AI Platform — Master Architecture (Refined 20-Subsystem)

> **Refined from 18 to 20 subsystems** after the Architecture Decision Review
> (`ARCHITECTURE_DECISION_REVIEW.md`). The two new subsystems — Workspace
> File System (L19) and Preview Runtime (L20) — are load-bearing additions
> for real software engineering. Without them, "the AI built a project" is
> unverifiable.
>
> This document supersedes the prior 18-layer version. Per-subsystem detail
> lives in `ARCHITECTURE_DECISION_REVIEW.md`; per-tool detail in `TOOL_MATRIX.md`;
> per-agent detail in `AGENT_MATRIX.md`; per-model detail in `DATABASE_DECISION_REVIEW.md`;
> execution lifecycle in `AUTONOMOUS_EXECUTION_MODEL.md`; file operations in
> `WORKSPACE_FILE_MODEL.md`; preview/runtime in `PREVIEW_RUNTIME_MODEL.md`;
> state transitions in `FINAL_SYSTEM_BOUNDARIES.md`; dead code in `SAFE_CLEANUP_PLAN.md`.

---

## THE 20 SUBSYSTEMS

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 20. PREVIEW RUNTIME         HTML/SVG/MD/Code/Build/Runtime/Screenshot     │
├──────────────────────────────────────────────────────────────────────────┤
│ 19. WORKSPACE FILESYSTEM    read/write/edit/patch/snapshot/rollback       │
├──────────────────────────────────────────────────────────────────────────┤
│ 18. PRESENTATION            React + i18n + markdown + code editor          │
├──────────────────────────────────────────────────────────────────────────┤
│ 17. CLIENT STATE            Zustand + persist + race-safe loaders          │
├──────────────────────────────────────────────────────────────────────────┤
│ 16. CLIENT TRANSPORT        safeFetch + sse-client with resume             │
├──────────────────────────────────────────────────────────────────────────┤
│ 15. API GATEWAY             auth + rate limit + zod + CORS + v1            │
├──────────────────────────────────────────────────────────────────────────┤
│ 14. SSE STREAMING           typed events + backpressure + heartbeat        │
├──────────────────────────────────────────────────────────────────────────┤
│ 13. EXECUTION ORCHESTRATION mission loop + DAG + checkpoint + replan       │
├──────────────────────────────────────────────────────────────────────────┤
│ 12. VALIDATION              static analysis + QA agent + repair loop       │
├──────────────────────────────────────────────────────────────────────────┤
│ 11. TOOL EXECUTION          native function calling + AbortSignal          │
├──────────────────────────────────────────────────────────────────────────┤
│ 10. AGENT REGISTRY          12 consolidated agents + LLM router            │
├──────────────────────────────────────────────────────────────────────────┤
│  9. CONTEXT ASSEMBLY        token-budget + skills + tool schemas           │
├──────────────────────────────────────────────────────────────────────────┤
│  8. MODEL GATEWAY           real streaming + native tools + embeds         │
├──────────────────────────────────────────────────────────────────────────┤
│  7. MEMORY STORE            embeddings + consolidation + scope fix         │
├──────────────────────────────────────────────────────────────────────────┤
│  6. KNOWLEDGE GRAPH         DELETE (4 dead models) or implement            │
├──────────────────────────────────────────────────────────────────────────┤
│  5. ARTIFACT MANAGEMENT     versioning + diff + download + edit            │
├──────────────────────────────────────────────────────────────────────────┤
│  4. TASK LIFECYCLE & DAG    deps + failurePolicy + validationRules         │
├──────────────────────────────────────────────────────────────────────────┤
│  3. DECISION RECORDS        workflow + linking + human override            │
├──────────────────────────────────────────────────────────────────────────┤
│  2. OBSERVABILITY           traceId + cost + retention + 5 levels          │
├──────────────────────────────────────────────────────────────────────────┤
│  1. DATA PERSISTENCE        Postgres + migrations + backups                │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## STATUS AT A GLANCE

| # | Subsystem | Status | Owner file (current) | Owner file (target) |
|---|---|---|---|---|
| 1 | Data Persistence | PARTIAL | `prisma/schema.prisma`, `src/lib/db.ts` | same (Postgres) |
| 2 | Observability | PARTIAL | `src/lib/ai/runtime.ts:137-167` | `src/lib/ai/observability.ts` (new) |
| 3 | Decision Records | PARTIAL | `src/lib/ai/runtime.ts:717-740` | `src/lib/ai/decisions/service.ts` (new) |
| 4 | Task Lifecycle & DAG | WRONG LOCATION | `src/lib/ai/runtime.ts:529-764` | `src/lib/ai/tasks/` (new) |
| 5 | Artifact Management | PARTIAL | `src/lib/ai/execution-engine.ts` | `src/lib/ai/artifacts/` (new) |
| 6 | Knowledge Graph | DEAD | (schema only) | (delete) |
| 7 | Memory Store | PARTIAL (bug) | `src/lib/ai/memory.ts` | same + `memory/writer.ts` (new) |
| 8 | Model Gateway | PARTIAL | `src/lib/ai/model.ts` | same |
| 9 | Context Assembly | PARTIAL | `src/lib/ai/context.ts` | same |
| 10 | Agent Registry | PARTIAL | `src/lib/ai/agents/index.ts` | `src/lib/ai/agents/{index,router,runner}.ts` |
| 11 | Tool Execution | BROKEN | `src/lib/ai/tools/index.ts` | same + `tools/executor.ts` (new) |
| 12 | Validation | MISSING | (none) | `src/lib/ai/validation.ts` (new) |
| 13 | Execution Orchestration | WRONG LOCATION | `src/lib/ai/runtime.ts` (mixed) | `src/lib/ai/orchestrator.ts` (new) |
| 14 | SSE Streaming | PARTIAL | `src/app/api/chat/route.ts:14-16` | `src/lib/ai/sse.ts` (new) |
| 15 | API Gateway | MISSING | (none) | `src/lib/middleware.ts` (new) |
| 16 | Client Transport | PARTIAL | `src/lib/safe-fetch.ts`, `chat-panel.tsx` | `src/lib/sse-client.ts` (new) |
| 17 | Client State | PARTIAL (races) | `src/lib/mimo-store.ts` | same + persist middleware |
| 18 | Presentation | PARTIAL | `src/components/mimo/**` | same |
| 19 | Workspace Filesystem | MISSING | (none — tools hit `fs` directly) | `src/lib/workspace/` (new) |
| 20 | Preview Runtime | PARTIAL | `api/preview/[id]/route.ts`, `inline-preview.tsx` | `src/lib/preview/` (new) |

---

## ARCHITECTURAL PRINCIPLES (refined)

1. **Single source of truth** — each piece of data lives in one place (DB for server, Zustand for client, Workspace for files). No duplication. (Currently violated: Artifact content duplicated in DB + disk; Message.previewUrl client-only.)
2. **Type safety end-to-end** — remove `ignoreBuildErrors`. Zod schemas on API boundaries. Shared types in one file. (Currently violated.)
3. **Fail loud, fail early** — remove `reactStrictMode: false`. Surface errors, don't swallow them. (Currently violated.)
4. **Validate before trust** — every task output is validated before marking complete. Every API input is validated (zod) before processing. (Currently MISSING — L12.)
5. **Defense in depth** — auth + rate limit + CSP + sandbox + allowlist. Multiple layers of security. (Currently MISSING — L15.)
6. **Observability first** — every action logged with traceId. Cost tracked. Metrics dashboarded. (Currently PARTIAL — L2.)
7. **Idempotent operations** — retrying a task should not duplicate artifacts. Mission checkpoint enables resume. (Currently MISSING — L13.)
8. **Progressive enhancement** — system works without embeddings, without knowledge graph, without parallel execution. Each layer enhances, doesn't block. (Currently PARTIAL.)
9. **Explicit over implicit** — tool calls via native function calling, not regex parsing. Status transitions via explicit states, not string conventions. (Currently violated — L11.)
10. **Remove don't accumulate** — dead code, unused deps, and decorative features are deleted, not left to rot. (See `SAFE_CLEANUP_PLAN.md`.)
11. **Workspace is the only filesystem writer** — no tool calls `fs.*` directly. (NEW principle — see `WORKSPACE_FILE_MODEL.md`.)
12. **PreviewProvider is the only preview renderer** — no direct iframe `src` to artifact content except via a provider. (NEW principle — see `PREVIEW_RUNTIME_MODEL.md`.)

---

## CROSS-SUBSYSTEM CONTRACTS

### Event Flow (user sends message → response displayed)

```
L18 (ChatPanel.send)
  → L17 (startStreaming)
  → L16 (fetch /api/chat with SSE)
  → L15 (auth, rate limit, route, zod validate)
  → L14 (SSE stream start)
  → L13 (runMission or executeTask)
    → L10 (pickAgent — LLM-based, not keyword)
    → L9 (assembleContext — with tool schemas + skills)
      → L7 (retrieveMemories — semantic, scope-fixed)
    → L8 (chatStream — REAL streaming, native function calling)
      → L11 (executeTool — with AbortSignal + risk enforcement)
        → L19 (Workspace.write — records change + snapshot)
      → L7 (writeMemory — via knowledge agent, typed facts)
    → L5 (extractArtifacts — via Workspace, not direct fs)
    → L12 (validate — static analysis + QA agent + repair loop)
      → L10 (debugger agent, if repair needed)
      → L10 (developer agent, applies fix via Workspace)
    → L4 (markTaskCompleted — only after validate PASS)
    → L3 (createDecision — with status workflow)
    → L2 (logExecution — with traceId + cost)
  → L14 (SSE end event)
  → L16 (parse SSE — typed events)
  → L17 (endStreaming — race-safe)
  → L18 (render message)
```

### Artifact Flow (model emits code → preview shown)

```
L8 (model emits code block)
  → L13 (executeTask calls extractArtifacts)
  → L19 (Workspace.write — records change, creates snapshot)
  → L5 (ArtifactService.create — links to file, versioned)
    → L1 (INSERT Artifact with filePath populated)
  → L14 (send artifact event)
  → L17 (refresh artifacts list — race-safe)
  → L18 (render artifact in panel)
  → L20 (pickPreviewProvider — based on artifact type)
    → L20 (prepare session — may build, may spawn runtime)
    → L18 (iframe src = provider URL)
```

### Mission Flow (autonomous build)

```
L18 (user toggles autonomous + sends goal)
  → L13 (orchestrator.runMission)
    → L10 (requirements agent — extract requirements)
    → L10 (orchestrator — produce task DAG with deps + validation + failurePolicy)
    → L13 (scheduler — topological sort, parallel execution)
    → for each task (concurrency limit 3):
        → L4 (markTaskInProgressBar)
        → L13 (executeTask — see Event Flow above)
        → L12 (validate)
        → if FAIL:
            → L12 (repair — debugger → developer → retest, up to N retries)
            → if still FAIL:
                → L13 (escalate — orchestrator replans)
        → L4 (markTaskCompleted)
        → L13 (checkpoint — save mission state)
    → L10 (reviewer agent — goal alignment verdict)
    → L10 (documentation agent — mission summary)
    → L13 (markMissionComplete)
  → L14 (SSE end with summary + verdict + doc link)
```

---

## THE TWO NEW SUBSYSTEMS (load-bearing)

### L19. Workspace Filesystem

**Why it's a separate subsystem:**
Currently 5 tools (`file_read`, `file_write`, `patch`, `file_search`, `code_search`) and `execution-engine.ts` all call `fs.*` directly with different validation rules. Two writers can collide. `safeJoin` has a path-traversal bug. `file_read` reads `.env` and `prisma/dev.db`. No versioning. No rollback. No project boundary.

**What it owns:**
- All filesystem operations for a project.
- Path validation (single source of truth).
- Change recording (every write/edit/patch/delete/rename recorded).
- Snapshots + rollback.
- Binary file handling.
- Secret denylist.

**Contract:**
```ts
interface Workspace {
  readonly projectId: string;
  readonly root: string;
  read(relPath: string, opts?: ReadOpts): Promise<FileContent>;
  write(relPath: string, content: string | Buffer, opts?: WriteOpts): Promise<WriteResult>;
  edit(relPath: string, editSpec: EditSpec, opts?: EditOpts): Promise<EditResult>;
  patch(relPath: string, find: string, replace: string, opts?: PatchOpts): Promise<PatchResult>;
  delete(relPath: string, opts?: DeleteOpts): Promise<DeleteResult>;
  rename(oldPath: string, newPath: string, opts?: RenameOpts): Promise<RenameResult>;
  listDir(relPath: string, opts?: ListOpts): Promise<DirEntry[]>;
  searchFiles(pattern: string, opts?: SearchOpts): Promise<SearchHit[]>;
  searchCode(query: string, opts?: SearchOpts): Promise<CodeSearchHit[]>;
  snapshot(name?: string): Promise<Snapshot>;
  restore(snapshotId: string): Promise<RestoreResult>;
  listChanges(filter?: ChangeFilter): Promise<WorkspaceChange[]>;
}
```

**Files (target):** `src/lib/workspace/{index,path-validator,change-log,snapshot,search}.ts`, `prisma/schema.prisma` (add `WorkspaceChange`, `Snapshot` models).

**Status:** MISSING. See `WORKSPACE_FILE_MODEL.md` for full design.

### L20. Preview Runtime

**Why it's a separate subsystem:**
Currently `/api/preview/[id]/route.ts` serves single-file HTML/SVG/CSS/JS/JSON. Cannot build. Cannot run. Cannot capture logs. Cannot screenshot. Cannot handle multi-file sites. Cannot handle interactive apps. The `<title>` interpolation is an XSS smell.

**What it owns:**
- Choosing the right `PreviewProvider` for an artifact.
- Building (if needed).
- Spawning runtimes (if needed).
- Capturing logs/errors/screenshots.
- Sandbox + CSP enforcement.
- Lifecycle management (TTL, dispose).

**Contract:**
```ts
interface PreviewProvider {
  readonly kind: string;
  readonly supportsLiveReload: boolean;
  readonly needsRuntime: boolean;
  prepare(ctx: PreviewContext): Promise<PreviewSession>;
  getUrl(session: PreviewSession): string;
  dispose(session: PreviewSession): Promise<void>;
}
```

**Providers (11 total):**
1. `HtmlPreviewProvider` — single-file HTML
2. `SvgPreviewProvider` — SVG
3. `MarkdownPreviewProvider` — server-rendered markdown
4. `CodePreviewProvider` — syntax-highlighted code
5. `JsonPreviewProvider` — collapsible JSON tree
6. `StaticSitePreviewProvider` — multi-file static site
7. `BuildOutputPreviewProvider` — built project (Next.js, Vite, etc.)
8. `RuntimePreviewProvider` — running server (with port + logs)
9. `ScreenshotPreviewProvider` — headless browser capture
10. `LogPreviewProvider` — log viewer
11. `TestResultPreviewProvider` — test result table

**Files (target):** `src/lib/preview/{index,providers/*}.ts`, `prisma/schema.prisma` (add `Build`, `BuildLog`, `Runtime`, `RuntimeLog`, `Screenshot` models), `src/app/api/preview/[id]/route.ts` (refactor), `src/app/api/build/[id]/route.ts` (new), `src/app/api/runtime/[id]/route.ts` (new).

**Status:** PARTIAL. See `PREVIEW_RUNTIME_MODEL.md` for full design.

---

## MIGRATION STRATEGY (refined)

### Phase 1: Stabilize (P0, weeks 1-2)
- Remove `ignoreBuildErrors: true` (after fixing TS errors).
- Remove `reactStrictMode: false` (after fixing React bugs).
- Add auth (L15).
- Add rate limiting (L15).
- Fix `file_read` security (allowlist + deny secrets).
- Fix `safeJoin` prefix bug.
- Add CSP headers.
- Migrate to PostgreSQL.

### Phase 2: Fix Broken Core (P1, weeks 3-5)
- Fix tool execution (native function calling, replace `parseToolCalls`).
- Fix fake streaming (real ZAI SDK streaming or no chunking).
- Fix memory `where.OR` bug.
- Wire up memory consolidation.
- Fix race conditions in store.
- Add server-side cancellation (AbortSignal).
- Fix hardcoded counts in UI.

### Phase 3: Build Missing Layers (P2, weeks 6-8)
- Build L12 Validation Layer (static analysis + QA agent + repair loop).
- Build L19 Workspace Filesystem (replaces direct `fs.*` calls).
- Build L20 Preview Runtime (multi-provider abstraction).
- Artifact versioning + diff + download.
- Emit `validate|repair|retest|review` phases.

### Phase 4: Autonomous Loop Overhaul (P3, weeks 9-11)
- Populate task dependencies from plan.
- DAG execution with parallelism.
- Honor `failurePolicy` (retry/skip/abort/escalate).
- Mission checkpoint/resume.
- Review phase at mission end.
- Split `runtime.ts` into `orchestrator.ts` + `tasks/`.

### Phase 5: Knowledge & Memory Intelligence (P4, weeks 12-14)
- Add embeddings for semantic memory retrieval.
- Smart context truncation (summarize vs drop).
- Skills injection into context.
- (Optional) Re-implement Knowledge Graph if wanted.

### Phase 6: UX & i18n Completion (P5, weeks 15-16)
- Replace custom markdown with `react-markdown` + `remark-gfm`.
- Complete Arabic localization.
- Add client state persistence.
- Debounce skills search.
- Pagination for conversation messages.
- Wire up Toaster for errors.

### Phase 7: Polish & Observability (P6, weeks 17-18)
- Add `traceId`/`spanId` to `ExecutionLog`.
- Add cost tracking.
- Add metrics dashboard.
- Log retention policy.
- Fix `db.ts` query logging.

### Phase 8: Cleanup (parallel, weeks 1-18)
- Phase A of `SAFE_CLEANUP_PLAN.md` — immediate.
- Phase B — after verification.
- Phase C — as roadmap tasks land.
- Remove 4 dead Prisma models.
- Remove unused shadcn components.

**Total: 18 weeks to reach target architecture.**

---

## COMPARISON: CURRENT vs TARGET (refined)

| Aspect | Current | Target |
|---|---|---|
| Subsystems implemented | ~8 of 20 | 20 of 20 |
| Type safety | Disabled (`ignoreBuildErrors`) | End-to-end (Zod + TS strict) |
| Auth | None | next-auth on every route |
| Streaming | Fake (chunked non-streaming) | Real SSE with backpressure |
| Tool execution | Broken (regex never matches) | Native function calling |
| Validation | None | Static analysis + QA agent + repair |
| Memory | Keyword LIKE, no consolidation, scope bug | Embeddings + cosine + consolidation + scope-fixed |
| Knowledge graph | 4 dead models | DELETED (or properly implemented in P4) |
| Task DAG | Sequential, dependencies ignored | Topological sort, parallel execution |
| Failure handling | Always break | Policy-based (retry/skip/abort/escalate) |
| Checkpoint/resume | None | Mission table + periodic saves |
| Observability | Basic logs | Traces + metrics + cost |
| Client persistence | None | Zustand persist middleware |
| Race conditions | Multiple (3 confirmed) | None (AbortController + ID validation) |
| i18n | Partial (most panels English) | Complete (every string via `t()`) |
| Filesystem | 5 tools + 1 engine, all direct `fs.*` | Single Workspace abstraction |
| Preview | Single-file HTML only | 11 PreviewProviders |
| Unused deps | ~5-10 | 0 (Phase A) + verified (Phase B) |
| Dead code | ~121 lines + 4 dead models | 0 |

---

## REFINEMENTS FROM PRIOR 18-LAYER VERSION

1. **L19 Workspace Filesystem added** — previously implicit in L11 (Tool Execution). Now explicit because it has its own contracts (change log, snapshots, rollback, project boundary).
2. **L20 Preview Runtime added** — previously a single route in L15 (API Gateway). Now explicit because it has its own contracts (build, runtime, logs, screenshots, 11 providers).
3. **L6 Knowledge Graph** — previously "implement". Now "DELETE 4 dead models OR implement properly in P4". Decision: delete now, revisit later.
4. **L10 Agent Registry** — previously "15 agents". Now "12 consolidated agents" (merge planner → orchestrator, refactoring + database → developer, repurpose knowledge as background). See `AGENT_MATRIX.md`.
5. **L4 Task Lifecycle** — previously "honor dependencies, failurePolicy, validationRules". Now "extract to `src/lib/ai/tasks/` module; separate from L13 Orchestration".
6. **L13 Execution Orchestration** — previously "DAG + parallel + checkpoint + replan". Now "split from `runtime.ts` into `src/lib/ai/orchestrator.ts`".
7. **L12 Validation** — previously "static analysis + QA agent + repair loop". Now explicit: "the ONLY subsystem that can transition a task to `completed`".

---

## DOCUMENT MAP

| Document | Scope |
|---|---|
| `SYSTEM_AUDIT.md` | Brutal-honesty audit of current state (updated with final decisions) |
| `MASTER_ARCHITECTURE.md` | This document — 20-subsystem target |
| `MASTER_ROADMAP.md` | P0-P6 task breakdown with full specs |
| `ARCHITECTURE_DECISION_REVIEW.md` | Per-subsystem detail (20 subsystems) |
| `FINAL_SYSTEM_BOUNDARIES.md` | 11 content states and their transitions |
| `TOOL_MATRIX.md` | Per-tool detail (10 tools + 20 missing) |
| `AGENT_MATRIX.md` | Per-agent detail (15 → 12 consolidation) |
| `WORKSPACE_FILE_MODEL.md` | L19 design |
| `PREVIEW_RUNTIME_MODEL.md` | L20 design |
| `AUTONOMOUS_EXECUTION_MODEL.md` | L13 lifecycle (11 stages vs current 2) |
| `DATABASE_DECISION_REVIEW.md` | Per-model detail (12 models, 4 to remove) |
| `SAFE_CLEANUP_PLAN.md` | Dead code + unused deps classification |
