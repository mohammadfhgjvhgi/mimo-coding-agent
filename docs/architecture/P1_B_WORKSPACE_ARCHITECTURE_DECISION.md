# P1-B Workspace Architecture Decision

> READ-ONLY architecture decision. No source code modified.
> SUB-GATE B0.5: Final design review before implementation.

---

## 1. Current State

### Filesystem Access Today
- **5 tools** (`file_read`, `file_write`, `file_search`, `code_search`, `patch`) access filesystem directly
- **1 execution engine** (`execution-engine.ts`) writes generated code to `/upload/`
- **2 hardcoded constants**: `SANDBOX_ROOT = "/home/z/my-project"` and `UPLOAD_DIR = "/home/z/my-project/upload"`
- **No workspace directory** exists
- **No project-scoped file operations**
- **`/upload/`** is a flat directory with 13 generated files

### Security Today
- `file_read`: blocked patterns (`.env`, `.db`, `.git/`, `node_modules/`, `.next/`) + `safeJoin()`
- `file_write`: `/upload/` only, no `..` or `/` in filename
- `file_search`/`code_search`: ⚠️ NO blocked patterns (can discover/read sensitive files)
- `patch`: `/upload/` only
- **No symlink check** anywhere
- **No project boundary** enforcement

### Research Alignment
- ADR-004: Embedded storage (SQLite) — ✅ Already implemented
- ADR-005: Tiered sandboxing — ❌ Not implemented (tools run in-process)
- Research `WORKSPACE_FILE_MODEL.md`: Proposes `/workspace/projects/{projectId}/` structure — ❌ Not implemented

---

## 2. Target Architecture

### Canonical Boundary

```
USER
  ↓
CHAT API
  ↓
RUNTIME (executeTask)
  ↓
MODEL (with tool schemas)
  ↓
TOOL CALL (native function calling)
  ↓
TOOL-CALLER (validate → permission → execute)
  ↓
TOOL ADAPTER (file_read, file_write, etc.)
  ↓
WORKSPACE SERVICE ← CANONICAL FILESYSTEM AUTHORITY
  ↓
PATH VALIDATOR (normalize + resolve + verify within boundary)
  ↓
FILESYSTEM (fs.readFile, fs.writeFile, etc.)
  ↓
STRUCTURED RESULT
  ↓
TOOL-CALLER → MODEL → FINAL RESPONSE
```

### Why Agent/Tool Must NOT Directly Access Filesystem

1. **Security**: Tools are invoked by model output. Model output is untrusted. If tools directly access filesystem, a crafted tool call could bypass security.
2. **Consistency**: 5 tools currently implement path validation independently. Inconsistencies exist (file_search has no blocked patterns).
3. **Auditability**: Direct filesystem access is not logged. WorkspaceService logs all operations.
4. **Project scoping**: Tools have no concept of "which project". WorkspaceService enforces project boundaries.
5. **Future extensibility**: Versioning, diffs, rollback all need a central interception point.

---

## 3. Workspace vs Project vs File

### Concept Definitions

| Concept | Definition | Owner | Storage Location | Who Can Modify | Lifecycle |
|---------|-----------|-------|-----------------|---------------|-----------|
| **Workspace** | Root container for all user-generated files | System | `/home/z/my-project/workspace/` | System only | Permanent |
| **Project** | A logical grouping of files + conversations + artifacts | User (via API) | `workspace/projects/{projectId}/` | User + System | Until deleted |
| **Directory** | A folder within a project | System (via tools) | `workspace/projects/{projectId}/src/` etc. | Tools via WorkspaceService | Until deleted |
| **File** | A file on disk within a project or workspace | System (via tools) | `workspace/projects/{projectId}/...` or `workspace/shared/` | Tools via WorkspaceService | Until deleted |
| **Artifact** | A DB record tracking a generated file's metadata + content | Execution Engine | DB (Artifact table) + filesystem (file path) | Execution Engine | Until conversation deleted |
| **Generated File** | A file created by AI (execution engine or tool) | Execution Engine / Tool | Initially in `workspace/generated/`, may become Project File | Execution Engine / Tool | Until moved or deleted |
| **Project File** | A file that belongs to a specific project | User or AI (with project context) | `workspace/projects/{projectId}/` | Tools via WorkspaceService (with projectId) | Until project deleted |
| **Temporary File** | A file created for intermediate processing | System | `workspace/tmp/` | System only | Auto-cleaned |
| **Build Output** | Output from build process (future) | Runtime Service (future) | `workspace/projects/{projectId}/.build/` | Runtime Service | Until rebuild |

### Key Distinctions

**Is an Artifact a Project File?**
- **No.** An Artifact is a DB record. The file on disk is a File. The Artifact tracks the file's metadata (name, type, format, content copy). A File can exist without an Artifact. An Artifact can reference a File via `filePath`.

**Does a Generated File automatically become a Project File?**
- **No.** Currently, generated files go to `/upload/` (flat, no project). In the new architecture, generated files go to `workspace/generated/` unless a projectId is provided. If a projectId is provided, they go to `workspace/projects/{projectId}/`. The execution engine would need to be updated to pass projectId (P2 task).

**How to distinguish temporary files from project files?**
- **Location**: Temporary files are in `workspace/tmp/`. Project files are in `workspace/projects/{projectId}/`.
- **Naming**: Temporary files have `tmp-` prefix. Project files have meaningful names.
- **Cleanup**: Temporary files are auto-deleted after 24 hours (future). Project files persist until explicitly deleted.

---

## 4. Path Model

### Proposed Directory Structure

```
/home/z/my-project/
├── workspace/                    ← WORKSPACE ROOT (new)
│   ├── generated/                ← AI-generated files (replaces /upload/ for new files)
│   │   ├── mimo-{timestamp}-0.html
│   │   └── ...
│   ├── projects/                 ← Project-scoped files (future, P2)
│   │   └── {projectId}/          ← One directory per project
│   │       ├── src/
│   │       ├── public/
│   │       ├── docs/
│   │       └── .mimo/            ← Project metadata
│   ├── shared/                   ← Files shared across projects (future)
│   └── tmp/                      ← Temporary files (future)
│
├── upload/                       ← LEGACY COMPATIBILITY (kept for existing files)
│   ├── mimo-{timestamp}-0.html   ← Existing generated files stay here
│   └── ...                       ← Read-only from WorkspaceService (no new writes)
│
├── src/                          ← Application source code (NOT in workspace)
├── prisma/                       ← Database schema (NOT in workspace)
├── skills/                       ← Skills (NOT in workspace)
└── ...
```

### Path Rules

| Path | WorkspaceService Access | Reason |
|------|------------------------|--------|
| `workspace/generated/` | ✅ Read + Write | New generated files |
| `workspace/projects/{id}/` | ✅ Read + Write (future P2) | Project files |
| `workspace/shared/` | ✅ Read + Write (future) | Shared resources |
| `workspace/tmp/` | ✅ Read + Write (future) | Temporary files |
| `upload/` | ✅ Read-only | Legacy files (backward compatibility) |
| `src/` | ✅ Read-only | Application source (file_read) |
| `prisma/` | ✅ Read-only | Schema files (file_read) |
| `public/` | ✅ Read-only | Public assets (file_read) |
| `.env` | ❌ BLOCKED | Secrets |
| `*.db` | ❌ BLOCKED | Database files |
| `.git/` | ❌ BLOCKED | Version control |
| `node_modules/` | ❌ BLOCKED | Dependencies |
| `.next/` | ❌ BLOCKED | Build cache |

### /upload/ Decision
- **Keep as legacy compatibility area** — existing files stay there
- **No new writes to /upload/** — new generated files go to `workspace/generated/`
- **WorkspaceService can read from /upload/** — backward compatibility for existing artifacts
- **Eventually deprecate** — P6 task, after all references migrated

### M:/mimo_storage
- **No relation** — no `M:` drive or `mimo_storage` directory exists in this environment
- **Not relevant** to this architecture

---

## 5. Path Security Model

### Security Layers (Defense in Depth)

```
Layer 1: Input Validation
  → Reject empty paths
  → Reject absolute paths (starting with /)
  → Reject paths with null bytes

Layer 2: Path Normalization
  → path.normalize() to resolve . and ..
  → path.resolve(basePath, normalizedPath) to get absolute path

Layer 3: Symlink Resolution
  → fs.realpath() to resolve symlinks to their actual target
  → Verify resolved path starts with authorized root

Layer 4: Boundary Check
  → resolved path must start with one of:
    - /home/z/my-project/workspace/
    - /home/z/my-project/upload/ (read-only)
    - /home/z/my-project/src/ (read-only)
    - /home/z/my-project/prisma/ (read-only)
    - /home/z/my-project/public/ (read-only)

Layer 5: Blocked Patterns
  → Even within authorized roots, block:
    - .env, .env.*
    - *.db, *.sqlite
    - .git/**
    - node_modules/**
    - .next/**
```

### Symlink Attack Prevention

```typescript
async function validatePath(requestedPath: string, allowedRoots: string[], mustExist: boolean): Promise<string> {
  // Layer 1: Input validation
  if (!requestedPath || requestedPath.includes('\0')) {
    throw new Error('Invalid path: empty or contains null bytes');
  }
  if (path.isAbsolute(requestedPath)) {
    throw new Error('Absolute paths are not allowed');
  }

  // Layer 2: Normalize
  const normalized = path.normalize(requestedPath);

  // Layer 3: Resolve against each allowed root
  for (const root of allowedRoots) {
    const resolved = path.resolve(root, normalized);

    // Layer 3b: Symlink resolution
    let realPath: string;
    try {
      realPath = await fs.realpath(resolved);
    } catch {
      if (mustExist) throw new Error(`Path does not exist: ${normalized}`);
      continue; // Path doesn't exist yet (for write operations)
    }

    // Layer 4: Boundary check — realpath must be within an allowed root
    const isWithinRoot = allowedRoots.some(root => realPath.startsWith(root + '/') || realPath === root);
    if (!isWithinRoot) {
      throw new Error(`Path escapes workspace boundary: ${normalized} → ${realPath}`);
    }

    // Layer 5: Blocked patterns
    if (isBlocked(normalized)) {
      throw new Error(`Access denied: ${normalized}`);
    }

    return realPath;
  }

  throw new Error(`Path not within any allowed root: ${normalized}`);
}
```

### Key Security Rule

**RESOLVED REAL PATH must remain inside AUTHORIZED WORKSPACE/PROJECT ROOT.**

Not just `path.resolve()` — `fs.realpath()` to follow symlinks to their actual target, THEN verify the target is within an authorized root.

---

## 6. File Operations Contract

### Structured Operation Result

```typescript
interface WorkspaceResult {
  success: boolean;
  operation: string;           // "read" | "write" | "search" | etc.
  path?: string;                // resolved path (relative to workspace root)
  absolutePath?: string;        // absolute path (internal, not exposed to model)
  data?: unknown;               // file content, search results, etc.
  metadata?: {
    size?: number;
    modified?: Date;
    type?: "file" | "directory";
  };
  error?: string;               // user-friendly error message
  diagnostics?: {               // internal diagnostics (logged, not sent to model)
    code: string;               // "PATH_TRAVERSAL" | "BLOCKED_PATTERN" | "NOT_FOUND" | etc.
    detail: string;
  };
}
```

### Operation Contracts

| Operation | Input | Output | Validation | Permission | Error Model | Audit |
|-----------|-------|--------|-----------|------------|-------------|-------|
| **read** | `{ path }` | `{ success, data: content, metadata: { size } }` | Path must be file, ≤50KB, within allowed roots | Read access to path | `NOT_FOUND`, `TOO_LARGE`, `ACCESS_DENIED` | ✅ Log path + size |
| **search** | `{ pattern, maxResults? }` | `{ success, data: [{ path, size }] }` | Pattern is string, maxResults ≤ 50 | Read access to search root | `ACCESS_DENIED` | ✅ Log pattern + count |
| **write** | `{ path, content }` | `{ success, path, metadata: { size } }` | Path within write-allowed roots, filename sanitized | Write access to path | `ACCESS_DENIED`, `INVALID_FILENAME` | ✅ Log path + size |
| **edit** | `{ path, edits: [{ line, content }] }` | `{ success, path, metadata: { size } }` | Path must exist, edits are valid | Write access to path | `NOT_FOUND`, `ACCESS_DENIED` | ✅ Log path + edit count |
| **patch** | `{ path, find, replace }` | `{ success, path, patched: bool, metadata: { size } }` | Path must exist, find non-empty | Write access to path | `NOT_FOUND`, `ACCESS_DENIED`, `FIND_NOT_FOUND` | ✅ Log path |
| **delete** | `{ path }` | `{ success, path }` | Path must exist, within write-allowed roots | Write access + delete permission | `NOT_FOUND`, `ACCESS_DENIED` | ✅ Log path |
| **rename** | `{ from, to }` | `{ success, from, to }` | Both paths within write-allowed roots | Write access to both | `NOT_FOUND`, `ACCESS_DENIED`, `TARGET_EXISTS` | ✅ Log from + to |
| **mkdir** | `{ path }` | `{ success, path }` | Path within write-allowed roots | Write access | `ACCESS_DENIED`, `ALREADY_EXISTS` | ✅ Log path |
| **list** | `{ path }` | `{ success, data: [{ name, type, size }] }` | Path must be directory | Read access | `NOT_FOUND`, `NOT_DIRECTORY`, `ACCESS_DENIED` | ✅ Log path |
| **stat** | `{ path }` | `{ success, metadata: { size, modified, type } }` | Path must exist | Read access | `NOT_FOUND`, `ACCESS_DENIED` | ✅ Log path |
| **diff** | `{ old, new }` | `{ success, data: diff result }` | Both are strings | N/A (no filesystem) | N/A | ❌ No audit needed |

---

## 7. Tool Boundary

### Current → Target

```
CURRENT:
file_read  → safeJoin + blockedPatterns + fs.readFile
file_write → path.join + fs.writeFile
file_search → walkDir + fs.readdir
code_search → walkDir + fs.readdir + fs.readFile
patch      → path.join + fs.readFile + fs.writeFile

TARGET:
file_read  → WorkspaceService.read()
file_write → WorkspaceService.write()
file_search → WorkspaceService.search()
code_search → WorkspaceService.searchCode()
patch      → WorkspaceService.patch()
```

### Tool as Adapter

Tools become thin adapters:

```typescript
// Example: file_read after migration
file_read: {
  name: "file_read",
  description: "Read a file from the workspace...",
  inputSchema: { ... },
  riskLevel: "low",
  timeoutMs: 5000,
  execute: async (input) => {
    const result = await WorkspaceService.read(String(input.path));
    if (!result.success) {
      throw new Error(result.error);
    }
    return result.data;
  },
}
```

**Tools no longer contain:**
- `safeJoin()` — moved to WorkspaceService
- `blockedPatterns` — moved to WorkspaceService
- `SANDBOX_ROOT` / `UPLOAD_DIR` constants — moved to WorkspaceService
- `walkDir()` — moved to WorkspaceService
- `fs.*` calls — moved to WorkspaceService

**Tools still contain:**
- Tool name, description, schema (for model)
- Risk level, timeout (for permission/execution)
- Input parsing (string → typed)
- Output formatting (WorkspaceResult → tool-specific output)

---

## 8. Execution Engine Boundary

### Current Problem
`execution-engine.ts` directly writes files to `/upload/` AND creates Artifact records. It conflates:
- File creation (filesystem operation)
- Artifact creation (DB record)
- Preview detection (content analysis)

### Target: Separate Responsibilities

```
Execution Engine (response processing)
  ↓ extracts code blocks from model response
  ↓
WorkspaceService.write()  ← writes file to filesystem
  ↓ returns file path
  ↓
Artifact creation (DB record)  ← stores metadata + content copy
  ↓ returns artifact ID
  ↓
Preview detection  ← checks if file is previewable
  ↓ returns preview URL
```

### What Execution Engine should NOT do:
- ❌ Direct `fs.writeFile()` calls
- ❌ Hardcode `UPLOAD_DIR`
- ❌ Decide where files go (WorkspaceService decides)
- ❌ Handle path validation (WorkspaceService handles)

### What Execution Engine should do:
- ✅ Extract code blocks from model response
- ✅ Call `WorkspaceService.write()` with filename + content
- ✅ Create Artifact record with `filePath` populated (from WorkspaceService result)
- ✅ Determine if file is previewable (from WorkspaceService metadata)

---

## 9. Database Boundary

### Current Models

| Model | Purpose | Status |
|-------|---------|--------|
| `Project` | Project metadata | ✅ Works, no filesystem link |
| `Artifact` | Generated file metadata | ✅ Works, `filePath` never populated |
| `Conversation.projectId` | Links conversation to project | ✅ Field exists |

### Future Models (NOT for P1-B — design only)

| Model | Purpose | When |
|-------|---------|------|
| `ProjectFile` | File metadata within a project | P2 (when project workspace implemented) |
| `FileVersion` | Version history for ProjectFile | P2 (after ProjectFile) |
| `Build` | Build result metadata | P3 (when build system implemented) |
| `Execution` | Execution/run metadata | P3 (when runtime implemented) |

### ProjectFile vs Artifact

| Aspect | ProjectFile | Artifact |
|--------|------------|----------|
| What it represents | A real file on disk within a project | A generated output (code, doc, report) |
| Filesystem link | ✅ Direct (path is authoritative) | ⚠️ Content stored in DB + optional filePath |
| Created by | User or AI (with project context) | AI (execution engine) |
| Versioned | ✅ Yes (via FileVersion) | ⚠️ version field exists, always 1 |
| Lifecycle | Lives with project | Lives with conversation |
| Relationship | ProjectFile can be referenced by Artifact | Artifact can reference ProjectFile via filePath |

**Decision**: ProjectFile represents the actual file on disk. Artifact represents the metadata of a generated output. They are different concepts and should NOT be merged.

---

## 10. Compatibility Strategy

### Migration Principle
**No behavior change.** WorkspaceService initially does EXACTLY what tools do now.

### Migration Order

```
Step 1 (B1): Create WorkspaceService
  - Move safeJoin, blockedPatterns, SANDBOX_ROOT, UPLOAD_DIR to WorkspaceService
  - Implement: read, write, search, searchCode, patch
  - WorkspaceService writes to /upload/ (same as current)
  - No tool changes yet

Step 2 (B2): Migrate Read/Search
  - file_read.execute() → WorkspaceService.read()
  - file_search.execute() → WorkspaceService.search()
  - code_search.execute() → WorkspaceService.searchCode()
  - Verify: same behavior, same paths, same results

Step 3 (B3): Migrate Write/Edit
  - file_write.execute() → WorkspaceService.write()
  - patch.execute() → WorkspaceService.patch()
  - execution-engine.executeResponse() → WorkspaceService.write()
  - Verify: same behavior, same paths, same results
```

### Backward Compatibility

| Concern | Strategy |
|---------|---------|
| Existing files in /upload/ | WorkspaceService can read from /upload/ (read-only) |
| Existing artifacts with content in DB | No change — Artifact.content still stores content |
| Existing tool behavior | WorkspaceService initially uses same paths, same validation |
| Existing preview API | No change — reads from DB, not filesystem |

---

## 11. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| WorkspaceService introduces latency | LOW | Minimal overhead (function call vs direct fs) |
| Path validation inconsistency during migration | MEDIUM | Migrate one tool at a time, test after each |
| Symlink resolution fails on non-existent paths | LOW | Handle write operations separately (path may not exist yet) |
| /upload/ → workspace/generated/ migration breaks existing artifacts | MEDIUM | Keep /upload/ as read-only legacy, new files go to workspace/generated/ |
| Execution engine dual-write (DB + filesystem) | LOW | WorkspaceService returns path, execution engine stores in Artifact.filePath |
| file_search/code_search may return different results | MEDIUM | WorkspaceService uses same walkDir logic initially |

---

## 12. Open Decisions (Require Approval)

| # | Decision | Options | Recommendation |
|---|----------|---------|----------------|
| 1 | Where should new generated files go? | A) `/upload/` (current, no change) B) `workspace/generated/` (new location) | **B** — cleaner separation, /upload/ becomes legacy |
| 2 | Should existing /upload/ files be migrated? | A) Yes, move to workspace/generated/ B) No, keep in /upload/ (read-only) | **B** — don't break existing artifacts |
| 3 | Should WorkspaceService support project-scoped paths now? | A) Yes (P1-B) B) No (defer to P2) | **B** — P1-B is boundary establishment, not project scoping |
| 4 | Should Artifact.filePath be populated? | A) Yes (in P1-B) B) No (defer) | **A** — easy to add, links DB to filesystem |
| 5 | Should file_search/code_search get blockedPatterns? | A) Yes (P1-B security fix) B) No (defer) | **A** — security gap, should fix during migration |

---

## 13. Proposed Sub-Gate Order

### B1: WorkspaceService Skeleton + Contracts
- Create `src/lib/ai/workspace.ts`
- Implement: `validatePath()`, `read()`, `write()`, `search()`, `searchCode()`, `patch()`
- Move: `safeJoin`, `blockedPatterns`, `SANDBOX_ROOT`, `UPLOAD_DIR` to WorkspaceService
- Add: symlink resolution (`fs.realpath()`)
- No tool changes — tools still use direct fs
- Tests: path validation, symlink, blocked patterns, boundary check

### B2: Migrate Read/Search Operations
- `file_read` → `WorkspaceService.read()`
- `file_search` → `WorkspaceService.search()` (add blockedPatterns)
- `code_search` → `WorkspaceService.searchCode()` (add blockedPatterns)
- Tests: same results as before migration
- Regression: chat, HTML generation, preview

### B3: Migrate Write/Edit Operations
- `file_write` → `WorkspaceService.write()`
- `patch` → `WorkspaceService.patch()`
- `execution-engine.ts` → `WorkspaceService.write()` + populate `Artifact.filePath`
- Tests: file creation, artifact creation, preview still works
- Regression: full P1-A regression suite

### B4: Security + Regression Verification
- Run all tests (P0 + P1-A + P1-B)
- Browser verification
- API verification
- Memory isolation
- Tool calling
- HTML generation + preview
- find-bugs (if available)

---

## Summary

### What I Will Keep
- `/upload/` directory (as read-only legacy)
- Existing artifacts in DB (no migration)
- Existing tool schemas (no model-facing changes)
- `safeJoin()` logic (moved to WorkspaceService)
- `blockedPatterns` (moved to WorkspaceService, applied to ALL operations)

### What I Will Move
- `SANDBOX_ROOT`, `UPLOAD_DIR` constants → WorkspaceService
- `safeJoin()` function → WorkspaceService
- `blockedPatterns` array → WorkspaceService
- `walkDir()` function → WorkspaceService
- `ensureUploadDir()` function → WorkspaceService
- Path validation logic → WorkspaceService

### What I Will Change
- `file_read.execute()` → calls `WorkspaceService.read()` instead of direct `fs.*`
- `file_write.execute()` → calls `WorkspaceService.write()` instead of direct `fs.*`
- `file_search.execute()` → calls `WorkspaceService.search()` + gets blockedPatterns
- `code_search.execute()` → calls `WorkspaceService.searchCode()` + gets blockedPatterns
- `patch.execute()` → calls `WorkspaceService.patch()` instead of direct `fs.*`
- `execution-engine.ts` → calls `WorkspaceService.write()` instead of direct `fs.*` + populates `Artifact.filePath`

### What I Will NOT Change
- Tool schemas (model sees same tools)
- Tool permissions (agent defaultTools unchanged)
- Artifact DB model (no schema changes)
- Project DB model (no schema changes)
- Preview API (reads from DB)
- Tool-caller.ts (no changes)
- Runtime.ts (no changes)

### Risks
- LOW: Migration is wrapping, not replacing
- MEDIUM: file_search/code_search will get blockedPatterns (behavior change — may return fewer results)
- LOW: Execution engine will write to same /upload/ directory (no path change in B1-B3)

### Decisions Needing Approval
1. New generated files → `workspace/generated/` or keep `/upload/`?
2. Populate `Artifact.filePath` in B3?
3. Add blockedPatterns to file_search/code_search in B2?
