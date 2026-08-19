# Implementation Master Plan

> READ-ONLY planning document. No source code modified.
> Based on actual source code inspection + Architecture Decision Review + research validation.

---

## Executive Summary

The MiMo AI Platform is a demoable prototype with 7,507 LOC across 99 files. The chat loop works, file creation works, HTML preview works. However: tools are dead code, no validation exists, memory has a retrieval bug, race conditions corrupt state, TypeScript errors are silenced, and 3 DB models are orphaned.

This plan converts the architecture into 7 phases (P0-P6) with 46 concrete implementation tasks, explicit dependency graph, approval gates, and migration strategy.

---

## What Changed From Previous Roadmap

### Rejected Recommendations
1. **REJECTED**: "Replace parseToolCalls with ZAI SDK function-calling" — ZAI SDK v0.0.18 does NOT expose a function-calling API. Must use post-response intent detection or two-phase model call instead.
2. **REJECTED**: "Remove KnowledgeEntity/KnowledgeRelation immediately" — Research ADRs reference knowledge graph architecture. Keep as future foundation, document as unused.
3. **REJECTED**: "Merge agents in P0" — Agent consolidation requires contracts first. Moved to P6.
4. **REJECTED**: "Run Z.ai fullstack init script" — Project is ALREADY initialized (Caddyfile, .zscripts, z-ai-web-dev-sdk present). Running the script risks overwriting existing work.

### Modified Recommendations
1. **MODIFIED**: "Fix ignoreBuildErrors" — Moved from P0 to P0 BUT with caveat: must fix ALL type errors first, which may require significant effort. Split into P0-1a (assess) and P0-1b (fix + disable).
2. **MODIFIED**: "Implement WorkspaceService" — Changed from "create new layer" to "wrap existing tools with compatibility bridge" to avoid big-bang rewrite.
3. **MODIFIED**: "Real tool calling" — Changed from "use SDK function-calling" to "two-phase model call" since SDK doesn't support native function-calling.

---

## Phase Summary

| Phase | Name | Tasks | Duration | Risk |
|-------|------|-------|----------|------|
| P0 | Foundation/Safety/Correctness | 8 | 1-2 weeks | Low-Medium |
| P1 | Canonical Tool + Workspace | 7 | 2-3 weeks | Medium |
| P2 | Real Project Engineering | 6 | 3-4 weeks | Medium |
| P3 | Validation/Build/Test/Runtime | 6 | 2-3 weeks | Medium-High |
| P4 | Autonomous Engineering | 5 | 2-3 weeks | High |
| P5 | Advanced UX | 5 | 2-3 weeks | Low |
| P6 | Optimization/Hardening | 5 | 1-2 weeks | Low |

---

## Critical State Model

### States (never collapse these)

| State | Owner | Current Status |
|-------|-------|----------------|
| GENERATED TEXT | Model Layer → Message.content | ✅ Exists |
| GENERATED CODE | Execution Engine (extractCodeBlocks) | ✅ Exists |
| CREATED FILE | Execution Engine → /upload/ | ✅ Exists |
| MODIFIED FILE | File Tools (patch) | ⚠️ Partial (patch only, no versioning) |
| PROJECT FILE | Workspace Layer | ❌ Missing |
| ARTIFACT | Execution Engine → Artifact DB | ✅ Exists |
| BUILT PROJECT | Runtime Layer | ❌ Missing |
| TESTED PROJECT | Runtime Layer | ❌ Missing |
| VALIDATED PROJECT | Validation Layer | ❌ Missing |
| EXECUTED PROJECT | Runtime Layer | ❌ Missing |
| RUNNING APPLICATION | Runtime Layer | ❌ Missing |
| LIVE PREVIEW | Preview Layer | ⚠️ Partial (HTML only) |

### Allowed Transitions
```
TEXT → CODE → FILE → ARTIFACT → PREVIEW (current, works)
FILE → MODIFIED → VERSIONED → DIFF → REVERT (missing)
FILE → PROJECT_FILE → BUILD → TEST → VALIDATE → EXECUTE → RUN → PREVIEW (missing)
```

---

## Subsystem Implementation Boundaries

### 1. Model Layer
- **Existing**: `src/lib/ai/model.ts` — ZAI SDK wrapper, fake streaming, retry logic
- **Target**: Real streaming (if SDK supports), model registry, fallback chain
- **Migration**: Wrap existing functions, add model registry, test streaming
- **New files**: None (modify existing)
- **DB changes**: None
- **Tests**: Verify chat returns content, streaming yields deltas, retry handles 429

### 2. Context Layer
- **Existing**: `src/lib/ai/context.ts` — history + memories + agent prompt
- **Target**: Add project context, file context, research context, decision context
- **Migration**: Extend assembleContext with optional project/files parameters
- **New files**: None (modify existing)
- **DB changes**: None
- **Tests**: Verify context includes project files when projectId provided

### 3. Memory Layer
- **Existing**: `src/lib/ai/memory.ts` — 9-type store, keyword search, where.OR bug
- **Target**: Fix bug, add consolidation, project-scoped memories
- **Migration**: Fix where.OR → use AND for conversationId, OR for keywords within scope
- **New files**: None (modify existing)
- **DB changes**: None (projectId field already exists)
- **Tests**: Create memory in conv A, retrieve in conv B → should NOT see A's memories

### 4. Knowledge Layer
- **Existing**: 3 Prisma models (KnowledgeEntity, KnowledgeRelation, KnowledgeEntry) — all orphaned or empty
- **Target**: Implement entity extraction + graph queries (P3) OR remove (decision needed)
- **Migration**: None in P0. Document as "future foundation"
- **New files**: `src/lib/ai/knowledge.ts` (P3)
- **DB changes**: None
- **Tests**: N/A (not implemented)

### 5. Conversation Layer
- **Existing**: Fully functional CRUD + search + pin + rename + delete
- **Target**: Keep as-is. Add conversation branching (P5)
- **Migration**: None
- **Tests**: Verify CRUD, search, pin, rename, delete all work

### 6. Project Layer
- **Existing**: `src/app/api/projects/` — CRUD works, no workspace
- **Target**: Add workspace directory, file tree, project-scoped context
- **Migration**: Add workspace creation on project create
- **New files**: `src/lib/ai/workspace.ts`, `src/components/mimo/file-tree.tsx`
- **DB changes**: ProjectFile, FileVersion models (P2)
- **Tests**: Create project → verify workspace dir exists

### 7. Workspace Layer
- **Existing**: DOES NOT EXIST. file_write goes to flat /upload/
- **Target**: WorkspaceService with project-scoped directories, path validation, versioning
- **Migration**: Wrap existing file tools with WorkspaceService calls (compatibility bridge)
- **New files**: `src/lib/ai/workspace.ts`
- **DB changes**: ProjectFile, FileVersion (P2)
- **Tests**: Write file → verify in project dir, path traversal blocked

### 8. File Layer
- **Existing**: file_read, file_write, patch tools — correctly implemented but unreachable
- **Target**: All file ops through WorkspaceService
- **Migration**: Tools call WorkspaceService instead of direct fs
- **New files**: None (modify tools)
- **Tests**: file_read blocks .env, file_write creates versioned file

### 9. Task Layer
- **Existing**: Task model with dependencies field (unused), linear execution
- **Target**: DAG with dependency resolution, parallel execution, validation gate
- **Migration**: Use dependencies field, add topological sort
- **New files**: None (modify runtime)
- **DB changes**: None (fields exist)
- **Tests**: Create tasks with deps → verify execution order

### 10. Agent Layer
- **Existing**: 15 agents, all same execution path, defaultTools not enforced
- **Target**: Structured contracts, enforced tool access, consolidated to 12 (P6)
- **Migration**: Add agent contracts first, consolidate later
- **New files**: None (modify agents)
- **Tests**: Verify agent selection, tool enforcement

### 11. Tool Layer
- **Existing**: 10 tools, correctly implemented but unreachable (parseToolCalls dead)
- **Target**: Two-phase tool calling, WorkspaceService integration, permission enforcement
- **Migration**: Replace parseToolCalls with two-phase approach
- **New files**: `src/lib/ai/tool-caller.ts`
- **Tests**: Model requests search → tool executes → result feeds back

### 12. Execution Layer
- **Existing**: runtime.ts executeTask — model call + file creation, no validation
- **Target**: Model → Tool → File → Validate → Build → Test → Result
- **Migration**: Add validation phase between model response and task completion
- **New files**: `src/lib/ai/validation.ts`
- **Tests**: Task with expectedOutput → validation checks before completed

### 13. Validation Layer
- **Existing**: DOES NOT EXIST
- **Target**: Syntactic, type, build, test, requirement validation
- **Migration**: Add validation function in runtime before task completion
- **New files**: `src/lib/ai/validation.ts`
- **Tests**: Failing output → task not marked completed

### 14. Recovery Layer
- **Existing**: Retry loop (3 retries with backoff)
- **Target**: Checkpoints, resume, failure budgets, approval gates
- **Migration**: Add checkpoint after each task, save state to DB
- **New files**: `src/lib/ai/checkpoint.ts`, Checkpoint model
- **Tests**: Kill mid-mission → resume from checkpoint

### 15. Artifact Layer
- **Existing**: execution-engine creates artifacts, no versioning
- **Target**: Versioned artifacts, linked to workspace files
- **Migration**: Check existing artifact by name, increment version
- **New files**: None (modify execution-engine)
- **Tests**: Create same file twice → version 2

### 16. Preview Layer
- **Existing**: HTML/SVG iframe preview, inline in chat
- **Target**: Preview provider registry: HTML, Markdown, SVG, JSON, code, project, app
- **Migration**: Add preview providers incrementally
- **New files**: `src/lib/ai/preview-registry.ts`
- **Tests**: Create Markdown artifact → rendered preview

### 17. Runtime Layer
- **Existing**: DOES NOT EXIST
- **Target**: Build, test, run, monitor, stop
- **Migration**: Add RuntimeService with process management
- **New files**: `src/lib/ai/runtime-service.ts`
- **Tests**: Build project → verify output

### 18. Persistence Layer
- **Existing**: Prisma/SQLite, 12 models (3 orphaned), db:push (no migrations)
- **Target**: Clean schema, proper migrations, indexes
- **Migration**: Remove orphaned models, add migrations, add indexes
- **New files**: Migration files
- **Tests**: Migration applies cleanly, rollback works

### 19. Observability Layer
- **Existing**: ExecutionLog table, state API
- **Target**: Metrics aggregation, success rate, latency tracking
- **Migration**: Add metrics computation in state API
- **New files**: None (modify state API)
- **Tests**: Verify metrics computed correctly

### 20. Frontend Layer
- **Existing**: 17 components, Zustand store, race conditions
- **Target**: Fix races, complete i18n, error boundaries, resizable panels
- **Migration**: Add conversation ID guards to store, translate all strings
- **New files**: None (modify existing)
- **Tests**: Switch conversations quickly → no stale data

---

## Skill Integration Plan

### UI/UX Pro Max (ALREADY INSTALLED)
- **Location**: `skills/ui-ux-pro-max/`
- **Usage**: During P5 (Advanced UX) and any UI changes
- **Workflow**:
  1. Read `skills/ui-ux-pro-max/SKILL.md` before UI work
  2. Use design_system.py for token generation
  3. Follow triage → deliverables → assets → output standards
- **Phases**: P0 (error UI), P5 (all UX), P6 (polish)

### Find-Bugs / OMEN (NOT INSTALLED)
- **Installation command**: `npx skillfish add panbanda/omen find-bugs`
- **Installation location**: `skills/find-bugs/` (estimated)
- **Usage**: After foundational changes, before phase completion
- **Phases**: P0 (after fixes), P1 (after tool changes), P3 (after runtime), P4 (after autonomous)
- **Workflow**:
  1. Install before first use
  2. Run after each phase's code changes
  3. Incorporate findings into bug tracker
  4. Fix critical findings before proceeding

### Skill Discovery
- **Command**: `npx skills find <query>`
- **Usage**: When a specific capability is needed during implementation
- **Example**: `npx skills find "code analysis"` before P1 tool work

---

## Z.AI Environment Status

### Already Present (DO NOT re-initialize)
- `Caddyfile` — gateway config with XTransformPort
- `.zscripts/` — build, dev, start, mini-services scripts
- `z-ai-web-dev-sdk` v0.0.18 in package.json
- `skills/` — 69 skills including UI/UX Pro Max
- `examples/websocket/` — socket.io reference
- `mini-services/` — empty but configured

### What init-fullstack.sh Would Do (DO NOT RUN)
- Overwrite Caddyfile
- Replace .zscripts/
- Reinstall skills
- Reset package.json
- **DESTROY existing project work**

### Decision: Do NOT run init script. Environment is already correct.

---

## Approval Gates

| Gate | Phase | What User Must Approve |
|------|-------|----------------------|
| GATE 0 | Architecture | This implementation plan |
| GATE 1 | P0 complete | Foundation fixes verified |
| GATE 2 | P1 complete | Tool calling + WorkspaceService working |
| GATE 3 | P2 complete | Project workspace + file tree working |
| GATE 4 | P3 complete | Build/test/validation working |
| GATE 5 | P4 complete | Autonomous execution working |
| GATE 6 | P5+P6 complete | UX + optimization complete |

---

## Migration Strategy

For every architectural replacement:
```
OLD (keep running)
  ↓
COMPATIBILITY BRIDGE (new code calls old code)
  ↓
NEW (parallel implementation)
  ↓
MIGRATION (switch callers to new)
  ↓
OLD REMOVAL (after verification)
```

No big-bang rewrites. Every change has a working checkpoint.
