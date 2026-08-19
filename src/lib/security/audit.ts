// MiMo AI — Audit Log (ADR-008 / observability)
//
// Append-only record of every permission decision and security-relevant
// action. Every `checkPermission` call already writes a row; this module
// exposes the explicit `audit()` helper for non-permission events (e.g.
// "approval created", "tool executed", "policy rule updated") and a query
// helper.


// Prisma generates the AuditLog type; import it for typing.

export interface AuditInput {
  actor: string // system | user | agent:<type> | tool:<name> | autonomous-trigger
  action: string
  resource: string
  resourceId?: string
  permitted: boolean
  reason?: string
  metadata?: Record<string, unknown>
}

export interface AuditFilter {
  actor?: string
  action?: string
  resourceId?: string
  limit?: number
}

/**
 * Write a single audit entry. Never throws — audit failures are logged.
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actor: input.actor,
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId,
        permitted: input.permitted,
        reason: input.reason,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
    })
  } catch (err) {
    // Audit failures must not break callers, but must be visible.
    logger.error('audit write failed', {
      actor: input.actor,
      action: input.action,
      error: String(err),
    })
  }
}

/**
 * Query audit log with optional filter. Newest first. Default limit 200.
 */
export async function listAudit(filter: AuditFilter = {}): Promise<AuditLog[]> {
  const where: Record<string, unknown> = {}
  if (filter.actor) where.actor = filter.actor
  if (filter.action) where.action = filter.action
  if (filter.resourceId) where.resourceId = filter.resourceId

  return db.auditLog.findMany({
    where: where as any,
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(filter.limit ?? 200, 1), 2000),
  })
}
