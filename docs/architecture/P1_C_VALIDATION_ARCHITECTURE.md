# P1-C Validation Architecture

> Canonical validation boundary for MiMo AI Platform.

---

## Validation Layers

```
MODEL
↓
TOOL CALL → TOOL EXECUTION → TOOL RESULT VALIDATION
↓
WORKSPACE OPERATION → WORKSPACE RESULT VALIDATION
↓
ARTIFACT CREATION → ARTIFACT VALIDATION
↓
TASK COMPLETION VALIDATION
↓
ACCEPT (completed) / REJECT (failed)
```

## Key Principle

**A model saying "done" is NEVER sufficient evidence that a task succeeded.**

The system determines success from **observable state**:
- Tool results have valid structure
- Workspace operations succeeded
- Artifacts exist on disk with valid metadata
- No validation check failed

## ValidationService (`src/lib/ai/validation.ts`)

### 1. Tool Result Validation
- **Input**: `{ toolName, success, output, error?, durationMs }`
- **Checks** (6 deterministic):
  - success is boolean
  - output present on success
  - error present on failure
  - durationMs is non-negative number
  - toolName is present
  - no success+error contradiction
- **Authority**: `validateToolResult()`
- **Failure behavior**: Returns `ValidationResult` with `passed: false`

### 2. Workspace Result Validation
- **Input**: `WorkspaceResult` from WorkspaceService
- **Checks** (7 deterministic):
  - success is boolean
  - operation is present
  - path or data present on success
  - error present on failure
  - diagnostics code present on failure
  - path within sandbox (no traversal)
  - no success+error contradiction
- **Authority**: `validateWorkspaceResult()`

### 3. Artifact Validation
- **Input**: `ArtifactToValidate` (from DB)
- **Checks** (11 deterministic):
  - has name
  - has content
  - has filePath
  - file exists on disk
  - file size matches sizeBytes
  - filePath within boundary (no traversal)
  - filePath in allowed area (upload/ or workspace/)
  - type is valid
  - format is valid
  - sizeBytes is positive
  - content length roughly matches sizeBytes
- **Authority**: `validateArtifact()`

### 4. Task Completion Validation
- **Input**: `{ taskTitle, expectedOutput?, responseContent, toolsUsed, artifactsCreated, toolValidations, workspaceValidations, artifactValidations }`
- **Checks** (6):
  - all tool validations passed
  - all workspace validations passed
  - all artifact validations passed
  - response content non-empty
  - response relates to expectedOutput (if specified)
  - model claim not trusted (always passes — documentation check)
- **Authority**: `validateTaskCompletion()`
- **Failure behavior**: Task marked `failed` instead of `completed`

## Task Completion Rule

```
A task may become COMPLETED only when:
  ✓ required tool calls succeeded
  ✓ required workspace operations succeeded
  ✓ required artifacts exist when applicable
  ✓ artifact metadata is valid
  ✓ no required validation check failed

If validation fails:
  TASK ≠ COMPLETED
  TASK = FAILED
```

## Integration Points

| Location | What happens |
|----------|-------------|
| `runtime.ts` after model response | Validate tool results, artifacts, task completion |
| Before `db.task.update()` | Check `taskValidation.passed` → set `completed` or `failed` |
| SSE event `type: "decision"` | Emit validation results to frontend |
| `ExecutionLog` phase `"validate"` | Log validation results for observability |

## What This Is NOT

- ❌ Not an "AI validator" that asks another model
- ❌ Not automatic repair loops
- ❌ Not retry loops
- ❌ Not build/test execution
- ❌ Not a new state machine
- ✅ Deterministic checks based on observable state
