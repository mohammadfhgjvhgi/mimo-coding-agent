// MiMo AI — Learning Engine
// ADR-006: Controlled self-improvement. Lessons always safe; deployed changes gated.


// ============ Experience Extraction ============

export async function extractLesson(task: Task): Promise<Lesson | null> {
  if (task.status !== 'completed' && task.status !== 'failed') return null

  try {
    const gateway = await getModelGateway()
    const steps = await db.step.findMany({
      where: { taskId: task.id },
      orderBy: { stepIndex: 'asc' },
    })

    const stepSummary = steps.map(s =>
      `[${s.stepType}] ${s.toolName ? `tool:${s.toolName}` : ''} ${s.status} ${s.error ? `error:${s.error.slice(0, 100)}` : ''}`
    ).join('\n')

    const lessonType = task.status === 'failed' ? 'failure' : 'success'

    const result = await gateway.generateStructured<{ lesson: string; strategy?: string }>(
      {
        messages: [{
          role: 'user',
          content: `Task: ${task.goal}\nStatus: ${task.status}\nSteps:\n${stepSummary}\n\nExtract a concise lesson learned from this task. What worked? What didn't? What should be remembered for similar future tasks?`,
        }],
        thinking: false,
      },
      `{ "lesson": string, "strategy"?: string }`
    )

    // Write lesson to DB
    const lesson = await db.lesson.create({
      data: {
        taskId: task.id,
        lessonType,
        content: result.lesson,
        evidence: JSON.stringify({ steps: stepSummary, result: task.result }),
        status: 'learned',
      },
    })

    // Also write to memory (always safe — this is an observation, not a behavior change)
    await writeMemory({
      type: lessonType === 'failure' ? 'failure' : 'skill',
      content: result.lesson,
      importance: task.status === 'failed' ? 0.7 : 0.5,
      provenance: { source: 'learning', taskId: task.id },
    })

    emit('memory:written', { memoryId: lesson.id, type: 'lesson', lessonType }, task.id)
    logger.info('Lesson extracted', { taskId: task.id, type: lessonType })

    return lesson as unknown as Lesson
  } catch (err) {
    logger.error('Lesson extraction failed', { taskId: task.id, error: String(err) })
    return null
  }
}

// ============ Candidate Improvement (gated) ============

export interface CandidateImprovement {
  id: string
  type: 'prompt' | 'routing' | 'tool_selection' | 'strategy'
  description: string
  proposedChange: string
  status: 'candidate' | 'evaluating' | 'approved' | 'deployed' | 'rejected' | 'rolled_back'
}

export async function suggestImprovement(task: Task): Promise<CandidateImprovement | null> {
  try {
    const gateway = await getModelGateway()
    const result = await gateway.generateStructured<{ type: string; description: string; change: string }>(
      {
        messages: [{
          role: 'user',
          content: `Based on this task (goal: ${task.goal}, status: ${task.status}), suggest one concrete improvement to the system. This could be a prompt tweak, routing rule, tool selection heuristic, or strategy update. Be specific.`,
        }],
        thinking: false,
      },
      `{ "type": "prompt"|"routing"|"tool_selection"|"strategy", "description": string, "change": string }`
    )

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const candidate: CandidateImprovement = {
      id,
      type: result.type as CandidateImprovement['type'],
      description: result.description,
      proposedChange: result.change,
      status: 'candidate',
    }

    logger.info('Improvement candidate generated', { id, type: candidate.type })
    return candidate
  } catch (err) {
    logger.error('Improvement suggestion failed', { error: String(err) })
    return null
  }
}

// ============ Deployment Gate ============

export async function deployImprovement(candidate: CandidateImprovement): Promise<{ deployed: boolean; reason: string }> {
  // ADR-006: ALL deployments require evaluation + regression + approval
  // For v1: manual approval only. Auto-deploy deferred to v1.x.

  // Step 1: Evaluate (placeholder — would run eval suite)
  const evalResult = await runEvaluation(candidate)
  if (!evalResult.pass) {
    return { deployed: false, reason: `Evaluation failed: ${evalResult.reason}` }
  }

  // Step 2: Regression check (placeholder)
  const regressionResult = await runRegression(candidate)
  if (!regressionResult.pass) {
    return { deployed: false, reason: `Regression failed: ${regressionResult.reason}` }
  }

  // Step 3: Security check
  if (candidate.proposedChange.toLowerCase().includes('ignore') || candidate.proposedChange.toLowerCase().includes('bypass')) {
    return { deployed: false, reason: 'Security check failed: suspicious content' }
  }

  // Step 4: Manual approval required for v1
  // In v1, we log the candidate but don't auto-deploy
  logger.info('Improvement passed gates but requires manual approval', { id: candidate.id })

  return { deployed: false, reason: 'Manual approval required for v1. Candidate logged for review.' }
}

async function runEvaluation(candidate: CandidateImprovement): Promise<{ pass: boolean; reason: string }> {
  // Placeholder: would run benchmark suite
  // For v1: always pass (candidates are suggestions, not auto-deployed)
  return { pass: true, reason: 'Eval suite placeholder (v1)' }
}

async function runRegression(candidate: CandidateImprovement): Promise<{ pass: boolean; reason: string }> {
  // Placeholder: would run regression tests
  return { pass: true, reason: 'Regression suite placeholder (v1)' }
}

// ============ List Lessons ============

export async function listLessons(filter?: { taskId?: string; type?: string; limit?: number }): Promise<Lesson[]> {
  const where: Record<string, unknown> = {}
  if (filter?.taskId) where.taskId = filter.taskId
  if (filter?.type) where.lessonType = filter.type
  const rows = await db.lesson.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: filter?.limit ?? 50,
  })
  return rows as unknown as Lesson[]
}
