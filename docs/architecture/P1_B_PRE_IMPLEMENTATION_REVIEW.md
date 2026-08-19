# P1-B Pre-Implementation Review

> READ-ONLY discovery. No source code modified.
> SUB-GATE B0: Discovery and documentation only.

---

## 1. What Currently Performs Filesystem Operations?

### Direct filesystem access exists in TWO files:

| File | Operations | Constants |
|------|-----------|-----------|
| `src/lib/ai/tools/index.ts` | `fs.stat`, `fs.readFile`, `fs.writeFile`, `fs.readdir`, `fs.mkdir` | `SANDBOX_ROOT = "/home/z/my-project"`, `UPLOAD_DIR = path.join(SANDBOX_ROOT, "upload")` |
| `src/lib/ai/execution-engine.ts` | `fs.writeFile`, `fs.stat`, `fs.mkdir` | `UPLOAD_DIR = "/home/z/my-project/upload"` (hardcoded, not imported from tools) |

### Files that do NOT directly access filesystem:
- `src/lib/ai/tool-caller.ts` — calls `executeTool()` which delegates to tools
- `src/lib/ai/runtime.ts` — calls `executeResponse()` which uses execution-engine
- `src/app/api/preview/[id]/route.ts` — reads from DB (Artifact.content), not filesystem
- `src/app/api/projects/route.ts` — DB only, no filesystem operations
- `src/app/api/projects/[id]/route.ts` — DB only, no filesystem operations

---

## 2. Which Tools Access the Filesystem Directly?

| Tool | Filesystem Access | Path Scope | Operations |
|------|-----------------|------------|------------|
| `file_read` | ✅ Direct | `SANDBOX_ROOT` (entire project) | `fs.stat`, `fs.readFile` |
| `file_write` | ✅ Direct | `UPLOAD_DIR` only | `fs.writeFile`, `fs.stat`, `fs.mkdir` |
| `file_search` | ✅ Direct | `SANDBOX_ROOT` (walks entire project) | `fs.readdir`, `fs.stat` |
| `code_search` | ✅ Direct | `SANDBOX_ROOT` (walks entire project) | `fs.readdir`, `fs.readFile` |
| `patch` | ✅ Direct | `UPLOAD_DIR` only | `fs.readFile`, `fs.writeFile`, `fs.stat` |
| `web_search` | ❌ No | N/A | ZAI SDK |
| `web_reader` | ❌ No | N/A | ZAI SDK |
| `memory_store` | ❌ No | N/A | Prisma DB |
| `knowledge_search` | ❌ No | N/A | Prisma DB |
| `diff` | ❌ No | N/A | String comparison only |

**5 tools need migration to WorkspaceService.**

---

## 3. Which Paths Are Currently Allowed?

### file_read (broadest access)
- **Root**: `/home/z/my-project/` (entire project directory)
- **Allowed**: Any file under SANDBOX_ROOT that passes `safeJoin()` + blocked patterns
- **Examples**: `src/lib/ai/model.ts`, `upload/test.html`, `prisma/schema.prisma`, `package.json`

### file_write (narrowest access)
- **Root**: `/home/z/my-project/upload/` only
- **Constraint**: Filename cannot contain `..` or `/`
- **Examples**: `upload/test.html`, `upload/script.py`

### file_search
- **Root**: `/home/z/my-project/` (walks entire project)
- **Skips**: Directories starting with `.`, `node_modules`, `__pycache__`
- **Max depth**: 5 levels

### code_search
- **Root**: `/home/z/my-project/` (walks entire project)
- **Extensions**: `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.json`, `.md`, `.prisma`, `.sql`, `.css`
- **Max file size**: 100KB
- **Skips**: Same as file_search

### patch
- **Root**: `/home/z/my-project/upload/` only
- **Constraint**: Filename cannot contain `..` or `/`

---

## 4. Which Paths Are Currently Blocked?

### file_read blocked patterns (regex):
```
/\.env/i         → .env, .env.local, .env.production
/\.db$/i         → custom.db, test.db
/\.sqlite$/i     → data.sqlite
/\.git\//i       → .git/config
/^\.git\//i      → .git/HEAD
/node_modules\//i → node_modules/anything
/^node_modules\//i
/\.next\//i      → .next/server
/^\.next\//i
```

### file_write constraints:
- No `..` in filename
- No `/` in filename
- Only `UPLOAD_DIR` directory

### safeJoin() path traversal protection:
```typescript
function safeJoin(base: string, target: string): string {
  const resolved = path.resolve(base, target);
  if (!resolved.startsWith(base)) {
    throw new Error(`Path traversal blocked: ${target}`);
  }
  return resolved;
}
```

### Security gaps identified:
1. **No symlink check** — `path.resolve` follows symlinks, could escape sandbox
2. **file_search/code_search don't use blockedPatterns** — they walk ALL directories (except hidden/node_modules)
3. **No project boundary** — all tools operate on entire SANDBOX_ROOT, no project scoping
4. **Two separate path constants** — `SANDBOX_ROOT` in tools/index.ts and `UPLOAD_DIR` in execution-engine.ts are independently hardcoded

---

## 5. Where Is Project Identity Known?

| Location | How | Available to tools? |
|----------|-----|-------------------|
| `Conversation.projectId` | Prisma field (nullable, FK to Project) | ❌ Not passed to tools |
| `ToolCallContext.conversationId` | Passed from runtime → tool-caller | ❌ No projectId in context |
| `Project` model | Prisma, has `id`, `name`, `type` | ❌ Not queried by tools |
| API `/api/projects` | Returns projects | ❌ Not used by tools |

**Current state**: Project identity exists in the database but is NEVER passed to tools or execution engine. Tools have no concept of "which project am I working in."

---

## 6. Where Is Workspace Identity Known?

**Nowhere.** There is no workspace concept in the current implementation.

- No `workspace/` directory exists on disk
- No `WorkspaceService` class exists
- No workspace ID is passed anywhere
- The closest concept is `SANDBOX_ROOT` (= `/home/z/my-project/`) which is the entire project directory

---

## 7. How Are Generated Files Currently Stored?

### From execution-engine.ts (AI-generated code blocks):
```
/home/z/my-project/upload/mimo-{timestamp}-{index}.{ext}
```
- Flat directory (no subdirectories)
- No project scoping
- Filename generated from timestamp + language extension
- Content stored in both: filesystem (upload/) + DB (Artifact.content)
- `Artifact.filePath` field exists in schema but is NEVER populated

### From file_write tool:
```
/home/z/my-project/upload/{filename}
```
- Flat directory
- Model provides filename
- No version history
- Overwrites existing files silently

### From patch tool:
```
/home/z/my-project/upload/{filename}
```
- Modifies existing file in upload/
- No diff/version stored before patching

---

## 8. How Are Artifacts Currently Stored?

### Artifact DB model:
```prisma
model Artifact {
  id              String   @id @default(cuid())
  conversationId  String   // FK to Conversation
  taskId          String?  // FK to Task (nullable)
  name            String   // filename
  type            String   // code | document | research_report | etc
  format          String   // markdown | json | typescript | html | etc
  content         String   // full file content stored in DB
  summary         String?
  filePath        String?  // NEVER POPULATED (always null)
  sizeBytes       Int
  tags            String?  // JSON array
  version         Int      @default(1) // ALWAYS 1 (no versioning)
}
```

### Artifact creation flow:
```
Model generates code block
  → execution-engine.ts:executeResponse()
  → Extracts code block from markdown
  → Writes file to /upload/{filename}
  → Creates Artifact record in DB with content
  → Returns artifact ID + preview URL
```

### Issues:
1. `filePath` field never populated — file exists on disk but DB doesn't track where
2. `version` field always 1 — no versioning
3. Content duplicated (in DB + on disk)
4. No link between Artifact and Project
5. No cleanup mechanism for orphaned files

---

## 9. Which Existing Database Models Represent Projects/Files?

| Model | Purpose | Filesystem Link | Used? |
|-------|---------|----------------|-------|
| `Project` | Project identity + metadata | ❌ No workspace dir | ✅ CRUD works |
| `Artifact` | Generated file metadata | `filePath` field (never populated) | ✅ Created by execution-engine |
| `Conversation.projectId` | Links conversation to project | N/A | ✅ Field exists, used in schema |
| `ProjectFile` | ❌ DOES NOT EXIST | N/A | N/A |
| `FileVersion` | ❌ DOES NOT EXIST | N/A | N/A |

**Current state**: No DB model tracks individual files. Artifact is the closest, but it stores content in DB (not file metadata). `filePath` exists but is never used.

---

## 10. What Can Be Wrapped Without Breaking Existing Functionality?

### Tools that can be wrapped with WorkspaceService (compatibility bridge):

| Tool | Current Direct Access | Can Wrap? | Migration Risk |
|------|---------------------|-----------|----------------|
| `file_read` | `fs.stat` + `fs.readFile` + `safeJoin` | ✅ Yes — replace direct calls with `WorkspaceService.readFile()` | LOW — same behavior, just routed through service |
| `file_write` | `fs.writeFile` + `fs.stat` + `fs.mkdir` | ✅ Yes — replace with `WorkspaceService.writeFile()` | LOW — same behavior |
| `file_search` | `fs.readdir` + `fs.stat` + `walkDir` | ✅ Yes — replace with `WorkspaceService.searchFiles()` | LOW — same behavior |
| `code_search` | `fs.readdir` + `fs.readFile` + `walkDir` | ✅ Yes — replace with `WorkspaceService.searchCode()` | LOW — same behavior |
| `patch` | `fs.readFile` + `fs.writeFile` + `fs.stat` | ✅ Yes — replace with `WorkspaceService.patchFile()` | LOW — same behavior |

### Execution engine that can be wrapped:

| Component | Current Direct Access | Can Wrap? | Migration Risk |
|-----------|---------------------|-----------|----------------|
| `execution-engine.ts` | `fs.writeFile` + `fs.stat` + `fs.mkdir` | ✅ Yes — replace with `WorkspaceService.writeFile()` | LOW — same behavior |

### What CANNOT be wrapped (must remain as-is):
- `preview/[id]/route.ts` — reads from DB, not filesystem
- `tool-caller.ts` — no direct filesystem access
- `runtime.ts` — no direct filesystem access
- All API routes (projects, artifacts, etc.) — DB only

---

## Migration Strategy (Compatibility Bridge)

### Phase B1: WorkspaceService Skeleton
```
WorkspaceService (new)
  ├── readFile(path) → calls existing safeJoin + fs.readFile + blockedPatterns
  ├── writeFile(path, content) → calls existing fs.writeFile to UPLOAD_DIR
  ├── searchFiles(pattern) → calls existing walkDir
  ├── searchCode(query) → calls existing walkDir
  ├── patchFile(path, find, replace) → calls existing fs.readFile + fs.writeFile
  └── validatePath(path) → calls existing safeJoin + blockedPatterns
```

### Phase B2: Migrate Read/Search
```
file_read.execute() → WorkspaceService.readFile()
file_search.execute() → WorkspaceService.searchFiles()
code_search.execute() → WorkspaceService.searchCode()
```

### Phase B3: Migrate Write/Edit/Delete
```
file_write.execute() → WorkspaceService.writeFile()
patch.execute() → WorkspaceService.patchFile()
execution-engine.executeResponse() → WorkspaceService.writeFile()
```

### Compatibility Bridge Pattern:
```typescript
// WorkspaceService initially delegates to existing logic:
class WorkspaceService {
  readFile(path: string) {
    // Same validation as current file_read tool
    // Same blockedPatterns
    // Same safeJoin
    // Same fs.readFile
    // Returns same structure
  }
}
```

**Key principle**: WorkspaceService initially does EXACTLY what the tools do now. No behavior change. Just moves the logic to a central location.

---

## Path Security Gap Analysis

| Gap | Current | After WorkspaceService |
|-----|---------|----------------------|
| Symlink escape | ❌ Not checked | ✅ `fs.realpath()` + verify within root |
| Absolute paths | ⚠️ `safeJoin` blocks via `startsWith` | ✅ Reject absolute paths explicitly |
| `../` traversal | ✅ `safeJoin` blocks | ✅ Same + `path.normalize()` |
| Blocked patterns | ✅ In file_read only | ✅ In WorkspaceService (all operations) |
| file_search walks sensitive dirs | ❌ No blockedPatterns | ✅ WorkspaceService enforces |
| code_search reads sensitive files | ❌ No blockedPatterns | ✅ WorkspaceService enforces |
| Project boundary | ❌ Does not exist | ⚠️ P2 (not B1) |
| Workspace boundary | ❌ Does not exist | ✅ B1 (workspace root validation) |

---

## Summary

| Question | Answer |
|----------|--------|
| 1. What performs filesystem operations? | `tools/index.ts` (5 tools) + `execution-engine.ts` |
| 2. Which tools access filesystem? | file_read, file_write, file_search, code_search, patch |
| 3. Which paths are allowed? | file_read: entire SANDBOX_ROOT; file_write/patch: UPLOAD_DIR only |
| 4. Which paths are blocked? | .env, .db, .git/, node_modules/, .next/ (file_read only) |
| 5. Where is project identity known? | Conversation.projectId in DB — NOT passed to tools |
| 6. Where is workspace identity known? | NOWHERE — no workspace concept exists |
| 7. How are generated files stored? | Flat /upload/ directory, no project scoping |
| 8. How are artifacts stored? | DB (Artifact.content) + filesystem (upload/) — duplicated, not linked |
| 9. Which DB models represent projects/files? | Project (metadata), Artifact (generated content) — no ProjectFile model |
| 10. What can be wrapped? | All 5 tools + execution-engine — LOW risk compatibility bridge |

---

## SUB-GATE B0: COMPLETE

No source code was modified.
Waiting for approval to proceed to SUB-GATE B1 (WorkspaceService skeleton).
