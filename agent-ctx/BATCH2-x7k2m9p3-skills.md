# BATCH 2: x7k2m9p3 skills

## What was copied

Copied 65 skill directories from `/tmp/all_repos/x7k2m9p3/skills/` → `/tmp/workspace_extract/skills/imported/`.

### Skipped (Python-only, aminer-*)
- aminer-academic-search (Python)
- aminer-daily-paper (Python)
- aminer-deep-search (Python)
- aminer-free-academic (Python, aminer-* family)

### Filtering rules
- Excluded `__pycache__/` and `*.pyc` files (compiled Python bytecode — irrelevant to TS workspace).
- Used `rsync -a` to preserve directory structure with a single subdirectory per skill.

### Categories represented
- AI integrations: ASR, LLM, TTS, VLM, image-generation, image-edit, image-search, image-understand, video-generation, video-understand, podcast-generate
- Document creation: pdf, xlsx, pptx, docx, charts
- Web/Research: web-search, web-reader, web-shader-extractor, multi-search-engine, agent-browser
- Life/Work: resume-builder, jd-resume-tailor, job-intent-tracker, interview-prep, interview-designer, get-fortune-analysis
- Education: gaokao-* (5 skills), quiz-html, quiz-mastery, study-buddy, literature-survey
- Writing/Marketing: blog-writer, seo-content-writer, content-strategy, marketing-mode, cheat-sheet, writing-plans
- Design/UI: design (48MB), ui-ux-pro-max, visual-design-foundations, fullstack-dev
- Misc: anti-pua, auto-target-tracker, coding-agent, contentanalysis, dream-interpreter, experiment-suite, finance, gift-evaluator, mindfulness-meditation, qingyan-research, research-explorer, skill-creator, skill-finder-cn, stock-analysis-skill, storyboard-manager, task-review, version-management, ai-news-collectors

## Manager update (`src/lib/skills/manager.ts`)

- Added `loadImportedSkills()` — recursively scans `<workspace>/skills/imported/*/SKILL.md`.
- Parses YAML frontmatter (via `js-yaml`) for `name`, `description`, `triggers`, `category`, `version`, `license`.
- Body of SKILL.md becomes the skill's `instructions`.
- Auto-generates triggers from skill name when none declared.
- Cached result (`importedSkillsCache`); `invalidateImportedSkillsCache()` for refresh.
- Updated `detectSkills()` to consider both builtin + imported skills.
- Updated `listSkills()` to expose both builtin + imported in the UI.
- New `Skill.source` field: `"builtin" | "imported" | "custom"`.

## New dependency
- `js-yaml@5.3.0` + `@types/js-yaml` — installed for frontmatter parsing.

## Verification
- All 65 SKILL.md files are non-empty and parseable (smallest 564B, largest 58KB).
- `npx tsc --noEmit` → 0 errors
- `npx eslint src/ --quiet` → 0 errors

## Notes
- The existing `skills/*.json` (nextjs, typescript, debugging, testing, refactoring, python) files in the workspace root are unchanged — they're loaded by `loadCustomSkills()` looking at `.mimo/skills/*.json`. The manager now reads both builtin JSON-style skills AND imported SKILL.md-style skills.
