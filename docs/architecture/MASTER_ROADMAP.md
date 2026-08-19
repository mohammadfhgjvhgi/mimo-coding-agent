# Master Roadmap (Final)

> Based on Architecture Decision Review. Every task has: objective, affected files, dependencies, acceptance criteria, validation method, risk, rollback strategy.

---

## P0 — Foundation / Safety / Correctness (1-2 weeks)

### P0-1: Fix `ignoreBuildErrors: true`
- **Objective**: Stop silently shipping type errors
- **Affected files**: `next.config.ts:7`
- **Dependencies**: None
- **Acceptance**: `ignoreBuildErrors: false` and `bun run build` passes
- **Validation**: Run build, check for errors
- **Risk**: May reveal existing type errors that need fixing
- **Rollback**: Revert to `true`

### P0-2: Fix Memory `where.OR` Bug
- **Objective**: Stop memories leaking across conversations
- **Affected files**: `src/lib/ai/memory.ts:55-77`
- **Dependencies**: None
- **Acceptance**: Memory retrieval only returns memories from current conversation + global
- **Validation**: Create memory in conv A, retrieve in conv B — should not see A's memories
- **Risk**: Low
- **Rollback**: Git revert

### P0-3: Fix Race Conditions in Store
- **Objective**: Prevent stale fetches from corrupting state
- **Affected files**: `src/lib/mimo-store.ts:610-633`
- **Dependencies**: None
- **Acceptance**: Switching conversations quickly doesn't show stale data
- **Validation**: Send message in conv A, switch to conv B within 800ms, verify B doesn't show A's data
- **Risk**: Low
- **Rollback**: Git revert

### P0-4: Fix `file_read` Security Hole
- **Objective**: Block reading sensitive files
- **Affected files**: `src/lib/ai/tools/index.ts:90-117`
- **Dependencies**: None
- **Acceptance**: `file_read` rejects `.env`, `*.db`, `.git/`, `node_modules/`
- **Validation**: Try reading `.env` — should get error
- **Risk**: Low
- **Rollback**: Git revert

### P0-5: Remove Dead Code (SAFE only)
- **Objective**: Clean up confirmed dead code
- **Affected files**: `prisma/schema.prisma` (AgentActivity), `src/lib/ai/runtime.ts` (looksLikeArtifact, parseMemoryWrites), `src/app/api/route.ts`
- **Dependencies**: None
- **Acceptance**: Lint passes, build passes, no runtime errors
- **Validation**: Run dev server, test chat flow
- **Risk**: Low
- **Rollback**: Git revert

### P0-6: Fix Documentation Mismatches
- **Objective**: Correct false claims in code comments
- **Affected files**: `src/lib/ai/agents/index.ts:2`, `src/lib/ai/tools/index.ts:2`, `src/components/mimo/settings-dialog.tsx:115`, `prisma/schema.prisma:139`
- **Dependencies**: None
- **Acceptance**: All comments match actual counts (15 agents, 10 tools, 12 models)
- **Validation**: Read comments
- **Risk**: None
- **Rollback**: Git revert

---

## P1 — Canonical Tool + Workspace Execution (2-3 weeks)

### P1-1: Implement Real Tool Calling
- **Objective**: Tools actually execute when model needs them
- **Affected files**: `src/lib/ai/runtime.ts`, `src/lib/ai/model.ts`, `src/lib/ai/tools/index.ts`
- **Dependencies**: P0 complete
- **Acceptance**: When model says "let me search for X", web_search executes and results feed back
- **Validation**: Send message "search for latest React news" — verify tool executes
- **Risk**: Medium — changes core execution flow
- **Rollback**: Git revert to parseToolCalls (dead but safe)

### P1-2: Add Validation Phase
- **Objective**: Tasks validate output before marking complete
- **Affected files**: `src/lib/ai/runtime.ts:482-491`
- **Dependencies**: P1-1
- **Acceptance**: Task checks expectedOutput before status → completed
- **Validation**: Send task with expectedOutput, verify validation runs
- **Risk**: Low
- **Rollback**: Git revert

### P1-3: Fix Autonomous Mode Task Dependencies
- **Objective**: Tasks execute in dependency order (DAG)
- **Affected files**: `src/lib/ai/runtime.ts:runAutonomousLoop`
- **Dependencies**: P1-2
- **Acceptance**: Tasks with dependencies wait for deps to complete
- **Validation**: Create plan with dependent tasks, verify order
- **Risk**: Medium
- **Rollback**: Git revert to linear execution

### P1-4: Create WorkspaceService
- **Objective**: All file operations go through workspace layer
- **Affected files**: NEW `src/lib/ai/workspace.ts`, `src/lib/ai/tools/index.ts`
- **Dependencies**: P0 complete
- **Acceptance**: Tools call WorkspaceService, not direct filesystem
- **Validation**: Test file operations through workspace
- **Risk**: Medium
- **Rollback**: Git revert

### P1-5: Add Missing File Tools
- **Objective**: file_edit, file_delete, file_rename, dir_create, dir_list
- **Affected files**: `src/lib/ai/tools/index.ts`
- **Dependencies**: P1-4
- **Acceptance**: All file operations available
- **Validation**: Test each tool
- **Risk**: Low
- **Rollback**: Git revert

---

## P2 — Real Project Execution (3-4 weeks)

### P2-1: Project Workspace Directory
- **Objective**: Each project has filesystem workspace
- **Affected files**: `src/lib/ai/workspace.ts`, `src/app/api/projects/`
- **Dependencies**: P1-4
- **Acceptance**: Creating a project creates `/workspace/projects/{id}/`
- **Validation**: Create project, verify directory exists
- **Risk**: Low
- **Rollback**: Remove directory

### P2-2: File Tree UI
- **Objective**: Show project files in tree view
- **Affected files**: NEW `src/components/mimo/file-tree.tsx`
- **Dependencies**: P2-1
- **Acceptance**: User can browse project files
- **Validation**: Create files, verify they appear in tree
- **Risk**: Low
- **Rollback**: Git revert

### P2-3: Multi-file Project Generation
- **Objective**: AI can generate multiple related files
- **Affected files**: `src/lib/ai/execution-engine.ts`
- **Dependencies**: P2-1
- **Acceptance**: Ask for "HTML + CSS + JS" → all 3 files created in project
- **Validation**: Request multi-file project, verify all files exist
- **Risk**: Low
- **Rollback**: Git revert

### P2-4: Code Editor Integration
- **Objective**: View and edit files in browser
- **Affected files**: NEW `src/components/mimo/code-editor.tsx`
- **Dependencies**: P2-2
- **Acceptance**: User can view file content with syntax highlighting
- **Validation**: Open file in editor, verify rendering
- **Risk**: Low
- **Rollback**: Git revert

### P2-5: File Versioning
- **Objective**: Track file versions, enable rollback
- **Affected files**: `src/lib/ai/workspace.ts`, NEW `prisma/schema.prisma` (ProjectFile, FileVersion)
- **Dependencies**: P2-1
- **Acceptance**: Editing a file creates new version, can revert
- **Validation**: Edit file, verify version history, revert
- **Risk**: Medium — DB migration needed
- **Rollback**: Drop new models

---

## P3 — Validation / Build / Test / Runtime (2-3 weeks)

### P3-1: Build System
- **Objective**: Build projects (npm/bun build)
- **Affected files**: NEW `src/lib/ai/runtime-service.ts`
- **Dependencies**: P2-1
- **Acceptance**: Build command executes, output captured
- **Validation**: Build a project, verify output
- **Risk**: Medium — process management
- **Rollback**: Remove runtime service

### P3-2: Test Execution
- **Objective**: Run tests, capture results
- **Affected files**: `src/lib/ai/runtime-service.ts`
- **Dependencies**: P3-1
- **Acceptance**: Test command executes, pass/fail captured
- **Validation**: Run tests on a project
- **Risk**: Low
- **Rollback**: Git revert

### P3-3: Lint + Typecheck
- **Objective**: Run lint and typecheck
- **Affected files**: `src/lib/ai/runtime-service.ts`
- **Dependencies**: P3-1
- **Acceptance**: Lint/typecheck output captured
- **Validation**: Run lint on a project
- **Risk**: Low
- **Rollback**: Git revert

### P3-4: Extended Preview Types
- **Objective**: Markdown, JSON, code previews
- **Affected files**: `src/app/api/preview/[id]/route.ts`, `src/components/mimo/inline-preview.tsx`
- **Dependencies**: None
- **Acceptance**: Markdown rendered, JSON structured, code highlighted
- **Validation**: Create each type, verify preview
- **Risk**: Low
- **Rollback**: Git revert

### P3-5: Knowledge Graph Activation
- **Objective**: Use KnowledgeEntity/KnowledgeRelation or remove them
- **Affected files**: NEW `src/lib/ai/knowledge.ts`, `src/lib/ai/context.ts`
- **Dependencies**: P1 complete
- **Acceptance**: Entities extracted from conversations, used in context
- **Validation**: Create conversation, verify entities extracted
- **Risk**: Medium
- **Rollback**: Git revert
- **NEEDS USER APPROVAL**: Whether to implement or remove KnowledgeEntity/KnowledgeRelation

---

## P4 — Autonomous Engineering (2-3 weeks)

### P4-1: Self-Repair Loop
- **Objective**: Failed validation → diagnose → fix → retest
- **Affected files**: `src/lib/ai/runtime.ts`
- **Dependencies**: P1-2, P3-2
- **Acceptance**: When test fails, debugger diagnoses, developer fixes, retest
- **Validation**: Create failing test, verify self-repair
- **Risk**: Medium
- **Rollback**: Git revert

### P4-2: Checkpoints
- **Objective**: Save execution state for resume
- **Affected files**: NEW `src/lib/ai/checkpoint.ts`, NEW `prisma/schema.prisma` (Checkpoint model)
- **Dependencies**: P1-3
- **Acceptance**: Mission can resume from last checkpoint after crash
- **Validation**: Start mission, kill server, restart, verify resume
- **Risk**: Medium
- **Rollback**: Drop Checkpoint model

### P4-3: Approval Gates
- **Objective**: Pause for user approval on risky actions
- **Affected files**: `src/lib/ai/runtime.ts`, `src/components/mimo/chat-panel.tsx`
- **Dependencies**: P1-1
- **Acceptance**: Risky actions pause and ask user
- **Validation**: Trigger risky action, verify pause
- **Risk**: Low
- **Rollback**: Git revert

### P4-4: Parallel Task Execution
- **Objective**: Independent tasks execute in parallel
- **Affected files**: `src/lib/ai/runtime.ts`
- **Dependencies**: P1-3
- **Acceptance**: Tasks with no dependencies run concurrently
- **Validation**: Create plan with parallel tasks, verify concurrency
- **Risk**: Medium
- **Rollback**: Git revert to sequential

---

## P5 — Advanced UX (2-3 weeks)

### P5-1: Resizable Panels
- **Objective**: User can resize chat vs. side panel
- **Affected files**: `src/components/mimo/workspace.tsx`
- **Dependencies**: None
- **Acceptance**: Drag divider to resize
- **Validation**: Resize and verify layout
- **Risk**: Low
- **Rollback**: Git revert

### P5-2: Diff Viewer
- **Objective**: Show before/after when AI modifies files
- **Affected files**: NEW `src/components/mimo/diff-viewer.tsx`
- **Dependencies**: P2-5
- **Acceptance**: File modifications show diff
- **Validation**: Edit file, verify diff displayed
- **Risk**: Low
- **Rollback**: Git revert

### P5-3: Terminal/Log Output
- **Objective**: Real-time execution logs
- **Affected files**: NEW `src/components/mimo/terminal.tsx`
- **Dependencies**: P3-1
- **Acceptance**: Build/test output streams in real-time
- **Validation**: Run build, verify streaming output
- **Risk**: Low
- **Rollback**: Git revert

### P5-4: Complete Arabic i18n
- **Objective**: Translate all hardcoded strings
- **Affected files**: `src/lib/i18n.ts`, all panel components
- **Dependencies**: None
- **Acceptance**: All UI text translated when Arabic selected
- **Validation**: Switch to Arabic, verify no English strings
- **Risk**: None
- **Rollback**: Git revert

---

## P6 — Optimization / Hardening (1-2 weeks)

### P6-1: Database Indexes
- **Objective**: Add indexes for common queries
- **Affected files**: `prisma/schema.prisma`
- **Dependencies**: None
- **Acceptance**: Queries faster on large datasets
- **Validation**: Benchmark before/after
- **Risk**: Low
- **Rollback**: Remove indexes

### P6-2: Remove Unused Dependencies
- **Objective**: Clean package.json
- **Affected files**: `package.json`
- **Dependencies**: All features complete
- **Acceptance**: `depcheck` confirms no unused deps
- **Validation**: Run depcheck, build, test
- **Risk**: Medium — could break hidden imports
- **Rollback**: Reinstall deps

### P6-3: Error Recovery UI
- **Objective**: Clear message when server is down
- **Affected files**: `src/components/mimo/workspace.tsx`
- **Dependencies**: None
- **Acceptance**: When API fails, show "Server down" message
- **Validation**: Kill server, verify message
- **Risk**: Low
- **Rollback**: Git revert

### P6-4: Agent Consolidation
- **Objective**: Merge overlapping agents (architect+planner, code_analyst+reviewer, refactoring+developer)
- **Affected files**: `src/lib/ai/agents/index.ts`
- **Dependencies**: All features complete
- **Acceptance**: 12 agents instead of 15, no functionality lost
- **Validation**: Test all workflows still work
- **Risk**: Medium
- **Rollback**: Git revert
- **NEEDS USER APPROVAL**: Which agents to consolidate

---

## REMOVE / CONSOLIDATE Section

### Remove (after approval)
| Item | Phase | Safe? |
|------|-------|-------|
| AgentActivity model | P0 | ✅ Safe (0 references) |
| looksLikeArtifact() | P0 | ✅ Safe (0 callers) |
| parseMemoryWrites() | P0 | ✅ Safe (never works) |
| api/route.ts | P0 | ✅ Safe (dead endpoint) |
| parseToolCalls() | P1 | ✅ Safe (after replacement) |
| Dead exports (8 functions) | P2 | ⚠️ Verify first |
| Unused npm deps (15+) | P6 | ⚠️ Verify first |

### Consolidate (after approval)
| Items | Into | Phase |
|-------|------|-------|
| StreamEvent type (types.ts + ai-client.ts) | Single shared type | P0 |
| looksLikeArtifact + executeResponse | executeResponse only | P0 (remove looksLikeArtifact) |
| Inline fetch + safeFetch | All through safeFetch | P1 |
| architect + planner | architect | P6 |
| code_analyst + reviewer | reviewer | P6 |
| refactoring + developer | developer | P6 |

### Needs User Approval
| Item | Options |
|------|---------|
| KnowledgeEntity model | A) Remove B) Keep as foundation C) Implement now |
| KnowledgeRelation model | A) Remove B) Keep as foundation C) Implement now |
| Agent consolidation | Which agents to merge? |
| Unused dependencies removal | Which ones to remove? |

**DO NOT implement any of this yet. Await approval.**
