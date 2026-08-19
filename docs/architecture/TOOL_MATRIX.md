# Tool Matrix

> Audit of all 10 existing tools + missing tools required for real software engineering.

---

## Existing Tools (10)

| # | Tool | Purpose | Risk | Status | Security Issue |
|---|------|---------|------|--------|----------------|
| 1 | `web_search` | Search web via ZAI SDK | low | ✅ REAL (but unreachable) | None |
| 2 | `web_reader` | Read web page via ZAI SDK | low | ✅ REAL (but unreachable) | None |
| 3 | `file_read` | Read file from sandbox | low | ✅ REAL (but unreachable) | ⚠️ No path allowlist — can read .env, .db |
| 4 | `file_write` | Write to /upload/ | medium | ✅ REAL (but unreachable) | Path traversal blocked, but /upload/ only |
| 5 | `memory_store` | Write memory | low | ✅ REAL (but unreachable) | None |
| 6 | `knowledge_search` | Search KnowledgeEntry + Memory | low | ✅ REAL (but unreachable) | None |
| 7 | `file_search` | Search files by name | low | ✅ REAL (but unreachable) | Walks entire project dir |
| 8 | `code_search` | Search code in files | low | ✅ REAL (but unreachable) | Walks entire project dir |
| 9 | `patch` | Apply text patch to file | medium | ✅ REAL (but unreachable) | /upload/ only |
| 10 | `diff` | Compare two strings | low | ✅ REAL (but unreachable) | None |

### Critical Finding
**ALL 10 tools are correctly implemented but UNREACHABLE.**

`parseToolCalls()` at `runtime.ts:36-62` uses regex to find `{"tool":"web_search","input":{...}}` JSON in model output. No agent prompt instructs the model to output this format. The model never does. Therefore tools never execute.

The only "tool" that works is `executeResponse()` in execution-engine.ts, which extracts code blocks and writes files. But this is NOT called as a tool — it's a post-response pipeline step.

### Tool Details

#### 1. web_search
- **Schema**: `{ query: string, num?: number }`
- **Output**: `{ query, results: [{url, name, snippet, host_name, rank, date}], count }`
- **Permissions**: None (read-only web)
- **Deterministic**: No (web content changes)
- **Error handling**: Retries with backoff (model.ts:invokeFunction)
- **Observability**: Logged via ExecutionLog (if called)

#### 2. web_reader
- **Schema**: `{ url: string }`
- **Output**: `{ title?, content?, html?, publishTime? }`
- **Permissions**: None
- **Deterministic**: No
- **Error handling**: Retries

#### 3. file_read
- **Schema**: `{ path: string }`
- **Output**: `{ path, size, content }`
- **Permissions**: ⚠️ NONE — can read any file in /home/z/my-project/
- **Path validation**: `safeJoin()` prevents `../` traversal but no allowlist
- **Security risk**: Can read `.env` (contains DATABASE_URL), `db/custom.db`, `.git/` files
- **Fix needed**: Path allowlist — block `.env`, `*.db`, `.git/`, `node_modules/`

#### 4. file_write
- **Schema**: `{ filename: string, content: string }`
- **Output**: `{ path, absolutePath, size }`
- **Permissions**: /upload/ directory only
- **Path validation**: Blocks `..` and `/` in filename
- **Limitation**: No subdirectories, no project scoping

#### 5. memory_store
- **Schema**: `{ type, content, importance?, conversationId?, tags? }`
- **Output**: `{ id, type, stored: true }`
- **Permissions**: None
- **Deterministic**: Yes

#### 6. knowledge_search
- **Schema**: `{ query: string, limit?: number }`
- **Output**: `{ knowledgeEntries: [...], memories: [...] }`
- **Permissions**: None
- **Note**: KnowledgeEntry table is empty (orphaned model), so only memories returned

#### 7. file_search
- **Schema**: `{ pattern: string, maxResults?: number }`
- **Output**: `{ pattern, results: [{path, size}], count }`
- **Permissions**: Walks entire /home/z/my-project/
- **Limitation**: Skips node_modules, .git, __pycache__ but not .env, db/

#### 8. code_search
- **Schema**: `{ query: string, maxResults?: number }`
- **Output**: `{ query, results: [{file, line, content}], count }`
- **Permissions**: Reads file contents of .ts, .tsx, .js, .jsx, .py, .json, .md, .prisma, .sql, .css
- **Limitation**: Can read sensitive file contents

#### 9. patch
- **Schema**: `{ filename, find, replace }`
- **Output**: `{ path, size, patched: boolean }`
- **Permissions**: /upload/ only
- **Limitation**: Simple find-replace, no regex, no multi-line awareness

#### 10. diff
- **Schema**: `{ old: string, new: string }`
- **Output**: `{ added, removed, totalLines, diff: [{type, line}] }`
- **Permissions**: None (operates on strings, not files)
- **Limitation**: Simple line-by-line, no semantic diff

---

## Missing Tools Required for Real Software Engineering

### File System Tools (MISSING)
| Tool | Purpose | Priority |
|------|---------|----------|
| `file_edit` | Edit specific lines of a file (not just find-replace) | P1 |
| `file_delete` | Delete a file | P1 |
| `file_rename` | Rename/move a file | P1 |
| `file_copy` | Copy a file | P2 |
| `dir_create` | Create a directory | P1 |
| `dir_list` | List directory contents | P1 |
| `dir_tree` | Get directory tree structure | P2 |

### Project Tools (MISSING)
| Tool | Purpose | Priority |
|------|---------|----------|
| `project_scan` | Scan project structure, identify tech stack | P2 |
| `project_analyze` | Analyze dependencies, architecture | P2 |
| `project_files` | List all files in a project | P2 |

### Build/Run Tools (MISSING)
| Tool | Purpose | Priority |
|------|---------|----------|
| `build_run` | Run build command (npm/bun build) | P3 |
| `test_run` | Run tests | P3 |
| `lint_run` | Run linter | P3 |
| `typecheck_run` | Run type checker | P3 |
| `cmd_run` | Execute shell command (sandboxed) | P3 |

### Intelligence Tools (MISSING)
| Tool | Purpose | Priority |
|------|---------|----------|
| `symbol_find` | Find symbol definition | P3 |
| `references_find` | Find references to symbol | P3 |
| `dependency_trace` | Trace import/dependency chain | P3 |

### Knowledge Tools (MISSING)
| Tool | Purpose | Priority |
|------|---------|----------|
| `entity_extract` | Extract entities from text | P3 |
| `entity_link` | Link entity to project | P3 |
| `graph_query` | Query knowledge graph | P3 |

---

## Tool Calling Architecture Decision

### Current (BROKEN)
```
Model generates text → parseToolCalls() regex scans for JSON → never finds → tools dead
```

### Option A: ZAI SDK Function Calling
- **If ZAI SDK supports function-calling API**: Use it natively
- **Pros**: Reliable, structured, model knows tool schemas
- **Cons**: Unknown if SDK supports it
- **Verification needed**: Check `z-ai-web-dev-sdk` docs

### Option B: Post-Response Intent Detection
- **Approach**: After model responds, scan for intent patterns:
  - "I'll search for X" → web_search
  - "Let me read file X" → file_read
  - "Creating file X" → file_write
- **Pros**: Works with any model
- **Cons**: Fragile (depends on model phrasing)

### Option C: Two-Phase Model Call
- **Approach**: First call asks model "what tools do you need?" → structured response → execute tools → second call with results
- **Pros**: Reliable
- **Cons**: 2x model calls, more latency

### Recommendation
Try Option A first (check SDK). If not available, use Option C (two-phase) as it's more reliable than Option B.

**DO NOT implement yet. Await approval.**
