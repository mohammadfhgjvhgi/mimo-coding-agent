# Final System Boundaries — Critical Distinctions

> The architecture must NOT treat these as the same thing.

---

## State Hierarchy

```
GENERATED TEXT          — model output (string in Message.content)
    ↓ (if contains code block)
GENERATED CODE          — code block extracted from text
    ↓ (if execution engine writes to disk)
CREATED FILE            — file on disk in /upload/ or workspace
    ↓ (if file is modified)
MODIFIED FILE           — file changed (patch, edit)
    ↓ (if file belongs to a project)
PROJECT FILE            — file in project workspace directory
    ↓ (if stored as Artifact record)
ARTIFACT                — DB record tracking the file (content, format, version)
    ↓ (if project has build config)
BUILT PROJECT           — project compiled/bundled successfully
    ↓ (if tests exist and pass)
TESTED PROJECT          — tests executed, results captured
    ↓ (if app can start)
EXECUTED PROJECT        — app process started, listening on port
    ↓ (if accessible via URL)
RUNNING APPLICATION     — live app serving requests
    ↓ (if rendered in browser)
LIVE PREVIEW            — user can see and interact with the app
```

---

## Detailed Definitions

### 1. GENERATED TEXT
- **What**: Raw model output string
- **Owner**: Model Layer → Runtime Layer → Message DB
- **Storage**: `Message.content` in database
- **Example**: "Here's an HTML page: ```html ... ```"
- **Transition to next**: Execution engine scans for code blocks

### 2. GENERATED CODE
- **What**: Code block extracted from model text
- **Owner**: Execution Engine (`execution-engine.ts:extractCodeBlocks`)
- **Storage**: In-memory only (not persisted separately)
- **Example**: The content between ```html and ```
- **Transition to next**: Execution engine writes to disk

### 3. CREATED FILE
- **What**: File written to disk
- **Owner**: Execution Engine → filesystem (`/upload/` or workspace)
- **Storage**: Physical file on disk
- **Example**: `/upload/mimo-1234567890-0.html`
- **Transition to next**: If file is in project workspace, becomes PROJECT FILE

### 4. MODIFIED FILE
- **What**: Existing file changed
- **Owner**: File tools (patch, edit) — NOT YET IMPLEMENTED
- **Storage**: Physical file (old version lost without versioning)
- **Example**: Editing `index.html` to add a section
- **Transition to next**: If in project workspace, stays PROJECT FILE
- **MISSING**: No diff, no rollback, no version history

### 5. PROJECT FILE
- **What**: File belonging to a project workspace
- **Owner**: Workspace Layer — NOT YET IMPLEMENTED
- **Storage**: `/workspace/projects/{projectId}/` directory
- **Example**: `/workspace/projects/abc123/index.html`
- **MISSING**: Current system has no project-scoped file storage

### 6. ARTIFACT
- **What**: DB record tracking a created/modified file
- **Owner**: Execution Engine → Artifact DB model
- **Storage**: `Artifact` table (content, format, type, size)
- **Example**: `{ id: "...", name: "welcome.html", type: "code", format: "html" }`
- **Current state**: Works but no versioning, no link to file on disk

### 7. BUILT PROJECT
- **What**: Project compiled/bundled successfully
- **Owner**: Runtime Layer — NOT YET IMPLEMENTED
- **Storage**: Build output directory
- **Example**: `next build` output in `.next/`
- **MISSING**: No build capability exists

### 8. TESTED PROJECT
- **What**: Tests executed, results captured
- **Owner**: Runtime Layer — NOT YET IMPLEMENTED
- **Storage**: Test results in ExecutionLog or separate TestResult model
- **Example**: `bun run test` → 27 passed, 3 failed
- **MISSING**: No test execution exists

### 9. EXECUTED PROJECT
- **What**: App process started, listening on port
- **Owner**: Runtime Layer — NOT YET IMPLEMENTED
- **Storage**: Process metadata (PID, port, status)
- **Example**: `bun run dev` → process on port 3001
- **MISSING**: No process management exists

### 10. RUNNING APPLICATION
- **What**: Live app serving requests
- **Owner**: Runtime Layer — NOT YET IMPLEMENTED
- **Storage**: URL + health status
- **Example**: `http://localhost:3001` returns 200
- **MISSING**: No app lifecycle management

### 11. LIVE PREVIEW
- **What**: User can see and interact with the app in browser
- **Owner**: Preview Layer
- **Storage**: iframe URL
- **Current state**: HTML-only preview works. No app preview.
- **Example**: iframe pointing to `/api/preview/{artifactId}` for static HTML
- **MISSING**: No preview for running apps, multi-file projects, Markdown, JSON

---

## Which Subsystem Owns Each Transition

| Transition | Owner | Current Status |
|-----------|-------|----------------|
| Text → Code | Execution Engine | ✅ Works |
| Code → File | Execution Engine | ✅ Works |
| File → Modified File | File Tools | ❌ Missing |
| File → Project File | Workspace Layer | ❌ Missing |
| File → Artifact | Execution Engine | ✅ Works |
| Artifact → Built Project | Runtime Layer | ❌ Missing |
| Built → Tested | Runtime Layer | ❌ Missing |
| Tested → Executed | Runtime Layer | ❌ Missing |
| Executed → Running | Runtime Layer | ❌ Missing |
| Running → Live Preview | Preview Layer | ❌ Missing (HTML only) |

---

## Key Architectural Rule

**The current system conflates "created a file" with "executed a project".**

When the user says "build this and show me", the system:
1. ✅ Generates text (model)
2. ✅ Extracts code (execution engine)
3. ✅ Writes file (execution engine)
4. ✅ Creates artifact (DB)
5. ✅ Shows HTML preview (iframe)
6. ❌ Does NOT build
7. ❌ Does NOT test
8. ❌ Does NOT run
9. ❌ Does NOT verify

**This is file creation + static preview, NOT project execution.**

The architecture must explicitly distinguish these states and only claim "executed" when the project actually runs.
