# MiMo AI Platform — Module Dependency Map

> Verified by reading every `import` statement in `src/`.
> Arrows mean "depends on" (importer → imported).
> Dead modules marked ☠️.

---

## 1. HIGH-LEVEL LAYER MAP

```
┌─────────────────────────────────────────────────────────────────┐
│  ENTRY POINTS                                                   │
│  src/app/page.tsx → src/app/layout.tsx                          │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│  UI LAYER (components/mimo/*)                                   │
│  workspace.tsx (root)                                           │
│    ├─ sidebar.tsx                                               │
│    ├─ chat-panel.tsx                                            │
│    │    ├─ markdown.tsx                                         │
│    │    ├─ inline-preview.tsx                                   │
│    │    └─ agent-icons.ts                                       │
│    ├─ preview-panel.tsx                                         │
│    ├─ tasks-panel.tsx                                           │
│    ├─ agents-panel.tsx                                          │
│    ├─ artifacts-panel.tsx                                       │
│    ├─ memory-panel.tsx                                          │
│    ├─ decisions-panel.tsx                                       │
│    ├─ timeline-panel.tsx                                        │
│    ├─ skills-panel.tsx                                          │
│    ├─ tools-panel.tsx                                           │
│    ├─ projects-panel.tsx                                        │
│    ├─ command-palette.tsx                                       │
│    └─ settings-dialog.tsx                                       │
└────────────┬────────────────────────────────────────────────────┘
             │ imports
             ▼
┌─────────────────────────────────────────────────────────────────┐
│  STATE LAYER                                                    │
│  lib/mimo-store.ts (Zustand)                                    │
└────────────┬────────────────────────────────────────────────────┘
             │ imports
             ▼
┌─────────────────────────────────────────────────────────────────┐
│  CLIENT UTILITIES                                               │
│  lib/ai-client.ts (types)                                       │
│  lib/safe-fetch.ts (HTTP)                                       │
│  lib/i18n.ts (translations)                                     │
│  lib/utils.ts (cn helper)                                       │
└─────────────────────────────────────────────────────────────────┘

                 ════════ API BOUNDARY ════════

┌─────────────────────────────────────────────────────────────────┐
│  API LAYER (app/api/*/route.ts)                                 │
│  chat/route.ts → SSE streaming                                  │
│  conversations/route.ts + [id]/route.ts                         │
│  projects/route.ts + [id]/route.ts                              │
│  preview/[id]/route.ts                                          │
│  state/route.ts, tools/route.ts, agents/route.ts, skills/route  │
│  memory/route.ts, tasks/route.ts, artifacts/route.ts            │
│  decisions/route.ts                                             │
│  route.ts ☠️ (dead — returns "Hello, world!")                   │
└────────────┬────────────────────────────────────────────────────┘
             │ imports
             ▼
┌─────────────────────────────────────────────────────────────────┐
│  AI RUNTIME LAYER (lib/ai/*)                                    │
│  runtime.ts (executeTask, runAutonomousLoop)                    │
│    ├─ model.ts (chat, chatStream, generateStructured)           │
│    ├─ context.ts (assembleContext)                              │
│    │    ├─ memory.ts (retrieveMemories, writeMemory)            │
│    │    └─ agents/index.ts (getAgent)                           │
│    ├─ agents/index.ts (pickAgentForMessage, getAgent)           │
│    ├─ tools/index.ts (executeTool)                              │
│    │    ├─ model.ts (invokeFunction)                            │
│    │    ├─ memory.ts (writeMemory, retrieveMemories)            │
│    │    └─ db.ts                                                │
│    ├─ memory.ts (writeMemory)                                   │
│    └─ execution-engine.ts (executeResponse)                     │
│  skills/index.ts (loadSkills, listSkills)                       │
│  types.ts (shared types)                                        │
└────────────┬────────────────────────────────────────────────────┘
             │ imports
             ▼
┌─────────────────────────────────────────────────────────────────┐
│  DATA LAYER                                                     │
│  lib/db.ts (PrismaClient singleton)                             │
│  prisma/schema.prisma (12 models)                               │
│  SQLite database (DATABASE_URL)                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  EXTERNAL                                                       │
│  z-ai-web-dev-sdk (GLM-4-plus model + web_search/web_reader)    │
│  Next.js 16, React 19, Tailwind 4, Prisma 6, Zustand 5         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. DETAILED IMPORT GRAPH (file → file)

### Entry Points

| File | Imports |
|---|---|
| `src/app/page.tsx:1` | `@/components/mimo/workspace` |
| `src/app/layout.tsx:1-4` | `next/font/google`, `./globals.css`, `@/components/ui/toaster` |

### UI Components (src/components/mimo/)

| File | Imports from `@/` | Imports from `react`/`lucide`/etc |
|---|---|---|
| `workspace.tsx:2-37` | `useMimo`, all 13 panel components, `cn`, `t`, `getDirection` | `useEffect`, lucide icons (15) |
| `sidebar.tsx:2-23` | `useMimo`, `Button`, `ScrollArea`, `Badge`, `Input`, `cn`, `formatDistanceToNow`, `t`, `getDirection` | `useState`, `useRef`, `useEffect`, lucide (10) |
| `chat-panel.tsx:3-26` | `useMimo`, `Button`, `Textarea`, `ScrollArea`, `Badge`, `Card`, `getAgentIcon`, `Markdown`, `InlinePreview`, `cn`, `t`, `getDirection` | `useState`, `useRef`, `useEffect`, lucide (10) |
| `markdown.tsx:3-5` | `cn` | `memo`, `useState`, lucide (2) |
| `inline-preview.tsx:4-6` | `Button`, `cn` | `useState`, `useRef`, lucide (6) |
| `preview-panel.tsx:4-19` | `useMimo`, `Button`, `Badge`, `Card`, `cn`, `t` | `useState`, `useEffect`, `useRef`, lucide (8) |
| `tasks-panel.tsx:3-9` | `useMimo`, `Card`, `Badge`, `ScrollArea`, `Progress`, `cn` | lucide (5) |
| `agents-panel.tsx:3-7` | `useMimo`, `Card`, `Badge`, `getAgentIcon`, `cn` | (none) |
| `artifacts-panel.tsx:3-9` | `useMimo`, `Card`, `Badge`, `Button`, `Dialog*`, `cn` | `useState`, lucide (8) |
| `memory-panel.tsx:3-7` | `useMimo`, `Card`, `Badge`, `cn` | lucide (2) |
| `decisions-panel.tsx:3-6` | `useMimo`, `Card`, `Badge` | lucide (1) |
| `timeline-panel.tsx:3-6` | `useMimo`, `Badge`, `cn` | lucide (1) |
| `skills-panel.tsx:3-7` | `useMimo`, `Card`, `Badge`, `Input` | lucide (1) |
| `tools-panel.tsx:3-6` | `useMimo`, `Card`, `Badge` | lucide (3) |
| `projects-panel.tsx:3-12` | `useMimo`, `safeFetch`, `Card`, `Badge`, `Button`, `Input`, `Textarea`, `t` | `useState`, lucide (4) |
| `command-palette.tsx:4-31` | `useMimo`, `Dialog*`, `Command*` | `useState`, `useEffect`, lucide (11) |
| `settings-dialog.tsx:3-14` | `useMimo`, `t`, `getDirection`, `listLocales`, `Dialog*`, `Button`, `ScrollArea`, `cn` | lucide (7) |
| `agent-icons.ts:3-20` | (none — just lucide) | lucide (15 icons) |

### State & Client Utilities (src/lib/)

| File | Imports |
|---|---|
| `mimo-store.ts:5-22` | `zustand`, types from `@/lib/ai-client`, `Locale`/`Direction` from `@/lib/i18n`, `safeFetch`/`ApiError` from `@/lib/safe-fetch` |
| `ai-client.ts:1` | (none — pure type declarations) |
| `safe-fetch.ts:1` | (none — pure fetch wrapper) |
| `i18n.ts:1` | (none — pure translation dictionary) |
| `db.ts:1` | `@prisma/client` |
| `utils.ts` | `clsx`, `tailwind-merge` (standard shadcn) |

### API Routes (src/app/api/)

| Route File | Imports from `@/lib` | Other |
|---|---|---|
| `chat/route.ts:5-9` | `db`, `executeTask`+`runAutonomousLoop` from `@/lib/ai/runtime`, `pickAgentForMessage` from `@/lib/ai/agents`, types from `@/lib/ai/types` | `NextRequest`, `NextResponse` |
| `preview/[id]/route.ts:4-5` | `db` | `NextRequest`, `NextResponse` |
| `conversations/route.ts:2-3` | `db` | `NextRequest`, `NextResponse` |
| `conversations/[id]/route.ts:2-3` | `db` | `NextRequest`, `NextResponse` |
| `projects/route.ts:2-3` | `db` | `NextRequest`, `NextResponse` |
| `projects/[id]/route.ts:2-3` | `db` | `NextRequest`, `NextResponse` |
| `state/route.ts:2-6` | `db`, `listAgents`, `listSkills`, `listTools` | `NextResponse` |
| `tools/route.ts:2-3` | `listTools` | `NextResponse` |
| `agents/route.ts:2-3` | `listAgents` | `NextResponse` |
| `skills/route.ts:2-3` | `searchSkills`, `listSkills` | `NextRequest`, `NextResponse` |
| `memory/route.ts:2-4` | `db`, `writeMemory`, `getAllMemories` | `NextRequest`, `NextResponse` |
| `tasks/route.ts:2-3` | `db` | `NextRequest`, `NextResponse` |
| `artifacts/route.ts:2-3` | `db` | `NextRequest`, `NextResponse` |
| `decisions/route.ts:2-3` | `db` | `NextRequest`, `NextResponse` |
| `route.ts:1` ☠️ | (none) | `NextResponse` |

### AI Runtime (src/lib/ai/)

| File | Imports from `@/` | Imports from npm |
|---|---|---|
| `runtime.ts:8-21` | `db`, `chat`+`chatStream`+`generateStructured` from `./model`, `assembleContext` from `./context`, `pickAgentForMessage`+`getAgent` from `./agents`, `executeTool` from `./tools`, `writeMemory` from `./memory`, `executeResponse` from `./execution-engine`, types from `./types` | (none) |
| `model.ts:9` | (none — internal) | `z-ai-web-dev-sdk` |
| `context.ts:8-11` | `db`, `retrieveMemories` from `./memory`, `getAgent` from `./agents`, types from `./types` | (none) |
| `memory.ts:5-6` | `db`, types from `./types` | (none) |
| `agents/index.ts:5` | types from `./types` (note: imports from `./types` which resolves to `src/lib/ai/types.ts`) | (none) |
| `tools/index.ts:5-10` | `fs/promises`, `path`, `invokeFunction` from `../model`, `writeMemory`+`retrieveMemories` from `../memory`, `db`, types from `../types` | (none) |
| `execution-engine.ts:12-14` | `fs/promises`, `path`, `db` | (none) |
| `skills/index.ts:5-7` | `fs/promises`, `path`, types from `../types` | (none) |
| `types.ts:1` | (none — pure type declarations) | (none) |

---

## 3. CIRCULAR DEPENDENCY CHECK

**No circular imports detected.** The dependency graph is acyclic:

```
types.ts ← (everything)
   ↑
agents/index.ts ← context.ts, runtime.ts, api/agents, api/state
memory.ts ← context.ts, runtime.ts, tools/index.ts, api/memory
model.ts ← runtime.ts, tools/index.ts
   ↑
context.ts ← runtime.ts
tools/index.ts ← runtime.ts
execution-engine.ts ← runtime.ts
   ↑
runtime.ts ← api/chat
   ↑
db.ts ← (every API + AI lib)
   ↑
api/* ← (fetch calls from mimo-store)
   ↑
mimo-store ← (every UI component)
   ↑
components/mimo/* ← workspace.tsx ← page.tsx
```

---

## 4. EXTERNAL DEPENDENCY MAP (npm)

### Used Dependencies

| Package | Used By | Purpose |
|---|---|---|
| `next` (16.1.1) | All routes, layout, page | Framework |
| `react`/`react-dom` (19) | All components | UI |
| `zustand` (5.0.6) | `mimo-store.ts` | Client state |
| `@prisma/client` (6.11.1) | `db.ts` | ORM |
| `prisma` (6.11.1) | CLI only | Schema → client |
| `z-ai-web-dev-sdk` (0.0.18) | `model.ts` | AI model + tools |
| `lucide-react` (0.525.0) | All components | Icons |
| `tailwind-merge` + `clsx` | `utils.ts` | Class merging |
| `class-variance-authority` | shadcn/ui components | Variants |
| `cmdk` (1.1.1) | `command-palette.tsx`, `ui/command.tsx` | Command palette |
| `date-fns` (4.1.0) | `sidebar.tsx` | Time formatting |
| `@radix-ui/react-*` (25 packages) | shadcn/ui components | Primitives |
| `tailwindcss` (4) + `@tailwindcss/postcss` | Build | CSS |
| `tw-animate-css` | `globals.css` | Animations |
| `sharp` (0.34.3) | Next.js image optimization | Image processing |

### Unused Dependencies (dead weight)

| Package | In `package.json` | Actual Usage |
|---|---|---|
| `next-auth` (4.24.11) | line 61 | **NOT USED** — no auth implemented |
| `next-intl` (4.3.4) | line 62 | **NOT USED** — custom `i18n.ts` instead |
| `next-themes` (0.4.6) | line 63 | **NOT USED** — custom theme logic in `workspace.tsx` |
| `react-markdown` (10.1.0) | line 69 | **NOT USED** — custom `markdown.tsx` instead |
| `react-syntax-highlighter` (15.6.1) | line 71 | **NOT USED** — `<pre>` plain text |
| `@tanstack/react-query` (5.82.0) | line 50 | **NOT USED** — Zustand loaders instead |
| `@tanstack/react-table` (8.21.3) | line 51 | **NOT USED** |
| `@mdxeditor/editor` (3.39.1) | line 20 | **NOT USED** |
| `recharts` (2.15.4) | line 72 | **NOT USED** — no charts |
| `react-resizable-panels` (3.0.3) | line 70 | **NOT USED** — fixed layout |
| `framer-motion` (12.23.2) | line 57 | **NOT USED** |
| `react-hook-form` (7.60.0) + `@hookform/resolvers` + `zod` (4.0.2) | lines 68, 19, 80 | **NOT USED** in MiMo code — only in shadcn `form.tsx` |
| `react-day-picker` (9.8.0) | line 66 | **NOT USED** in MiMo — only shadcn `calendar.tsx` |
| `embla-carousel-react` (8.6.0) | line 56 | **NOT USED** in MiMo — only shadcn `carousel.tsx` |
| `input-otp` (1.4.2) | line 58 | **NOT USED** in MiMo — only shadcn `input-otp.tsx` |
| `@dnd-kit/*` (3 packages) | lines 16-18 | **NOT USED** in MiMo — only shadcn |
| `@reactuses/core` (6.0.5) | line 49 | **NOT USED** |
| `vaul` (1.1.2) | line 78 | **NOT USED** in MiMo — only shadcn `drawer.tsx` |
| `sonner` (2.0.6) | line 74 | **NOT USED** in MiMo — `toaster.tsx` uses `@radix-ui/react-toast` |
| `uuid` (11.1.0) | line 77 | **NOT USED** — IDs generated via `Date.now()+Math.random()` |

**Total unused: ~20 packages** — significant install time + bundle size + attack surface.

### shadcn/ui Components (48 files, only 9 used by MiMo)

| Used by MiMo | File |
|---|---|
| ✅ | `button.tsx`, `card.tsx`, `badge.tsx`, `input.tsx`, `textarea.tsx`, `dialog.tsx`, `command.tsx`, `scroll-area.tsx`, `progress.tsx`, `separator.tsx`, `tabs.tsx` (workspace uses some) |
| ❌ Unused | `accordion.tsx`, `alert-dialog.tsx`, `alert.tsx`, `aspect-ratio.tsx`, `avatar.tsx`, `calendar.tsx`, `carousel.tsx`, `chart.tsx`, `checkbox.tsx`, `collapsible.tsx`, `context-menu.tsx`, `drawer.tsx`, `dropdown-menu.tsx`, `form.tsx`, `hover-card.tsx`, `input-otp.tsx`, `menubar.tsx`, `navigation-menu.tsx`, `pagination.tsx`, `popover.tsx`, `radio-group.tsx`, `select.tsx`, `sheet.tsx`, `sidebar.tsx` (shadcn's, not MiMo's), `skeleton.tsx`, `slider.tsx`, `sonner.tsx`, `switch.tsx`, `table.tsx`, `toast.tsx`, `toaster.tsx`, `toggle.tsx`, `toggle-group.tsx`, `tooltip.tsx` |

**~37 shadcn files unused.** Should be deleted to reduce maintenance + bundle.

---

## 5. RUNTIME DEPENDENCIES (filesystem + external services)

| Component | Depends On | Failure Mode |
|---|---|---|
| Model calls | ZAI SDK → external API | 429 rate limit → retry (model.ts:51-65) → eventual failure |
| Tool `web_search`/`web_reader` | ZAI SDK functions.invoke → external API | Same |
| Tool `file_read`/`file_write`/`file_search`/`code_search`/`patch` | Local filesystem `/home/z/my-project/` | Permission denied, disk full |
| Skills registry | `/home/z/my-project/skills/` directory | Empty array if missing (silent) |
| Execution engine | `/home/z/my-project/upload/` directory | Auto-created (execution-engine.ts:18-24) |
| Database | SQLite file (`DATABASE_URL`) | App crashes if file missing/unwritable |
| Preview iframe | `/api/preview/[id]` route | 404 if artifact deleted |

---

## 6. OWNERSHIP MAP (who calls whom)

### `runtime.ts` is the most-imported-from AI module
- Called by: `api/chat/route.ts:7`
- Imports from: 8 other AI modules + `db`
- **Criticality**: HIGH — single point of failure for all chat

### `mimo-store.ts` is the most-imported-from client module
- Called by: every UI component (17 files)
- Imports from: `ai-client`, `safe-fetch`, `i18n`
- **Criticality**: HIGH — single point of failure for all UI state

### `db.ts` is imported by everything that touches data
- Called by: 12 API routes + 4 AI lib files
- **Criticality**: CRITICAL — DB outage kills everything

### `agents/index.ts` is self-contained
- Imports: only `./types`
- Imported by: `context.ts`, `runtime.ts`, `api/agents`, `api/state`
- **Criticality**: LOW — pure data module

### `tools/index.ts` depends on `db`, `model`, `memory`
- Imported by: `runtime.ts:12`, `api/tools`, `api/state`
- **Criticality**: MEDIUM — but rarely invoked (parseToolCalls broken)

### `model.ts` is the gateway to external AI
- Imported by: `runtime.ts:9`, `tools/index.ts:7`
- **Criticality**: HIGH — ZAI SDK outage kills chat

---

## 7. DEAD CODE / UNREACHABLE MODULES

| Module | Status | Evidence |
|---|---|---|
| `src/app/api/route.ts` | ☠️ DEAD | Returns "Hello, world!" — no callers |
| `src/lib/ai/runtime.ts:88-133` `looksLikeArtifact` | ☠️ DEAD | Function defined but never called |
| `src/lib/ai/agents/index.ts:767-777` `shouldSuggestAutonomous` | ☠️ DEAD | Exported but never imported |
| `src/lib/ai/memory.ts:98-108` `getMemoriesByType` | ☠️ DEAD | Exported but never imported |
| `src/lib/ai/memory.ts:110-131` `consolidateMemories` | ☠️ DEAD | Exported but never imported |
| `src/lib/ai/execution-engine.ts:233-250` `getArtifactForPreview` | ☠️ DEAD | Exported but never imported (route queries DB directly) |
| `src/lib/ai/skills/index.ts:88-95` `getSkill` | ☠️ DEAD | Exported but never imported |
| `src/lib/ai/skills/index.ts:109-112` `clearSkillsCache` | ☠️ DEAD | Exported but never imported |
| `src/lib/i18n.ts:174-176` `getTranslations` | ☠️ DEAD | Exported but never imported |
| `src/lib/safe-fetch.ts:80-87` `checkServerHealth` | ☠️ DEAD | Exported but never imported |
| `src/components/ui/toaster.tsx` + `toast.tsx` | ☠️ DEAD | Imported by `layout.tsx:4` but `useToast` never called in MiMo |
| `examples/websocket/` | ☠️ DEAD | Example code, no integration |
| `tests/*.sh` | ⚠️ INCOMPLETE | Shell scripts for runtime builds, not unit tests |

---

## 8. RECOMMENDED CONSOLIDATIONS

1. **Merge `types.ts` and `ai-client.ts`** — near-identical types, manual sync is fragile.
2. **Remove unused npm packages** (~20) — reduces install time, bundle size, attack surface.
3. **Remove unused shadcn/ui components** (~37) — reduces maintenance burden.
4. **Delete dead exports** (10 functions listed above) — reduces code surface area.
5. **Single source of truth for "agent count" / "tool count" / "skill count"** — currently hardcoded in 3+ places (`settings-dialog.tsx:115`, `chat-panel.tsx:411`, `i18n.ts:43`).
6. **Remove `next-auth`, `next-intl`, `next-themes`, `react-markdown`, `react-syntax-highlighter`, `@tanstack/react-query`, `@tanstack/react-table`, `@mdxeditor/editor`, `recharts`, `react-resizable-panels`, `framer-motion`** unless planned for near-term use.
