# Agent Matrix

> Audit of all 15 agents + consolidation recommendation.

---

## Current Agents (15)

| # | Agent | Responsibility | Tools (declared) | Overlap | Recommendation |
|---|-------|---------------|-----------------|---------|----------------|
| 1 | orchestrator | Coordinate, plan, route | memory, knowledge | — | KEEP — core coordinator |
| 2 | researcher | Web search, citations | web_search, web_reader, knowledge, memory | — | KEEP |
| 3 | planner | Task DAG, dependencies | memory, knowledge | ⚠️ architect | KEEP |
| 4 | developer | Write code | file_read, file_write, memory | ⚠️ refactoring | KEEP |
| 5 | debugger | Diagnose errors | file_read, knowledge, memory | — | KEEP |
| 6 | qa | Tests, validation | file_read, file_write, memory | — | KEEP |
| 7 | security | Vulnerabilities | file_read, knowledge | ⚠️ reviewer | KEEP |
| 8 | reviewer | Code review, approve | file_read, knowledge | ⚠️ security, code_analyst | KEEP |
| 9 | documentation | Docs, README | file_read, file_write, memory | — | KEEP |
| 10 | knowledge | Memory management | memory, knowledge, file_read | — | KEEP |
| 11 | architect | System design | memory, knowledge, file_read | ⚠️ planner | **CONSIDER MERGE with planner** |
| 12 | code_analyst | Codebase analysis | file_read, file_search, code_search, memory | ⚠️ reviewer | **CONSIDER MERGE with reviewer** |
| 13 | refactoring | Code improvement | file_read, file_write, memory | ⚠️ developer | **CONSIDER MERGE with developer** |
| 14 | database | Schema, migrations | file_read, file_write, memory | — | KEEP (specialized) |
| 15 | requirements | Requirements analysis | memory, knowledge | — | KEEP (specialized) |

---

## Overlap Analysis

### Overlap 1: architect ↔ planner
- **architect**: "Designs system architecture: components, data flow, APIs, tech stack"
- **planner**: "Converts goals into executable task DAGs with dependencies"
- **Overlap**: Both produce structured plans. Architect focuses on technical design, planner on task decomposition.
- **Recommendation**: MERGE into `architect` — architect produces both system design AND task plan. The distinction is artificial.
- **Risk**: Low. Both are planning agents.

### Overlap 2: code_analyst ↔ reviewer
- **code_analyst**: "Reads and understands existing codebases. Maps dependencies, finds technical debt"
- **reviewer**: "Reviews architecture decisions, code quality, alignment with project goals"
- **Overlap**: Both read code and assess quality. Analyst focuses on understanding, reviewer on judging.
- **Recommendation**: MERGE into `reviewer` — reviewer can both analyze and judge. The distinction is artificial.
- **Risk**: Low. Both are analysis agents.

### Overlap 3: refactoring ↔ developer
- **refactoring**: "Improves code structure without changing behavior"
- **developer**: "Writes clean, typed, production-ready code"
- **Overlap**: Both write/modify code. Refactoring is a subset of development.
- **Recommendation**: MERGE into `developer` — developer handles both new code and refactoring. The distinction is artificial.
- **Risk**: Low. Both are code-writing agents.

### Overlap 4: security ↔ reviewer
- **security**: "Reviews code for vulnerabilities"
- **reviewer**: "Reviews code quality"
- **Overlap**: Both review code, just different aspects.
- **Recommendation**: KEEP SEPARATE — security requires specialized knowledge (injection, XSS, auth). Worth keeping distinct.
- **Risk**: Merging would lose security focus.

---

## Consolidation Recommendation

### Current: 15 agents
### Proposed: 12 agents

| Action | Agent | Merged Into |
|--------|-------|-------------|
| MERGE | architect | planner (rename to `architect`) |
| MERGE | code_analyst | reviewer |
| MERGE | refactoring | developer |
| KEEP | All others | — |

### Proposed 12 Agents:
1. **orchestrator** — coordinate, plan, route
2. **researcher** — web search, citations
3. **architect** — system design + task planning (merged architect+planner)
4. **developer** — write code + refactor (merged developer+refactoring)
5. **debugger** — diagnose errors
6. **qa** — tests, validation
7. **security** — vulnerabilities
8. **reviewer** — code review + analysis (merged reviewer+code_analyst)
9. **documentation** — docs, README
10. **knowledge** — memory management
11. **database** — schema, migrations
12. **requirements** — requirements analysis

---

## Agent Contract Issues

### Current Problem
All 15 agents:
- Use the same model (GLM-4-plus)
- Use the same execution path (executeTask)
- Have `defaultTools` arrays that are NEVER enforced
- Have no structured output contract
- Are selected by keyword matching (pickAgentForMessage)

### What's Wrong
1. **defaultTools not enforced**: `developer` declares `["file_read", "file_write", "memory_store"]` but runtime never checks — any agent can call any tool (if tools worked at all)
2. **No output contract**: Each agent's system prompt describes output format, but runtime doesn't validate
3. **Keyword selection is fragile**: "code" triggers developer, but "code review" should trigger reviewer

### Canonical Agent Contract
```typescript
interface AgentContract {
  name: string;
  responsibility: string;
  inputSchema: ZodSchema;      // What the agent accepts
  outputSchema: ZodSchema;     // What the agent must produce
  allowedTools: string[];      // Enforced tool access
  allowedModels?: string[];    // Model routing (future)
  selectionKeywords: string[]; // For routing
  authority: "read" | "write" | "admin"; // Permission level
}
```

**DO NOT implement yet. Await approval.**
