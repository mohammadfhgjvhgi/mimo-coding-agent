// Personal Productivity OS — tasks, projects, goals, habits, reminders, notes, reviews.
// 11 operations, deterministic, bilingual (Arabic + English), persisted to SQLite.
//
// Design:
//   • 8 Prisma models: PTask, Project, Goal, Habit, HabitLog, Reminder, Note, Review, DayPlan
//   • Streak tracking for habits (current + longest)
//   • OKR-style goals with key results
//   • Daily/weekly reviews with structured sections
//   • Day plan with time blocks
//
// 11 operations:
//   1.  dailyDashboard       — today's overview (tasks due, habits, reminders, day plan)
//   2.  taskManager          — CRUD tasks with priority/status/subtasks
//   3.  projectManager       — CRUD projects + milestones + progress
//   4.  goalsManager         — CRUD goals + key results + progress tracking
//   5.  habitsManager        — CRUD habits + log completion + streak tracking
//   6.  calendarIntegration   — list events/tasks/reminders in date range
//   7.  remindersManager      — CRUD reminders + check due + snooze
//   8.  notesManager         — CRUD notes (markdown/checklist/voice) + pin
//   9.  dailyReview          — create/get daily review with sections
//   10. weeklyReview         — create/get weekly review with stats
//   11. planningAssistant    — suggest day plan from tasks + habits + goals

import { db } from "@/lib/db"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = "todo" | "in_progress" | "done" | "cancelled" | "blocked"
export type TaskPriority = "low" | "medium" | "high" | "urgent"
export type ProjectStatus = "planning" | "active" | "on_hold" | "completed" | "cancelled"
export type GoalType = "short_term" | "medium_term" | "long_term"
export type GoalStatus = "not_started" | "in_progress" | "achieved" | "abandoned"
export type HabitFrequency = "daily" | "weekly" | "custom"
export type HabitLogStatus = "completed" | "skipped" | "missed"
export type ReminderType = "one_time" | "daily" | "weekly" | "monthly"
export type ReminderStatus = "pending" | "sent" | "snoozed" | "dismissed"
export type NoteType = "text" | "markdown" | "checklist" | "voice"
export type ReviewType = "daily" | "weekly" | "monthly"

export interface TaskRecord {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  projectId: string | null
  goalId: string | null
  dueDate: Date | null
  estimatedMin: number | null
  actualMin: number
  tags: string[]
  subtasks: Array<{ title: string; done: boolean }>
  order: number
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface ProjectRecord {
  id: string
  name: string
  description: string | null
  status: ProjectStatus
  color: string
  milestones: Array<{ title: string; dueDate?: string; done: boolean }>
  startDate: Date | null
  endDate: Date | null
  totalTasks: number
  completedTasks: number
  createdAt: Date
  updatedAt: Date
}

export interface GoalRecord {
  id: string
  title: string
  description: string | null
  type: GoalType
  status: GoalStatus
  progress: number
  targetDate: Date | null
  startDate: Date | null
  keyResults: Array<{ description: string; target: number; current: number; done: boolean }>
  parentId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface HabitRecord {
  id: string
  name: string
  description: string | null
  frequency: HabitFrequency
  frequencyDays: number[]
  streak: { current: number; longest: number; lastCompleted: string | null; history: string[] }
  targetTime: string | null
  color: string
  active: boolean
  createdAt: Date
  updatedAt: Date
}

export interface ReminderRecord {
  id: string
  title: string
  description: string | null
  type: ReminderType
  remindAt: Date
  endsAt: Date | null
  taskId: string | null
  status: ReminderStatus
  createdAt: Date
  updatedAt: Date
}

export interface NoteRecord {
  id: string
  title: string
  content: string
  type: NoteType
  tags: string[]
  projectId: string | null
  taskId: string | null
  pinned: boolean
  createdAt: Date
  updatedAt: Date
}

export interface ReviewRecord {
  id: string
  type: ReviewType
  date: Date
  sections: {
    accomplishments: string[]
    challenges: string[]
    learnings: string[]
    nextActions: string[]
    mood?: string
  }
  rating: number | null
  summary: string | null
  createdAt: Date
}

export interface DayPlanRecord {
  id: string
  date: Date
  blocks: Array<{ startTime: string; endTime: string; taskId?: string; title: string; type: "task" | "event" | "break" | "focus" }>
  totalMinutes: number
  focusMinutes: number
  dailyGoals: string[]
  createdAt: Date
  updatedAt: Date
}

export interface DashboardData {
  date: Date
  tasksDueToday: TaskRecord[]
  tasksOverdue: TaskRecord[]
  tasksInProgress: TaskRecord[]
  habitsDueToday: Array<{ habit: HabitRecord; completedToday: boolean }>
  remindersDue: ReminderRecord[]
  dayPlan: DayPlanRecord | null
  activeGoals: GoalRecord[]
  activeProjects: ProjectRecord[]
}

export type ProductivityResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; message: string }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function endOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

// ---------------------------------------------------------------------------
// Row → record mappers
// ---------------------------------------------------------------------------

function taskRowToRecord(row: {
  id: string; title: string; description: string | null; status: string; priority: string;
  projectId: string | null; goalId: string | null; dueDate: Date | null;
  estimatedMin: number | null; actualMin: number; tags: string; subtasks: string;
  order: number; completedAt: Date | null; createdAt: Date; updatedAt: Date
}): TaskRecord {
  return {
    id: row.id, title: row.title, description: row.description,
    status: row.status as TaskStatus, priority: row.priority as TaskPriority,
    projectId: row.projectId, goalId: row.goalId, dueDate: row.dueDate,
    estimatedMin: row.estimatedMin, actualMin: row.actualMin,
    tags: safeParse(row.tags, []),
    subtasks: safeParse(row.subtasks, []),
    order: row.order, completedAt: row.completedAt,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}

function projectRowToRecord(row: {
  id: string; name: string; description: string | null; status: string; color: string;
  milestones: string; startDate: Date | null; endDate: Date | null;
  totalTasks: number; completedTasks: number; createdAt: Date; updatedAt: Date
}): ProjectRecord {
  return {
    id: row.id, name: row.name, description: row.description,
    status: row.status as ProjectStatus, color: row.color,
    milestones: safeParse(row.milestones, []),
    startDate: row.startDate, endDate: row.endDate,
    totalTasks: row.totalTasks, completedTasks: row.completedTasks,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}

function goalRowToRecord(row: {
  id: string; title: string; description: string | null; type: string; status: string;
  progress: number; targetDate: Date | null; startDate: Date | null; keyResults: string;
  parentId: string | null; createdAt: Date; updatedAt: Date
}): GoalRecord {
  return {
    id: row.id, title: row.title, description: row.description,
    type: row.type as GoalType, status: row.status as GoalStatus,
    progress: row.progress, targetDate: row.targetDate, startDate: row.startDate,
    keyResults: safeParse(row.keyResults, []),
    parentId: row.parentId, createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}

function habitRowToRecord(row: {
  id: string; name: string; description: string | null; frequency: string;
  frequencyDays: string; streak: string; targetTime: string | null; color: string;
  active: boolean; createdAt: Date; updatedAt: Date
}): HabitRecord {
  return {
    id: row.id, name: row.name, description: row.description,
    frequency: row.frequency as HabitFrequency,
    frequencyDays: safeParse(row.frequencyDays, []),
    streak: safeParse(row.streak, { current: 0, longest: 0, lastCompleted: null, history: [] }),
    targetTime: row.targetTime, color: row.color, active: row.active,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}

function reminderRowToRecord(row: {
  id: string; title: string; description: string | null; type: string; remindAt: Date;
  endsAt: Date | null; taskId: string | null; status: string; createdAt: Date; updatedAt: Date
}): ReminderRecord {
  return {
    id: row.id, title: row.title, description: row.description,
    type: row.type as ReminderType, remindAt: row.remindAt, endsAt: row.endsAt,
    taskId: row.taskId, status: row.status as ReminderStatus,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}

function noteRowToRecord(row: {
  id: string; title: string; content: string; type: string; tags: string;
  projectId: string | null; taskId: string | null; pinned: boolean;
  createdAt: Date; updatedAt: Date
}): NoteRecord {
  return {
    id: row.id, title: row.title, content: row.content,
    type: row.type as NoteType, tags: safeParse(row.tags, []),
    projectId: row.projectId, taskId: row.taskId, pinned: row.pinned,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}

function reviewRowToRecord(row: {
  id: string; type: string; date: Date; sections: string; rating: number | null;
  summary: string | null; createdAt: Date
}): ReviewRecord {
  return {
    id: row.id, type: row.type as ReviewType, date: row.date,
    sections: safeParse(row.sections, { accomplishments: [], challenges: [], learnings: [], nextActions: [] }),
    rating: row.rating, summary: row.summary, createdAt: row.createdAt,
  }
}

function dayPlanRowToRecord(row: {
  id: string; date: Date; blocks: string; totalMinutes: number; focusMinutes: number;
  dailyGoals: string; createdAt: Date; updatedAt: Date
}): DayPlanRecord {
  return {
    id: row.id, date: row.date,
    blocks: safeParse(row.blocks, []),
    totalMinutes: row.totalMinutes, focusMinutes: row.focusMinutes,
    dailyGoals: safeParse(row.dailyGoals, []),
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}

// ---------------------------------------------------------------------------
// 1. Daily Dashboard — today's overview
// ---------------------------------------------------------------------------

export async function dailyDashboard(date: Date = new Date()): Promise<ProductivityResult<DashboardData>> {
  try {
    const dayStart = startOfDay(date)
    const dayEnd = endOfDay(date)
    // Tasks due today
    const tasksDueToday = (await db.pTask.findMany({
      where: { dueDate: { gte: dayStart, lte: dayEnd }, status: { not: "done" } },
      orderBy: { priority: "desc" },
    })).map(taskRowToRecord)
    // Overdue tasks
    const tasksOverdue = (await db.pTask.findMany({
      where: { dueDate: { lt: dayStart }, status: { notIn: ["done", "cancelled"] } },
      orderBy: { dueDate: "asc" },
    })).map(taskRowToRecord)
    // In progress
    const tasksInProgress = (await db.pTask.findMany({
      where: { status: "in_progress" },
      orderBy: { updatedAt: "desc" },
    })).map(taskRowToRecord)
    // Habits due today
    const habits = (await db.habit.findMany({ where: { active: true } })).map(habitRowToRecord)
    const habitsDueToday: Array<{ habit: HabitRecord; completedToday: boolean }> = []
    for (const h of habits) {
      const log = await db.habitLog.findUnique({
        where: { habitId_date: { habitId: h.id, date: dayStart } },
      })
      habitsDueToday.push({ habit: h, completedToday: !!log })
    }
    // Reminders due
    const remindersDue = (await db.reminder.findMany({
      where: { remindAt: { lte: dayEnd }, status: "pending" },
      orderBy: { remindAt: "asc" },
    })).map(reminderRowToRecord)
    // Day plan
    const dayPlanRow = await db.dayPlan.findUnique({ where: { date: dayStart } })
    const dayPlan = dayPlanRow ? dayPlanRowToRecord(dayPlanRow) : null
    // Active goals
    const activeGoals = (await db.goal.findMany({
      where: { status: "in_progress" },
      orderBy: { targetDate: "asc" },
    })).map(goalRowToRecord)
    // Active projects
    const activeProjects = (await db.project.findMany({
      where: { status: "active" },
      orderBy: { updatedAt: "desc" },
    })).map(projectRowToRecord)
    return {
      ok: true,
      data: {
        date: dayStart,
        tasksDueToday,
        tasksOverdue,
        tasksInProgress,
        habitsDueToday,
        remindersDue,
        dayPlan,
        activeGoals,
        activeProjects,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "dashboard_failed",
      message: `❌ فشل لوحة المعلومات / dashboard failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Task Manager — CRUD tasks
// ---------------------------------------------------------------------------

export interface TaskInput {
  title: string
  description?: string
  priority?: TaskPriority
  projectId?: string
  goalId?: string
  dueDate?: Date
  estimatedMin?: number
  tags?: string[]
  subtasks?: Array<{ title: string; done: boolean }>
}

export async function taskCreate(input: TaskInput): Promise<ProductivityResult<TaskRecord>> {
  try {
    if (!input.title) {
      return { ok: false, error: "no_title", message: "❌ العنوان مطلوب / title required" }
    }
    const row = await db.pTask.create({
      data: {
        title: input.title,
        description: input.description,
        priority: input.priority ?? "medium",
        projectId: input.projectId,
        goalId: input.goalId,
        dueDate: input.dueDate,
        estimatedMin: input.estimatedMin,
        tags: JSON.stringify(input.tags ?? []),
        subtasks: JSON.stringify(input.subtasks ?? []),
      },
    })
    // Update project task count
    if (input.projectId) {
      await db.project.update({
        where: { id: input.projectId },
        data: { totalTasks: { increment: 1 } },
      })
    }
    return { ok: true, data: taskRowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "task_create_failed",
      message: `❌ فشل إنشاء المهمة / task create failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function taskUpdate(id: string, patch: Partial<TaskInput> & { status?: TaskStatus; actualMin?: number; order?: number }): Promise<ProductivityResult<TaskRecord>> {
  try {
    const existing = await db.pTask.findUnique({ where: { id } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ المهمة غير موجودة / task not found: ${id}` }
    }
    const data: Record<string, unknown> = {}
    if (patch.title !== undefined) data.title = patch.title
    if (patch.description !== undefined) data.description = patch.description
    if (patch.priority !== undefined) data.priority = patch.priority
    if (patch.projectId !== undefined) data.projectId = patch.projectId
    if (patch.goalId !== undefined) data.goalId = patch.goalId
    if (patch.dueDate !== undefined) data.dueDate = patch.dueDate
    if (patch.estimatedMin !== undefined) data.estimatedMin = patch.estimatedMin
    if (patch.actualMin !== undefined) data.actualMin = patch.actualMin
    if (patch.tags !== undefined) data.tags = JSON.stringify(patch.tags)
    if (patch.subtasks !== undefined) data.subtasks = JSON.stringify(patch.subtasks)
    if (patch.order !== undefined) data.order = patch.order
    if (patch.status !== undefined) {
      data.status = patch.status
      if (patch.status === "done") {
        data.completedAt = new Date()
        // Update project completed count
        if (existing.projectId) {
          await db.project.update({
            where: { id: existing.projectId },
            data: { completedTasks: { increment: 1 } },
          })
        }
      } else if (existing.status === "done") {
        // Un-completing (was done, now moving to another status)
        data.completedAt = null
        if (existing.projectId) {
          await db.project.update({
            where: { id: existing.projectId },
            data: { completedTasks: { decrement: 1 } },
          })
        }
      }
    }
    const row = await db.pTask.update({ where: { id }, data })
    return { ok: true, data: taskRowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "task_update_failed",
      message: `❌ فشل تحديث المهمة / task update failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function taskList(opts: { status?: TaskStatus; priority?: TaskPriority; projectId?: string; goalId?: string; dueBefore?: Date; limit?: number } = {}): Promise<ProductivityResult<TaskRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.status) where.status = opts.status
    if (opts.priority) where.priority = opts.priority
    if (opts.projectId) where.projectId = opts.projectId
    if (opts.goalId) where.goalId = opts.goalId
    if (opts.dueBefore) where.dueDate = { lt: opts.dueBefore }
    const rows = await db.pTask.findMany({ where, orderBy: [{ order: "asc" }, { createdAt: "desc" }], take: opts.limit ?? 100 })
    return { ok: true, data: rows.map(taskRowToRecord) }
  } catch (e) {
    return { ok: false, error: "list_failed", message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function taskDelete(id: string): Promise<ProductivityResult<{ deleted: boolean }>> {
  try {
    const existing = await db.pTask.findUnique({ where: { id } })
    if (!existing) return { ok: false, error: "not_found", message: `❌ المهمة غير موجودة / task not found: ${id}` }
    if (existing.projectId) {
      await db.project.update({
        where: { id: existing.projectId },
        data: { totalTasks: { decrement: 1 }, ...(existing.status === "done" ? { completedTasks: { decrement: 1 } } : {}) },
      })
    }
    await db.pTask.delete({ where: { id } })
    return { ok: true, data: { deleted: true } }
  } catch (e) {
    return { ok: false, error: "delete_failed", message: `❌ فشل الحذف / delete failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 3. Project Manager — CRUD projects + milestones
// ---------------------------------------------------------------------------

export interface ProjectInput {
  name: string
  description?: string
  status?: ProjectStatus
  color?: string
  milestones?: Array<{ title: string; dueDate?: string; done: boolean }>
  startDate?: Date
  endDate?: Date
}

export async function projectCreate(input: ProjectInput): Promise<ProductivityResult<ProjectRecord>> {
  try {
    if (!input.name) return { ok: false, error: "no_name", message: "❌ الاسم مطلوب / name required" }
    const row = await db.project.create({
      data: {
        name: input.name,
        description: input.description,
        status: input.status ?? "planning",
        color: input.color ?? "#3b82f6",
        milestones: JSON.stringify(input.milestones ?? []),
        startDate: input.startDate,
        endDate: input.endDate,
      },
    })
    return { ok: true, data: projectRowToRecord(row) }
  } catch (e) {
    return { ok: false, error: "project_create_failed", message: `❌ فشل إنشاء المشروع / project create failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function projectList(opts: { status?: ProjectStatus; limit?: number } = {}): Promise<ProductivityResult<ProjectRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.status) where.status = opts.status
    const rows = await db.project.findMany({ where, orderBy: { createdAt: "desc" }, take: opts.limit ?? 50 })
    return { ok: true, data: rows.map(projectRowToRecord) }
  } catch (e) {
    return { ok: false, error: "list_failed", message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function projectGet(id: string): Promise<ProductivityResult<ProjectRecord>> {
  try {
    const row = await db.project.findUnique({ where: { id } })
    if (!row) return { ok: false, error: "not_found", message: `❌ المشروع غير موجود / project not found: ${id}` }
    return { ok: true, data: projectRowToRecord(row) }
  } catch (e) {
    return { ok: false, error: "get_failed", message: `❌ فشل الجلب / get failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 4. Goals Manager — CRUD goals + key results
// ---------------------------------------------------------------------------

export interface GoalInput {
  title: string
  description?: string
  type?: GoalType
  status?: GoalStatus
  targetDate?: Date
  startDate?: Date
  keyResults?: Array<{ description: string; target: number; current: number; done: boolean }>
  parentId?: string
}

export async function goalCreate(input: GoalInput): Promise<ProductivityResult<GoalRecord>> {
  try {
    if (!input.title) return { ok: false, error: "no_title", message: "❌ العنوان مطلوب / title required" }
    const row = await db.goal.create({
      data: {
        title: input.title,
        description: input.description,
        type: input.type ?? "medium_term",
        status: input.status ?? "not_started",
        targetDate: input.targetDate,
        startDate: input.startDate,
        keyResults: JSON.stringify(input.keyResults ?? []),
        parentId: input.parentId,
      },
    })
    return { ok: true, data: goalRowToRecord(row) }
  } catch (e) {
    return { ok: false, error: "goal_create_failed", message: `❌ فشل إنشاء الهدف / goal create failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function goalUpdateProgress(id: string, keyResultIndex: number, newCurrent: number): Promise<ProductivityResult<GoalRecord>> {
  try {
    const existing = await db.goal.findUnique({ where: { id } })
    if (!existing) return { ok: false, error: "not_found", message: `❌ الهدف غير موجود / goal not found: ${id}` }
    const krs = safeParse<GoalRecord["keyResults"]>(existing.keyResults, [])
    if (keyResultIndex < 0 || keyResultIndex >= krs.length) {
      return { ok: false, error: "bad_index", message: `❌ فهرس غير صالح / invalid key result index: ${keyResultIndex}` }
    }
    krs[keyResultIndex].current = newCurrent
    if (newCurrent >= krs[keyResultIndex].target) {
      krs[keyResultIndex].done = true
    } else {
      krs[keyResultIndex].done = false
    }
    // Update overall progress
    const doneCount = krs.filter((k) => k.done).length
    const progress = krs.length > 0 ? (doneCount / krs.length) * 100 : 0
    const status = progress === 100 ? "achieved" : progress > 0 ? "in_progress" : existing.status
    const row = await db.goal.update({
      where: { id },
      data: {
        keyResults: JSON.stringify(krs),
        progress,
        status,
      },
    })
    return { ok: true, data: goalRowToRecord(row) }
  } catch (e) {
    return { ok: false, error: "update_failed", message: `❌ فشل التحديث / update failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function goalList(opts: { status?: GoalStatus; type?: GoalType; parentId?: string; limit?: number } = {}): Promise<ProductivityResult<GoalRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.status) where.status = opts.status
    if (opts.type) where.type = opts.type
    if (opts.parentId) where.parentId = opts.parentId
    const rows = await db.goal.findMany({ where, orderBy: { createdAt: "desc" }, take: opts.limit ?? 50 })
    return { ok: true, data: rows.map(goalRowToRecord) }
  } catch (e) {
    return { ok: false, error: "list_failed", message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 5. Habits Manager — CRUD + log completion + streak tracking
// ---------------------------------------------------------------------------

export interface HabitInput {
  name: string
  description?: string
  frequency?: HabitFrequency
  frequencyDays?: number[]
  targetTime?: string
  color?: string
}

export async function habitCreate(input: HabitInput): Promise<ProductivityResult<HabitRecord>> {
  try {
    if (!input.name) return { ok: false, error: "no_name", message: "❌ الاسم مطلوب / name required" }
    const row = await db.habit.create({
      data: {
        name: input.name,
        description: input.description,
        frequency: input.frequency ?? "daily",
        frequencyDays: JSON.stringify(input.frequencyDays ?? []),
        targetTime: input.targetTime,
        color: input.color ?? "#10b981",
        streak: JSON.stringify({ current: 0, longest: 0, lastCompleted: null, history: [] }),
      },
    })
    return { ok: true, data: habitRowToRecord(row) }
  } catch (e) {
    return { ok: false, error: "habit_create_failed", message: `❌ فشل إنشاء العادة / habit create failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function habitLog(habitId: string, opts: { date?: Date; status?: HabitLogStatus; note?: string }): Promise<ProductivityResult<{ streak: { current: number; longest: number; lastCompleted: string | null } }>> {
  try {
    const existing = await db.habit.findUnique({ where: { id: habitId } })
    if (!existing) return { ok: false, error: "not_found", message: `❌ العادة غير موجودة / habit not found: ${habitId}` }
    const logDate = startOfDay(opts.date ?? new Date())
    const status = opts.status ?? "completed"
    // Upsert the log
    await db.habitLog.upsert({
      where: { habitId_date: { habitId, date: logDate } },
      update: { status, note: opts.note },
      create: { habitId, date: logDate, status, note: opts.note },
    })
    // Update streak
    const streak = safeParse<{ current: number; longest: number; lastCompleted: string | null; history: string[] }>(existing.streak, { current: 0, longest: 0, lastCompleted: null, history: [] })
    if (status === "completed") {
      const lastCompletedDate = streak.lastCompleted ? startOfDay(new Date(streak.lastCompleted)) : null
      const today = startOfDay(new Date())
      if (lastCompletedDate) {
        const diffDays = Math.round((today.getTime() - lastCompletedDate.getTime()) / (1000 * 60 * 60 * 24))
        if (diffDays === 1) {
          streak.current += 1
        } else if (diffDays > 1) {
          streak.current = 1
        }
        // diffDays === 0 → same day, no change
      } else {
        streak.current = 1
      }
      streak.longest = Math.max(streak.longest, streak.current)
      streak.lastCompleted = today.toISOString()
      streak.history.push(today.toISOString())
      if (streak.history.length > 365) streak.history = streak.history.slice(-365)
    }
    await db.habit.update({
      where: { id: habitId },
      data: { streak: JSON.stringify(streak) },
    })
    return { ok: true, data: { streak: { current: streak.current, longest: streak.longest, lastCompleted: streak.lastCompleted } } }
  } catch (e) {
    return { ok: false, error: "log_failed", message: `❌ فشل التسجيل / habit log failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function habitList(opts: { active?: boolean; frequency?: HabitFrequency; limit?: number } = {}): Promise<ProductivityResult<HabitRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.active !== undefined) where.active = opts.active
    if (opts.frequency) where.frequency = opts.frequency
    const rows = await db.habit.findMany({ where, orderBy: { createdAt: "desc" }, take: opts.limit ?? 100 })
    return { ok: true, data: rows.map(habitRowToRecord) }
  } catch (e) {
    return { ok: false, error: "list_failed", message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 6. Calendar Integration — list events/tasks/reminders in date range
// ---------------------------------------------------------------------------

export async function calendarIntegration(opts: { startDate: Date; endDate: Date }): Promise<ProductivityResult<{
  tasks: TaskRecord[]
  reminders: ReminderRecord[]
  habits: Array<{ habit: HabitRecord; logs: Array<{ date: Date; status: string }> }>
  dayPlans: DayPlanRecord[]
}>> {
  try {
    const tasks = (await db.pTask.findMany({
      where: { dueDate: { gte: opts.startDate, lte: opts.endDate } },
      orderBy: { dueDate: "asc" },
    })).map(taskRowToRecord)
    const reminders = (await db.reminder.findMany({
      where: { remindAt: { gte: opts.startDate, lte: opts.endDate } },
      orderBy: { remindAt: "asc" },
    })).map(reminderRowToRecord)
    const habits = (await db.habit.findMany({ where: { active: true } })).map(habitRowToRecord)
    const habitsWithLogs: Array<{ habit: HabitRecord; logs: Array<{ date: Date; status: string }> }> = []
    for (const h of habits) {
      const logs = await db.habitLog.findMany({
        where: { habitId: h.id, date: { gte: opts.startDate, lte: opts.endDate } },
        orderBy: { date: "asc" },
      })
      habitsWithLogs.push({ habit: h, logs: logs.map((l) => ({ date: l.date, status: l.status })) })
    }
    const dayPlans = (await db.dayPlan.findMany({
      where: { date: { gte: opts.startDate, lte: opts.endDate } },
      orderBy: { date: "asc" },
    })).map(dayPlanRowToRecord)
    return { ok: true, data: { tasks, reminders, habits: habitsWithLogs, dayPlans } }
  } catch (e) {
    return { ok: false, error: "calendar_failed", message: `❌ فشل التقويم / calendar failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 7. Reminders Manager — CRUD + check due + snooze
// ---------------------------------------------------------------------------

export interface ReminderInput {
  title: string
  description?: string
  type?: ReminderType
  remindAt: Date
  endsAt?: Date
  taskId?: string
}

export async function reminderCreate(input: ReminderInput): Promise<ProductivityResult<ReminderRecord>> {
  try {
    if (!input.title || !input.remindAt) {
      return { ok: false, error: "no_input", message: "❌ العنوان والوقت مطلوبان / title + remindAt required" }
    }
    const row = await db.reminder.create({
      data: {
        title: input.title,
        description: input.description,
        type: input.type ?? "one_time",
        remindAt: input.remindAt,
        endsAt: input.endsAt,
        taskId: input.taskId,
      },
    })
    return { ok: true, data: reminderRowToRecord(row) }
  } catch (e) {
    return { ok: false, error: "reminder_create_failed", message: `❌ فشل إنشاء التذكير / reminder create failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function remindersCheckDue(opts: { before?: Date } = {}): Promise<ProductivityResult<ReminderRecord[]>> {
  try {
    const before = opts.before ?? new Date()
    const rows = await db.reminder.findMany({
      where: { remindAt: { lte: before }, status: "pending" },
      orderBy: { remindAt: "asc" },
    })
    return { ok: true, data: rows.map(reminderRowToRecord) }
  } catch (e) {
    return { ok: false, error: "check_failed", message: `❌ فشل الفحص / check failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function reminderSnooze(id: string, snoozeUntil: Date): Promise<ProductivityResult<ReminderRecord>> {
  try {
    const row = await db.reminder.update({
      where: { id },
      data: { remindAt: snoozeUntil, status: "pending" },
    })
    return { ok: true, data: reminderRowToRecord(row) }
  } catch (e) {
    return { ok: false, error: "snooze_failed", message: `❌ فشل التأجيل / snooze failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function reminderDismiss(id: string): Promise<ProductivityResult<ReminderRecord>> {
  try {
    const row = await db.reminder.update({
      where: { id },
      data: { status: "dismissed" },
    })
    return { ok: true, data: reminderRowToRecord(row) }
  } catch (e) {
    return { ok: false, error: "dismiss_failed", message: `❌ فشل الرفض / dismiss failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 8. Notes Manager — CRUD + pin
// ---------------------------------------------------------------------------

export interface NoteInput {
  title: string
  content?: string
  type?: NoteType
  tags?: string[]
  projectId?: string
  taskId?: string
  pinned?: boolean
}

export async function noteCreate(input: NoteInput): Promise<ProductivityResult<NoteRecord>> {
  try {
    if (!input.title) return { ok: false, error: "no_title", message: "❌ العنوان مطلوب / title required" }
    const row = await db.note.create({
      data: {
        title: input.title,
        content: input.content ?? "",
        type: input.type ?? "markdown",
        tags: JSON.stringify(input.tags ?? []),
        projectId: input.projectId,
        taskId: input.taskId,
        pinned: input.pinned ?? false,
      },
    })
    return { ok: true, data: noteRowToRecord(row) }
  } catch (e) {
    return { ok: false, error: "note_create_failed", message: `❌ فشل إنشاء الملاحظة / note create failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function noteUpdate(id: string, patch: Partial<NoteInput>): Promise<ProductivityResult<NoteRecord>> {
  try {
    const data: Record<string, unknown> = {}
    if (patch.title !== undefined) data.title = patch.title
    if (patch.content !== undefined) data.content = patch.content
    if (patch.type !== undefined) data.type = patch.type
    if (patch.tags !== undefined) data.tags = JSON.stringify(patch.tags)
    if (patch.projectId !== undefined) data.projectId = patch.projectId
    if (patch.taskId !== undefined) data.taskId = patch.taskId
    if (patch.pinned !== undefined) data.pinned = patch.pinned
    const row = await db.note.update({ where: { id }, data })
    return { ok: true, data: noteRowToRecord(row) }
  } catch (e) {
    return { ok: false, error: "update_failed", message: `❌ فشل التحديث / update failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function noteList(opts: { type?: NoteType; projectId?: string; pinned?: boolean; limit?: number } = {}): Promise<ProductivityResult<NoteRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.type) where.type = opts.type
    if (opts.projectId) where.projectId = opts.projectId
    if (opts.pinned !== undefined) where.pinned = opts.pinned
    const rows = await db.note.findMany({ where, orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }], take: opts.limit ?? 100 })
    return { ok: true, data: rows.map(noteRowToRecord) }
  } catch (e) {
    return { ok: false, error: "list_failed", message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 9. Daily Review — create/get with structured sections
// ---------------------------------------------------------------------------

export interface ReviewInput {
  date: Date
  sections?: {
    accomplishments: string[]
    challenges: string[]
    learnings: string[]
    nextActions: string[]
    mood?: string
  }
  rating?: number
  summary?: string
}

export async function dailyReview(input: ReviewInput): Promise<ProductivityResult<ReviewRecord>> {
  try {
    const dayStart = startOfDay(input.date)
    // Check if a review already exists for this date
    const existing = await db.review.findFirst({ where: { type: "daily", date: dayStart } })
    const sections = input.sections ?? { accomplishments: [], challenges: [], learnings: [], nextActions: [] }
    if (existing) {
      const row = await db.review.update({
        where: { id: existing.id },
        data: {
          sections: JSON.stringify(sections),
          rating: input.rating,
          summary: input.summary,
        },
      })
      return { ok: true, data: reviewRowToRecord(row) }
    }
    const row = await db.review.create({
      data: {
        type: "daily",
        date: dayStart,
        sections: JSON.stringify(sections),
        rating: input.rating,
        summary: input.summary,
      },
    })
    return { ok: true, data: reviewRowToRecord(row) }
  } catch (e) {
    return { ok: false, error: "review_failed", message: `❌ فشل المراجعة / review failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function reviewGet(opts: { type: ReviewType; date?: Date; limit?: number }): Promise<ProductivityResult<ReviewRecord[]>> {
  try {
    const where: Record<string, unknown> = { type: opts.type }
    if (opts.date) where.date = startOfDay(opts.date)
    const rows = await db.review.findMany({ where, orderBy: { date: "desc" }, take: opts.limit ?? 30 })
    return { ok: true, data: rows.map(reviewRowToRecord) }
  } catch (e) {
    return { ok: false, error: "get_failed", message: `❌ فشل الجلب / get failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 10. Weekly Review — with stats from the past week
// ---------------------------------------------------------------------------

export interface WeeklyReviewResult {
  review: ReviewRecord
  stats: {
    tasksCompleted: number
    tasksCreated: number
    habitsCompleted: number
    habitsMissed: number
    avgMood: number | null
    totalFocusMinutes: number
    topAccomplishments: string[]
  }
}

export async function weeklyReview(input: ReviewInput): Promise<ProductivityResult<WeeklyReviewResult>> {
  try {
    const dayStart = startOfDay(input.date)
    const weekStart = new Date(dayStart)
    weekStart.setDate(weekStart.getDate() - 7)
    // Get review record
    const reviewRes = await dailyReview({ ...input, ...{ date: input.date } })
    if (!reviewRes.ok) return reviewRes as unknown as ProductivityResult<WeeklyReviewResult>
    // Compute weekly stats
    const tasksCompleted = await db.pTask.count({
      where: { status: "done", completedAt: { gte: weekStart, lte: dayStart } },
    })
    const tasksCreated = await db.pTask.count({
      where: { createdAt: { gte: weekStart, lte: dayStart } },
    })
    const habitLogs = await db.habitLog.findMany({
      where: { date: { gte: weekStart, lte: dayStart } },
    })
    const habitsCompleted = habitLogs.filter((l) => l.status === "completed").length
    const habitsMissed = habitLogs.filter((l) => l.status === "missed").length
    const dayPlans = await db.dayPlan.findMany({
      where: { date: { gte: weekStart, lte: dayStart } },
    })
    const totalFocusMinutes = dayPlans.reduce((s, d) => s + d.focusMinutes, 0)
    // Reviews for mood
    const reviews = await db.review.findMany({
      where: { type: "daily", date: { gte: weekStart, lte: dayStart } },
    })
    const moods = reviews.map((r) => r.rating).filter((r): r is number => r !== null)
    const avgMood = moods.length > 0 ? moods.reduce((s, m) => s + m, 0) / moods.length : null
    return {
      ok: true,
      data: {
        review: reviewRes.data,
        stats: {
          tasksCompleted,
          tasksCreated,
          habitsCompleted,
          habitsMissed,
          avgMood,
          totalFocusMinutes,
          topAccomplishments: reviewRes.data.sections.accomplishments.slice(0, 5),
        },
      },
    }
  } catch (e) {
    return { ok: false, error: "weekly_failed", message: `❌ فشل المراجعة الأسبوعية / weekly review failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 11. Planning Assistant — suggest day plan from tasks + habits + goals
// ---------------------------------------------------------------------------

export async function planningAssistant(opts: { date?: Date }): Promise<ProductivityResult<DayPlanRecord>> {
  try {
    const date = startOfDay(opts.date ?? new Date())
    // Gather: tasks due today + overdue + in progress
    const tasks = (await db.pTask.findMany({
      where: {
        OR: [
          { dueDate: { gte: date, lte: endOfDay(date) } },
          { dueDate: { lt: date }, status: { notIn: ["done", "cancelled"] } },
          { status: "in_progress" },
        ],
      },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
      take: 10,
    })).map(taskRowToRecord)
    // Habits due today
    const habits = (await db.habit.findMany({ where: { active: true } })).map(habitRowToRecord)
    // Active goals (top 3)
    const goals = (await db.goal.findMany({
      where: { status: "in_progress" },
      orderBy: { targetDate: "asc" },
      take: 3,
    })).map(goalRowToRecord)
    // Build blocks
    const blocks: DayPlanRecord["blocks"] = []
    let currentHour = 9 // Start at 9 AM
    // Morning: top 3 priority tasks (focus blocks)
    const topTasks = tasks.slice(0, 3)
    for (const t of topTasks) {
      const duration = t.estimatedMin ?? 45
      const startH = currentHour
      const endH = currentHour + Math.floor(duration / 60)
      const endM = (duration % 60)
      blocks.push({
        startTime: `${String(startH).padStart(2, "0")}:00`,
        endTime: `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`,
        taskId: t.id,
        title: t.title,
        type: "focus",
      })
      currentHour = endH + (endM > 0 ? 1 : 0)
    }
    // Break
    blocks.push({
      startTime: `${String(currentHour).padStart(2, "0")}:00`,
      endTime: `${String(currentHour).padStart(2, "0")}:15`,
      title: "استراحة / Break",
      type: "break",
    })
    currentHour += 1
    // Habits (15 min each)
    for (const h of habits.slice(0, 3)) {
      blocks.push({
        startTime: `${String(currentHour).padStart(2, "0")}:00`,
        endTime: `${String(currentHour).padStart(2, "0")}:15`,
        title: `عادة: ${h.name} / Habit: ${h.name}`,
        type: "task",
      })
      currentHour += 1
    }
    // Afternoon: remaining tasks
    for (const t of tasks.slice(3)) {
      const duration = t.estimatedMin ?? 30
      blocks.push({
        startTime: `${String(currentHour).padStart(2, "0")}:00`,
        endTime: `${String(currentHour + Math.ceil(duration / 60)).padStart(2, "0")}:00`,
        taskId: t.id,
        title: t.title,
        type: "task",
      })
      currentHour += Math.ceil(duration / 60)
    }
    // Goals review (end of day)
    if (goals.length > 0) {
      blocks.push({
        startTime: `${String(currentHour).padStart(2, "0")}:00`,
        endTime: `${String(currentHour).padStart(2, "0")}:30`,
        title: `مراجعة الأهداف / Goals review`,
        type: "event",
      })
    }
    const totalMinutes = blocks.reduce((s, b) => {
      const [sh] = b.startTime.split(":").map(Number)
      const [eh] = b.endTime.split(":").map(Number)
      return s + (eh - sh) * 60
    }, 0)
    const focusMinutes = blocks.filter((b) => b.type === "focus").reduce((s, b) => {
      const [sh] = b.startTime.split(":").map(Number)
      const [eh] = b.endTime.split(":").map(Number)
      return s + (eh - sh) * 60
    }, 0)
    // Upsert day plan
    const dailyGoals = goals.map((g) => g.title)
    const row = await db.dayPlan.upsert({
      where: { date },
      update: {
        blocks: JSON.stringify(blocks),
        totalMinutes,
        focusMinutes,
        dailyGoals: JSON.stringify(dailyGoals),
      },
      create: {
        date,
        blocks: JSON.stringify(blocks),
        totalMinutes,
        focusMinutes,
        dailyGoals: JSON.stringify(dailyGoals),
      },
    })
    return { ok: true, data: dayPlanRowToRecord(row) }
  } catch (e) {
    return { ok: false, error: "planning_failed", message: `❌ فشل التخطيط / planning failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface ProductivitySnapshot {
  totalTasks: number
  completedTasks: number
  pendingTasks: number
  overdueTasks: number
  totalProjects: number
  activeProjects: number
  totalGoals: number
  inProgressGoals: number
  totalHabits: number
  activeHabits: number
  totalReminders: number
  pendingReminders: number
  totalNotes: number
  pinnedNotes: number
  totalReviews: number
  totalDayPlans: number
  longestStreak: number
}

export async function productivitySnapshot(): Promise<ProductivityResult<ProductivitySnapshot>> {
  try {
    const tasks = await db.pTask.findMany()
    const projects = await db.project.findMany()
    const goals = await db.goal.findMany()
    const habits = await db.habit.findMany()
    const reminders = await db.reminder.findMany()
    const notes = await db.note.findMany()
    const reviews = await db.review.findMany()
    const dayPlans = await db.dayPlan.findMany()
    const longestStreak = Math.max(0, ...habits.map((h) => safeParse<{ longest: number }>(h.streak, { longest: 0 }).longest))
    return {
      ok: true,
      data: {
        totalTasks: tasks.length,
        completedTasks: tasks.filter((t) => t.status === "done").length,
        pendingTasks: tasks.filter((t) => t.status === "todo").length,
        overdueTasks: tasks.filter((t) => t.dueDate && t.dueDate < new Date() && t.status !== "done").length,
        totalProjects: projects.length,
        activeProjects: projects.filter((p) => p.status === "active").length,
        totalGoals: goals.length,
        inProgressGoals: goals.filter((g) => g.status === "in_progress").length,
        totalHabits: habits.length,
        activeHabits: habits.filter((h) => h.active).length,
        totalReminders: reminders.length,
        pendingReminders: reminders.filter((r) => r.status === "pending").length,
        totalNotes: notes.length,
        pinnedNotes: notes.filter((n) => n.pinned).length,
        totalReviews: reviews.length,
        totalDayPlans: dayPlans.length,
        longestStreak,
      },
    }
  } catch (e) {
    return { ok: false, error: "snapshot_failed", message: `❌ فشل اللقطة / snapshot failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

export function formatProductivityResult<T>(result: ProductivityResult<T>): string {
  if (!result.ok) {
    return `${result.message}\n[error: ${result.error}]`
  }
  const data = result.data as unknown
  if (data === null || data === undefined) return "✅ OK"
  if (typeof data === "string") return data
  if (typeof data === "number" || typeof data === "boolean") return String(data)
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}
