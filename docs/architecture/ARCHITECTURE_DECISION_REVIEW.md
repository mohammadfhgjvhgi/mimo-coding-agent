# Architecture Decision Review

> READ-ONLY review. No source code modified. Based on actual source inspection.

---

## 20 Subsystem Boundaries

### 1. Model Layer
- **What**: ZAI SDK wrapper — chat, streaming, structured output, function invocation
- **Owner**: `src/lib/ai/model.ts`
- **Who modifies**: Only model.ts internal functions
- **Who reads**: runtime.ts (chat, chatStream, generateStructured), tools/index.ts (invokeFunction)
- **Data in**: ChatMessage[] + ChatOptions
- **Data out**: ChatResult (content, usage, durationMs)
- **DB models**: None
- **APIs**: ZAI SDK (`z-ai-web-dev-sdk`)
- **Files**: `src/lib/ai/model.ts` (248 lines)
- **Correct?**: PARTIAL. Streaming is fake (non-streaming + word-burst chunking at `model.ts:126-169`). Retry logic exists. But `generateStructured` relies on JSON parsing heuristics.
- **What's wrong**: Fake streaming adds latency. No model routing/fallback. No token budget enforcement.
- **Canonical**: Real streaming when SDK supports it. Model registry with capability metadata. Fallback chain.

### 2. Context Layer
- **What**: Assembles conversation history + memories + agent system prompt
- **Owner**: `src/lib/ai/context.ts`
- **Who modifies**: runtime.ts calls assembleContext()
- **Who reads**: runtime.ts passes context to model
- **Data in**: conversationId, userMessage, agentName
- **Data out**: { system, messages, memories, tokenEstimate }
- **DB models**: Message, Memory
- **APIs**: None directly
- **Files**: `src/lib/ai/context.ts` (128 lines)
- **Correct?**: PARTIAL. Includes history (last 20) + memories (top 5). But NO project context, NO file context, NO research context, NO decision context.
- **What's wrong**: Context is conversation-only. No project scoping. No file awareness.
- **Canonical**: Context should include: conversation + project + files + research + decisions + active tasks. Token budget management.

### 3. Memory Layer
- **What**: 9-type memory store with keyword search
- **Owner**: `src/lib/ai/memory.ts`
- **Who modifies**: runtime.ts (writeMemory), tools/index.ts (memory_store tool)
- **Who reads**: context.ts (retrieveMemories)
- **Data in**: WriteMemoryInput, RetrieveMemoryInput
- **Data out**: Memory records
- **DB models**: Memory
- **APIs**: /api/memory
- **Files**: `src/lib/ai/memory.ts` (148 lines)
- **Correct?**: BROKEN. `memory.ts:70` — `where.OR` for conversationId is overwritten by keyword OR clause. Memories leak across conversations.
- **What's wrong**: 1) where.OR bug. 2) `consolidateMemories()` exported but never called. 3) `getMemoriesByType()` exported but never called. 4) No vector search (keyword LIKE only).
- **Canonical**: Fix where.OR bug. Add proper conversation scoping. Implement consolidation cron. Consider vector embeddings for semantic search.

### 4. Knowledge Layer
- **What**: Knowledge graph — entities + relationships
- **Owner**: Prisma models only (KnowledgeEntity, KnowledgeRelation)
- **Who modifies**: Nobody — 0 writes in entire src/
- **Who reads**: Nobody — 0 reads in entire src/
- **Data in**: Nothing
- **Data out**: Nothing
- **DB models**: KnowledgeEntity, KnowledgeRelation
- **APIs**: None
- **Files**: `prisma/schema.prisma` (models defined), NO implementation files
- **Correct?**: ORPHANED. Completely dead. No entity extraction, no relationship mapping, no graph queries.
- **What's wrong**: Models exist but zero implementation.
- **Canonical**: Either implement (entity extraction from conversations, relationship mapping, graph queries in context) OR remove the models. If keeping as future foundation, document clearly.

### 5. Conversation Layer
- **What**: Conversation CRUD + message persistence
- **Owner**: `src/app/api/conversations/` + `src/lib/mimo-store.ts`
- **Who modifies**: API routes (create/update/delete), store (client state)
- **Who reads**: Store, sidebar, chat-panel
- **Data in**: title, goal, status, autonomous, projectId, pinned, tags
- **Data out**: Conversation + Messages + relations
- **DB models**: Conversation, Message
- **APIs**: /api/conversations, /api/conversations/[id]
- **Files**: `src/app/api/conversations/route.ts`, `src/app/api/conversations/[id]/route.ts`
- **Correct?**: REAL. Full CRUD works. Rename, delete, pin, search all functional.
- **What's wrong**: Nothing critical. Tags field is JSON string (could be relation).
- **Canonical**: Keep as-is. Consider tags as separate model if needed.

### 6. Project Layer
- **What**: Project CRUD + conversation linking
- **Owner**: `src/app/api/projects/` + `src/components/mimo/projects-panel.tsx`
- **Who modifies**: API routes, projects-panel
- **Who reads**: Store, projects-panel
- **Data in**: name, description, type, goals, techStack, requirements
- **Data out**: Project + conversations + entities + memories
- **DB models**: Project
- **APIs**: /api/projects, /api/projects/[id]
- **Files**: `src/app/api/projects/route.ts`, `src/app/api/projects/[id]/route.ts`
- **Correct?**: PARTIAL. CRUD works. But no file workspace, no project-scoped context, no project intelligence.
- **What's wrong**: Project is just a DB record. No filesystem workspace. No file tree. Conversations can link to projects but context engine doesn't use it.
- **Canonical**: Project should own a workspace directory. Context should be project-scoped. File tree UI.

### 7. Workspace Layer
- **What**: Filesystem operations for projects
- **Owner**: DOES NOT EXIST as a subsystem
- **Current state**: `file_write` tool writes to `/upload/` (flat, no project scoping). `execution-engine.ts` writes to `/upload/`. No workspace abstraction.
- **Who modifies**: tools/index.ts (file_write), execution-engine.ts
- **Who reads**: tools/index.ts (file_read), execution-engine.ts
- **Data in**: filename, content
- **Data out**: file path, size
- **DB models**: None (files are not tracked in DB, only as Artifacts)
- **Correct?**: MISSING. No workspace layer exists. Files go to flat `/upload/` directory.
- **What's wrong**: No project-scoped directories. No file tree. No versioning. No rollback. No diffs.
- **Canonical**: `/workspace/projects/{projectId}/` directory per project. File operations go through WorkspaceService. Files tracked in DB (File model). Versioning + diffs.

### 8. File Layer
- **What**: Individual file operations (read, write, edit, patch, delete)
- **Owner**: `src/lib/ai/tools/index.ts` (file_read, file_write, patch)
- **Who modifies**: tools (when called — but tools are dead code)
- **Who reads**: tools (when called — dead)
- **Data in**: path/filename, content
- **Data out**: file content, size, path
- **DB models**: None directly (Artifact stores content copy)
- **Correct?**: PARTIAL. Tools are correctly implemented but unreachable (parseToolCalls never triggers). file_read has no path allowlist (can read .env, .db). file_write is sandboxed to /upload/ only.
- **What's wrong**: 1) Dead code (never called). 2) file_read security hole. 3) No edit/patch/rename/delete tools that work on project files. 4) No directory operations.
- **Canonical**: File operations through WorkspaceService. Path allowlist. Project-scoped. Versioned.

### 9. Task Layer
- **What**: Task state machine + dependencies
- **Owner**: `src/lib/ai/runtime.ts` (executeTask, runAutonomousLoop)
- **Who modifies**: runtime.ts creates/updates tasks
- **Who reads**: store (tasks-panel), runtime
- **Data in**: title, objective, assignedAgent, priority, dependencies, expectedOutput
- **Data out**: Task records with status
- **DB models**: Task
- **APIs**: /api/tasks
- **Files**: `src/lib/ai/runtime.ts`, `src/app/api/tasks/route.ts`
- **Correct?**: PARTIAL. Tasks are created and executed. But: no DAG (linear only), no parallel execution, no real validation, no checkpoints, no resumability.
- **What's wrong**: 1) `dependencies` field exists but never used. 2) No parallel execution. 3) Status goes pending→in_progress→completed with no validation gate. 4) `failurePolicy` field exists but only "retry" is implemented.
- **Canonical**: Real DAG with dependency resolution. Parallel execution. Validation gate before completed. Checkpoints for resumability.

### 10. Agent Layer
- **What**: 15 specialized agents with system prompts
- **Owner**: `src/lib/ai/agents/index.ts`
- **Who modifies**: Nobody (static definitions)
- **Who reads**: runtime.ts (getAgent, pickAgentForMessage), api/agents
- **Data in**: AgentRole name
- **Data out**: AgentDefinition (systemPrompt, tools, color, icon)
- **DB models**: None
- **APIs**: /api/agents
- **Files**: `src/lib/ai/agents/index.ts` (778 lines)
- **Correct?**: PARTIAL. 15 agents exist with well-written prompts. But: all use same model, same tools, same execution path. `defaultTools` arrays are decorative (never enforced). No structured output contracts.
- **What's wrong**: 1) Agents are just different system prompts. 2) `defaultTools` never enforced. 3) No input/output schema per agent. 4) Overlap: architect/planner, code_analyst/reviewer, refactoring/developer.
- **Canonical**: Agents should have structured output contracts, enforced tool access, distinct behavior patterns. Consider consolidating to 10-12 agents.

### 11. Tool Layer
- **What**: 10 tools with schemas + execution
- **Owner**: `src/lib/ai/tools/index.ts`
- **Who modifies**: Nobody (static definitions)
- **Who reads**: runtime.ts (executeTool — but parseToolCalls never triggers), api/tools
- **Data in**: tool name + input
- **Data out**: tool result
- **DB models**: None directly
- **APIs**: /api/tools
- **Files**: `src/lib/ai/tools/index.ts` (490 lines)
- **Correct?**: BROKEN. Tools are correctly implemented but unreachable. `parseToolCalls()` at `runtime.ts:36-62` uses regex to find JSON format the model never outputs.
- **What's wrong**: 1) parseToolCalls regex never matches. 2) No function-calling API integration. 3) file_read security hole. 4) No tool permission enforcement.
- **Canonical**: Replace regex with: (a) ZAI SDK function-calling if available, or (b) post-response intent detection. Tool permissions enforced. Path allowlist for file_read.

### 12. Execution Layer
- **What**: Orchestrates model + tools + file creation
- **Owner**: `src/lib/ai/runtime.ts` (executeTask) + `src/lib/ai/execution-engine.ts`
- **Who modifies**: runtime.ts
- **Who reads**: api/chat/route.ts
- **Data in**: ExecuteTaskInput
- **Data out**: ExecuteTaskResult
- **DB models**: Message, Task, Artifact, Memory, ExecutionLog
- **Files**: `src/lib/ai/runtime.ts` (765 lines), `src/lib/ai/execution-engine.ts` (250 lines)
- **Correct?**: PARTIAL. Model call works. File creation works. But: no validation, no build, no test, no run. "Execution engine" is just "code block extraction + file write".
- **What's wrong**: 1) No validation phase. 2) No build/test/run. 3) executeResponse() is misnamed — it's a file creation engine, not an execution engine. 4) looksLikeArtifact() is dead code (replaced by executeResponse but never removed).
- **Canonical**: Execution layer should: model call → tool execution → file operations → validation → build → test → result. Each phase observable.

### 13. Validation Layer
- **What**: Verify output meets requirements
- **Owner**: DOES NOT EXIST
- **Current state**: `runtime.ts:482-491` marks task `completed` immediately after model returns. `expectedOutput` and `validationRules` fields exist in Task model but are never checked.
- **Correct?**: MISSING. No validation exists at all.
- **Canonical**: Validation phase between model response and task completion. Check expectedOutput. Run tests. Verify file syntax. Acceptance criteria.

### 14. Recovery Layer
- **What**: Checkpoints, resume, failure budgets
- **Owner**: PARTIAL — `runtime.ts:648-670` has retry loop (3 retries with backoff)
- **Correct?**: PARTIAL. Retry exists. But: no checkpoints, no resume, no failure budget tracking, no state persistence for recovery.
- **Canonical**: Checkpoint after each task. Resume from last checkpoint. Failure budget per mission. State machine with WAITING_FOR_INPUT, WAITING_FOR_APPROVAL states.

### 15. Artifact Layer
- **What**: Created files/code/docs stored as artifacts
- **Owner**: `src/lib/ai/execution-engine.ts` + `src/app/api/preview/[id]/route.ts`
- **Who modifies**: execution-engine.ts (create), runtime.ts
- **Who reads**: store (artifacts-panel), preview API
- **Data in**: content, format, type, name
- **Data out**: Artifact records
- **DB models**: Artifact
- **APIs**: /api/artifacts, /api/preview/[id]
- **Files**: `src/lib/ai/execution-engine.ts`, `src/app/api/artifacts/route.ts`, `src/app/api/preview/[id]/route.ts`
- **Correct?**: PARTIAL. Artifacts are created and stored. But: no versioning, no diffs, no rollback, no build status.
- **What's wrong**: 1) No versioning (each create is a new artifact, no history). 2) No link between artifact and file on disk. 3) No build/test status.
- **Canonical**: Artifact versioning. Link to file on disk. Build status. Preview-readiness flag.

### 16. Preview Layer
- **What**: Render artifacts in browser
- **Owner**: `src/app/api/preview/[id]/route.ts` + `src/components/mimo/preview-panel.tsx` + `src/components/mimo/inline-preview.tsx`
- **Who modifies**: Nobody
- **Who reads**: chat-panel (inline), preview-panel (full)
- **Data in**: artifactId
- **Data out**: HTML content with content-type
- **DB models**: Artifact
- **APIs**: /api/preview/[id]
- **Files**: `src/app/api/preview/[id]/route.ts`, `src/components/mimo/preview-panel.tsx`, `src/components/mimo/inline-preview.tsx`
- **Correct?**: PARTIAL. HTML preview works (iframe). Inline preview works. But: only HTML/SVG. No Markdown rendering. No JSON viewer. No code syntax highlighting in preview. No multi-file project preview. No build/run.
- **What's wrong**: 1) Only HTML/SVG preview. 2) iframe sandbox was insecure (fixed to `allow-scripts` only). 3) No project preview (multi-file). 4) No runtime preview (running app).
- **Canonical**: Preview types: HTML, Markdown, SVG, JSON, code, multi-file project, running app. Preview registry. Build + run for project preview.

### 17. Runtime Layer
- **What**: Application execution (build, run, test)
- **Owner**: DOES NOT EXIST
- **Correct?**: MISSING. No build, no run, no test execution.
- **Canonical**: Runtime layer that can: build projects, run tests, execute commands, capture output, show logs.

### 18. Persistence Layer
- **What**: Prisma/SQLite database
- **Owner**: `src/lib/db.ts` + `prisma/schema.prisma`
- **Who modifies**: All API routes + runtime
- **Who reads**: All API routes + runtime
- **DB models**: 12 models (Conversation, Message, Task, AgentActivity, Artifact, Memory, Decision, ExecutionLog, KnowledgeEntry, Project, KnowledgeEntity, KnowledgeRelation)
- **Files**: `src/lib/db.ts`, `prisma/schema.prisma`
- **Correct?**: PARTIAL. Works but: 3 orphaned models (AgentActivity, KnowledgeEntity, KnowledgeRelation). Memory has where.OR bug. No migrations (using db:push). No indexes beyond defaults.
- **Canonical**: Remove orphaned models (or implement them). Fix memory bug. Add proper migrations. Add indexes for common queries.

### 19. Observability Layer
- **What**: Execution logs + metrics
- **Owner**: `src/lib/ai/runtime.ts` (logExecution function) + `src/app/api/state/route.ts`
- **Who modifies**: runtime.ts
- **Who reads**: store (timeline-panel), state API
- **DB models**: ExecutionLog
- **APIs**: /api/state
- **Files**: `src/lib/ai/runtime.ts:137-167`, `src/app/api/state/route.ts`
- **Correct?**: PARTIAL. Logs are written. But: no metrics aggregation, no success rate calculation, no latency tracking, no alerting.
- **Canonical**: Metrics aggregation. Success rate. Latency histograms. Error rate alerting.

### 20. Frontend Layer
- **What**: React components + Zustand store + SSE handling
- **Owner**: `src/components/mimo/` + `src/lib/mimo-store.ts`
- **Who modifies**: User interactions
- **Who reads**: User
- **Data in**: SSE events, user input, API responses
- **Data out**: Rendered UI
- **Files**: 17 components + store
- **Correct?**: PARTIAL. UI works. But: race conditions in store (setTimeout fetches), business logic in components, incomplete i18n.
- **Canonical**: Fix race conditions. Move business logic out of components. Complete i18n. Add error boundaries.

---

## Summary: Current vs Canonical

| Layer | Current Status | Canonical Need |
|-------|---------------|----------------|
| Model | PARTIAL (fake streaming) | Real streaming, model routing |
| Context | PARTIAL (conversation only) | Project + files + research |
| Memory | BROKEN (where.OR bug) | Fix bug, add consolidation |
| Knowledge | ORPHANED (dead models) | Implement or remove |
| Conversation | REAL | Keep |
| Project | PARTIAL (DB record only) | Workspace + file tree |
| Workspace | MISSING | Full workspace layer |
| File | PARTIAL (dead tools) | Live tools through workspace |
| Task | PARTIAL (no DAG) | DAG + parallel + validation |
| Agent | PARTIAL (prompts only) | Structured contracts |
| Tool | BROKEN (unreachable) | Real tool calling |
| Execution | PARTIAL (file write only) | Full execution pipeline |
| Validation | MISSING | Validation phase |
| Recovery | PARTIAL (retry only) | Checkpoints + resume |
| Artifact | PARTIAL (no versioning) | Versioning + diffs |
| Preview | PARTIAL (HTML only) | Multi-type + project |
| Runtime | MISSING | Build + run + test |
| Persistence | PARTIAL (orphaned models) | Clean schema |
| Observability | PARTIAL (logs only) | Metrics + alerting |
| Frontend | PARTIAL (race conditions) | Fix races + complete i18n |
