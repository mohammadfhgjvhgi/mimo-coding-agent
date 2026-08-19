# MiMo AI Platform — Execution Model

> What ACTUALLY happens when a user sends a message, today.
> Versus what SHOULD happen in a real autonomous engineering system.
> All claims backed by `file:line` references.

---

## PART 1: CURRENT EXECUTION LIFECYCLE (as implemented)

### 1.1 User Sends a Message (Single-Task Mode)

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. User types in chat-panel.tsx and clicks Send                     │
│    chat-panel.tsx:77-194 (send function)                            │
└──────────────┬──────────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. Client adds user message to UI immediately (optimistic)          │
│    chat-panel.tsx:84-97                                             │
│    ⚠️ No rollback if API fails (TD-034)                              │
└──────────────┬──────────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. Client starts streaming state                                     │
│    chat-panel.tsx:99  startStreaming() → mimo-store.ts:326-327     │
│    Sets isStreaming=true, clears streamingContent, activeTools      │
└──────────────┬──────────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. Client POSTs to /api/chat with SSE                               │
│    chat-panel.tsx:103-113                                           │
│    Body: { conversationId?, message, agentName?, autonomous }       │
│    signal: abortRef.current.signal                                  │
└──────────────┬──────────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. Server: /api/chat/route.ts POST handler                          │
│    api/chat/route.ts:18-127                                         │
│                                                                     │
│    a. Parse body (line 27-31)                                       │
│    b. Get or create conversation (line 39-59)                       │
│       - If no conversationId: create new Conversation row           │
│       - If conversationId: verify exists                            │
│    c. Pick agent (line 62):                                         │
│       - body.agentName (if user selected)                           │
│       - OR pickAgentForMessage(message) [keyword router]            │
│    d. Save user message to DB (line 65-71)                          │
│    e. Create ReadableStream + SSE encoder (line 74-117)             │
│    f. send({ type: "start", conversationId, agent }) (line 82)      │
└──────────────┬──────────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 6. Server: executeTask() in runtime.ts                              │
│    runtime.ts:193-513                                               │
│                                                                     │
│    a. Mark task in_progress (line 212-217) [if taskId]              │
│    b. logExecution({ phase: "plan" }) (line 219-225)               │
│    c. send({ type: "agent", phase: "plan" }) (line 227)             │
│    d. assembleContext() (line 230-237)                              │
│       ┌─────────────────────────────────────────────────────┐       │
│       │ context.ts:32-128                                    │       │
│       │ 1. Get agent system prompt (line 38-39)              │       │
│       │ 2. Load last 20 messages from DB (line 44-61)        │       │
│       │ 3. retrieveMemories({ query: userMessage }) (65-78)  │       │
│       │    ⚠️ where.OR bug (memory.ts:70) — leaks across     │       │
│       │    conversations when keywords present               │       │
│       │ 4. Build system prompt: agent + memories + extra     │       │
│       │ 5. Hard truncate if > 60K chars (line 110-118)       │       │
│       └─────────────────────────────────────────────────────┘       │
│    e. logExecution({ phase: "execute" }) (line 240-246)            │
│    f. send({ type: "agent", phase: "thinking" }) (line 248)        │
│    g. chatStream() — FAKE STREAMING (line 256-270)                  │
│       ┌─────────────────────────────────────────────────────┐       │
│       │ model.ts:126-169                                     │       │
│       │ 1. yield "" (immediate, line 133)                    │       │
│       │ 2. await chat() — FULL non-streaming response        │       │
│       │    (user waits 10-60s with no visible progress)      │       │
│       │ 3. Split response into 3-word bursts                 │       │
│       │ 4. yield each burst with 20ms delay                  │       │
│       │    (adds artificial delay on top of model wait)      │       │
│       └─────────────────────────────────────────────────────┘       │
│       Each yield → send({ type: "delta", content: burst })          │
│    h. Parse tool calls (line 292) — parseToolCalls()                │
│       ┌─────────────────────────────────────────────────────┐       │
│       │ runtime.ts:36-62                                     │       │
│       │ ⚠️ Regex requires {"tool":"name","input":{...}}      │       │
│       │ ⚠️ No agent prompt instructs this format             │       │
│       │ ⚠️ Inner {[^}]+} can't match nested objects          │       │
│       │ ⚠️ Fallback only triggers on "search" keyword        │       │
│       │ RESULT: toolCalls is almost always []                │       │
│       └─────────────────────────────────────────────────────┘       │
│    i. IF toolCalls.length > 0 (RARE):                               │
│       - For each call (max 3, line 294):                            │
│         - send({ type: "tool", status: "starting" })                │
│         - logExecution({ phase: "execute", toolName })              │
│         - executeTool(name, input) — tools/index.ts:469-489         │
│           ┌─────────────────────────────────────────────────┐       │
│           │ tools/index.ts:478-483                          │       │
│           │ Promise.race([tool.execute, timeout])           │       │
│           │ ⚠️ Tool keeps running after timeout             │       │
│           └─────────────────────────────────────────────────┘       │
│         - send({ type: "tool", status: "done"|"error" })            │
│         - logExecution({ phase: "observe" })                        │
│         - IF no error: follow-up chat() (line 344-369)               │
│           ⚠️ Non-streaming — user sees no progress                   │
│           - Append followUp.content to responseContent               │
│           - send({ type: "delta", content: followUp.content })       │
│    j. Parse memory writes (line 375) — parseMemoryWrites()          │
│       ⚠️ Same issue as parseToolCalls — requires specific JSON       │
│       ⚠️ Never fires in practice                                     │
│    k. IF memoryWrites.length > 0 (RARE):                            │
│       - For each (max 3): writeMemory()                             │
│       - send({ type: "memory" })                                    │
│    l. Auto-memory if response > 300 chars (line 393-409):           │
│       - writeMemory({ type: "procedural", content: "Agent X..." })  │
│       ⚠️ Low-value content (TD-041)                                  │
│    m. executeResponse() (line 417-466)                              │
│       ┌─────────────────────────────────────────────────────┐       │
│       │ execution-engine.ts:157-228                         │       │
│       │ 1. extractCodeBlocks(content) — regex               │       │
│       │ 2. For each block ≥20 chars:                        │       │
│       │    a. Generate/sanitize filename                    │       │
│       │    b. fs.writeFile to /home/z/my-project/upload/    │       │
│       │    c. db.artifact.create()                          │       │
│       │ 3. Return { filesCreated, previewable }             │       │
│       │ ⚠️ NOT a real execution engine — just file write    │       │
│       │ ⚠️ No compile, no test, no run                      │       │
│       └─────────────────────────────────────────────────────┘       │
│       - For each file: send({ type: "artifact" })                   │
│       - IF previewable: send({ type: "preview" })                   │
│    n. Save assistant message to DB (line 469-479)                   │
│    o. Mark task completed (line 482-491)                            │
│       ⚠️ No validation (TD-010)                                      │
│    p. logExecution({ phase: "complete" }) (line 493-501)           │
│    q. Return ExecuteTaskResult                                      │
└──────────────┬──────────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 7. Server: send({ type: "end", content, agent, ... })               │
│    api/chat/route.ts:98-108                                         │
└──────────────┬──────────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 8. Client: handleStreamEvent("end")                                 │
│    mimo-store.ts:550-633                                            │
│                                                                     │
│    a. IF event.content (single-task mode):                          │
│       endStreaming(content) (line 555)                              │
│       → mimo-store.ts:332-365                                       │
│         - Dedup check (line 339)                                    │
│         - Append assistant message to messages array                │
│         - Include pendingPreview URL if set                         │
│    b. ELSE IF event.summary (autonomous mode):                      │
│       - Save remaining streamed content as message (line 561-581)   │
│       - Append summary as orchestrator message (line 584-595)       │
│       - Clear streaming state                                       │
│    c. setTimeout(800ms) — refresh tasks/artifacts/decisions/memories│
│       ⚠️ Race condition (TD-013) — stale convId                     │
│    d. setTimeout(1000ms) — refresh systemState + conversations      │
│       ⚠️ Race condition                                              │
│    e. controller.close() (server-side, finally block)               │
└─────────────────────────────────────────────────────────────────────┘
```

**Total wall-clock time for a simple question**: ~10-60s (model latency) + ~1-5s (chunked fake streaming) + ~100ms (DB writes).

**Total wall-clock time for a code-generation request**: same + ~50ms per file written.

### 1.2 Autonomous Mode

```
User sends message with autonomous=true
  │
  ▼
api/chat/route.ts:84-87
  runAutonomousLoop({ conversationId, goal }, send)
  │
  ▼
runtime.ts:529-764
  │
  ├─ 1. PLAN PHASE (line 546-597)
  │    ├─ generateStructured() with plan schema
  │    │   └─ model.ts:174-221 — chat() with JSON instruction
  │    │      ⚠️ Fragile JSON parsing (regex fallbacks)
  │    ├─ IF parse fails: fallback to single-task plan (line 582-596)
  │    └─ send({ type: "agent", phase: "planning" })
  │
  ├─ 2. PERSIST TASKS (line 600-619)
  │    └─ For each task in plan.tasks:
  │       └─ db.task.create({ status: "pending", order: ... })
  │    ⚠️ dependencies field NOT populated from plan
  │    ⚠️ failurePolicy always "retry"
  │
  ├─ 3. send({ type: "task", phase: "planned", tasks: [...] })
  │
  ├─ 4. EXECUTE PHASE (line 635-708)
  │    └─ For each idx in plan.executionOrder:
  │       ├─ send({ type: "task", phase: "starting" })
  │       ├─ RETRY LOOP (line 648-671):
  │       │   └─ while retryCount <= 3:
  │       │      ├─ executeTask(...)  ← same as 1.1 above
  │       │      ├─ IF success: break
  │       │      └─ IF exception: retryCount++, wait 500*retryCount ms
  │       │         ⚠️ Only catches exceptions, not low-quality output
  │       ├─ IF result: send({ type: "task", phase: "completed" })
  │       └─ IF no result:
  │          ├─ db.task.update({ status: "failed" })
  │          ├─ send({ type: "task", phase: "failed" })
  │          ├─ success = false
  │          └─ break; ⚠️ ALWAYS breaks, ignores failurePolicy (TD-020)
  │
  ├─ 5. UPDATE CONVERSATION STATUS (line 711-714)
  │    └─ db.conversation.update({ status: "completed" | "failed" })
  │
  ├─ 6. CREATE DECISION RECORD (line 717-740)
  │    └─ db.decision.create({ title, context, decision, ... })
  │
  ├─ 7. SUMMARY (line 742-755)
  │    ├─ Build summary string
  │    ├─ logExecution({ phase: "complete" })
  │    └─ send({ type: "end", summary, success })
  │
  └─ 8. RETURN AutonomousRunResult
```

**Critical gaps in current autonomous loop**:

1. **No validation phase** — tasks marked completed based solely on "model didn't throw exception".
2. **No DAG execution** — tasks run strictly sequentially in `executionOrder` array order. `dependencies` field never populated or read.
3. **No parallel execution** — independent tasks could run in parallel but don't.
4. **No replanning** — if a task fails, mission aborts. Orchestrator doesn't get a chance to replan.
5. **No inter-agent communication** — agents don't share intermediate results. Each task starts fresh.
6. **No `validate` / `repair` / `retest` / `review` phases** — defined in `ExecutionPhase` type but never emitted.
7. **No `failurePolicy` enforcement** — always `break` on failure.
8. **No quality check** — model output is accepted as-is. No "does this actually address the objective?" check.
9. **No token/cost tracking per task** — only aggregate `tokenInput`/`tokenOutput` on Message.
10. **No checkpoint/resume** — if server crashes mid-mission, all progress lost.

---

## PART 2: PROPOSED EXECUTION LIFECYCLE (target state)

### 2.1 Single-Task Execution (improved)

```
1. User sends message
2. Client optimistic update (with rollback on failure)
3. POST /api/chat (with AbortSignal)
4. Server:
   a. Auth check (TD-003)
   b. Rate limit check (TD-004)
   c. Get/create conversation
   d. Save user message
   e. Pick agent (improved: scoring-based, not keyword)
   f. assembleContext (with bug fixes)
   g. REAL streaming via ZAI SDK (or remove fake chunking)
   h. Native function calling (not regex parsing):
      - Define tools to ZAI SDK
      - Model decides when to call
      - SDK handles the call/return loop
      - Stream tool-call events to client
   i. After response:
      - Extract artifacts (improved regex)
      - Write files
      - IF code artifact:
        - Run `tsc --noEmit` on TS files
        - Run `node --check` on JS files
        - Run `python -m py_compile` on PY files
        - Capture errors
        - IF errors: send back to model for repair
      - IF HTML artifact:
        - Optionally run headless browser for smoke test
      - Write validation result to ExecutionLog
   j. Save assistant message
   k. Mark task completed (only if validation passed)
   l. IF validation failed: mark task "failed", suggest retry
5. Server sends end event with validation result
6. Client updates UI with final state
```

### 2.2 Autonomous Loop (improved)

```
1. User sends goal with autonomous=true
2. Server: runAutonomousLoop
   a. PLAN PHASE:
      - Orchestrator produces plan (tasks + dependencies + validationRules)
      - Persist tasks with dependencies populated
      - Build DAG from dependencies
      - Topological sort
   b. EXECUTE PHASE (DAG-aware):
      - Maintain a queue of ready tasks (deps satisfied)
      - Execute up to N tasks in parallel (configurable, default 3)
      - For each task:
        i.   Mark "in_progress"
        ii.  assembleContext (include results from dependency tasks)
        iii. Stream model call
        iv.  Execute tool calls (native function calling)
        v.   Extract artifacts
        vi.  VALIDATE:
             - Run static checks (tsc, eslint, etc.)
             - IF validationRules: invoke QA agent
             - IF QA FAIL: invoke debugger agent to repair
             - IF repair succeeds: re-validate
             - IF repair fails: mark task "failed"
        vii. Mark task "completed" (only if validation passed)
        viii. Write decision record if architectural choice made
        ix.  Consolidate memories (call consolidateMemories)
      - On task failure:
        - Read failurePolicy:
          - "retry": retry up to maxRetries
          - "skip": mark failed, continue
          - "abort": stop mission
          - "escalate": invoke orchestrator to replan
   c. REVIEW PHASE (new):
      - After all tasks complete, invoke reviewer agent
      - Reviewer checks: goal alignment, quality, security
      - IF reviewer rejects: invoke relevant agents to fix
   d. SUMMARIZE:
      - Build summary with per-task status, tools used, artifacts created
      - Write final Decision record
      - Update conversation status
   e. CHECKPOINT (new):
      - Periodically save mission state to DB
      - On server restart: resume from last checkpoint
3. Stream all events to client in real-time
```

### 2.3 Phase Mapping (current vs proposed)

| Phase | Current (runtime.ts) | Proposed |
|---|---|---|
| `plan` | ✅ Emitted (line 223) — just logs "Agent X starting task" | ✅ Real planning: orchestrator produces DAG, validationRules, failurePolicy |
| `execute` | ✅ Emitted (line 244) — model call starts | ✅ Model call + native tool calling + real streaming |
| `observe` | ✅ Emitted (line 320) — tool result logged | ✅ Tool results + intermediate state captured for dependent tasks |
| `validate` | ❌ NEVER emitted | ✅ NEW: run static analysis, invoke QA agent, check validationRules |
| `repair` | ❌ NEVER emitted | ✅ NEW: invoke debugger agent on validation failure |
| `retest` | ❌ NEVER emitted | ✅ NEW: re-run validation after repair |
| `review` | ❌ NEVER emitted | ✅ NEW: invoke reviewer agent at mission end |
| `complete` | ✅ Emitted (line 497) — task done | ✅ Task done AND validated |

### 2.4 Tool Execution (current vs proposed)

**Current** (broken):
```
Model emits text response
  → parseToolCalls() regex scans for {"tool":"...","input":{...}}
  → NEVER matches (no prompt instructs this format)
  → tools never execute
```

**Proposed** (native function calling):
```
Model call with tools parameter
  → ZAI SDK handles tool-call detection
  → SDK calls executeTool() when model requests
  → Tool result fed back to model automatically
  → Model continues until done
  → Stream all tool-call events to client
```

### 2.5 Memory Lifecycle (current vs proposed)

**Current** (broken):
```
Response > 300 chars
  → writeMemory({ type: "procedural", content: "Agent X responded to: Y..." })
  → Low-value, never consolidated
  → consolidateMemories() never called
  → Memory table bloats with copies of responses
```

**Proposed**:
```
After executeTask completes:
  → Invoke knowledge agent: "Extract 0-3 key facts worth remembering"
  → Write each fact as a typed memory (semantic, procedural, etc.)
  → Call consolidateMemories(conversationId):
    - Promote high-access short_term → long_term
    - Deduplicate by content similarity
    - Archive low-importance memories
  → Periodically (daily): run full consolidation across all conversations
```

### 2.6 Validation Strategy (proposed)

For each artifact type, run appropriate validation:

| Artifact Type | Validation Steps |
|---|---|
| TypeScript code | `tsc --noEmit` on extracted code; check for `any` types; check imports resolve |
| JavaScript code | `node --check` for syntax; optional: run in sandbox |
| Python code | `python -m py_compile` for syntax; optional: run in sandbox |
| HTML | Headless browser smoke test (page loads, no JS errors) |
| CSS | `stylelint` or basic syntax check |
| JSON | `JSON.parse` (already done in preview route) |
| SQL | `sqlite3 --readonly` parse check |
| Markdown | Check for broken links, missing sections |
| Config (YAML/TOML) | Parse with appropriate library |

If validation fails:
1. Capture error output
2. Invoke `debugger` agent with error + original code
3. Debugger proposes fix
4. Apply fix (via `patch` tool or rewrite)
5. Re-validate
6. If still failing after 3 repair attempts: mark task "failed", continue mission (if failurePolicy allows)

### 2.7 Checkpoint/Resume (proposed)

```
Periodically (every task completion):
  → Save mission state to DB:
    - Current task index
    - Completed task IDs + results
    - Failed task IDs + errors
    - Pending tasks
  → On server restart:
    - Load mission state
    - Resume from last completed task
    - Skip already-completed tasks
```

This requires a new `Mission` model:
```prisma
model Mission {
  id              String   @id @default(cuid())
  conversationId  String
  goal            String
  status          String   @default("running") // running | paused | completed | failed | aborted
  planJson        String   // JSON: full plan
  progressJson    String   // JSON: per-task status
  startedAt       DateTime @default(now())
  completedAt     DateTime?
  lastCheckpointAt DateTime?
}
```

### 2.8 Observability (proposed)

Every execution should emit structured logs:

```ts
{
  traceId: string,        // correlation across tasks
  spanId: string,         // unique per phase
  parentSpanId?: string,  // for nested operations
  conversationId: string,
  taskId?: string,
  agentName?: string,
  toolName?: string,
  phase: ExecutionPhase,
  level: LogLevel,
  message: string,
  details?: Record<string, unknown>,
  durationMs: number,
  tokenInput: number,
  tokenOutput: number,
  estimatedCostUsd: number,
  status: "success" | "failure" | "partial" | "skipped",
  timestamp: Date,
}
```

This enables:
- Distributed tracing (where did time go?)
- Cost tracking (how much did this mission cost?)
- Quality metrics (what % of tasks pass validation on first try?)
- Regression detection (did this task take longer than last time?)

---

## PART 3: TRANSITION PLAN (current → proposed)

### Phase 1: Fix the broken foundations (1-2 weeks)
- Fix `parseToolCalls` or switch to native function calling
- Fix `where.OR` memory bug
- Fix `safeJoin` prefix bug
- Add `file_read` allowlist
- Wire up `consolidateMemories`
- Fix race conditions in store

### Phase 2: Add validation (2-3 weeks)
- Implement static analysis for code artifacts (tsc, node --check, py_compile)
- Add `validate` phase to `executeTask`
- Add `repair` phase (invoke debugger agent on failure)
- Add `retest` phase (re-run validation after repair)
- Update task status transitions: `in_progress` → `validating` → `completed` | `failed`

### Phase 3: Improve autonomous loop (2-3 weeks)
- Populate `dependencies` field from orchestrator plan
- Build DAG from dependencies
- Topological sort
- Parallel execution with concurrency limit
- Honor `failurePolicy` (retry | skip | abort | escalate)
- Add `escalate` path: invoke orchestrator to replan on failure

### Phase 4: Add review + checkpoint (1-2 weeks)
- Add `review` phase: invoke reviewer agent at mission end
- Add `Mission` model for checkpoint/resume
- Periodic checkpoint saves
- Resume on server restart

### Phase 5: Observability (1 week)
- Add traceId/spanId to ExecutionLog
- Add token/cost tracking
- Add metrics dashboard (success rate, avg duration, cost per mission)
- Add log retention policy (delete after 30 days)

**Total estimated effort**: 7-11 weeks of focused work to reach the proposed execution model.

---

## PART 4: CRITICAL INSIGHT

The current execution model is essentially:

> **User sends message → Model responds → Save response → Extract code blocks → Write files → Done.**

There is:
- ❌ No real tool execution (parseToolCalls broken)
- ❌ No validation (tasks marked completed blindly)
- ❌ No repair (debugger agent never auto-invoked)
- ❌ No review (reviewer agent never auto-invoked)
- ❌ No DAG (tasks run sequentially)
- ❌ No parallel execution
- ❌ No replanning on failure
- ❌ No checkpoint/resume
- ❌ No cost tracking
- ❌ No memory consolidation

The system is a **single-shot chatbot with file extraction**, not an **autonomous engineering agent**. The autonomous loop is a sequential multi-shot chatbot — it runs N independent tasks in sequence, with no awareness of each other's results (beyond shared DB state).

To become a real autonomous engineering system, it needs the proposed execution model above. The infrastructure (agents, tools, DB schema, SSE streaming) is mostly in place — what's missing is the **orchestration logic** that ties them together into a real execution lifecycle.
