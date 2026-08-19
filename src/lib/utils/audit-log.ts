// Audit Logging System — records sensitive operations for review.
// Adapted from mehani-lms.

import { db } from "@/lib/db"

export type AuditAction =
  | "tool.execute"
  | "file.write"
  | "file.delete"
  | "git.checkpoint"
  | "git.rollback"
  | "memory.save"
  | "memory.delete"
  | "goal.create"
  | "goal.complete"
  | "goal.fail"
  | "config.change"
  | "terminal.run"

export interface AuditEntry {
  id: string
  action: AuditAction
  detail: string
  userId?: string
  timestamp: Date
}

// In-memory audit log (persisted to DB in production)
const auditLog: AuditEntry[] = []
const MAX_LOG_SIZE = 500

export function logAudit(action: AuditAction, detail: string, userId?: string): void {
  const entry: AuditEntry = {
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    action,
    detail,
    userId,
    timestamp: new Date(),
  }
  auditLog.unshift(entry)
  if (auditLog.length > MAX_LOG_SIZE) auditLog.pop()
}

export function getAuditLog(limit: number = 50): AuditEntry[] {
  return auditLog.slice(0, limit)
}

export function getAuditStats(): Record<string, number> {
  const stats: Record<string, number> = {}
  for (const entry of auditLog) {
    stats[entry.action] = (stats[entry.action] || 0) + 1
  }
  return stats
}
