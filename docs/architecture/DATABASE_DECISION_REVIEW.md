# Database Decision Review

> Audit every Prisma model. No migrations or deletions yet.

---

## Model Classification

| # | Model | Classification | References | Recommendation |
|---|-------|---------------|------------|----------------|
| 1 | Conversation | ✅ REAL | Used by all API routes, store, runtime | KEEP |
| 2 | Message | ✅ REAL | Used by chat, conversations API | KEEP |
| 3 | Task | ⚠️ PARTIAL | Created by runtime, `dependencies` field unused | KEEP (fix dependencies) |
| 4 | AgentActivity | ❌ ORPHANED | 0 reads/writes in src/ | **REMOVE (P0)** |
| 5 | Artifact | ⚠️ PARTIAL | Created by execution-engine, no versioning | KEEP (add versioning) |
| 6 | Memory | ⚠️ PARTIAL | Has where.OR bug, consolidation never called | KEEP (fix bug) |
| 7 | Decision | ✅ REAL | Created by autonomous loop, read by decisions API | KEEP |
| 8 | ExecutionLog | ✅ REAL | Written by runtime, read by state API | KEEP |
| 9 | KnowledgeEntry | ⚠️ PARTIAL | Model exists, knowledge_search tool queries it, but nothing writes to it | KEEP (implement ingestion) |
| 10 | Project | ⚠️ PARTIAL | CRUD works, but no workspace/files | KEEP (add workspace) |
| 11 | KnowledgeEntity | ❌ ORPHANED | 0 reads/writes in src/ | **REMOVE or IMPLEMENT (decision needed)** |
| 12 | KnowledgeRelation | ❌ ORPHANED | 0 reads/writes in src/ | **REMOVE or IMPLEMENT (decision needed)** |

---

## Detailed Analysis

### 1. Conversation — REAL
- **Fields**: id, title, goal, status, autonomous, projectType, projectId, pinned, tags, createdAt, updatedAt
- **Relations**: messages, tasks, artifacts, decisions, executions, memories, project
- **Issues**: `tags` is JSON string (could be separate model), `status` should be enum
- **Decision**: KEEP as-is. Minor improvements later.

### 2. Message — REAL
- **Fields**: id, conversationId, role, content, agentName, toolName, toolCallId, tokenInput, tokenOutput, durationMs, createdAt
- **Issues**: No `previewUrl`/`previewName` fields (added in ai-client.ts type but not in DB). Client-only state.
- **Decision**: KEEP. Consider adding preview fields to DB if persistence needed.

### 3. Task — PARTIAL
- **Fields**: id, conversationId, parentId, title, description, objective, assignedAgent, status, priority, dependencies, inputs, expectedOutput, validationRules, failurePolicy, retryCount, maxRetries, completionNotes, order, createdAt, startedAt, completedAt, updatedAt
- **Issues**: 
  - `dependencies` field exists but NEVER USED in execution
  - `inputs` field exists but NEVER POPULATED
  - `validationRules` field exists but NEVER CHECKED
  - `failurePolicy` exists but only "retry" implemented
  - `parentId` exists but no sub-task support
- **Decision**: KEEP. Fix: use dependencies for DAG, populate inputs, check validationRules.

### 4. AgentActivity — ORPHANED
- **Fields**: id, conversationId, agentName, taskId, status, currentAction, toolsUsed, message, startedAt, updatedAt, completedAt
- **References checked**: 
  - `grep -r "AgentActivity" src/` → 0 results (only in schema.prisma)
  - `grep -r "agentActivity" src/` → 0 results
- **Why safe to remove**: No code reads or writes this model. Agent activity is tracked via ExecutionLog instead.
- **What replaces it**: ExecutionLog already captures agent activity (agentName, phase, message, status).
- **Decision**: **SAFE TO REMOVE**

### 5. Artifact — PARTIAL
- **Fields**: id, conversationId, taskId, name, type, format, content, summary, filePath, sizeBytes, tags, version, createdAt, updatedAt
- **Issues**:
  - `version` field exists but always 1 (no versioning implemented)
  - `filePath` field exists but never populated (content stored in DB instead)
  - `tags` is JSON string
  - No link to ProjectFile (doesn't exist yet)
- **Decision**: KEEP. Add: versioning, populate filePath, link to workspace files.

### 6. Memory — PARTIAL (BUG)
- **Fields**: id, conversationId, projectId, type, content, summary, importance, confidence, source, scope, tags, relatedMemories, expiresAt, createdAt, updatedAt, accessedAt, accessCount
- **Bug**: `memory.ts:70` — `where.OR` for conversationId is overwritten by keyword OR clause:
  ```typescript
  // Line 57: where.OR = [{ conversationId: null }, { conversationId }]
  // Line 70: where.OR = [...where.OR, ...keywords.flatMap(...)]
  // Result: OR = [conversationId: null, conversationId, content LIKE kw, summary LIKE kw]
  // The conversationId filter is now optional (OR'd with keyword matches)
  // → Memories from OTHER conversations leak in if they match keywords
  ```
- **Other issues**: 
  - `consolidateMemories()` exported but never called
  - `getMemoriesByType()` exported but never called
  - `projectId` field exists but never used
  - `relatedMemories` field exists but never populated
  - `expiresAt` field exists but never checked
- **Decision**: KEEP. FIX where.OR bug immediately (P0).

### 7. Decision — REAL
- **Fields**: id, conversationId, title, context, decision, reasoning, alternatives, consequences, relatedTasks, relatedFiles, status, decidedBy, createdAt
- **Issues**: `alternatives`, `consequences`, `relatedTasks`, `relatedFiles` are JSON strings
- **Decision**: KEEP. Works correctly for autonomous missions.

### 8. ExecutionLog — REAL
- **Fields**: id, conversationId, taskId, agentName, toolName, phase, level, message, details, durationMs, status, createdAt
- **Issues**: `details` is JSON string. No indexes beyond defaults (could use index on conversationId).
- **Decision**: KEEP. Add index on conversationId + createdAt.

### 9. KnowledgeEntry — PARTIAL
- **Fields**: id, source, sourcePath, title, content, summary, category, tags, entities, chunkCount, createdAt, accessedAt, accessCount
- **Issues**: 
  - Model exists and knowledge_search tool queries it
  - But NOTHING WRITES to it — no ingestion pipeline
  - Always empty
- **Decision**: KEEP. Implement document ingestion (P3) or use for research results.

### 10. Project — PARTIAL
- **Fields**: id, name, description, type, status, goals, techStack, requirements, createdAt, updatedAt
- **Relations**: conversations, entities, memories
- **Issues**: 
  - `goals`, `techStack`, `requirements` are JSON strings
  - No file workspace
  - No file tree
  - Conversations can link but context engine doesn't use it
- **Decision**: KEEP. Add workspace directory, file tree, project-scoped context.

### 11. KnowledgeEntity — ORPHANED
- **Fields**: id, projectId, name, type, description, properties, source, createdAt
- **References checked**:
  - `grep -r "KnowledgeEntity" src/` → 0 results (only in schema.prisma)
  - `grep -r "knowledgeEntity" src/` → 0 results
  - `grep -r "db.knowledgeEntity" src/` → 0 results
- **Why safe to remove**: No code reads or writes this model.
- **Future architecture**: Could be useful for knowledge graph. But currently 0 implementation.
- **Decision**: **NEEDS USER APPROVAL** — Remove OR implement. If keeping as future foundation, document clearly.

### 12. KnowledgeRelation — ORPHANED
- **Fields**: id, fromId, toId, type, properties, createdAt
- **References checked**: Same as KnowledgeEntity — 0 references in src/
- **Decision**: **NEEDS USER APPROVAL** — Same as KnowledgeEntity.

---

## Proposed Deletions

### Safe to Remove (P0)
| Model | Why Safe | References Checked | Replacement |
|-------|---------|-------------------|-------------|
| AgentActivity | 0 reads/writes in src/ | grep confirmed | ExecutionLog already tracks agent activity |

### Needs User Approval
| Model | Why | Options |
|-------|-----|---------|
| KnowledgeEntity | 0 reads/writes | A) Remove (clean) B) Keep as future foundation C) Implement now |
| KnowledgeRelation | 0 reads/writes | A) Remove (clean) B) Keep as future foundation C) Implement now |

---

## Schema Issues to Fix (No deletion needed)

### 1. Memory where.OR Bug (P0)
- **File**: `src/lib/ai/memory.ts:70`
- **Fix**: Use AND for conversationId, OR for keywords within that scope
- **Risk**: Low — only affects retrieval, not writes

### 2. Task dependencies unused (P1)
- **File**: `src/lib/ai/runtime.ts` — `runAutonomousLoop` doesn't use `dependencies` field
- **Fix**: Build DAG from dependencies, execute in topological order
- **Risk**: Medium — changes autonomous execution flow

### 3. Artifact version always 1 (P2)
- **File**: `src/lib/ai/execution-engine.ts` — always creates new artifact
- **Fix**: Check if artifact with same name exists, increment version
- **Risk**: Low

### 4. No indexes (P6)
- **File**: `prisma/schema.prisma`
- **Fix**: Add indexes on common query fields (conversationId, createdAt, status)
- **Risk**: Low — performance improvement only

### 5. status fields should be enums (P6)
- **Models**: Conversation.status, Task.status, Project.status
- **Fix**: Use Prisma enums instead of strings
- **Risk**: Medium — requires migration

---

## New Models Needed (Future — DO NOT implement yet)

### ProjectFile (P2)
- Tracks files in project workspace
- Links to Artifact for content
- Version history

### FileVersion (P2)
- Version history for ProjectFile
- Content hash, diff from previous

### Checkpoint (P4)
- Autonomous mission checkpoints
- Task graph state
- For resume after crash

### BuildResult (P3)
- Build output
- Success/failure, logs, duration

### TestResult (P3)
- Test execution results
- Pass/fail counts, details

**DO NOT implement any of these yet. Await approval.**
