// MiMo AI — Policy Engine (ADR-008: Non-bypassable RBAC+ABAC, deny-by-default)
//
// Every Tool/Agent/Execution action MUST pass through `checkPermission` before
// it executes. There is no "skip policy" path. Even a fully hijacked model
// cannot perform an action the policy denies.
//
// v1 rules are hardcoded (data-driven later). Deny-wins: any deny rule wins
// regardless of allow rules.


// ============ Types ============

export interface PermissionInput {
  actor: string // system | user | agent:<type> | tool:<name> | autonomous-trigger
  action: string // e.g. 'tool.execute', 'file.write', 'shell.exec', 'network.fetch'
  resource: string // e.g. 'workspace', 'file:/abs/path', 'url:host', 'tool:bash'
  resourceId?: string
  context?: Record<string, unknown>
  toolRisk?: 'low' | 'medium' | 'high' | 'critical'
  authorityLevel?: AuthorityLevel
}

export interface ApprovalInput {
  taskId?: string
  sessionId?: string
  toolCallId?: string
  requestType: string // tool_execution | autonomous_action | deployment
  description: string
  risk: 'low' | 'medium' | 'high' | 'critical'
  expiresInSeconds?: number // default 300s (5min)
}

// Authority ordering: global > session > task > agent > tool
const AUTHORITY_RANK: Record<AuthorityLevel, number> = {
  global: 5,
  session: 4,
  task: 3,
  agent: 2,
  tool: 1,
}

// ============ Rule Engine ============

interface Rule {
  name: string
  // returns a partial PolicyDecision: { allowed: false } -> deny-wins,
  // { allowed: true, ... } -> allow, undefined -> rule does not apply
  evaluate: (input: PermissionInput) => Partial<PolicyDecision> | undefined
}

const WORKSPACE_ROOT = process.env.MIMO_WORKSPACE ?? process.cwd()

/**
 * Is a path inside the workspace? Used to gate filesystem writes.
 */
function isInsideWorkspace(path: string): boolean {
  if (!path) return false
  const abs = path.startsWith('/') ? path : `${WORKSPACE_ROOT}/${path}`
  const normalized = abs.replace(/\/+/g, '/').replace(/\/$/, '')
  const root = WORKSPACE_ROOT.replace(/\/+$/, '')
  // Reject path traversal escapes
  if (normalized.includes('..')) {
    const resolved = normalized.replace(/\.\.\//g, '').replace(/\.\.$/, '')
    return resolved.startsWith(root)
  }
  return normalized === root || normalized.startsWith(`${root}/`)
}

const rules: Rule[] = [
  // 1. Critical-risk tool -> always require approval
  {
    name: 'critical-risk-requires-approval',
    evaluate: (i) =>
      i.toolRisk === 'critical'
        ? {
            allowed: false,
            reason: 'Critical-risk action requires explicit approval',
            conditions: ['approval_required'],
          }
        : undefined,
  },
  // 2. High-risk tool -> require approval unless authority=global
  {
    name: 'high-risk-requires-approval',
    evaluate: (i) =>
      i.toolRisk === 'high' && i.authorityLevel !== 'global'
        ? {
            allowed: false,
            reason: 'High-risk action requires approval (authorityLevel < global)',
            conditions: ['approval_required'],
          }
        : undefined,
  },
  // 3. Medium-risk tool -> allowed if authority >= session
  {
    name: 'medium-risk-needs-task',
    evaluate: (i) => {
      if (i.toolRisk !== 'medium') return undefined
      const level = i.authorityLevel ?? 'tool'
      // Medium-risk (e.g. fs_write, knowledge_ingest) allowed at task+ authority
      if (AUTHORITY_RANK[level] >= AUTHORITY_RANK.task) {
        return { allowed: true, reason: 'Medium-risk allowed at task+ authority' }
      }
      return {
        allowed: false,
        reason: 'Medium-risk action requires authorityLevel >= task',
        conditions: ['approval_required'],
      }
    },
  },
  // 4. Low-risk tool -> allowed
  {
    name: 'low-risk-allowed',
    evaluate: (i) =>
      i.toolRisk === 'low'
        ? { allowed: true, reason: 'Low-risk action permitted' }
        : undefined,
  },
  // 5. Filesystem write outside workspace -> deny
  {
    name: 'no-write-outside-workspace',
    evaluate: (i) => {
      if (!['file.write', 'file.delete', 'fs.write', 'fs.delete'].includes(i.action)) return undefined
      const path = (i.context?.path as string) ?? (i.context?.filePath as string) ?? i.resourceId ?? ''
      if (!isInsideWorkspace(path)) {
        return {
          allowed: false,
          reason: `Filesystem write outside workspace denied: ${path}`,
        }
      }
      return undefined
    },
  },
  // 6. Network access by tools -> require approval
  {
    name: 'network-requires-approval',
    evaluate: (i) => {
      if (!['network.fetch', 'http.request', 'tool:browser', 'browser.navigate'].includes(i.action)) return undefined
      return {
        allowed: false,
        reason: 'Network access by tools requires approval',
        conditions: ['approval_required'],
      }
    },
  },
  // 7. Shell/terminal execution -> require approval (treat as high)
  {
    name: 'shell-requires-approval',
    evaluate: (i) => {
      if (!['shell.exec', 'bash.exec', 'terminal.exec', 'tool:bash', 'tool:shell'].includes(i.action)) return undefined
      // Force toolRisk to high if not set, and require approval
      return {
        allowed: false,
        reason: 'Shell/terminal execution requires approval (high risk)',
        conditions: ['approval_required', 'sandbox_required'],
      }
    },
  },
  // 8. Deletion actions -> always require approval
  {
    name: 'deletion-requires-approval',
    evaluate: (i) => {
      const isDelete =
        i.action.endsWith('.delete') ||
        i.action.endsWith('.remove') ||
        i.action === 'file.delete' ||
        i.action === 'db.delete' ||
        (i.context?.destructive === true)
      if (!isDelete) return undefined
      return {
        allowed: false,
        reason: 'Deletion/destructive actions always require approval',
        conditions: ['approval_required'],
      }
    },
  },
  // 9. Kill-switch: global deny via env var
  {
    name: 'kill-switch',
    evaluate: () => {
      // Check both env and in-memory flag (import lazily to avoid circular dep)
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { isKillSwitchActive } = require('@/lib/autonomy/triggers')
        if (isKillSwitchActive()) {
          return { allowed: false, reason: 'Global kill-switch active — all actions denied' }
        }
      } catch {}
      return undefined
    },
  },
]

// ============ Public API ============

/**
 * Evaluate `input` against all policy rules. Deny-wins.
 * If no rule applies, deny by default (per ADR-008).
 *
 * Also writes an AuditLog entry recording the decision.
 */
export async function checkPermission(input: PermissionInput): Promise<PolicyDecision> {
  let decision: PolicyDecision | null = null

  for (const rule of rules) {
    let result: Partial<PolicyDecision> | undefined
    try {
      result = rule.evaluate(input)
    } catch (err) {
      logger.warn('policy rule error', { rule: rule.name, error: String(err) })
      // Fail closed
      decision = {
        allowed: false,
        reason: `Policy rule ${rule.name} threw: ${String(err)}`,
      }
      break
    }
    if (!result) continue
    // Deny-wins: any deny short-circuits
    if (result.allowed === false) {
      decision = {
        allowed: false,
        reason: result.reason ?? `Denied by rule: ${rule.name}`,
        conditions: result.conditions,
        modifiedParams: result.modifiedParams,
      }
      break
    }
    // Allow: record but keep evaluating for any later deny
    if (result.allowed === true && !decision) {
      decision = {
        allowed: true,
        reason: result.reason ?? `Allowed by rule: ${rule.name}`,
        conditions: result.conditions,
        modifiedParams: result.modifiedParams,
      }
    }
  }

  // Deny-by-default: no rule matched
  if (!decision) {
    decision = {
      allowed: false,
      reason: `No policy rule permitted action "${input.action}" on "${input.resource}" — deny-by-default`,
    }
  }

  // Audit every decision
  try {
    await auditDecision(input, decision)
  } catch (err) {
    logger.warn('audit write failed', { error: String(err) })
  }

  logger.debug('policy decision', {
    actor: input.actor,
    action: input.action,
    resource: input.resource,
    allowed: decision.allowed,
    reason: decision.reason,
  })

  return decision
}

/**
 * Create an Approval record (status 'pending'), emit `approval:requested`,
 * return the approvalId. Callers should then re-call `checkPermission` after
 * the approval is decided.
 */
export async function requestApproval(input: ApprovalInput): Promise<string> {
  const expiresInSeconds = input.expiresInSeconds ?? 300
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000)

  // Verify taskId exists before creating approval (FK constraint)
  let validTaskId = input.taskId
  if (validTaskId) {
    const task = await db.task.findUnique({ where: { id: validTaskId }, select: { id: true } })
    if (!task) validTaskId = undefined // drop invalid FK
  }

  // Verify sessionId exists if provided
  let validSessionId = input.sessionId
  if (validSessionId) {
    const session = await db.session.findUnique({ where: { id: validSessionId }, select: { id: true } })
    if (!session) validSessionId = undefined
  }

  const approval = await db.approval.create({
    data: {
      sessionId: validSessionId,
      taskId: validTaskId,
      toolCallId: input.toolCallId,
      requestType: input.requestType,
      description: input.description,
      risk: input.risk,
      status: 'pending',
      expiresAt,
    },
  })

  await emit('approval:requested', {
    approvalId: approval.id,
    requestType: input.requestType,
    description: input.description,
    risk: input.risk,
    taskId: input.taskId,
    sessionId: input.sessionId,
  }, input.taskId)

  logger.info('approval requested', {
    approvalId: approval.id,
    requestType: input.requestType,
    risk: input.risk,
  })

  return approval.id
}

/**
 * Decide a pending approval: update Approval record, emit `approval:decided`.
 * If `modifiedParams` provided, they are stored as JSON in `decision` and the
 * caller is expected to use them in place of the original tool input.
 */
export async function decideApproval(
  approvalId: string,
  decision: 'approved' | 'denied',
  decidedBy: string,
  modifiedParams?: Record<string, unknown>
): Promise<void> {
  const existing = await db.approval.findUnique({ where: { id: approvalId } })
  if (!existing) throw new Error(`Approval ${approvalId} not found`)
  if (existing.status !== 'pending') {
    throw new Error(`Approval ${approvalId} is not pending (status=${existing.status})`)
  }

  await db.approval.update({
    where: { id: approvalId },
    data: {
      status: decision,
      decidedBy,
      decidedAt: new Date(),
      decision: modifiedParams ? JSON.stringify(modifiedParams) : null,
    },
  })

  await emit('approval:decided', {
    approvalId,
    decision,
    decidedBy,
    requestType: existing.requestType,
    taskId: existing.taskId,
    modifiedParams: modifiedParams ?? null,
  }, existing.taskId ?? undefined)

  logger.info('approval decided', { approvalId, decision, decidedBy })
}

/**
 * List pending approvals, optionally filtered by session.
 */
export async function listPendingApprovals(sessionId?: string) {
  const where: Record<string, unknown> = { status: 'pending' }
  if (sessionId) where.sessionId = sessionId
  return db.approval.findMany({
    where: where as any,
    orderBy: { createdAt: 'asc' },
  })
}

// ============ Audit (internal hook; full audit API lives in audit.ts) ============

async function auditDecision(input: PermissionInput, decision: PolicyDecision) {
  await db.auditLog.create({
    data: {
      actor: input.actor,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId,
      permitted: decision.allowed,
      reason: decision.reason,
      metadata: JSON.stringify({
        toolRisk: input.toolRisk,
        authorityLevel: input.authorityLevel,
        conditions: decision.conditions,
        context: input.context,
      }),
    },
  })
}
