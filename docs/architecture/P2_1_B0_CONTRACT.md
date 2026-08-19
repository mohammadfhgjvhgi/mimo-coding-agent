# P2-1 B0 — Implementation Contract (Revised)

> **Status:** APPROVED WITH REQUIRED HARDENING (per Gate Review).
> This document supersedes `P2_1_B0_PRE_IMPLEMENTATION_REVIEW.md` and is the **official contract** for P2-1 implementation.
> All 6 hardening changes from the Gate Review are incorporated and marked with **[HARDENING N]** below.
> No source code is modified by this document. No implementation begins until this contract is explicitly approved.

---

## 0. Hardening Changes Incorporated

| # | Severity | Change | Status |
|---|----------|--------|--------|
| 1 | 🔴 Critical | `validateProjectPath` must support nested directory creation via "nearest existing ancestor" walk | ✅ Incorporated (§3.4) |
| 2 | 🔴 Critical | `listProjectTree`, `searchProject`, `searchProjectCode` must skip ALL symlinks during traversal | ✅ Incorporated (§4.3) |
| 3 | 🔴 Critical | `removeProjectDir` must use `lstat`, reject symlink roots, verify realpath + parent | ✅ Incorporated (§4.4) |
| 4 | 🟠 Moderate | Regex is a "safe directory identifier" constraint, NOT proof of Project existence | ✅ Incorporated (§3.2) |
| 5 | 🟠 Moderate | `_systemProjectId` spread order: model input first, system value last (always wins); strip model-provided projectId fields first as defense-in-depth | ✅ Incorporated (§5.3) |
| 6 | 🟢 Tests | Add test categories K (recursive isolation), L (missing parent creation), M (system authority) | ✅ Incorporated (§7) |

---

## 1. Scope (Unchanged from Original B0)

**Goal:** Make `Project` the basic isolation unit for files, without breaking P1.

**Approach:** Add a project-aware parallel API to WorkspaceService. The existing global API remains unchanged for backward compatibility.

**Files touched (6, all additive):**
| File | Change |
|------|--------|
| `src/lib/ai/workspace.ts` | +`PROJECTS_ROOT`, `isValidProjectId`, `validateProjectPath`, 8 project-aware methods. **Existing functions unchanged.** |
| `src/lib/ai/tool-caller.ts` | +`projectId?` in `ToolCallContext`, `_systemProjectId` injection (hardened spread order) |
| `src/lib/ai/runtime.ts` | +lookup `Conversation.projectId`, pass through context |
| `src/lib/ai/execution-engine.ts` | +`projectId?` in context, route to `writeProjectFile` when present |
| `src/lib/ai/types.ts` | +`projectId?` in `ExecutionContext` |
| `src/app/api/projects/route.ts` + `[id]/route.ts` | +`ensureProjectDir`/`removeProjectDir` calls |
| `tests/workspace-project-p2-1.test.ts` | NEW — ~67 assertions across 13 categories (A-M) |

**Files NOT touched:** `prisma/schema.prisma`, `src/lib/ai/tools/index.ts` (tool schemas), `src/lib/ai/task-graph.ts`, `src/lib/ai/validation.ts`, `src/lib/ai/model.ts`, `src/lib/ai/memory.ts`, `src/lib/ai/context.ts`, `src/lib/ai/agents/index.ts`, any UI component, `/api/chat/route.ts`.

**No Prisma migration. No tool schema changes. No UI changes.**

---

## 2. Architecture (Unchanged from Original B0)

```
Conversation.projectId (DB lookup in runtime)
        ↓
ExecutionContext.projectId
        ↓
ToolCallContext.projectId
        ↓
tool-caller injects _systemProjectId (system-authoritative)
        ↓
FS tool execute() reads _systemProjectId
        ↓
projectId present  → WorkspaceService.*ProjectFile()
projectId absent   → WorkspaceService.* (existing global /upload/ path)
```

**The model never sees or controls `projectId`.** It is not in any tool schema. It is injected from system context, mirroring the `conversationId` pattern from P1-A.

---

## 3. Sub-Gate B1 — Project Path Contract

### 3.1 Project root location

```
PROJECTS_ROOT = /home/z/my-project/workspace/projects
Per-project root = PROJECTS_ROOT/{projectId}
```

`PROJECTS_ROOT` is under the existing `WORKSPACE_ROOT` (already in `READ_ROOTS`).

### 3.2 [HARDENING 4] `projectId` validation — Safe directory identifier

```ts
/**
 * Pattern for a safe project directory identifier.
 *
 * This regex enforces a filesystem-safety constraint: the identifier must be
 * a short, lowercase-alphanumeric string starting with 'c'. This prevents
 * path traversal (no '..', no '/', no absolute paths) via the projectId itself.
 *
 * IMPORTANT: This does NOT prove the Project exists in the database.
 * It only proves the identifier is SAFE to embed in a filesystem path.
 * Project existence is a separate concern handled by the caller (the runtime
 * looks up Conversation.projectId, which is a validated FK).
 */
const SAFE_PROJECT_ID_REGEX = /^c[a-z0-9]{20,31}$/;

function isValidProjectId(projectId: string): boolean {
  return typeof projectId === "string" && SAFE_PROJECT_ID_REGEX.test(projectId);
}
```

**Naming:** The regex is `SAFE_PROJECT_ID_REGEX` (not `CUID_REGEX`). The function is `isValidProjectId` returning true if the ID is "safe to use in a filesystem path." The documentation explicitly states this does not verify Project existence.

### 3.3 `validateProjectPath` — 6 layers + Layer 0

The function preserves all 6 existing security layers from `validatePath`, plus a new Layer 0 for `projectId` format:

| Layer | Purpose | Logic |
|-------|---------|-------|
| **0** | `projectId` format validation [NEW] | `isValidProjectId(projectId)` — prevents traversal via projectId |
| 1 | Input validation | Empty, null bytes, absolute paths rejected |
| 2 | Normalization | `path.normalize(requestedPath)` |
| 3 | Resolution | `path.resolve(projectRoot, normalized)` — resolves against project root, NOT SANDBOX_ROOT |
| 4 | Symlink resolution | `fs.realpath` for existing paths; **nearest existing ancestor walk** for non-existing paths [HARDENING 1] |
| 5 | Boundary check | Realpath must be within `projectRoot` (the SPECIFIC project, not PROJECTS_ROOT) |
| 6 | Blocked patterns | `.env`, `.db`, `.git/`, `node_modules/`, `.next/` — same as existing |

### 3.4 [HARDENING 1] Nearest existing ancestor walk (fixes nested directory creation)

**Problem with original design:** For write operations where the target doesn't exist (e.g., writing `src/index.ts` when `src/` doesn't exist), `fs.realpath(parentDir)` fails because `src/` doesn't exist. This caused a false `OUTSIDE_PROJECT_ROOT` rejection, blocking legitimate nested writes.

**Fix:** Walk UP the path tree from the target's parent until we find an existing ancestor. Verify that ancestor's realpath is within the project root. If so, allow creation of the missing descendants.

```ts
// Layer 4 (write mode, target doesn't exist): nearest existing ancestor walk
//
// For a target like projectRoot/src/components/Button.tsx where neither src/ nor
// components/ exist:
//   1. Check projectRoot exists (reject PROJECT_DIR_MISSING if not — caller must
//      call ensureProjectDir first)
//   2. Walk up: projectRoot/src/components → projectRoot/src → projectRoot
//   3. First existing ancestor: projectRoot (verified in step 1)
//   4. realpath(projectRoot) — verify it equals projectRoot (no symlink in path)
//   5. Return valid — caller (writeProjectFile) will fs.mkdir(dir, {recursive:true})
//      to create the missing intermediate directories

// Step 1: verify project root exists
try {
  await fs.realpath(projectRoot);
} catch {
  return {
    valid: false,
    error: "Project directory does not exist. Call ensureProjectDir first.",
    code: "PROJECT_DIR_MISSING",
  };
}

// Step 2: build ancestor chain from target's parent down to projectRoot
const ancestors: string[] = [];
let current = path.dirname(resolved);
while (current.length > projectRoot.length && current !== path.dirname(projectRoot)) {
  ancestors.push(current);
  current = path.dirname(current);
}
ancestors.push(projectRoot); // projectRoot is the last resort ancestor

// Step 3: find nearest existing ancestor
let existingAncestor: string | null = null;
for (const ancestor of ancestors) {
  try {
    await fs.access(ancestor); // check existence without following symlinks
    existingAncestor = ancestor;
    break;
  } catch {
    // doesn't exist, continue up
  }
}

if (!existingAncestor) {
  // Should not happen since projectRoot was verified in step 1
  return {
    valid: false,
    error: "No existing ancestor found within project root",
    code: "OUTSIDE_PROJECT_ROOT",
  };
}

// Step 4: verify the existing ancestor's realpath is within projectRoot
// (prevents symlink escape: if an ancestor is a symlink to outside project,
//  realpath will reveal it)
const realAncestor = await fs.realpath(existingAncestor);
const ancestorInProject =
  realAncestor === projectRoot || realAncestor.startsWith(projectRoot + path.sep);

if (!ancestorInProject) {
  return {
    valid: false,
    error: `Path escapes project boundary via symlink: "${normalized}" resolves to "${realAncestor}"`,
    code: "PROJECT_BOUNDARY_ESCAPE",
  };
}

// Step 5: safe to create missing descendants
// The caller (writeProjectFile / patchProjectFile) will call fs.mkdir(dir, {recursive:true})
// to create the missing intermediate directories, then write the file.
return {
  valid: true,
  absolutePath: resolved,
  relativePath: path.relative(projectRoot, resolved),
};
```

**This resolves the contradiction:** `writeProjectFile(A, "src/components/Button.tsx")` now succeeds even when `src/` and `components/` don't exist. The validation verifies the nearest existing ancestor (project root) is safe, then the write operation creates the missing directories.

### 3.5 Backward compatibility contract (unchanged)

When `projectId` is absent, ALL operations use the existing global API. The `file_write`/`patch` "prepend upload/" hack remains in the global API. **No existing function signature changes.**

---

## 4. Sub-Gate B2 — WorkspaceService Project-Aware Methods

### 4.1 New constant

```ts
export const PROJECTS_ROOT = path.join(WORKSPACE_ROOT, "projects");
```

`READ_ROOTS` and `WRITE_ROOTS` are **NOT modified**. Project-aware methods use their own boundary check against `path.join(PROJECTS_ROOT, projectId)`.

### 4.2 New operations (file-level)

```ts
export async function ensureProjectDir(projectId: string): Promise<WorkspaceResult>
// Validates projectId, creates PROJECTS_ROOT/{projectId}/ via fs.mkdir({recursive:true}).
// Idempotent. Returns success if dir exists or was created.

export async function readProjectFile(projectId: string, filePath: string): Promise<WorkspaceResult>
// Validates projectId + path, reads file. Returns path relative to project root.
// Max 50KB (same as global read).

export async function writeProjectFile(projectId: string, filePath: string, content: string): Promise<WorkspaceResult>
// Validates projectId + path, creates intermediate directories via fs.mkdir({recursive:true}),
// writes file. Returns path relative to SANDBOX_ROOT (workspace/projects/{projectId}/{relPath}).

export async function patchProjectFile(projectId: string, filePath: string, find: string, replace: string): Promise<WorkspaceResult>
// Validates projectId + path, reads existing (or empty), applies find/replace, writes.
// Creates file if it doesn't exist (same behavior as global patch).
```

**Path contract for results:**
- `readProjectFile` returns `path` relative to **project root** (e.g., `src/index.ts`) — the model uses this with `file_read` in project mode.
- `writeProjectFile` and `patchProjectFile` return `path` relative to **project root** (e.g., `src/index.ts`) for consistency.
- For `Artifact.filePath` persistence, the execution engine will store `workspace/projects/{projectId}/{relPath}` (SANDBOX_ROOT-relative) so `validateArtifact`'s `startsWith("workspace/")` check passes.

### 4.3 [HARDENING 2] Symlink-safe recursive traversal

**`listProjectTree`, `searchProject`, `searchProjectCode`** all walk the project directory tree. They MUST NOT follow any symlink, even if the symlink points inside the same project.

**Shared traversal helper:**

```ts
/**
 * Walk a project directory tree with symlink-safe traversal.
 *
 * SECURITY: This function skips ALL symlinks during traversal.
 * - entry.isSymbolicLink() → SKIP (don't add to results, don't recurse)
 * - This prevents symlink-based directory escape attacks where a symlink
 *   inside project A points to project B, /etc, /upload, etc.
 *
 * The traversal only follows real directories. Since it starts at projectRoot
 * and only recurses into non-symlink subdirectories, it can never escape
 * the project boundary.
 */
async function walkProjectDir(
  projectRoot: string,
  currentDir: string,
  visitor: (entry: fs.Dirent, fullPath: string, relPath: string) => Promise<void>,
  maxDepth: number,
  maxResults: number,
  resultsCount: () => number,
  depth: number = 0
): Promise<void> {
  if (depth > maxDepth || resultsCount() >= maxResults) return;

  let entries: fs.Dirent[];
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (resultsCount() >= maxResults) break;

    // CRITICAL [HARDENING 2]: Skip ALL symlinks.
    // This is the primary defense against symlink-based directory escape.
    // A symlink inside the project pointing to:
    //   - another project (cross-project leak)
    //   - /etc, /upload, /home (sandbox escape)
    //   - any external path
    // is skipped entirely. Not added to results, not recursed into.
    if (entry.isSymbolicLink()) continue;

    // Skip sensitive/hidden directories (same as existing walkDir)
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "__pycache__") continue;

    const fullPath = path.join(currentDir, entry.name);
    const relPath = path.relative(projectRoot, fullPath);

    // Layer 6: blocked patterns
    if (isBlocked(relPath)) continue;

    if (entry.isDirectory()) {
      // Recurse into real directories only (symlinks already skipped above)
      await walkProjectDir(projectRoot, fullPath, visitor, maxDepth, maxResults, resultsCount, depth + 1);
    } else if (entry.isFile()) {
      await visitor(entry, fullPath, relPath);
    }
    // Symlinks, sockets, FIFOs, etc. are ignored (not isDirectory, not isFile)
  }
}
```

**Key properties:**
- `entry.isSymbolicLink()` check is at the TOP of the loop — symlinks are never processed
- `entry.isDirectory()` and `entry.isFile()` from `Dirent` describe the entry itself (not the symlink target) — they return false for symlinks
- Since traversal only recurses into real (non-symlink) directories starting from `projectRoot`, it can never escape the project boundary
- `fs.stat(fullPath)` is NOT called during traversal (only `fs.stat` for individual matched files, and only after confirming the entry is a real file via `entry.isFile()`)

**`listProjectTree` implementation:**

```ts
export async function listProjectTree(
  projectId: string,
  maxDepth: number = 10
): Promise<WorkspaceResult> {
  if (!isValidProjectId(projectId)) {
    return failure("listProjectTree", `Invalid project ID`, "INVALID_PROJECT_ID");
  }
  const projectRoot = path.join(PROJECTS_ROOT, projectId);

  // Verify project root exists and is a real directory (not symlink)
  try {
    const stat = await fs.lstat(projectRoot);
    if (!stat.isDirectory()) {
      return failure("listProjectTree", "Project root is not a directory", "NOT_A_DIRECTORY");
    }
    if (stat.isSymbolicLink()) {
      return failure("listProjectTree", "Project root is a symlink", "SYMLINK_ROOT_REJECTED");
    }
  } catch {
    return failure("listProjectTree", "Project directory does not exist", "PROJECT_DIR_MISSING");
  }

  const tree: Array<{ path: string; size: number; type: "file" | "directory" }> = [];
  await walkProjectDir(
    projectRoot,
    projectRoot,
    async (entry, fullPath, relPath) => {
      const stat = await fs.stat(fullPath);
      tree.push({
        path: relPath,
        size: stat.size,
        type: entry.isDirectory() ? "directory" : "file",
      });
    },
    maxDepth,
    500, // max 500 entries
    () => tree.length
  );

  return success("listProjectTree", {
    path: `workspace/projects/${projectId}`,
    data: { tree, count: tree.length },
  });
}
```

**`searchProject` and `searchProjectCode`** follow the same pattern — they use `walkProjectDir` with a visitor that filters by name pattern or file content.

### 4.4 [HARDENING 3] Hardened `removeProjectDir`

```ts
/**
 * Remove a project's directory.
 *
 * SECURITY: This is a recursive delete operation and is therefore high-risk.
 * Hardening measures:
 *   1. Validate projectId format (prevents traversal via projectId)
 *   2. Compute expected path: PROJECTS_ROOT/{projectId}
 *   3. Use lstat (NOT stat) to detect symlinks without following them
 *   4. Reject if project root is a symlink (SYMLINK_ROOT_REJECTED)
 *   5. Verify realpath equals expected path (no symlink in path chain)
 *   6. Verify parent realpath equals PROJECTS_ROOT (no parent manipulation)
 *   7. Only then: fs.rm with recursive + force
 *
 * If the directory doesn't exist, return success (idempotent).
 */
export async function removeProjectDir(projectId: string): Promise<WorkspaceResult> {
  // Step 1: projectId format validation
  if (!isValidProjectId(projectId)) {
    return failure("removeProjectDir", `Invalid project ID: ${projectId}`, "INVALID_PROJECT_ID");
  }

  const projectRoot = path.join(PROJECTS_ROOT, projectId);

  // Step 2: verify projectRoot is under PROJECTS_ROOT
  // (guaranteed by regex, but verify defensively)
  if (!projectRoot.startsWith(PROJECTS_ROOT + path.sep)) {
    return failure("removeProjectDir", "Computed path is not under PROJECTS_ROOT", "INVALID_PATH");
  }

  // Step 3: lstat (does NOT follow symlinks)
  let stat: await fs.Stats;
  try {
    stat = await fs.lstat(projectRoot);
  } catch {
    // Directory doesn't exist — idempotent success
    return success("removeProjectDir", {
      path: `workspace/projects/${projectId}`,
      metadata: { type: "directory" },
    });
  }

  // Step 4: reject if not a directory
  if (!stat.isDirectory()) {
    return failure("removeProjectDir", "Project root is not a directory", "NOT_A_DIRECTORY");
  }

  // Step 5: CRITICAL — reject if project root is a symlink
  // A symlink at project root could point anywhere. Refuse to delete.
  if (stat.isSymbolicLink()) {
    return failure(
      "removeProjectDir",
      "Project root is a symlink — refusing to delete (could destroy external data)",
      "SYMLINK_ROOT_REJECTED"
    );
  }

  // Step 6: verify realpath matches expected path (no symlink in the path chain)
  let realPath: string;
  try {
    realPath = await fs.realpath(projectRoot);
  } catch {
    return failure("removeProjectDir", "Cannot resolve project root realpath", "REALPATH_FAILED");
  }
  if (realPath !== projectRoot) {
    return failure(
      "removeProjectDir",
      `Project root realpath mismatch: expected ${projectRoot}, got ${realPath}`,
      "REALPATH_MISMATCH"
    );
  }

  // Step 7: verify parent is exactly PROJECTS_ROOT
  let parentReal: string;
  try {
    parentReal = await fs.realpath(PROJECTS_ROOT);
  } catch {
    return failure("removeProjectDir", "Cannot resolve PROJECTS_ROOT realpath", "PARENT_REALPATH_FAILED");
  }
  if (path.dirname(realPath) !== parentReal) {
    return failure(
      "removeProjectDir",
      `Project parent is not PROJECTS_ROOT: expected ${parentReal}, got ${path.dirname(realPath)}`,
      "PARENT_MISMATCH"
    );
  }

  // All checks passed — safe to remove
  try {
    await fs.rm(projectRoot, { recursive: true, force: true });
    return success("removeProjectDir", {
      path: `workspace/projects/${projectId}`,
      metadata: { type: "directory" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return failure("removeProjectDir", `Failed to remove project directory: ${msg}`, "RM_ERROR");
  }
}
```

**Key protections (7 layers):**
1. `projectId` regex — prevents traversal
2. Path starts-with check — defensive
3. `lstat` not `stat` — detects symlinks without following
4. `isDirectory()` check — must be a directory
5. `isSymbolicLink()` check — reject symlink roots
6. `realpath` equality — no symlink in path chain
7. Parent `realpath` equality — parent must be `PROJECTS_ROOT`

---

## 5. Sub-Gate B3 — `projectId` Injection (Hardened)

### 5.1 `ToolCallContext` extension

```ts
export interface ToolCallContext {
  conversationId: string;
  taskId?: string;
  agentName: string;
  projectId?: string;  // NEW — optional, system-injected from Conversation.projectId
}
```

### 5.2 [HARDENING 5] System-authoritative injection

The user correctly identified that spread order determines whether the system value can be overwritten. The rule: **model input first, system value last — system always wins.**

Additionally, as defense-in-depth, strip any model-provided `projectId` / `_systemProjectId` fields BEFORE the spread, so even if the model tries to inject these fields, they are removed before the system value is applied.

```ts
// In tool-caller.ts executeToolCall():

const FS_TOOLS = new Set(["file_read", "file_write", "file_search", "code_search", "patch"]);

// After schema validation and permission check, before executeTool:

let toolInput: Record<string, unknown> = request.arguments;

if (FS_TOOLS.has(request.name)) {
  // DEFENSE-IN-DEPTH [HARDENING 5]:
  // Strip any model-provided projectId / _systemProjectId fields BEFORE injection.
  // The model should not be sending these fields at all (they're not in any tool
  // schema), but if it does (prompt injection, hallucination, etc.), we remove them.
  const {
    projectId: _stripped1,      // eslint-disable-line @typescript-eslint/no-unused-vars
    _systemProjectId: _stripped2, // eslint-disable-line @typescript-eslint/no-unused-vars
    ...modelInput
  } = request.arguments;

  // SYSTEM-AUTHORITATIVE INJECTION:
  // Spread order: modelInput FIRST, system value LAST.
  // This guarantees the system value ALWAYS wins, even if modelInput somehow
  // contained _systemProjectId (it won't, because we stripped it above, but
  // this is belt-and-suspenders).
  toolInput = {
    ...modelInput,
    ...(context.projectId ? { _systemProjectId: context.projectId } : {}),
  };
}

// For memory_store (existing P1-A logic, unchanged):
if (request.name === "memory_store" && context.conversationId) {
  toolInput = {
    ...toolInput,
    conversationId: context.conversationId,
    _systemConversationId: context.conversationId,
  };
}

const result = await executeTool(request.name, toolInput);
```

**Security guarantee:** `_systemProjectId` is ALWAYS the value from `context.projectId` (which comes from `Conversation.projectId` via DB lookup). The model cannot override it because:
1. It's not in any tool schema (the model doesn't know to send it)
2. Even if the model sends `_systemProjectId` or `projectId`, it's stripped before injection
3. The system value is spread LAST, so it overwrites any remaining model value

### 5.3 Runtime lookup (unchanged from original B0)

In `executeTask`, after marking the task `in_progress`:

```ts
let projectId: string | undefined;
if (conversationId) {
  const conv = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { projectId: true },
  });
  projectId = conv?.projectId ?? undefined;
}
```

Pass `projectId` into `toolCallContext` and `executeResponse` context.

### 5.4 `ExecutionContext` extension

```ts
export interface ExecutionContext {
  conversationId: string;
  taskId?: string;
  agentName: AgentRole;
  userMessage: string;
  projectId?: string;  // NEW
  toolsUsed: string[];
  artifactsCreated: string[];
  memoriesWritten: string[];
  decisionsMade: string[];
}
```

---

## 6. Sub-Gate B4 — Filesystem Flow Migration (Unchanged)

### 6.1 Tool routing (5 FS tools + execution engine)

Each FS tool reads `_systemProjectId` and routes:

```ts
// In each FS tool's execute function:
const projectId = input._systemProjectId ? String(input._systemProjectId) : null;

if (projectId) {
  // Project-scoped operation
  const result = await WorkspaceService.writeProjectFile(projectId, filename, content);
  // ...
} else {
  // Global operation (existing behavior, unchanged)
  const result = await WorkspaceService.write(filename, content);
  // ...
}
```

### 6.2 Project lifecycle wiring

| Event | Action |
|-------|--------|
| `POST /api/projects` | After DB insert: `WorkspaceService.ensureProjectDir(project.id)`. If fails, log warning, don't fail the request. |
| `DELETE /api/projects/[id]` | Before DB delete: `WorkspaceService.removeProjectDir(id)`. If fails, log warning, proceed with DB delete. |

---

## 7. Sub-Gate B5 — Test Matrix (Expanded with K, L, M)

### New test file: `tests/workspace-project-p2-1.test.ts`

**Target: ~67 assertions across 13 categories (A-M).**

#### Category A: Project ID validation (6 assertions)
- A1: Valid CUID `projectId` accepted
- A2: Invalid `projectId` (contains `..`) → `INVALID_PROJECT_ID`
- A3: Invalid `projectId` (empty) → `INVALID_PROJECT_ID`
- A4: Invalid `projectId` (absolute path) → `INVALID_PROJECT_ID`
- A5: Invalid `projectId` (uppercase) → `INVALID_PROJECT_ID`
- A6: Invalid `projectId` (too short) → `INVALID_PROJECT_ID`

#### Category B: Project isolation (5 assertions) — **CRITICAL**
- B1: Project A `readProjectFile` cannot read Project B's file
- B2: Project A `writeProjectFile` cannot write to Project B's directory
- B3: Project A `patchProjectFile` cannot patch Project B's file
- B4: Project A `searchProject` does not return Project B's files
- B5: Project A `searchProjectCode` does not return Project B's code

#### Category C: Path traversal rejected (4 assertions)
- C1: `../../../etc/passwd` → rejected (escapes project root)
- C2: `../../other-project/file.txt` → rejected (escapes to another project)
- C3: `./../` → rejected
- C4: Absolute path `/etc/passwd` → `ABSOLUTE_PATH`

#### Category D: Symlink escape rejected (3 assertions)
- D1: Symlink in project A → project B's file: `readProjectFile` → `PROJECT_BOUNDARY_ESCAPE`
- D2: Symlink in project A → `/etc/passwd`: `readProjectFile` → `PROJECT_BOUNDARY_ESCAPE`
- D3: Symlink in project A → `../../upload/file.txt`: `readProjectFile` → `PROJECT_BOUNDARY_ESCAPE`

#### Category E: Blocked patterns (4 assertions)
- E1: `.env` in project → rejected
- E2: `data.db` in project → rejected
- E3: `.git/config` path in project → rejected
- E4: `node_modules/foo` path in project → rejected

#### Category F: Read/write in project works (8 assertions)
- F1: `writeProjectFile` creates file in project root
- F2: `writeProjectFile` creates file in subdirectory
- F3: `readProjectFile` reads file written by `writeProjectFile`
- F4: `patchProjectFile` modifies existing file
- F5: `patchProjectFile` creates file if it doesn't exist
- F6: `listProjectTree` returns files written to project
- F7: `searchProject` finds files by name pattern
- F8: `searchProjectCode` finds text inside project files

#### Category G: Backward compatibility — `/upload/` still works (6 assertions)
- G1: `WorkspaceService.write("test.txt", ...)` still writes to `/upload/test.txt`
- G2: `WorkspaceService.read("upload/test.txt")` still reads it
- G3: `WorkspaceService.search("test")` still finds `/upload/` files
- G4: `file_write` tool without `_systemProjectId` → writes to `/upload/`
- G5: `file_read` tool without `_systemProjectId` → reads global paths
- G6: Conversation without `projectId` → artifacts in `/upload/`

#### Category H: Input validation (2 assertions)
- H1: Path with null byte → `NULL_BYTE`
- H2: Empty path → `EMPTY_PATH`

#### Category I: Project lifecycle (4 assertions)
- I1: `ensureProjectDir` creates the project directory
- I2: `ensureProjectDir` is idempotent
- I3: `removeProjectDir` removes the project directory
- I4: `ensureProjectDir` rejects invalid `projectId`

#### Category J: Tool routing (5 assertions)
- J1: `file_write` with `_systemProjectId` → writes to project directory
- J2: `file_write` with `_systemProjectId` → does NOT write to `/upload/`
- J3: `file_write` without `_systemProjectId` → writes to `/upload/` (backward compat)
- J4: `file_read` with `_systemProjectId` → reads from project directory
- J5: `file_read` with `_systemProjectId` → cannot read `/upload/` files

#### [HARDENING 6] Category K: Recursive isolation (4 assertions) — **NEW**
- K1: Project A contains symlink → Project B; `searchProject(A)` does NOT discover B's files
- K2: Project A contains symlink → `/etc`; `searchProject(A)` does NOT traverse it
- K3: Project A contains symlink → `/upload`; `searchProjectCode(A)` does NOT traverse it
- K4: `listProjectTree(A)` does NOT expose files outside project A (symlinks skipped entirely)

#### [HARDENING 6] Category L: Missing parent creation (2 assertions) — **NEW**
- L1: `writeProjectFile(A, "src/index.ts")` succeeds when `src/` doesn't exist (creates `src/` then file)
- L2: `writeProjectFile(A, "src/components/App.tsx")` succeeds when neither `src/` nor `components/` exist (creates both then file)

#### [HARDENING 6] Category M: System authority (3 assertions) — **NEW**
- M1: Model attempts `projectId = B` in tool args; system context `projectId = A`; actual write goes to project A (model value stripped, system value wins)
- M2: Model attempts `_systemProjectId = B` in tool args; system context `projectId = A`; actual write goes to project A (stripped, system wins)
- M3: Model attempts `projectId = ""` in tool args; system context `projectId = A`; actual write goes to project A (stripped, system wins)

### Regression: all 405 existing P1 assertions must pass unchanged

The 7 existing P1 test suites use the global `/upload/` path (no `projectId`), exercising the backward-compatibility path. If any fail, P2-1 broke the global API — hard stop.

---

## 8. Security Analysis (Updated)

### 8.1 The 6+1 security layers

| Layer | Global API (`validatePath`) | Project API (`validateProjectPath`) |
|-------|-----------------------------|-------------------------------------|
| 0 | N/A | ✅ `projectId` format validation (prevents traversal via projectId) |
| 1 | ✅ Input validation | ✅ Same |
| 2 | ✅ Normalization | ✅ Same |
| 3 | ✅ Resolve against `SANDBOX_ROOT` | ✅ Resolve against `projectRoot` (more restrictive) |
| 4 | ✅ `realpath` for existing | ✅ `realpath` for existing + **nearest existing ancestor walk** for non-existing [HARDENING 1] |
| 5 | ✅ Boundary against `READ_ROOTS`/`WRITE_ROOTS` | ✅ Boundary against `projectRoot` (project-specific) |
| 6 | ✅ Blocked patterns | ✅ Same |

### 8.2 Project isolation guarantees

- **Project A cannot access Project B:** `validateProjectPath(A_id, "../B_id/file")` → Layer 3 resolves to `PROJECTS_ROOT/B_id/file` → Layer 5 boundary check against `PROJECTS_ROOT/A_id/` fails → `PROJECT_BOUNDARY_ESCAPE`
- **Symlink escape to another project:** `fs.realpath` resolves the symlink; Layer 5 boundary check against the specific project root fails → `PROJECT_BOUNDARY_ESCAPE`
- **`projectId` traversal:** `projectId = "../B_id"` fails Layer 0 regex → `INVALID_PROJECT_ID` before any filesystem access
- **Recursive traversal cannot escape:** `walkProjectDir` skips ALL symlinks [HARDENING 2]; only recurses into real directories starting from `projectRoot`; can never leave the project boundary
- **`removeProjectDir` cannot delete external data:** 7-layer hardening [HARDENING 3] rejects symlink roots, verifies realpath + parent

### 8.3 Model cannot control `projectId` [HARDENING 5]

1. `projectId` is NOT in any tool's `inputSchema`
2. `projectId` comes from `Conversation.projectId` (DB lookup), not from request body
3. If model sends `projectId` or `_systemProjectId` in tool args → stripped before injection
4. System value spread LAST → always overwrites any remaining model value
5. Same security property as `conversationId` in P1-A, plus defense-in-depth stripping

### 8.4 No new `fs.*` in tools or runtime

- 5 FS tools call `WorkspaceService.*` or `WorkspaceService.*ProjectFile` — no direct `fs.*`
- `execution-engine.ts` calls `WorkspaceService.write` or `WorkspaceService.writeProjectFile` — no direct `fs.*`
- `runtime.ts` does not touch the filesystem
- Only `workspace.ts` uses `fs.*` directly (it is the canonical authority)

---

## 9. Database Migration Requirements (Unchanged)

**NONE.** No new Prisma models. No schema changes. `Conversation.projectId` already exists.

---

## 10. What Is Explicitly NOT Implemented in P2-1 (Unchanged)

- File Tree UI (P2-2)
- Code Editor (P2-4)
- Multi-file generation logic (execution engine already handles multiple blocks)
- `ProjectFile` / `FileVersion` models (P2-5, explicitly deferred)
- File versioning (P2-5)
- Diff Viewer (P2-6)
- Prisma migration
- Tool schema changes
- Agent prompt changes
- Changes to existing `validatePath` or WorkspaceService functions (additive only)
- Changes to TaskGraphService
- Changes to ValidationService (`workspace/projects/...` already passes `startsWith("workspace/")`)
- Changes to the autonomous runtime loop
- UI changes
- New API routes for file access

---

## 11. Risk Assessment (Updated)

| Risk | Likelihood | Impact | Mitigation | Status |
|------|-----------|--------|------------|--------|
| `validateProjectPath` rejects nested writes | Was Medium | High | **[HARDENING 1]** Nearest existing ancestor walk | ✅ Fixed |
| `searchProject`/`listProjectTree` follow symlinks | Was Medium | Critical | **[HARDENING 2]** `walkProjectDir` skips ALL symlinks | ✅ Fixed |
| `removeProjectDir` deletes external data | Was Low | Critical | **[HARDENING 3]** 7-layer hardening | ✅ Fixed |
| Model overrides `_systemProjectId` | Was Low | High | **[HARDENING 5]** Strip + spread-last | ✅ Fixed |
| Backward compatibility break | Low | High | Category G tests + 405 P1 regression | ✅ Mitigated |
| Project isolation failure | Low | Critical | Categories B, D, K tests | ✅ Mitigated |

**Overall risk: LOW** (reduced from original B0 due to hardening).

---

## 12. Implementation Order (Unchanged)

```
B1 (Project path contract)           — PROJECTS_ROOT, isValidProjectId, validateProjectPath
  │   (with HARDENING 1: nearest existing ancestor walk)
  ▼
B2 (WorkspaceService project-aware)  — 8 new methods
  │   (with HARDENING 2: symlink-safe walkProjectDir)
  │   (with HARDENING 3: hardened removeProjectDir)
  ▼
B3 (projectId injection)             — ToolCallContext, ExecutionContext, runtime lookup
  │   (with HARDENING 5: strip + spread-last)
  ▼
B4 (Migrate filesystem flows)        — 5 FS tools + execution-engine + /api/projects wiring
  ▼
B5 (Isolation + regression tests)    — ~67 assertions across categories A-M
      (with HARDENING 6: categories K, L, M added)
```

---

## 13. Acceptance Criteria for P2-1 Gate

- [ ] All ~67 new P2-1 test assertions pass (categories A-M)
- [ ] All 405 existing P1 assertions pass unchanged
- [ ] `bun run lint` clean
- [ ] `bunx tsc --noEmit` clean (source + tests)
- [ ] Simple chat (no project) — artifacts in `/upload/`
- [ ] Autonomous mission (no project) — artifacts in `/upload/`
- [ ] Project-scoped autonomous mission — artifacts in `/workspace/projects/{projectId}/`
- [ ] Project A cannot access Project B (tests B1-B5 + K1-K4)
- [ ] Path traversal rejected (tests C1-C4)
- [ ] Symlink escape rejected (tests D1-D3 + K1-K4)
- [ ] Blocked files rejected in project (tests E1-E4)
- [ ] Nested directory creation works (tests L1-L2)
- [ ] Model cannot override `projectId` (tests M1-M3)
- [ ] `removeProjectDir` refuses symlinks (verified by code inspection + test)
- [ ] No Prisma migration performed
- [ ] No tool schema changes
- [ ] No UI changes
- [ ] No changes to existing WorkspaceService functions (additive only)

---

## 14. Contract Confirmation

This document is the **official implementation contract** for P2-1. All 6 hardening changes from the Gate Review are incorporated:

1. ✅ **[HARDENING 1]** `validateProjectPath` uses nearest existing ancestor walk (§3.4)
2. ✅ **[HARDENING 2]** `walkProjectDir` skips ALL symlinks during traversal (§4.3)
3. ✅ **[HARDENING 3]** `removeProjectDir` has 7-layer hardening (§4.4)
4. ✅ **[HARDENING 4]** Regex is "safe directory identifier," not "CUID proof" (§3.2)
5. ✅ **[HARDENING 5]** `_systemProjectId` injection strips model input + spreads system value last (§5.2)
6. ✅ **[HARDENING 6]** Test categories K (recursive isolation), L (missing parent), M (system authority) added (§7)

**No P1 code is modified to make P2 easier.** All P2-1 changes are additive — new functions in WorkspaceService, new optional fields in context types, new routing logic in tools. Existing functions, schemas, and behaviors are frozen.

**Awaiting explicit user approval of this revised contract to begin B1 implementation.**

Do NOT start implementation without approval.
Do NOT modify source code.
Stop here and wait.
