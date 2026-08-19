# P1-A Security Review

> READ-ONLY security analysis of the canonical tool calling mechanism.

---

## 1. Attack Surface Analysis

### Does native function calling increase attack surface?

**No.** The model can only call tools that are:
1. Defined in the `TOOLS` registry (server-side)
2. Included in the agent's `defaultTools` array (server-side)
3. Validated by `validateToolArguments` (server-side)
4. Permission-checked by `checkToolPermission` (server-side)

The model cannot:
- Create new tools
- Modify tool schemas
- Bypass permission checks
- Access tools not in its `defaultTools`
- Execute arbitrary code

### Trust Model

| Layer | Trusted? | Why |
|-------|----------|-----|
| Model output | ❌ NOT trusted | Model output is parsed, validated, permission-checked |
| Tool arguments | ❌ NOT trusted | Validated against schema before execution |
| Tool results | ✅ Trusted (from tools) | Tools are server-side code |
| Permission check | ✅ Trusted (system code) | `checkToolPermission` is not model-controlled |
| Path validation | ✅ Trusted (system code) | `safeJoin` + blocked patterns |

---

## 2. Tool-by-Tool Security Audit

### web_search
- **Network access**: Read-only HTTP search via ZAI SDK
- **Input**: `query` (string), `num` (number)
- **Output**: Array of search results
- **Risk**: None — read-only, no filesystem access, no destructive operations
- **Security**: ✅ SAFE

### web_reader (BROKEN)
- **Network access**: Read web page via ZAI SDK
- **Input**: `url` (string)
- **Issue**: Calls `invokeFunction("web_reader", ...)` but SDK function name is `page_reader`
- **Risk**: Tool always fails — no security risk (can't execute)
- **Security**: ⚠️ BROKEN (function name mismatch, not a security issue)

### file_read
- **Filesystem access**: Read files in `/home/z/my-project/`
- **Blocked paths**: `.env`, `*.db`, `*.sqlite`, `.git/`, `node_modules/`, `.next/`
- **Path traversal**: Blocked by `safeJoin()` (resolves path, checks if within sandbox)
- **Size limit**: 50KB max
- **Risk**: ⚠️ Can read source files containing secrets in comments/code
  - Example: `src/lib/ai/model.ts` is readable — contains no secrets
  - Example: `src/lib/db.ts` is readable — contains DATABASE_URL path (not credentials)
  - Example: `.env` is BLOCKED
- **Security**: ✅ SAFE (sensitive files blocked, source files don't contain secrets)

### file_write
- **Filesystem access**: Write to `/home/z/my-project/upload/` only
- **Path traversal**: Blocks `..` and `/` in filename
- **Destructive**: Yes — overwrites existing files
- **Risk**: Low — only /upload/ directory, no project source files affected
- **Security**: ✅ SAFE

### memory_store
- **DB access**: Write to Memory table
- **Input**: type, content, importance, conversationId, tags
- **Scope issue**: Model controls `conversationId` — if omitted, memory is stored as GLOBAL
- **Risk**: Model can escalate conversation memory to global scope
- **Security**: ⚠️ MEDIUM RISK — model controls scope

### knowledge_search
- **DB access**: Read KnowledgeEntry + Memory tables
- **Input**: query, limit
- **Risk**: None — read-only
- **Security**: ✅ SAFE

### file_search
- **Filesystem access**: Walk directory tree, list file names + sizes
- **Blocked**: node_modules, .git, __pycache__
- **Risk**: Could discover file names (information disclosure) but not content
- **Security**: ✅ SAFE

### code_search
- **Filesystem access**: Read file contents of .ts, .tsx, .js, .jsx, .py, .json, .md, .prisma, .sql, .css
- **Risk**: Could read source code content (same as file_read but broader)
- **Blocked**: Files > 100KB skipped
- **Security**: ⚠️ LOW RISK — could expose source code, but same risk as file_read

### patch
- **Filesystem access**: Modify files in `/upload/` only
- **Destructive**: Yes — modifies file content
- **Risk**: Low — only /upload/ directory
- **Security**: ✅ SAFE

### diff
- **Filesystem access**: None — operates on strings
- **Risk**: None
- **Security**: ✅ SAFE

---

## 3. Path Validation Audit

### file_read Path Validation

```typescript
// Step 1: Blocked patterns check
const blockedPatterns = [
  /\.env/i,         // Blocks .env, .env.local, .env.production
  /\.db$/i,         // Blocks custom.db, test.db
  /\.sqlite$/i,     // Blocks data.sqlite
  /\.git\//i,       // Blocks .git/config, src/.git/...
  /^\.git\//i,      // Blocks .git/HEAD
  /node_modules\//i, // Blocks node_modules/anything
  /^node_modules\//i,
  /\.next\//i,      // Blocks .next/build
  /^\.next\//i,
];

// Step 2: Path traversal check
const fullPath = safeJoin(SANDBOX_ROOT, relPath);
// safeJoin resolves path and checks: resolved.startsWith(base)
```

### Verification

| Path | Blocked? | Correct? |
|------|----------|----------|
| `.env` | ✅ Yes | ✅ |
| `.env.local` | ✅ Yes | ✅ |
| `db/custom.db` | ✅ Yes | ✅ |
| `.git/config` | ✅ Yes | ✅ |
| `node_modules/react/index.js` | ✅ Yes | ✅ |
| `.next/server/page.js` | ✅ Yes | ✅ |
| `../../../etc/passwd` | ✅ Yes (safeJoin) | ✅ |
| `src/lib/ai/model.ts` | ❌ Allowed | ✅ (no secrets) |
| `upload/test.html` | ❌ Allowed | ✅ |
| `prisma/schema.prisma` | ❌ Allowed | ✅ (no secrets) |

---

## 4. Memory Scope Security

### Current Behavior

```
memory_store tool called:
  → if model provides conversationId: scope = "conversation"
  → if model omits conversationId: scope = "global"
```

### Risk Assessment

| Scenario | Risk | Impact |
|----------|------|--------|
| Model stores user preference as global | LOW | Intended behavior for preferences |
| Model stores conversation-specific info as global | MEDIUM | Other conversations see it |
| Model stores sensitive info as global | MEDIUM | Data leak across conversations |
| Model omits conversationId maliciously | LOW | Model is not adversarial, but could be prompted |

### Recommended Fix (P1-B)

The system should inject `conversationId` from the execution context, NOT from model input:

```typescript
// CURRENT (model-controlled):
scope: input.conversationId ? "conversation" : "global",

// RECOMMENDED (system-controlled):
scope: context.conversationId ? "conversation" : "global",
// Model's conversationId input ignored
```

---

## 5. Permission Enforcement Audit

### How Permissions Work

```
1. Agent has defaultTools array (e.g., researcher has ["web_search", "web_reader", "knowledge_search", "memory_store"])
2. generateToolSchemaForAgent() only generates schemas for allowed tools
3. Model can only see/request tools in the schema
4. checkToolPermission() verifies agent.defaultTools includes tool name
5. executeToolCall() calls checkToolPermission before execution
```

### Can model bypass permissions?

**No.** Even if the model outputs a tool_call for a tool not in its schema:
1. `parseToolCallsFromResponse()` parses it (it doesn't filter by allowed tools)
2. `executeToolCall()` calls `checkToolPermission()`
3. `checkToolPermission()` checks `agent.defaultTools`
4. If not in defaultTools → returns `{ allowed: false }`
5. Tool is NOT executed

### Test Verification

Test 4 in `tests/tool-calling.test.ts` verifies this:
```
developer agent → web_search → REJECTED ("not authorized")
```

---

## 6. Network Security

### Outbound Network Access

| Tool | Network Access | Destination | Risk |
|------|---------------|-------------|------|
| web_search | Yes | ZAI API (search) | LOW — managed by SDK |
| web_reader | Yes | ZAI API (page reader) | LOW — managed by SDK |
| All others | No | N/A | NONE |

### No SSRF Risk

The model cannot make arbitrary HTTP requests. `web_search` and `web_reader` go through the ZAI SDK, which calls the ZAI API. The model cannot specify arbitrary URLs to fetch (web_reader takes a URL, but it goes through ZAI's page_reader service, not direct fetch).

---

## 7. Summary

| Area | Status |
|------|--------|
| Permission enforcement | ✅ Strong — system-enforced, not model-controlled |
| Path validation | ✅ Strong — blocked patterns + safeJoin |
| Filesystem boundaries | ✅ Strong — /upload/ for writes, blocked for sensitive reads |
| Network access | ✅ Safe — through ZAI SDK only |
| Memory scope | ⚠️ Medium — model controls scope (P1-B fix) |
| web_reader | ⚠️ Broken — wrong SDK function name (P1-A fix) |
| Infinite loop protection | ✅ Strong — max 5 per turn, no multi-turn loop |
| Destructive operations | ✅ Controlled — file_write/patch only in /upload/ |

### No Critical Security Issues Found

The canonical tool calling mechanism is secure. The two identified issues (web_reader function name, memory scope) are medium severity and fixable without architecture changes.
