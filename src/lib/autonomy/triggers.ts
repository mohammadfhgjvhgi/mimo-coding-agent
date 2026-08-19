// MiMo AI — Autonomy Layer
// Controlled autonomy: triggers, schedules, should-act gating, kill-switch.
// ADR: autonomy is policy-controlled, never unrestricted.


// Kill switch (in-memory + env). Persisted to DB Setting for restart survival.
let _killSwitch = false

export function isKillSwitchActive(): boolean {
  return _killSwitch || process.env.MIMO_KILL_SWITCH === 'true' || process.env.MIMO_KILL_SWITCH === '1'
}

export async function setKillSwitch(active: boolean): Promise<void> {
  _killSwitch = active
  // Persist to DB so it survives restart
  try {
    await db.setting.upsert({
      where: { key: 'kill_switch' },
      create: { key: 'kill_switch', value: String(active) },
      update: { value: String(active) },
    })
  } catch {}
  logger.warn('Kill switch toggled', { active })
  emit('error', { killSwitch: active, message: active ? 'Autonomy killed — all autonomous actions blocked' : 'Kill switch released' })
}

export async function loadKillSwitchFromDB(): Promise<void> {
  try {
    const row = await db.setting.findUnique({ where: { key: 'kill_switch' } })
    if (row) _killSwitch = row.value === 'true'
  } catch {}
}

// ============ Trigger Management ============

export async function createTrigger(name: string, type: Trigger['triggerType'], config: Record<string, unknown>): Promise<Trigger> {
  // For scheduled triggers, set nextFire based on config
  const nextFire = type === 'schedule' && config.intervalMs
    ? new Date(Date.now() + (config.intervalMs as number))
    : type === 'schedule' && config.fireAt
    ? new Date(config.fireAt as string)
    : null

  const row = await db.trigger.create({
    data: {
      name,
      triggerType: type,
      config: JSON.stringify(config),
      status: 'armed',
      ...(nextFire ? { nextFire } : {}),
    },
  })
  return row as unknown as Trigger
}

export async function listTriggers(): Promise<Trigger[]> {
  const rows = await db.trigger.findMany({ orderBy: { createdAt: 'desc' } })
  return rows as unknown as Trigger[]
}

export async function disableTrigger(id: string): Promise<void> {
  await db.trigger.update({ where: { id }, data: { status: 'disabled' } })
}

// ============ Should-Act Gate ============

export async function shouldAct(trigger: Trigger): Promise<{ act: boolean; reason: string }> {
  if (isKillSwitchActive()) {
    return { act: false, reason: 'Kill switch is active' }
  }

  // Check policy permission for autonomous action
  const decision = await checkPermission({
    actor: 'autonomy',
    action: 'autonomous:execute',
    resource: 'task',
    authorityLevel: 'global',
  })

  if (!decision.allowed) {
    return { act: false, reason: decision.reason }
  }

  return { act: true, reason: 'Permitted' }
}

// ============ Fire Trigger ============

export async function fireTrigger(triggerId: string): Promise<Task | null> {
  const trigger = await db.trigger.findUnique({ where: { id: triggerId } })
  if (!trigger || trigger.status !== 'armed') return null

  const gate = await shouldAct(trigger as unknown as Trigger)
  if (!gate.act) {
    await db.trigger.update({ where: { id: triggerId }, data: { status: 'suppressed' } })
    emit('task:updated', { triggerId, suppressed: true, reason: gate.reason })
    return null
  }

  const config = JSON.parse(trigger.config)
  const goal = config.goal || config.task || `Triggered: ${trigger.name}`

  const task = await createTask(goal)
  await db.trigger.update({
    where: { id: triggerId },
    data: { lastFired: new Date(), status: 'armed' },
  })

  emit('task:created', { taskId: task.id, triggerId, goal }, task.id)

  // Run agent in background (non-blocking)
  runAgent(task, [{ role: 'user', content: goal }]).catch(err =>
    logger.error('Autonomous task failed', { taskId: task.id, error: String(err) })
  )

  return task
}

// ============ Scheduler ============

// Simple in-memory scheduler for v1 (no cron lib needed)
const _intervals = new Map<string, NodeJS.Timeout>()

export function startScheduler() {
  // Check triggers every 60 seconds
  const interval = setInterval(async () => {
    if (isKillSwitchActive()) return

    const triggers = await db.trigger.findMany({
      where: { status: 'armed', triggerType: 'schedule' },
    })

    for (const trigger of triggers) {
      const config = JSON.parse(trigger.config)
      // Simple: if nextFire is past, fire
      if (trigger.nextFire && new Date(trigger.nextFire) <= new Date()) {
        await fireTrigger(trigger.id)
        // Schedule next fire (simple: +interval)
        const intervalMs = config.intervalMs || 3600000 // default 1 hour
        await db.trigger.update({
          where: { id: trigger.id },
          data: { nextFire: new Date(Date.now() + intervalMs) },
        })
      }
    }
  }, 60000)

  _intervals.set('scheduler', interval)
  logger.info('Autonomy scheduler started')
}

export function stopScheduler() {
  for (const interval of _intervals.values()) clearInterval(interval)
  _intervals.clear()
  logger.info('Autonomy scheduler stopped')
}

// ============ Authority Levels ============

export type AuthorityScope = 'global' | 'session' | 'task' | 'tool' | 'agent'

export async function revokeAuthority(level: AuthorityScope, id?: string): Promise<void> {
  if (level === 'global') {
    setKillSwitch(true)
  }
  // For task/tool/agent level, cancel specific operations
  if (level === 'task' && id) {
    const { cancelAgent } = await import('@/lib/agents/loop')
    cancelAgent(id)
  }
  logger.info('Authority revoked', { level, id })
  emit('error', { authorityRevoked: level, id })
}
