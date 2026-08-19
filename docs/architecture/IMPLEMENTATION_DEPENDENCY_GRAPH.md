# Implementation Dependency Graph

> What must happen before what. Corrected from initial roadmap based on actual code inspection.

---

## Core Dependency Chain

```
P0-1: TYPE SAFETY ASSESSMENT
  ↓
P0-2: MEMORY BUG FIX (no deps)
  ↓
P0-3: STORE RACE CONDITION FIX (no deps)
  ↓
P0-4: FILE_READ SECURITY FIX (no deps)
  ↓
P0-5: DEAD CODE REMOVAL (no deps)
  ↓
GATE 1: Foundation verified
  ↓
P1-1: TOOL CALLING (two-phase model call)
  ↓                    ↓
P1-2: WORKSPACE SERVICE   P1-3: TOOL MIGRATION (wrap with workspace)
  ↓                    ↓
P1-4: FILE TOOLS (edit, delete, rename, mkdir)
  ↓
P1-5: VALIDATION PHASE (check output before completed)
  ↓
GATE 2: Tool + Workspace verified
  ↓
P2-1: PROJECT WORKSPACE DIR
  ↓
P2-2: FILE TREE UI
  ↓        ↓
P2-3: MULTI-FILE GEN   P2-4: CODE EDITOR
  ↓        ↓
P2-5: FILE VERSIONING
  ↓
GATE 3: Project engineering verified
  ↓
P3-1: BUILD SYSTEM
  ↓
P3-2: TEST EXECUTION
  ↓        ↓
P3-3: LINT+TYPECHECK   P3-4: EXTENDED PREVIEW TYPES
  ↓        ↓
P3-5: KNOWLEDGE GRAPH ACTIVATION
  ↓
GATE 4: Validation/runtime verified
  ↓
P4-1: SELF-REPAIR LOOP
  ↓
P4-2: CHECKPOINTS
  ↓        ↓
P4-3: APPROVAL GATES   P4-4: PARALLEL EXECUTION
  ↓
GATE 5: Autonomous execution verified
  ↓
P5-1: RESIZABLE PANELS
  ↓        ↓
P5-2: DIFF VIEWER   P5-3: TERMINAL
  ↓        ↓
P5-4: COMPLETE ARABIC i18n   P5-5: ERROR RECOVERY UI
  ↓
GATE 6: UX verified
  ↓
P6-1: DB INDEXES
  ↓        ↓
P6-2: DEP CLEANUP   P6-3: AGENT CONSOLIDATION
  ↓        ↓
P6-4: OBSERVABILITY METRICS   P6-5: FINAL HARDENING
```

---

## Parallel Tasks (can run concurrently)

| Group | Tasks | Why Parallel |
|-------|-------|-------------|
| P0 fixes | P0-2, P0-3, P0-4, P0-5 | No dependencies between them |
| P1 workspace + tools | P1-2 + P1-3 | WorkspaceService and tool migration can start together |
| P2 UI + backend | P2-2 + P2-3 | File tree UI and multi-file gen are independent |
| P3 build + preview | P3-2 + P3-4 | Test execution and preview types are independent |
| P4 recovery + parallel | P4-3 + P4-4 | Approval gates and parallel execution are independent |
| P5 panels + i18n | P5-1 + P5-4 | Resizable panels and Arabic i18n are independent |
| P6 cleanup | P6-2 + P6-3 + P6-4 | All independent cleanup tasks |

---

## Critical Path (longest dependency chain)

```
P0-1 → P0-2 → GATE1 → P1-1 → P1-2 → P1-3 → P1-5 → GATE2 → 
P2-1 → P2-5 → GATE3 → P3-1 → P3-2 → GATE4 → 
P4-1 → P4-2 → GATE5 → P5-1 → GATE6 → P6-5
```

**Estimated critical path duration**: 13-18 weeks

---

## Blocked Items (cannot start until dependency met)

| Task | Blocked By | Why |
|------|-----------|-----|
| P1-3 (tool migration) | P1-2 (workspace service) | Tools need workspace to exist |
| P1-5 (validation) | P1-1 (tool calling) | Validation needs working execution |
| P2-3 (multi-file gen) | P2-1 (project workspace) | Needs project directory |
| P2-5 (versioning) | P2-1 (project workspace) | Needs project directory |
| P3-1 (build) | P2-1 (project workspace) | Build needs project files |
| P3-2 (test) | P3-1 (build) | Test needs build to exist |
| P4-1 (self-repair) | P1-5 (validation) + P3-2 (test) | Repair needs to know what failed |
| P4-2 (checkpoints) | P1-3 (task DAG) | Checkpoints need task state |
| P6-3 (agent consolidation) | All phases | Only after all features work |

---

## Rejected Dependencies (corrected from initial roadmap)

1. **REJECTED**: "Tool calling depends on ZAI SDK function-calling" — SDK doesn't support it. Use two-phase model call instead.
2. **REJECTED**: "Knowledge graph activation in P1" — Not needed for core execution. Moved to P3.
3. **REJECTED**: "Agent consolidation in P0" — Too risky before contracts established. Moved to P6.
4. **REJECTED**: "Remove ignoreBuildErrors immediately" — Must assess type errors first. Split into assess + fix.
