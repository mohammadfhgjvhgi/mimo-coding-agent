# P1-A Test Gap Review

> Review of existing tests + identified gaps. No tests added.

---

## Current Test Coverage

### tests/tool-calling.test.ts — 39 assertions, 12 cases

| # | Test Case | What It Tests | Important? | Implementation Detail? |
|---|-----------|--------------|-----------|----------------------|
| 1 | Valid tool invocation | web_search executes and returns result | ✅ Yes | Minor (durationMs type) |
| 2 | Unknown tool | Nonexistent tool rejected | ✅ Yes | No |
| 3 | Invalid arguments | Missing required field rejected | ✅ Yes | No |
| 4 | Permission rejection | Developer denied web_search | ✅ Yes | No |
| 5 | Tool failure | Invalid URL handled | ✅ Yes | No |
| 6 | Malformed intent | Invalid JSON args handled | ✅ Yes | No |
| 7 | Non-tool response | No tool_calls → no execution | ✅ Yes | No |
| 8 | Result formatting | Tool results formatted for model | ✅ Yes | Minor (field names) |
| 9 | Schema generation | Per-agent tool schemas generated | ✅ Yes | No |
| 10 | Schema validation | Required fields checked | ✅ Yes | No |
| 11 | Permission check | Agent defaultTools enforced | ✅ Yes | No |
| 12 | Empty response | Empty/null/missing handled | ✅ Yes | No |

### Assessment

**Strengths:**
- Tests cover the important canonical flow steps
- Tests verify permission enforcement (not just happy path)
- Tests verify error handling (malformed, unknown, invalid)
- Tests verify edge cases (empty response, no tool calls)

**Weaknesses:**
- All tests are unit-level (no integration with actual model)
- No end-to-end test (model → tool → result → model synthesis)
- No test for multiple tool calls in one turn
- No test for conversation isolation in tool execution
- No test for the actual runtime execution path (executeTask)

---

## Missing Tests (Identified, NOT Added)

### HIGH Priority

| # | Missing Test | Why Important | Proposed Approach |
|---|-------------|--------------|-------------------|
| 1 | Multiple tool calls ordering | Model can request 2+ tools — verify all execute and results feed back | Mock model response with 2 tool_calls, verify both execute |
| 2 | Tool result fed back to model (E2E) | Verify follow-up model call receives tool results | Mock model, verify second call includes tool output |
| 3 | Follow-up call has no tools | Verify no infinite loop — second chat() call should NOT pass tools | Inspect chat() call arguments in follow-up |
| 4 | Max 5 tool calls enforced | Verify hard limit prevents excessive execution | Mock 6 tool_calls, verify only 5 execute |

### MEDIUM Priority

| # | Missing Test | Why Important | Proposed Approach |
|---|-------------|--------------|-------------------|
| 5 | web_search returns real results | Integration test — verify SDK actually works | Call web_search with real query, verify results array |
| 6 | file_read blocks .env | Integration test — verify security in practice | Call file_read with ".env", verify error |
| 7 | Model recovery after tool failure | Verify model can explain failure to user | Mock tool failure, verify model receives error and responds |
| 8 | Conversation isolation in tools | Verify tool execution doesn't leak state across conversations | Execute tool in Conv A, verify Conv B unaffected |

### LOW Priority

| # | Missing Test | Why Important | Proposed Approach |
|---|-------------|--------------|-------------------|
| 9 | Tool timeout enforcement | Verify tools don't hang forever | Mock slow tool, verify timeout triggers |
| 10 | Observability logging | Verify ExecutionLog entries created | Execute tool, check DB for log entry |

---

## Proposed P1-A Regression Checklist

### Pre-Approval (must pass before P1-B)

- [ ] `bun run tests/tool-calling.test.ts` — all 39 assertions pass
- [ ] `bun run build` — passes with `ignoreBuildErrors: false`
- [ ] `bun run lint` — 0 errors, 0 warnings
- [ ] Simple chat: "What is 2+2?" → "4" (no tools triggered)
- [ ] Tool trigger: "Search for AI news" → web_search tool event in SSE
- [ ] Tool result: Model response includes search results
- [ ] HTML generation: "Create HTML page" → artifact + preview
- [ ] Memory isolation: Conv A memory not in Conv B
- [ ] Conversation switching: Load 2 conversations, verify no stale data
- [ ] No console errors in browser

### Post-Fix (after fixing 2 blockers)

- [ ] web_reader: "Read https://example.com" → page_reader executes successfully
- [ ] memory_store: Tool called without conversationId → still conversation-scoped (system injects ID)

### Continuous Regression (every change)

- [ ] Normal chat works
- [ ] Conversation CRUD works
- [ ] Arabic/RTL works
- [ ] Settings dialog works
- [ ] Command palette works
- [ ] All 11 panels accessible
- [ ] Server starts without errors
