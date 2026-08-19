# 🏗️ MiMo AI Engineering Intelligence Platform — Architecture

> An autonomous multi-agent AI engineering system built on Next.js 16 + TypeScript + z-ai-web-dev-sdk.
> Inspired by the MiMo v2 15-layer architecture and 10 ADRs from the research corpus.

---

## 🎯 System Purpose

Turn a user goal into a delivered solution through:
**Idea → Research → Requirements → Architecture → Planning → Implementation → Testing → Debugging → Documentation → Validation → Delivery**

With minimal user intervention. The user describes a goal; MiMo's 10 agents plan, execute, verify, and deliver.

---

## 🧱 Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     FRONTEND (Next.js 16)                     │
│  Workspace UI — 8 panels                                    │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐   │
│  │  Chat    │  Tasks   │  Agents  │ Artifacts│ Memory   │   │
│  ├──────────┼──────────┼──────────┼──────────┼──────────┤   │
│  │Decisions │ Timeline │  Skills  │          │          │   │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘   │
│  Zustand store · SSE streaming · 10 agent selector          │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTP / SSE
┌─────────────────────────▼───────────────────────────────────┐
│                    API LAYER (Next.js Route Handlers)        │
│  /api/chat (SSE) · /api/agents · /api/skills · /api/state   │
│  /api/conversations · /api/tasks · /api/artifacts           │
│  /api/memory · /api/decisions                               │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    AI CORE (src/lib/ai/)                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Runtime (executeTask + runAutonomousLoop)           │   │
│  │  Plan → Execute → Observe → Validate → Repair → Done │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌─────────────┬──────────────┬──────────────┬───────────┐  │
│  │ Model       │ Context      │ Memory       │ Agents    │  │
│  │ Gateway     │ Engine       │ Store        │ Registry  │  │
│  │ (ZAI SDK)   │ (60k limit)  │ (9 types)    │ (10)      │  │
│  └─────────────┴──────────────┴──────────────┴───────────┘  │
│  ┌─────────────┬──────────────┐                              │
│  │ Tool        │ Skill        │                              │
│  │ Registry    │ Registry     │                              │
│  │ (6 tools)   │ (69 skills)  │                              │
│  └─────────────┴──────────────┘                              │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    DATABASE (SQLite + Prisma)                │
│  Conversation · Message · Task · AgentActivity              │
│  Artifact · Memory · Decision · ExecutionLog · Knowledge    │
└─────────────────────────────────────────────────────────────┘
```

---

## 🤖 The 10 Agents

| # | Agent | Role | Color | Tools |
|---|-------|------|-------|-------|
| 1 | **Orchestrator** | Coordinates all agents, plans task DAGs | violet | memory, knowledge |
| 2 | **Researcher** | Web search + reading + evidence synthesis | cyan | web_search, web_reader, knowledge, memory |
| 3 | **Planner** | Converts goals into executable task DAGs | amber | memory, knowledge |
| 4 | **Developer** | Writes TypeScript/Python/Arduino code | emerald | file_read, file_write, memory |
| 5 | **Debugger** | Diagnoses errors, proposes fixes | rose | file_read, knowledge, memory |
| 6 | **QA** | Writes tests, validates outputs | blue | file_read, file_write, memory |
| 7 | **Security** | Vulnerability scanning, hardening | red | file_read, knowledge |
| 8 | **Reviewer** | Architecture review, approve/reject | orange | file_read, knowledge |
| 9 | **Documentation** | README, API docs, ADRs | teal | file_read, file_write, memory |
| 10 | **Knowledge** | Memory management, consolidation | indigo | memory, knowledge, file_read |

### Agent Routing
The `pickAgentForMessage()` function routes messages based on keywords:
- "research/search/find" → researcher
- "plan/design/architecture" → planner
- "code/implement/build" → developer
- "bug/error/fix" → debugger
- "test/validate" → qa
- "security/vulnerab" → security
- "review/audit" → reviewer
- "document/readme" → documentation
- "remember/memory" → knowledge
- default → orchestrator

---

## 🔧 The 6 Tools

| Tool | Risk | Description |
|------|------|-------------|
| `web_search` | low | Search the web via z-ai-web-dev-sdk |
| `web_reader` | low | Read web page content |
| `file_read` | low | Read files from project sandbox (max 50KB) |
| `file_write` | medium | Write files to /upload/ directory |
| `memory_store` | low | Write memories (9 types) |
| `knowledge_search` | low | Search knowledge base + memories |

### Tool Execution Pipeline
```
Intent → Permission → Validation → Tool → Result → Verification
```

Each tool has:
- Input schema (JSON Schema)
- Risk level (low/medium/high)
- Timeout (5-30s)
- Sandboxed execution

---

## 🧠 Memory System (9 Types)

| Type | Purpose | Example |
|------|---------|---------|
| `working` | Current task context | "User is debugging auth route" |
| `short_term` | Recent session | "Tried 3 approaches, X worked" |
| `long_term` | Consolidated knowledge | "Project uses Prisma + SQLite" |
| `episodic` | Past events | "On Aug 12, deployed v1.0" |
| `semantic` | Facts | "Next.js 16 uses Turbopack" |
| `procedural` | How-to | "To add API route, create src/app/api/..." |
| `preference` | User likes | "User prefers Arabic responses" |
| `failure` | What didn't work | "Don't use `any` type — lint fails" |
| `skill` | Capabilities | "System can generate Arduino code" |

### Memory Lifecycle
1. **Write** — agent calls `memory_store` tool or runtime auto-stores procedural memory
2. **Retrieve** — context engine pulls top-5 by keyword + importance
3. **Consolidate** — short_term → long_term when accessCount ≥ 2 AND importance ≥ 0.6
4. **Expire** — optional TTL via `expiresAt`

---

## 🔄 Autonomous Execution Loop

```
User Goal
    │
    ▼
┌─────────────────────────────────┐
│  Orchestrator plans             │
│  (generateStructured → JSON)    │
│  Output: { tasks[], order[] }   │
└──────────────┬──────────────────┘
               │
               ▼
    ┌──────────────────────┐
    │  For each task:      │◄────────────────┐
    │  ┌────────────────┐  │                 │
    │  │ 1. Plan        │  │                 │
    │  │ 2. Execute     │  │                 │
    │  │ 3. Observe     │  │                 │
    │  │ 4. Validate    │  │                 │
    │  │ 5. Repair?     │──┼─────────────────┘
    │  │ 6. Complete    │  │   (retry up to 3)
    │  └────────────────┘  │
    └──────────┬───────────┘
               │
               ▼
    ┌──────────────────────┐
    │  Log Decision (ADR)  │
    │  Log Execution       │
    │  Save Artifacts      │
    │  Write Memories      │
    └──────────────────────┘
```

### SSE Event Stream
```
data: { type: "start", conversationId, agent }
data: { type: "agent", agent, phase: "plan" }
data: { type: "agent", agent: "thinking", phase: "execute" }
data: { type: "delta", content: "..." }     ← streaming tokens
data: { type: "tool", name, input, output }  ← tool calls
data: { type: "memory", id, type, content }  ← memory writes
data: { type: "artifact", id, name, type }   ← artifact creation
data: { type: "task", phase, taskId }        ← task updates
data: { type: "end", content, summary }      ← completion
```

---

## 📊 Database Schema (10 Models)

```
Conversation (1) ──< (N) Message
                  ──< (N) Task ──< (N) ExecutionLog
                  ──< (N) Artifact
                  ──< (N) Decision
                  ──< (N) Memory
                  ──< (N) AgentActivity

KnowledgeEntry (standalone, for document intelligence)
```

---

## 🎨 UI Panels (8)

| Panel | Purpose |
|-------|---------|
| **Chat** | Streaming conversation with agent selector + autonomous toggle |
| **Tasks** | Task DAG with progress bar, status, agent assignment |
| **Agents** | 10 agents with live "active" indicators during execution |
| **Artifacts** | Code, docs, reports created by agents (click to view) |
| **Memory** | 9-type memory browser with importance scores |
| **Decisions** | Architecture Decision Records from autonomous missions |
| **Timeline** | Execution logs: plan → execute → observe → validate → complete |
| **Skills** | 69 AI skills with search |

---

## 🔌 API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/chat` | Streaming chat (SSE) |
| GET | `/api/agents` | List 10 agents |
| GET | `/api/skills?q=` | List/search 69 skills |
| GET | `/api/state` | System counts + recent executions |
| GET/POST | `/api/conversations` | List/create conversations |
| GET | `/api/conversations/[id]` | Full conversation with relations |
| GET/POST | `/api/tasks` | List/create tasks |
| GET | `/api/artifacts?conversationId=` | List artifacts |
| GET/POST | `/api/memory` | List/write memories |
| GET | `/api/decisions?conversationId=` | List decisions |

---

## 🛡️ Security & Reliability

- **Sandboxed file access** — `file_read`/`file_write` cannot escape `/home/z/my-project/`
- **Path traversal protection** — `safeJoin()` validates resolved paths
- **Tool timeouts** — 5-30s per tool, prevents hangs
- **Retry with backoff** — failed tasks retry up to 3 times
- **Failure policies** — retry / skip / abort / escalate per task
- **Execution logging** — every phase recorded to ExecutionLog table
- **Decision records** — autonomous missions log ADRs
- **Memory consolidation** — short-term promotes to long-term based on access + importance

---

## 🚀 Quick Start

```bash
# Start dev server
bun run dev

# Open http://localhost:3000
```

### Usage
1. Type a goal in the chat (e.g., "Build a smart parking system with Arduino")
2. Toggle **Autonomous** mode for multi-agent mission
3. Watch the Tasks panel for the plan DAG
4. View Artifacts for code/docs/reports
5. Check Timeline for execution logs
6. Memory panel shows what MiMo learned

---

## 📚 Research Foundation

This system is built on the MiMo research corpus (3901 files, 444MB):
- 10 ADRs from mimo-v2 (GLM-5.2 gateway, context management, tool policy, etc.)
- 64 knowledge docs across 20 domains (agents, memory, security, tools, etc.)
- 54 AI tools analyzed (evidence/)
- 16 HCI theories (academic/)
- 16 UX patterns (patterns/)
- 3 Arabic research documents (1.2MB)

---

## 🎯 Definition of Done

- ✅ Architecture coherent, modular, extensible
- ✅ Code implemented, typed, integrated
- ✅ 10 agents operational with system prompts
- ✅ 6 tools operational (web_search, web_reader, file_read, file_write, memory_store, knowledge_search)
- ✅ Context engine operational (history + memories + agent prompt)
- ✅ Memory system operational (9 types, write/retrieve/consolidate)
- ✅ Runtime operational (executeTask + runAutonomousLoop)
- ✅ SSE streaming operational
- ✅ 8 UI panels operational
- ✅ Lint clean
- ✅ Agent browser verified
- ✅ Worklog documented
