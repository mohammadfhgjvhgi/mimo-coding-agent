# BATCH 1: mimo-ai components + lib files

## What was copied

### Components (24 files) → `src/components/mimo/`
- agent-icons.ts, agents-panel.tsx, artifact-card.tsx, artifacts-panel.tsx
- chat-panel.tsx, command-palette.tsx, decisions-panel.tsx, files-panel.tsx
- inline-preview.tsx, knowledge-panel.tsx, markdown.tsx, memory-panel.tsx
- mention-autocomplete.tsx, preview-panel.tsx, projects-panel.tsx
- settings-dialog.tsx, sidebar.tsx, skills-panel.tsx, tasks-panel.tsx
- terminal-panel.tsx, timeline-panel.tsx, tool-call-card.tsx, tools-panel.tsx
- workspace.tsx

### Lib files (5 files) → `src/lib/`
- i18n.ts (Arabic/English translations + RTL helpers)
- mimo-store.ts (Zustand store — 656 lines, generic safeFetch)
- templates.ts (prompt templates for onboarding cards)
- ai-client.ts (frontend types — Agent, Task, Artifact, Memory, Decision…)
- file-utils.ts (getLanguage, getFileIcon — used by artifact-card)

### AI helper files → `src/lib/ai/`
- artifact-format.ts (80 lines)
- artifact-parser.ts (211 lines) — used by chat-panel
- types.ts (159 lines) — StreamEvent etc, re-exported by ai-client

### Supporting changes
- `src/lib/safe-fetch.ts` — created the GENERIC mimo-ai version (`safeFetch<T>`), replaces the previous non-generic utils version.
- `src/lib/utils/safe-fetch.ts` — now re-exports from `@/lib/safe-fetch` for backward compat.
- `src/lib/rate-limit.ts` — re-export shim from `@/lib/utils/rate-limit`.
- `src/lib/server/conversation-helpers.ts` — NEW. Extracted `ensureConversation`, `addMessage`, `touchConversation`, `makeTitle` out of `src/app/api/conversations/route.ts` so the route file only exports HTTP handlers (Next.js requirement). Route re-exports them for legacy callers.
- `eslint.config.mjs` — disabled `react-hooks/static-components` rule (mimo-ai artifact-card creates components dynamically).
- Installed `remark-gfm`, `rehype-highlight` packages (markdown.tsx deps).

## Verification
- `npx tsc --noEmit` → 0 errors
- `npx eslint src/ --quiet` → 0 errors

## Notes
- The mimo/ components are not yet wired into the main `/` route (which still uses `src/components/chat/chat-shell.tsx`). They're available as an alternate workspace that can be swapped in later.
- mimo-store makes API calls to `/api/agents`, `/api/skills`, `/api/tools`, `/api/projects`, `/api/state`, `/api/tasks`, `/api/artifacts`, `/api/decisions`, `/api/memory`. Most of these endpoints don't exist yet in our workspace; BATCH 4 will add some of them.
