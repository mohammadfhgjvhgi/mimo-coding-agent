# P1-D Task Graph Architecture

> Canonical task graph boundary for MiMo AI Platform.

---

## Design

The TaskGraph is a **directed acyclic graph (DAG)** that determines which tasks are eligible to execute based on dependency completion.

### Key Principle

TaskGraphService does NOT execute tasks. It only determines graph structure and which tasks are eligible. Task completion is handled by the execution layer after ValidationService (P1-C) passes.

### Graph Structure

```
PLAN
↓
CREATE TASK GRAPH
↓
VALIDATE GRAPH (cycle detection, missing deps, duplicates)
↓
READY TASKS (all deps completed)
↓
EXECUTION (by runtime, not TaskGraph)
↓
VALIDATION (by ValidationService, not TaskGraph)
↓
TASK STATE (completed/failed)
↓
UNLOCK DEPENDENT TASKS (via getNewlyReadyTasks)
```

### Task States

| State | Meaning |
|-------|---------|
| pending | Not yet ready (dependencies not all completed) |
| ready | All dependencies completed, eligible for execution |
| running | Currently being executed |
| completed | Execution + validation passed |
| failed | Execution or validation failed |
| blocked | At least one dependency failed |

### Dependency Rules

- A task becomes READY only when ALL dependencies are COMPLETED
- If any dependency FAILS, dependent tasks become BLOCKED (recursively)
- If any dependency is still PENDING/RUNNING, task remains PENDING
- TaskGraph NEVER marks tasks as completed — that's ValidationService's job

### Cycle Detection

Uses DFS with white-gray-black coloring algorithm:
- White = unvisited
- Gray = in progress (in current DFS path)
- Black = done

If a Gray node is encountered during DFS, a cycle exists.

### Topological Sort

Uses Kahn's algorithm to produce a deterministic execution order. Returns null if cycles exist.

## Persistence Decision

**No Prisma migration required.**

The existing `Task.dependencies` field (String, JSON array of task IDs) is sufficient:
- TaskGraphService works with in-memory `TaskGraph` objects
- Task records in DB store dependencies as JSON string
- TaskGraphService is instantiated from task records when needed
- No new DB models needed

## Relationship with ValidationService

```
TaskGraph determines: "Is this task READY?"
Execution runtime: runs the task
ValidationService: "Did this task SUCCEED?"
TaskGraph updates: "Based on success/failure, which tasks are now ready/blocked?"
```

TaskGraph and ValidationService are separate boundaries:
- TaskGraph: structural (dependencies, ordering, readiness)
- ValidationService: semantic (tool results, artifacts, completion)
