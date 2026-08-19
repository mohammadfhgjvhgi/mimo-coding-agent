# BATCH 3: Merge mimo-life-os AI modules

## Strategy
Per the user's instruction, "Don't copy blindly — read each, extract the unique logic, and MERGE into our existing files." Each module was read, the unique patterns identified, and appended to the corresponding workspace file (preserving the existing implementation).

## Merges performed

### 1. `execution-engine.ts` → NEW `src/lib/agent/code-extractor.ts` (99 lines)
Extracted the pure-logic utilities (no DB coupling):
- `extractCodeBlocks(content)` — parses ```lang:filename``` fences with fallback filename hints from preceding prose
- `generateFilename(lang, index)` — generates a `mimo-<ts>-<i>.<ext>` name
- `isPreviewable(lang, filename)` — true for HTML/SVG
- `getArtifactType(lang, filename)` — classifies as code/config/document
- `sanitizeFilename(name)` — strips unsafe characters

The DB-coupled `executeResponse` (which writes to `db.artifact` and `WorkspaceService`) was NOT copied because we have no Artifact model.

### 2. `task-graph.ts` → appended to `src/lib/agent/dag.ts` (+169 lines)
Added:
- `detectCycles(plan)` — white-gray-black DFS cycle detection with human-readable cycle path messages
- `validateDag(plan)` — checks missing deps, self-deps, duplicate edges, cycles
- `getReadyTasks(plan)`, `getBlockedTasks(plan)` — pending tasks ready/blocked by dependency state
- `getDagState(plan)` — status counts for UI / observability
- `DagNodeStatus` type — richer state machine (pending/ready/running/done/failed/blocked)

The existing `parseDagPlan`, `topologicalSort`, `getNextTask`, `isPlanComplete` were kept untouched.

### 3. `tool-caller.ts` → appended to `src/lib/tools/registry.ts` (+76 lines)
Added:
- `parseToolCallsFromResponse(response)` — parses ZAI SDK `choices[0].message.tool_calls` into our `ToolCall[]`, with malformed-argument capture
- `formatToolResultsForModel(results)` — converts `ToolResult[]` to the ZAI SDK `{role:"tool",content,tool_call_id}[]` follow-up format

The DB-coupled `executeToolCall` (project-id injection, permission check via `getAgent`) was NOT copied — we already have `dispatchTool` which does validation + permission.

### 4. `checkpoint.ts` → NOT copied
Requires `db.checkpoint` Prisma model we don't have. The pure logic is just save/load JSON of mission state. The existing `src/lib/recovery/manager.ts` already covers git-based checkpointing (rollbackToCheckpoint, handleFailure, detectLoop) — sufficient for our scope.

### 5. `validation.ts` → appended to `src/lib/verification/ladder.ts` (+93 lines)
Added:
- `validateToolResult(result)` — 6 deterministic checks on a tool result (boolean success, output on success, error on failure, valid duration, tool name present, no success+error combo)

The `validateArtifact`, `validateWorkspaceResult`, `validateTaskCompletion` were NOT copied — they depend on `WorkspaceResult` and `ArtifactToValidate` types from mimo-life-os' workspace.ts which we don't have.

### 6. `model.ts` → appended to `src/lib/llm-provider.ts` (+220 lines)
Added (all built on top of the existing `completeChat`):
- `isRetryableError(err)` — heuristic for 429/rate-limit/timeout/network
- `generateStructured<T>(settings, messages, schemaDescription)` — JSON-from-LLM with 4 fallback extractors (parse, fenced block, first {...}last}, first[...last])
- `treeOfThought(settings, messages, {branches})` — generate N candidate responses with different temperatures, then ask model to pick best
- `selfConsistency(settings, messages, {samples})` — generate N samples, return the most common one (first 200-char prefix as key)
- `optimizePrompt(settings, currentPrompt, examples)` — LLM-based prompt refinement

The streaming/non-streaming `chat()` helpers were NOT copied — we already have `streamChat` + `completeChat`.

### 7. `context.ts` → appended to `src/lib/context-os.ts` (+106 lines)
Added:
- `assembleContext({conversationId, userMessage, history, extraSystem})` — combines history + memory + caller system text
- Auto-compresses when token estimate exceeds `tokenBudgetForProvider("ollama")` using the existing `compressConversation`
- `AssembledContext` interface

The DB-coupled `KnowledgeEntry` lookup was NOT copied (no such model). Memory retrieval uses our existing `retrieveMemories` (added below).

### Supporting addition: `src/lib/tools/memory.ts` (+50 lines)
Added `retrieveMemories({query, limit, conversationId})` — keyword-substring recall from `db.memory`. Used by the new `assembleContext`.

## Verification
- `npx tsc --noEmit` → 0 errors
- `npx eslint src/ --quiet` → 0 errors

## Files touched
| File | Action | Lines added |
|------|--------|-------------|
| src/lib/agent/code-extractor.ts | NEW | 99 |
| src/lib/agent/dag.ts | APPENDED | +169 |
| src/lib/tools/registry.ts | APPENDED | +76 |
| src/lib/verification/ladder.ts | APPENDED | +93 |
| src/lib/llm-provider.ts | APPENDED | +220 |
| src/lib/context-os.ts | APPENDED | +106 |
| src/lib/tools/memory.ts | APPENDED | +50 |
| **TOTAL** | | **+813 lines** |
