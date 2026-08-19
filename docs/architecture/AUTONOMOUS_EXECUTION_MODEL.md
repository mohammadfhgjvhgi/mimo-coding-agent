# Autonomous Execution Model

> Compare proposed lifecycle against actual implementation.

---

## Proposed Lifecycle vs Actual

| # | Stage | Status | Evidence |
|---|-------|--------|----------|
| 1 | USER GOAL | ✅ EXISTS | `api/chat/route.ts:33` — message from user |
| 2 | INTENT | ✅ EXISTS | `agents/index.ts:pickAgentForMessage()` — keyword routing |
| 3 | CONTEXT | ⚠️ PARTIAL | `context.ts:assembleContext()` — history + memories only, no project/files/research |
| 4 | PROJECT DISCOVERY | ❌ MISSING | No project context in execution |
| 5 | REQUIREMENTS | ❌ MISSING | requirements agent exists but not in autonomous flow |
| 6 | ARCHITECTURE | ❌ MISSING | architect agent exists but not in autonomous flow |
| 7 | PLAN | ✅ EXISTS | `runtime.ts:565` — `generateStructured()` produces JSON plan |
| 8 | TASK GRAPH | ⚠️ PARTIAL | Tasks created with `order` field, but `dependencies` field never used. Linear execution only. |
| 9 | AGENT ASSIGNMENT | ✅ EXISTS | Plan includes `assignedAgent` per task |
| 10 | TOOL EXECUTION | ❌ BROKEN | `parseToolCalls()` never triggers. Tools dead. |
| 11 | WORKSPACE OPERATIONS | ⚠️ PARTIAL | `executeResponse()` writes files to /upload/, but no project workspace |
| 12 | BUILD | ❌ MISSING | No build capability |
| 13 | TEST | ❌ MISSING | No test execution |
| 14 | VALIDATION | ❌ MISSING | Task marked completed without checking output |
| 15 | REVIEW | ❌ MISSING | No review phase |
| 16 | FIX | ❌ MISSING | No self-repair |
| 17 | RETEST | ❌ MISSING | No retest after fix |
| 18 | ARTIFACT | ✅ EXISTS | `execution-engine.ts` creates artifacts |
| 19 | PREVIEW/RUN | ⚠️ PARTIAL | HTML preview only, no app run |
| 20 | RESULT | ✅ EXISTS | Saved as Message |
| 21 | MEMORY/KNOWLEDGE | ⚠️ PARTIAL | Memory written (procedural auto-memory), but knowledge graph dead |
| 22 | PROJECT STATE | ❌ MISSING | No project state update |

---

## What Already Exists (Keep)

### 1. Intent Detection (pickAgentForMessage)
- **Status**: ✅ Works
- **Quality**: Good — keyword-based with Arabic support
- **Keep**: Yes, but enhance with context (current project, recent tasks)

### 2. Context Assembly (assembleContext)
- **Status**: ⚠️ Partial
- **Quality**: Works for conversation + memories
- **Keep**: Yes, but extend with project/files/research/decisions

### 3. Planning (generateStructured)
- **Status**: ✅ Works
- **Quality**: Produces JSON plan with tasks, execution order, risks
- **Keep**: Yes, but add dependency tracking and parallel execution

### 4. Task Execution (executeTask)
- **Status**: ⚠️ Partial
- **Quality**: Model call + file creation works. No tools, no validation.
- **Keep**: Yes, but add tool execution, validation, retry with different strategy

### 5. Artifact Creation (executeResponse)
- **Status**: ✅ Works
- **Quality**: Extracts code blocks, writes files
- **Keep**: Yes, but rename to "FileCreationEngine" (not "ExecutionEngine")

### 6. Memory Writing (writeMemory)
- **Status**: ✅ Works
- **Quality**: Auto-writes procedural memory
- **Keep**: Yes

### 7. Execution Logging (logExecution)
- **Status**: ✅ Works
- **Quality**: Logs to ExecutionLog table
- **Keep**: Yes

---

## What is Missing (Add)

### 1. Project Discovery
- **What**: Before planning, identify which project the goal relates to
- **How**: Check current project context, scan project files, match goal keywords
- **Priority**: P2

### 2. Requirements Phase
- **What**: Before architecture, extract requirements
- **How**: requirements agent produces structured requirements
- **Priority**: P3

### 3. Architecture Phase
- **What**: Before planning, produce system architecture
- **How**: architect agent produces architecture document
- **Priority**: P3

### 4. Task Dependencies (DAG)
- **What**: Tasks should declare dependencies, execute in dependency order
- **How**: `dependencies` field already exists in Task model. Use it.
- **Priority**: P1

### 5. Tool Execution
- **What**: Tools should actually execute when needed
- **How**: Replace parseToolCalls with real tool calling (see TOOL_MATRIX.md)
- **Priority**: P1

### 6. Validation Phase
- **What**: Before marking task complete, validate output
- **How**: Check expectedOutput, run tests, verify file syntax
- **Priority**: P1

### 7. Build Phase
- **What**: Build project after files created
- **How**: RuntimeService.build()
- **Priority**: P3

### 8. Test Phase
- **What**: Run tests after build
- **How**: RuntimeService.test()
- **Priority**: P3

### 9. Review Phase
- **What**: Review completed work
- **How**: reviewer agent checks artifacts against requirements
- **Priority**: P3

### 10. Self-Repair
- **What**: If validation/test fails, diagnose and fix
- **How**: debugger agent analyzes error, developer agent patches, retest
- **Priority**: P4

### 11. Checkpoints
- **What**: Save execution state for resume
- **How**: Save task graph state + completed tasks to DB
- **Priority**: P4

### 12. Project State Update
- **What**: After mission, update project state (files, decisions, knowledge)
- **How**: Write to Project model, KnowledgeEntity, Decision
- **Priority**: P3

---

## What is Duplicated (Consolidate)

### 1. looksLikeArtifact() + executeResponse()
- **Problem**: `looksLikeArtifact()` in runtime.ts:88-133 is dead code. `executeResponse()` in execution-engine.ts does the same thing better.
- **Fix**: Remove `looksLikeArtifact()`
- **Priority**: P0

### 2. parseToolCalls() + parseMemoryWrites()
- **Problem**: Both use regex to detect JSON in model output. Neither works.
- **Fix**: Replace with real tool calling system
- **Priority**: P1

---

## What is Incorrectly Ordered

### Current Flow
```
Model call → Tool calls (dead) → Memory writes → File creation → Save message → Mark complete
```

### Correct Flow
```
Model call → Tool calls → File creation → Validation → Memory writes → Save message → Mark complete
```

**Problem**: Memory writes happen before validation. If validation fails, we've stored memories for a failed task.

---

## What Should Be Removed

### 1. looksLikeArtifact() — DEAD CODE
- **Reason**: Replaced by executeResponse(), never called
- **Safe**: Yes — grep confirms 0 callers

### 2. parseMemoryWrites() — DOESN'T WORK
- **Reason**: Regex never matches model output
- **Safe**: Yes — memory is written via auto-memory in runtime.ts:393-409

### 3. parseToolCalls() Format 1 (JSON) — DOESN'T WORK
- **Reason**: Model never outputs `{"tool":"...","input":{...}}` JSON
- **Safe**: Yes — 0 tools executed via this path
- **Note**: Format 2 (inline "search for X") also rarely works

---

## Canonical Autonomous Execution Flow

```
USER GOAL
    ↓
1. INTENT — pickAgentForMessage (EXISTS)
    ↓
2. CONTEXT — assembleContext (EXISTS, needs extension)
    ↓
3. PROJECT DISCOVERY — check current project (MISSING)
    ↓
4. PLAN — generateStructured (EXISTS)
    ↓
5. TASK GRAPH — create tasks with dependencies (PARTIAL → FIX)
    ↓
6. FOR EACH TASK (in dependency order, parallel when possible):
    ↓
   6a. AGENT ASSIGNMENT — from plan (EXISTS)
       ↓
   6b. CONTEXT — task-specific context (PARTIAL)
       ↓
   6c. MODEL CALL — chat/chatStream (EXISTS)
       ↓
   6d. TOOL EXECUTION — if needed (BROKEN → FIX)
       ↓
   6e. WORKSPACE OPERATIONS — write/edit files (PARTIAL → FIX)
       ↓
   6f. VALIDATION — check output (MISSING → ADD)
       ↓
   6g. IF FAILED:
       - DEBUG — diagnose error (MISSING → ADD)
       - FIX — patch code (MISSING → ADD)
       - RETEST — validate again (MISSING → ADD)
       - RETRY (up to failure budget)
       ↓
   6h. ARTIFACT — create artifact record (EXISTS)
       ↓
   6i. MEMORY — write procedural memory (EXISTS)
       ↓
   6j. MARK COMPLETE (EXISTS, needs validation gate)
    ↓
7. BUILD — if project (MISSING → ADD)
    ↓
8. TEST — if tests exist (MISSING → ADD)
    ↓
9. REVIEW — reviewer agent checks (MISSING → ADD)
    ↓
10. PREVIEW/RUN — if applicable (PARTIAL → EXTEND)
    ↓
11. RESULT — save summary (EXISTS)
    ↓
12. PROJECT STATE — update project (MISSING → ADD)
    ↓
13. CHECKPOINT — save state for resume (MISSING → ADD)
```

---

## State Machine

### Task States (Current)
```
pending → in_progress → completed
                    → failed
```

### Task States (Canonical)
```
pending → planning → in_progress → validating → completed
                                      ↓
                                   failed → retrying → in_progress
                                              ↓
                                           failed (budget exhausted)
                                           
Special states:
- waiting_for_input — needs user clarification
- waiting_for_approval — needs user approval (risky action)
- blocked — dependency not met
- cancelled — user cancelled
```

**DO NOT implement yet. Await approval.**
