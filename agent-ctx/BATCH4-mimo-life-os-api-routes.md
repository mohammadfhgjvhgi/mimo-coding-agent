# BATCH 4: mimo-life-os API routes

## What was copied

8 API routes from `/tmp/all_repos/mimo-life-os/src/app/api/` → `src/app/api/<name>/route.ts`, each ADAPTED to our Prisma models and existing lib structure.

### 1. `/api/build/route.ts`
- POST: runs `npm run build` (or `bun run build`) in the project workspace dir
- Uses `@/lib/ai/runtime-service.build(projectId)`

### 2. `/api/decisions/route.ts`
- GET: lists decisions for a conversationId
- ADAPTED: we have no `Decision` model, so decisions are stored as `Memory` rows with `category="decision"` and key prefix `decision_<convId>_<title>`
- Maps Memory rows to a Decision-shaped response

### 3. `/api/artifacts/route.ts`
- GET: lists artifacts (code blocks) for a conversationId
- ADAPTED: we have no `Artifact` model, so artifacts are extracted at request time from assistant `Message.content` using `extractCodeBlocks` (added in BATCH 3)
- Returns one artifact per ```fenced``` code block

### 4. `/api/lint/route.ts`
- POST: runs `npx eslint . --quiet` (lint) or `npx tsc --noEmit` (typecheck) in project workspace
- Uses `@/lib/ai/runtime-service.lint/typecheck(projectId)`

### 5. `/api/preview/[id]/route.ts`
- GET: serves artifact content with proper Content-Type for iframe embedding
- ADAPTED: id is `<messageId>_<blockIndex>`; we re-extract the code block from the assistant message at request time
- Handles HTML wrapping, SVG, CSS, JS, JSON pretty-printing, Markdown

### 6. `/api/projects/route.ts`
- GET: lists project directories under `<workspace>/projects/`
- POST: creates a project directory (sanitized name)
- ADAPTED: we have no `Project` model, so projects are tracked as filesystem directories

### 7. `/api/state/route.ts`
- GET: system state (counts of conversations/tasks/memories/etc + recent activity)
- ADAPTED: uses our existing models (Conversation, Message, Memory, Task, ScheduledTask, Symbol)
- Returns registry counts (agents/skills/tools) from our adapters
- Metrics/eventLog are returned empty (we have no ExecutionLog table)

### 8. `/api/tools/route.ts`
- GET: lists all tools via `@/lib/ai/tools.listTools()`

## Supporting adapter files created

To keep the routes faithful to mimo-life-os structure while using our existing lib:

### `src/lib/ai/agents.ts`
- `listAgents()` — adapts our `swarm-roles.ts` ROLE_PROMPTS into a flat `AgentInfo[]`
- `getAgent(name)` — single lookup

### `src/lib/ai/skills.ts`
- `listSkills()` — re-exports from `@/lib/skills/manager`

### `src/lib/ai/tools.ts`
- `listTools()` — wraps our `@/lib/tools/registry` REGISTRY and adds risk-level heuristic (high for run_*, medium for write_*, low otherwise)

### `src/lib/ai/workspace.ts`
- `ensureProjectDir(projectId)` — creates `<workspace>/projects/<id>/`
- `ensureWorkspaceDirs()` — creates `upload/` and `projects/`
- `writeProjectFile(projectId, filename, content)` — writes to project subdir (uses `resolveWorkspacePath` with proper workspaceRoot context)
- `write(filename, content)` — writes to `upload/`
- Exports `SANDBOX_ROOT` and `UPLOAD_DIR` constants

### `src/lib/ai/runtime-service.ts`
- `build(projectId)` — runs build command via `child_process.exec`
- `lint(projectId)` — runs `npx eslint . --quiet`
- `typecheck(projectId)` — runs `npx tsc --noEmit`
- Returns `BuildResult { success, stdout, stderr, durationMs }`

## Cleanup performed

- `src/app/api/conversations/route.ts` — removed the legacy `export { ensureConversation, addMessage, touchConversation, makeTitle }` (was causing Next.js type-check errors about non-handler exports). Those helpers now live only in `@/lib/server/conversation-helpers`.
- `src/lib/tools/registry.ts` — `REGISTRY` is now `export const` so the `@/lib/ai/tools` adapter can iterate it.

## Verification
- `npx tsc --noEmit` → 0 errors
- `npx eslint src/ --quiet` → 0 errors
