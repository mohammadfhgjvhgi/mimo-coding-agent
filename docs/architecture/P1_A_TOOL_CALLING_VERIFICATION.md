# P1-A Tool Calling Verification

> Verified from actual installed SDK source code and live API calls.

---

## SDK Verification

### Installed Package
- **Name**: `z-ai-web-dev-sdk`
- **Version**: `0.0.18`
- **Location**: `node_modules/z-ai-web-dev-sdk/`
- **Main**: `dist/index.js`
- **Types**: `dist/index.d.ts`

### Type Definition Analysis

```typescript
// From dist/index.d.ts
interface CreateChatCompletionBody {
    model?: string;
    messages: ChatMessage[];
    stream?: boolean;
    thinking?: { type: 'enabled' | 'disabled' };
    [key: string]: any;  // ← THIS IS KEY: allows arbitrary properties
}
```

The `[key: string]: any` index signature means ANY property can be passed, including `tools`. The SDK does not validate or transform this — it passes through to the API.

### Source Code Analysis

```javascript
// From dist/index.js, createChatCompletion() at line 73
async createChatCompletion(body) {
    const requestBody = {
        ...body,  // ← spreads ALL properties including tools
        thinking: body.thinking || { type: 'disabled' },
    };
    const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody),
    });
    return await response.json();  // ← returns raw JSON including tool_calls
}
```

**Conclusion**: The SDK is a thin wrapper. It passes `tools` to the API and returns `tool_calls` from the response without any transformation.

### Function Map (from SDK types)

```typescript
interface FunctionMap {
    web_search: { args: SearchFunctionArgs; result: SearchFunctionResultItem[] };
    page_reader: { args: PageReaderFunctionArgs; result: PageReaderFunctionResult };
}
```

**Important**: The SDK's function invocation API uses `page_reader`, NOT `web_reader`. The current `web_reader` tool in `tools/index.ts` calls `invokeFunction("web_reader", ...)` which fails with 400 "Unknown function".

### Live API Test Results

#### Test 1: Single Tool Call
```
Request: { messages: [...], tools: [{ type: "function", function: { name: "web_search", ... } }] }
Response: {
  choices: [{
    finish_reason: "tool_calls",
    message: {
      role: "assistant",
      content: "I'll search for React 19 features...",
      tool_calls: [{
        id: "call_-7355395514629616574",
        type: "function",
        function: { name: "web_search", arguments: '{"query":"React 19 features"}' }
      }]
    }
  }],
  usage: { prompt_tokens: 204, completion_tokens: 35, total_tokens: 239 }
}
```

#### Test 2: Multiple Tool Calls
```
Request: Asked for "search React 19 AND read file src/lib/ai/model.ts"
Response: 2 tool_calls returned:
  1. web_search with {"query":"React 19 features new updates"}
  2. file_read with {"path":"src/lib/ai/model.ts"}
```

#### Test 3: No Tool Call (Simple Question)
```
Request: "What is 2+2?" with tools available
Response: finish_reason: "stop", content: "2 + 2 = 4.", tool_calls: undefined
```

#### Test 4: Response Structure
```
Response keys: [ "choices", "created", "id", "model", "object", "request_id", "usage" ]
choices[0] keys: [ "finish_reason", "index", "message" ]
choices[0].message keys: [ "content", "role", "tool_calls" ]
```

### Streaming + Tools Compatibility

**Status**: ⚠️ UNTESTED

The SDK's `createChatCompletion()` returns `response.body` (ReadableStream) when `stream: true`. It is unknown whether streaming responses include `tool_calls` in the stream. The current P1-A implementation uses non-streaming `chat()` for tool calls, which is correct.

### Tool Result Return to Model

**Status**: ✅ VERIFIED

Tool results are formatted as:
```typescript
{ role: "tool", content: JSON.stringify(output).slice(0, 8000), tool_call_id: callId }
```

These are sent in the follow-up `chat()` call as user messages (since the SDK's `ChatMessage` type doesn't include `role: "tool"`):
```typescript
{ role: "user", content: `Tool ${tool_call_id} result: ${content}` }
```

This is a workaround — the SDK type only supports `role: 'system' | 'user' | 'assistant'`. The API likely accepts `role: "tool"` but the TypeScript type doesn't include it.

---

## Canonical Flow Verification

```
1. generateToolSchemaForAgent(agentName)     → tool-caller.ts:42
2. chat(messages, { tools: schemas })        → model.ts:88 (passes tools via [key:string]:any)
3. parseToolCallsFromResponse(result.raw)    → tool-caller.ts:68
4. validateToolArguments(name, args)         → tool-caller.ts:99
5. checkToolPermission(agent, tool)          → tool-caller.ts:120
6. executeToolCall(request, context)         → tool-caller.ts:140
7. formatToolResultsForModel(results)        → tool-caller.ts:165
8. chat(followUpMessages)                    → model.ts:88 (without tools — no infinite loop)
```

### No Bypass Paths

| Check | Verified |
|-------|----------|
| `executeTool` imported in runtime.ts? | ❌ No — only in tool-caller.ts |
| `parseToolCalls` (old regex) in runtime.ts? | ❌ No — removed |
| Any file calls `executeTool` directly? | ❌ No — grep confirms only tool-caller.ts |
| Agent prompts instruct tool format? | ❌ No — native function calling |
| Model can bypass permission? | ❌ No — `checkToolPermission` is system code |
