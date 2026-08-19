# MiMo AI Platform — Feature Reality Matrix

> Every feature in the system, classified A-G based on what it ACTUALLY does (not what comments claim).
> Evidence: `file:line` references throughout.

## Classification Key

| Grade | Meaning |
|---|---|
| **A. REAL** | Complete workflow works end-to-end |
| **B. PARTIAL** | Some implementation, workflow incomplete |
| **C. MOCK** | UI exists, backend missing |
| **D. DECORATIVE** | Appears functional, does nothing |
| **E. BROKEN** | Implementation exists, fails in real usage |
| **F. DUPLICATED** | Multiple systems overlap |
| **G. ARCHITECTURALLY UNSAFE** | Works now, serious future problems |

---

## 1. CORE CHAT SYSTEM

| Feature | Grade | Evidence |
|---|---|---|
| Send user message | **A** | `chat-panel.tsx:77-194` → `api/chat/route.ts:18-127` → `runtime.ts:193-513` → DB save `runtime.ts:469-479` |
| Stream model response | **B** | Fake streaming: `model.ts:126-169` calls non-streaming `chat()` then chunks words with 20ms delay. Adds latency, removes no real wait. |
| Save assistant message | **A** | `runtime.ts:469-479` persists to `Message` table |
| Stop generation | **B** | Client aborts fetch (`chat-panel.tsx:63-75`) but server-side `executeTask` continues running. No server-side cancellation. |
| Copy message | **A** | `chat-panel.tsx:456-461` — `navigator.clipboard.writeText` |
| Markdown rendering | **B** | Custom renderer `markdown.tsx:17-114` only handles code blocks, inline code, bold. No headers, lists, links, images, tables, quotes. |
| Auto-scroll | **A** | `chat-panel.tsx:57-61` |
| RTL/LTR per message | **A** | `chat-panel.tsx:302,464` — `dir={dir}` |
| Token/duration display | **A** | `chat-panel.tsx:486-490` shows `{durationMs}s · {tokenOutput} tok` |

## 2. AGENT SYSTEM (15 agents)

| Feature | Grade | Evidence |
|---|---|---|
| 15 agent definitions | **A** | `agents/index.ts:7-594` — all 15 defined with prompts, capabilities, colors, icons |
| Agent selector UI | **A** | `chat-panel.tsx:340-358` — clickable buttons for all 15 |
| Manual agent selection | **A** | User clicks agent → `selectedAgent` → sent in request body `chat-panel.tsx:109` |
| Auto agent routing | **B** | `pickAgentForMessage` (`agents/index.ts:641-761`) keyword-based, several false-positive bugs (e.g., "find" → researcher, "write" → developer) |
| Agent activity tracking | **D** | `AgentActivity` Prisma model exists (`schema.prisma:96-112`) but **never written to or read from**. 0 references in src/. |
| Agent collaboration | **D** | No inter-agent messaging. Orchestrator just delegates tasks sequentially. Agents don't talk to each other. |
| Agent-specific tools | **D** | `defaultTools` arrays in agent definitions (`agents/index.ts:21,65,96,...`) are decorative — tools are not auto-injected into prompts. Agent must emit tool-call JSON (which they don't). |
| Active agent indicator | **A** | `chat-panel.tsx:247-261` shows spinning loader + agent name + phase |

## 3. TOOL SYSTEM (10 tools)

| Feature | Grade | Evidence |
|---|---|---|
| 10 tool definitions | **A** | `tools/index.ts:31-459` — all 10 defined with schemas, risk levels, timeouts |
| Tool list API | **A** | `api/tools/route.ts:5-14` |
| Tools panel UI | **A** | `tools-panel.tsx:14-63` — displays all tools |
| `web_search` tool | **E** | Implementation works (`tools/index.ts:46-61`) but `parseToolCalls` (`runtime.ts:36-62`) never extracts tool-call JSON from model output. Only fires via brittle inline regex fallback (`runtime.ts:52-59`) when "search" keyword is present. |
| `web_reader` tool | **E** | Same — implementation works but never invoked. |
| `file_read` tool | **E** | Same — never invoked. Also reads ANY file under project root including `.env` (`tools/index.ts:106`). |
| `file_write` tool | **E** | Same — never invoked. |
| `memory_store` tool | **E** | Same — never invoked. Memory writes happen via `parseMemoryWrites` (also broken) or auto-memory. |
| `knowledge_search` tool | **E** | Same — never invoked. Also queries `KnowledgeEntry` table which is **always empty** (no API/code writes to it). |
| `file_search` tool | **E** | Same — never invoked. |
| `code_search` tool | **E** | Same — never invoked. |
| `patch` tool | **E** | Same — never invoked. |
| `diff` tool | **E** | Same — never invoked. |
| Tool execution timeout | **B** | `executeTool` uses `Promise.race` (`tools/index.ts:478-483`) — tool continues running after timeout, just result ignored. No cancellation. Resource leak. |
| Tool result follow-up | **B** | `runtime.ts:331-370` — follow-up `chat()` call is non-streaming. User sees no progress during synthesis. |

## 4. EXECUTION ENGINE

| Feature | Grade | Evidence |
|---|---|---|
| Code block extraction | **B** | `execution-engine.ts:52-77` — regex requires newline after fence, misses single-line blocks |
| File creation | **A** | `execution-engine.ts:184-186` — writes to `/home/z/my-project/upload/` |
| Artifact DB storage | **A** | `execution-engine.ts:193-205` — creates `Artifact` row |
| Previewable detection | **A** | `execution-engine.ts:122-126` — HTML/SVG flagged |
| Real execution (compile/run/test) | **C** | NOT IMPLEMENTED. Just writes file. No `tsc`, no `node`, no test runner. |
| Validation phase | **C** | NOT IMPLEMENTED. `ExecutionPhase` type includes `validate` (`types.ts:46`) but `runtime.ts` never emits it. |
| Repair phase | **C** | NOT IMPLEMENTED. `ExecutionPhase` includes `repair` (`types.ts:47`) — never used. |
| Retest phase | **C** | NOT IMPLEMENTED. Never used. |
| Review phase | **C** | NOT IMPLEMENTED. Never used. QA/reviewer agents exist but are never auto-invoked. |

## 5. AUTONOMOUS MODE

| Feature | Grade | Evidence |
|---|---|---|
| Autonomous toggle UI | **A** | `chat-panel.tsx:224-233` |
| Orchestrator planning | **B** | `runtime.ts:546-597` — calls `generateStructured` for plan JSON. Falls back to single-task on parse failure (line 582-596). |
| Task DAG persistence | **A** | `runtime.ts:600-619` — saves tasks to DB with order, priority, agent assignment |
| Sequential task execution | **A** | `runtime.ts:635-708` — iterates `plan.executionOrder` |
| Task retry on failure | **B** | `runtime.ts:648-671` — retries up to 3 times with 500ms*retryCount delay. But only catches exceptions, not tool errors or low-quality output. |
| Task failure handling | **E** | `runtime.ts:706` — `break` on first failure. No replanning, no fallback, no escalation. `failurePolicy` field on Task model is **ignored**. |
| Task validation | **E** | Tasks marked `completed` at `runtime.ts:482-491` regardless of output quality. No validation rules checked. |
| Mission summary | **A** | `runtime.ts:742-764` — emits summary string with task/tool/artifact counts |
| Decision record creation | **A** | `runtime.ts:717-740` — creates `Decision` row summarizing mission |
| Parallel task execution | **C** | NOT IMPLEMENTED. Tasks run strictly sequentially. `dependencies` field on Task model is never used to build a DAG. |

## 6. MEMORY SYSTEM

| Feature | Grade | Evidence |
|---|---|---|
| 9 memory types | **A** | `types.ts:22-31`, `schema.prisma:145` |
| Write memory | **A** | `memory.ts:28-43` |
| Retrieve memory | **B** | `memory.ts:45-96` — keyword LIKE search, no embeddings, no semantic search |
| Memory → context injection | **A** | `context.ts:64-92` — top 5 memories injected into system prompt |
| Auto-memory on response | **B** | `runtime.ts:393-409` — writes low-value procedural memory (`"Agent X responded to: Y. Output summary: Z"`) |
| Model-emitted memory writes | **E** | `parseMemoryWrites` (`runtime.ts:67-83`) requires `{"memory":{"type":"...","content":"..."}}` JSON. No prompt instructs model to emit this. Effectively never fires. |
| Memory consolidation | **E** | `consolidateMemories` (`memory.ts:110-131`) is **never called**. Short_term never promotes to long_term. Lifecycle fictional. |
| Memory panel UI | **A** | `memory-panel.tsx:21-75` — displays memories with type colors, importance, scope, tags |
| Memory manual create | **C** | API exists (`api/memory/route.ts:13-29`) but no UI to create memories manually |
| Memory edit/delete | **C** | NOT IMPLEMENTED. No API, no UI. |
| Memory retrieval bug | **E** | `memory.ts:69-77` — `where.OR` overwritten by keywords, conversationId filter lost. Memories leak across conversations. |
| Memory by type | **D** | `getMemoriesByType` (`memory.ts:98`) exported but never called |
| Memory access tracking | **A** | `memory.ts:86-93` — increments `accessCount` and updates `accessedAt` on retrieval |

## 7. ARTIFACT SYSTEM

| Feature | Grade | Evidence |
|---|---|---|
| Artifact creation | **A** | `execution-engine.ts:193-205` |
| Artifact list API | **A** | `api/artifacts/route.ts:5-15` |
| Artifacts panel UI | **A** | `artifacts-panel.tsx:24-103` — list + click-to-view dialog |
| Artifact preview (HTML/SVG) | **A** | `api/preview/[id]/route.ts` + `preview-panel.tsx` + `inline-preview.tsx` |
| Artifact preview (code) | **B** | `preview-panel.tsx:211-216` — plain `<pre>`, no syntax highlighting |
| Artifact manual create | **C** | API has GET only (`api/artifacts/route.ts`), no POST. Can only be created via execution engine. |
| Artifact edit/delete | **C** | NOT IMPLEMENTED |
| Artifact versioning | **D** | `version` field on Artifact model (`schema.prisma:128`) — always 1, never incremented |
| Artifact download | **C** | NOT IMPLEMENTED in UI |

## 8. PREVIEW SYSTEM

| Feature | Grade | Evidence |
|---|---|---|
| Inline preview in chat | **A** | `inline-preview.tsx` + `chat-panel.tsx:316-318,512-514` |
| Full preview panel | **A** | `preview-panel.tsx:30-220` |
| Device sizing | **A** | `preview-panel.tsx:124-165` — desktop/tablet/mobile widths |
| Code view toggle | **A** | `preview-panel.tsx:108-119` + `inline-preview.tsx:25-35` |
| Refresh | **A** | `preview-panel.tsx:59-63` (reloads iframe src) + `inline-preview.tsx:21` (key change) |
| Open external | **A** | `preview-panel.tsx:65-69` + `inline-preview.tsx:23` |
| iframe sandbox | **A** | `sandbox="allow-scripts"` only (`preview-panel.tsx:204`, `inline-preview.tsx:99`) |
| CSP header | **C** | NOT IMPLEMENTED. No Content-Security-Policy on preview responses. |
| HTML escaping in wrapper | **E** | `api/preview/[id]/route.ts:46` — `${artifact.name}` injected into `<title>` without escaping. XSS smell (mitigated by sandbox). |

## 9. TASK SYSTEM

| Feature | Grade | Evidence |
|---|---|---|
| Task creation (autonomous) | **A** | `runtime.ts:600-619` |
| Task list API | **A** | `api/tasks/route.ts:5-15` |
| Tasks panel UI | **A** | `tasks-panel.tsx:21-96` — status icons, progress bar, agent badges |
| Task manual create | **C** | API exists (`api/tasks/route.ts:17-36`) but no UI |
| Task status transitions | **B** | `pending` → `in_progress` → `completed` (`runtime.ts:213,483`). `planning`, `validating`, `blocked`, `failed` defined but rarely used. |
| Task dependencies (DAG) | **D** | `dependencies` field on Task model (`schema.prisma:70`) — never read, never enforced. Tasks run in `executionOrder` array order, not DAG. |
| Task validation rules | **D** | `validationRules` field (`schema.prisma:73`) — never read, never checked |
| Task failure policy | **D** | `failurePolicy` field (`schema.prisma:74`) — never read, always `break` on failure |
| Task retry count | **B** | `retryCount`/`maxRetries` fields — retried in autonomous loop (`runtime.ts:648-671`) but only on exceptions |
| Task edit/delete | **C** | NOT IMPLEMENTED |

## 10. DECISION SYSTEM

| Feature | Grade | Evidence |
|---|---|---|
| Decision creation (autonomous) | **A** | `runtime.ts:717-740` — one Decision per autonomous mission |
| Decision list API | **A** | `api/decisions/route.ts:5-15` |
| Decisions panel UI | **A** | `decisions-panel.tsx:8-55` |
| Decision manual create | **C** | NOT IMPLEMENTED. No POST API. |
| Decision status transitions | **B** | Only `accepted` is ever set (`runtime.ts:734`). `proposed`, `rejected`, `superseded` defined but never used. |
| ADR linking to tasks/files | **D** | `relatedTasks`, `relatedFiles` fields (`schema.prisma:179-180`) — never populated |

## 11. EXECUTION LOG / TIMELINE

| Feature | Grade | Evidence |
|---|---|---|
| Log creation | **A** | `runtime.ts:137-167` — `logExecution` helper called at every phase |
| Log list (per conversation) | **A** | `api/conversations/[id]/route.ts:18` includes executions |
| Timeline panel UI | **A** | `timeline-panel.tsx:27-92` |
| Phase colors | **A** | `timeline-panel.tsx:8-17` |
| Level colors | **A** | `timeline-panel.tsx:19-25` |
| Recent executions (global) | **A** | `api/state/route.ts:34-48` — 10 most recent |
| Log filtering/search | **C** | NOT IMPLEMENTED in UI |
| Log retention/cleanup | **G** | No retention policy. Logs accumulate forever. Will bloat DB over time. |

## 12. SKILLS SYSTEM

| Feature | Grade | Evidence |
|---|---|---|
| Skills folder scanning | **A** | `skills/index.ts:46-82` — reads `/home/z/my-project/skills/*/SKILL.md` |
| Skills list API | **A** | `api/skills/route.ts:5-9` |
| Skills panel UI | **A** | `skills-panel.tsx:9-60` |
| Skill search | **A** | `skills/index.ts:97-107` + `skills-panel.tsx:18-21` |
| Skill execution | **C** | NOT IMPLEMENTED. Skills are metadata-only. No `execute()` method. No prompt injection. |
| Skill caching | **A** | `skills/index.ts:11-13,48-50` — 60s TTL |
| Skill debounce on search | **E** | `skills-panel.tsx:18-21` — `loadSkills(e.target.value)` on every keystroke. No debounce. Floods API. |

## 13. PROJECTS SYSTEM

| Feature | Grade | Evidence |
|---|---|---|
| Project CRUD API | **A** | `api/projects/route.ts` + `api/projects/[id]/route.ts` |
| Projects panel UI | **A** | `projects-panel.tsx:14-148` — create, list, delete |
| Project → conversation linking | **B** | `projectId` field on Conversation (`schema.prisma:26`) — settable via PATCH API but **no UI to assign conversation to project** |
| Project entities (knowledge graph) | **D** | `KnowledgeEntity` model (`schema.prisma:255-269`) — displayed in project _count (`api/projects/route.ts:10`) but **never created**. Count always 0. |
| Project memories | **B** | `Memory.projectId` field (`schema.prisma:144`) — settable but `writeMemory` (`memory.ts:28-43`) doesn't accept `projectId`. Never used. |
| Project goals/techStack/requirements | **C** | Stored as JSON strings (`api/projects/route.ts:28-30`) but no UI to edit them. |
| Project type filtering | **C** | NOT IMPLEMENTED in UI |

## 14. CONVERSATION MANAGEMENT

| Feature | Grade | Evidence |
|---|---|---|
| Conversation list | **A** | `sidebar.tsx:131-237` |
| Create conversation | **A** | `sidebar.tsx:106-113` (newConversation clears state; actual creation on first message) |
| Rename conversation | **A** | `sidebar.tsx:69-79` + `mimo-store.ts:199-220` |
| Delete conversation | **A** | `sidebar.tsx:81-85` + `mimo-store.ts:222-243` |
| Pin/unpin conversation | **A** | `sidebar.tsx:201-209` + `mimo-store.ts:245-260` |
| Search conversations | **A** | `sidebar.tsx:55-60,115-127` |
| Sort (pinned first, then updated) | **A** | `sidebar.tsx:61-67` |
| Tags | **C** | `tags` field on Conversation (`schema.prisma:28`) — settable via PATCH but no UI |
| Goal field | **B** | Set on creation (`api/chat/route.ts:45`) but not editable in UI |

## 15. SETTINGS & I18N

| Feature | Grade | Evidence |
|---|---|---|
| Settings dialog | **A** | `settings-dialog.tsx:16-149` |
| Language toggle (ar/en) | **A** | `settings-dialog.tsx:46-60` + `workspace.tsx:179-185` |
| Theme toggle (dark/light/system) | **A** | `settings-dialog.tsx:69-89` + `workspace.tsx:93-112` |
| Direction (RTL/LTR) | **A** | `workspace.tsx:115-118` applies to `<html>` |
| Arabic translations | **B** | `i18n.ts:13-162` — ~50 keys translated. Most panels bypass `t()` and hardcode English. |
| Settings persistence | **C** | NOT IMPLEMENTED. Locale, theme, autonomousMode lost on page refresh. No `localStorage`. |
| System info display | **E** | `settings-dialog.tsx:113-118` — hardcoded "10 agents · 6 tools · 69 skills" (actually 15/10/variable). "v2.0" hardcoded. |

## 16. COMMAND PALETTE

| Feature | Grade | Evidence |
|---|---|---|
| Cmd+K shortcut | **A** | `command-palette.tsx:61-73` |
| 11 commands | **A** | `command-palette.tsx:33-45` |
| Panel navigation | **A** | `command-palette.tsx:85-87` |
| Settings open | **A** | `command-palette.tsx:81-82` |
| Autonomous toggle | **A** | `command-palette.tsx:83-84` |
| New conversation | **A** | `command-palette.tsx:78-80` |
| Fuzzy search | **E** | `shouldFilter={false}` (line 94) + manual `.includes()` filter (line 103). Defeats cmdk's built-in fuzzy search. |
| Localization | **C** | 100% English. No `t()` calls. |

## 17. SIDEBAR / SYSTEM STATE

| Feature | Grade | Evidence |
|---|---|---|
| Conversation list | **A** | `sidebar.tsx:131-237` |
| System state stats | **A** | `sidebar.tsx:241-259` — 6 stats grid + agents/skills badges |
| Periodic state refresh | **A** | `workspace.tsx:85-90` — every 10s |
| Brand header | **A** | `sidebar.tsx:89-102` |

## 18. SECURITY POSTURE

| Feature | Grade | Evidence |
|---|---|---|
| Authentication | **C** | NOT IMPLEMENTED. `next-auth` in `package.json:61` but unused. Every API is public. |
| Authorization (RBAC) | **C** | NOT IMPLEMENTED |
| Rate limiting | **C** | NOT IMPLEMENTED |
| CSRF protection | **B** | Next.js defaults to same-origin cookies, but no explicit tokens. No writes use cookies anyway. |
| CSP headers | **C** | NOT IMPLEMENTED |
| Input validation | **B** | `safeFetch` handles JSON parse errors. API routes do basic `if (!field)` checks. No zod schemas despite `zod` in deps. |
| SQL injection | **A** | Prisma parameterizes all queries. ✅ |
| Path traversal (file_write) | **A** | `tools/index.ts:138` rejects `..` and `/` in filename |
| Path traversal (file_read) | **E** | `tools/index.ts:23-29` `safeJoin` uses `startsWith(base)` which accepts sibling dirs like `/home/z/my-project-evil/`. Should use `startsWith(base + path.sep)`. |
| Path traversal (execution-engine) | **A** | `execution-engine.ts:181` sanitizes filename with regex |
| Secret leakage | **G** | `file_read` can read `.env`, `dev.log`, `server.log`, `bun.lock`. If model is prompted to read these, secrets leak into chat. |
| iframe XSS | **B** | `sandbox="allow-scripts"` (no same-origin) prevents parent access. But `api/preview/[id]/route.ts:46` injects `artifact.name` into HTML without escaping — code injection smell. |
| TypeScript safety | **G** | `ignoreBuildErrors: true` (`next.config.ts:7`) — type errors ship to production. |
| React safety | **G** | `reactStrictMode: false` (`next.config.ts:9`) — dev sanity checks disabled. |

## 19. OBSERVABILITY

| Feature | Grade | Evidence |
|---|---|---|
| Execution logs | **A** | `runtime.ts:137-167` — logs every phase |
| Log levels | **B** | `LogLevel` type has 5 levels (`types.ts:52`). Only `info` and `error` ever used. |
| Recent activity | **A** | `api/state/route.ts:34-48` |
| Metrics (success rate, avg duration) | **C** | `i18n.ts:148-152` has translation keys for these but **no UI displays them**. |
| Token tracking | **A** | `Message.tokenInput`/`tokenOutput` saved (`runtime.ts:475-476`) |
| Duration tracking | **A** | `Message.durationMs` saved (`runtime.ts:477`) |
| Cost tracking | **C** | NOT IMPLEMENTED. No $ cost calculation. |
| Tracing / OpenTelemetry | **C** | NOT IMPLEMENTED |
| Error tracking (Sentry) | **C** | NOT IMPLEMENTED |

## 20. DATA PERSISTENCE

| Feature | Grade | Evidence |
|---|---|---|
| SQLite database | **A** | `schema.prisma:13` |
| Prisma ORM | **A** | `db.ts:7-12` |
| Client state (Zustand) | **A** | `mimo-store.ts:110-642` |
| Client persistence | **C** | NOT IMPLEMENTED. No `localStorage`/`sessionStorage` middleware. All client state lost on refresh. |
| Server-side caching | **B** | Skills cached 60s (`skills/index.ts:11-13`). Nothing else cached. |
| Database migrations | **B** | `package.json:10-13` has scripts but no `prisma/migrations/` folder. Uses `db push` (data loss accepted). |

## 21. DUPLICATED / OVERLAPPING SYSTEMS (Grade F)

| Feature | Grade | Evidence |
|---|---|---|
| Types duplication | **F** | `types.ts` (backend) and `ai-client.ts` (frontend) define near-identical types. Manual sync required. |
| Memory write paths | **F** | Three paths: (1) `parseMemoryWrites` regex (broken), (2) auto-memory in `runtime.ts:393-409`, (3) `memory_store` tool (never invoked). Only (2) works. |
| Artifact creation paths | **F** | (1) `executeResponse` in `execution-engine.ts` (works), (2) `looksLikeArtifact` in `runtime.ts:88` (dead, never called). |
| Conversation creation | **F** | (1) `api/chat/route.ts:42-51` (on first message), (2) `api/conversations/route.ts:18-34` POST (never called by frontend). |
| Theme management | **F** | Custom theme logic in `workspace.tsx:93-112`. `next-themes` in `package.json:63` but unused. |
| i18n management | **F** | Custom `i18n.ts`. `next-intl` in `package.json:62` but unused. |
| Markdown rendering | **F** | Custom `markdown.tsx`. `react-markdown` in `package.json:69` but unused. |
| Data fetching | **F** | Custom `safeFetch` + Zustand loaders. `@tanstack/react-query` in `package.json:50` but unused. |
| Auth | **F** | `next-auth` in `package.json:61` but unused. No auth implemented. |

## 22. SUMMARY COUNTS

| Grade | Count | Examples |
|---|---|---|
| **A. REAL** | ~45 | Chat send, agent definitions, artifact creation, preview, conversation CRUD, etc. |
| **B. PARTIAL** | ~18 | Streaming (fake), auto-routing (buggy), markdown (limited), Arabic i18n, task retry (exceptions only) |
| **C. MOCK** | ~16 | Real execution, validation, manual create UIs for tasks/decisions/artifacts, auth, RBAC, CSP, metrics UI |
| **D. DECORATIVE** | ~10 | AgentActivity, defaultTools, dependencies, validationRules, failurePolicy, KnowledgeEntity count, artifact versioning |
| **E. BROKEN** | ~14 | All 10 tools (never invoked), parseMemoryWrites, consolidateMemories, memory retrieval bug, command palette fuzzy search, system info display |
| **F. DUPLICATED** | ~9 | Types, memory paths, artifact paths, theme, i18n, markdown, data fetching, auth, conversation creation |
| **G. ARCHITECTURALLY UNSAFE** | ~4 | ignoreBuildErrors, reactStrictMode false, file_read secret leakage, log retention |

**Bottom line:** ~45 real features, ~18 partial, ~16 mock, ~10 decorative, ~14 broken, ~9 duplicated, ~4 unsafe. The system is **demoable but not trustworthy**.
