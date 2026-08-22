// Personal Intelligence OS — 10 operations (spec section 36, features 475-484).
//
// Learns the user's context, preferences, goals, priorities, and routines.
// Builds a unified personal timeline from all activities.
//
// 10 operations:
//   1. personalProfile (475) — user context: name, language, timezone, work hours
//   2. preferenceEngine (476) — learn + retrieve user preferences
//   3. goalEngine (477) — active goals + progress
//   4. priorityEngine (478) — priority ranking of tasks/projects
//   5. routineDetection (479) — detect recurring patterns from activity
//   6. routineSuggestions (480) — suggest automations based on detected routines
//   7. decisionHistory (481) — chronological decisions log
//   8. projectRelationships (482) — how projects connect (shared tasks, knowledge)
//   9. knowledgeRelationships (483) — how knowledge items connect (tags, sources)
//   10. personalTimeline (484) — unified timeline from all sources

import { db } from "@/lib/db"

export interface PIResult<T> {
  ok: boolean
  data: T
  error?: string
  message?: string
}

// ---------------------------------------------------------------------------
// 1. Personal Profile (475)
// ---------------------------------------------------------------------------

export async function personalProfile(): Promise<PIResult<{
  name: string
  preferredLanguage: string
  timezone: string
  workHours: { start: string; end: string }
  activeProjects: number
  activeGoals: number
  totalConversations: number
  totalMemories: number
  totalTasks: number
  memberSince: string
  lastActive: string
}>> {
  try {
    // Get user info from memories (if saved)
    const nameMem = await db.memory.findUnique({ where: { key: "user_name" } })
    const langMem = await db.memory.findUnique({ where: { key: "user_language" } })
    const tzMem = await db.memory.findUnique({ where: { key: "user_timezone" } })
    const workStartMem = await db.memory.findUnique({ where: { key: "user_work_start" } })
    const workEndMem = await db.memory.findUnique({ where: { key: "user_work_end" } })

    const [projects, goals, conversations, memories, tasks] = await Promise.all([
      db.project.count({ where: { status: "active" } }),
      db.goal.count({ where: { status: "in_progress" } }),
      db.conversation.count(),
      db.memory.count(),
      db.pTask.count(),
    ])

    const firstConversation = await db.conversation.findFirst({ orderBy: { createdAt: "asc" } })
    const lastConversation = await db.conversation.findFirst({ orderBy: { updatedAt: "desc" } })

    return {
      ok: true,
      data: {
        name: nameMem?.value ?? "مستخدم MiMo X",
        preferredLanguage: langMem?.value ?? "العربية",
        timezone: tzMem?.value ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
        workHours: {
          start: workStartMem?.value ?? "09:00",
          end: workEndMem?.value ?? "17:00",
        },
        activeProjects: projects,
        activeGoals: goals,
        totalConversations: conversations,
        totalMemories: memories,
        totalTasks: tasks,
        memberSince: firstConversation?.createdAt.toISOString() ?? new Date().toISOString(),
        lastActive: lastConversation?.updatedAt.toISOString() ?? new Date().toISOString(),
      },
    }
  } catch (e) {
    return { ok: false, data: null as any, error: "profile_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 2. Preference Engine (476)
// ---------------------------------------------------------------------------

export async function preferenceEngine(action: "get" | "set" | "list", opts?: { key?: string; value?: string }): Promise<PIResult<any>> {
  try {
    if (action === "set" && opts?.key && opts?.value) {
      const existing = await db.memory.findUnique({ where: { key: `pref_${opts.key}` } })
      if (existing) {
        await db.memory.update({ where: { key: `pref_${opts.key}` }, data: { value: opts.value } })
      } else {
        await db.memory.create({ data: { key: `pref_${opts.key}`, value: opts.value, category: "preference", source: "user" } })
      }
      return { ok: true, data: { key: opts.key, value: opts.value, saved: true } }
    }

    if (action === "get" && opts?.key) {
      const mem = await db.memory.findUnique({ where: { key: `pref_${opts.key}` } })
      return { ok: true, data: { key: opts.key, value: mem?.value ?? null } }
    }

    // List all preferences
    const prefs = await db.memory.findMany({ where: { category: "preference" } })
    return {
      ok: true,
      data: prefs.map(p => ({
        key: p.key.replace("pref_", ""),
        value: p.value,
        updatedAt: p.updatedAt.toISOString(),
      })),
    }
  } catch (e) {
    return { ok: false, data: null as any, error: "preference_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 3. Goal Engine (477)
// ---------------------------------------------------------------------------

export async function goalEngine(): Promise<PIResult<{
  goals: Array<{
    id: string
    title: string
    status: string
    progress: number
    keyResults: number
    keyResultsDone: number
  }>
  total: number
  inProgress: number
  completed: number
}>> {
  try {
    const goals = await db.goal.findMany({ orderBy: { createdAt: "desc" } })

    return {
      ok: true,
      data: {
        goals: goals.map(g => {
          const krs = g.keyResults ? (typeof g.keyResults === "string" ? JSON.parse(g.keyResults) : g.keyResults) : []
          const krsDone = Array.isArray(krs) ? krs.filter((k: any) => k.done).length : 0
          return {
            id: g.id,
            title: g.title,
            status: g.status,
            progress: g.progress,
            keyResults: Array.isArray(krs) ? krs.length : 0,
            keyResultsDone: krsDone,
          }
        }),
        total: goals.length,
        inProgress: goals.filter(g => g.status === "in_progress").length,
        completed: goals.filter(g => g.status === "done" || g.status === "completed").length,
      },
    }
  } catch (e) {
    return { ok: false, data: null as any, error: "goal_engine_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 4. Priority Engine (478)
// ---------------------------------------------------------------------------

export async function priorityEngine(): Promise<PIResult<{
  ranked: Array<{ id: string; title: string; type: string; priority: string; score: number; reason: string }>
  total: number
}>> {
  try {
    const tasks = await db.pTask.findMany({
      where: { status: { in: ["todo", "in_progress"] } },
      take: 50,
    })

    const projects = await db.project.findMany({
      where: { status: "active" },
      take: 20,
    })

    const ranked: Array<{ id: string; title: string; type: string; priority: string; score: number; reason: string }> = []

    // Score tasks
    for (const t of tasks) {
      let score = 50
      const priority = t.priority ?? "medium"
      if (priority === "urgent") score += 40
      else if (priority === "high") score += 25
      else if (priority === "low") score -= 15

      // Boost if has due date approaching
      if (t.dueDate) {
        const daysUntil = (t.dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        if (daysUntil < 1) score += 30
        else if (daysUntil < 3) score += 15
        else if (daysUntil < 7) score += 5
      }

      // Boost if in_progress
      if (t.status === "in_progress") score += 10

      score = Math.max(0, Math.min(100, score))

      ranked.push({
        id: t.id,
        title: t.title,
        type: "task",
        priority,
        score,
        reason: `${priority} priority${t.dueDate ? `, due in ${Math.round((t.dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))}d` : ""}${t.status === "in_progress" ? ", in progress" : ""}`,
      })
    }

    // Score projects
    for (const p of projects) {
      let score = 40
      score += Math.min(p.completedTasks / Math.max(p.totalTasks, 1) * 20, 20) // progress boost
      ranked.push({
        id: p.id,
        title: p.name,
        type: "project",
        priority: "medium",
        score: Math.round(score),
        reason: `project, ${p.completedTasks}/${p.totalTasks} tasks done`,
      })
    }

    ranked.sort((a, b) => b.score - a.score)

    return { ok: true, data: { ranked: ranked.slice(0, 20), total: ranked.length } }
  } catch (e) {
    return { ok: false, data: null as any, error: "priority_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 5. Routine Detection (479)
// ---------------------------------------------------------------------------

export async function routineDetection(): Promise<PIResult<{
  routines: Array<{
    pattern: string
    frequency: string
    occurrences: number
    lastSeen: string
    confidence: number
  }>
  total: number
}>> {
  try {
    // Analyze conversation creation patterns
    const conversations = await db.conversation.findMany({
      select: { createdAt: true, updatedAt: true },
      take: 200,
    })

    // Group by hour of day
    const hourCounts: Record<number, number> = {}
    const dayCounts: Record<number, number> = {}
    for (const c of conversations) {
      const hour = c.createdAt.getHours()
      const day = c.createdAt.getDay()
      hourCounts[hour] = (hourCounts[hour] ?? 0) + 1
      dayCounts[day] = (dayCounts[day] ?? 0) + 1
    }

    const routines: Array<{ pattern: string; frequency: string; occurrences: number; lastSeen: string; confidence: number }> = []

    // Find peak hours
    const peakHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]
    if (peakHour && Number(peakHour[1]) > 3) {
      routines.push({
        pattern: `نشاط في الساعة ${peakHour[0]}:00`,
        frequency: "يومي",
        occurrences: Number(peakHour[1]),
        lastSeen: conversations[0]?.updatedAt.toISOString() ?? new Date().toISOString(),
        confidence: Math.min(100, Number(peakHour[1]) * 10),
      })
    }

    // Find peak days
    const dayNames = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]
    const peakDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0]
    if (peakDay && Number(peakDay[1]) > 3) {
      routines.push({
        pattern: `نشاط يوم ${dayNames[parseInt(peakDay[0])]}`,
        frequency: "أسبوعي",
        occurrences: Number(peakDay[1]),
        lastSeen: conversations[0]?.updatedAt.toISOString() ?? new Date().toISOString(),
        confidence: Math.min(100, Number(peakDay[1]) * 15),
      })
    }

    // Check task creation patterns
    const tasks = await db.pTask.findMany({ select: { createdAt: true }, take: 100 })
    const taskHourCounts: Record<number, number> = {}
    for (const t of tasks) {
      const h = t.createdAt.getHours()
      taskHourCounts[h] = (taskHourCounts[h] ?? 0) + 1
    }
    const peakTaskHour = Object.entries(taskHourCounts).sort((a, b) => b[1] - a[1])[0]
    if (peakTaskHour && Number(peakTaskHour[1]) > 2) {
      routines.push({
        pattern: `إنشاء مهام في الساعة ${peakTaskHour[0]}:00`,
        frequency: "يومي",
        occurrences: Number(peakTaskHour[1]),
        lastSeen: new Date().toISOString(),
        confidence: Math.min(100, Number(peakTaskHour[1]) * 20),
      })
    }

    return { ok: true, data: { routines, total: routines.length } }
  } catch (e) {
    return { ok: false, data: null as any, error: "routine_detection_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 6. Routine Suggestions (480)
// ---------------------------------------------------------------------------

export async function routineSuggestions(): Promise<PIResult<{
  suggestions: Array<{
    title: string
    description: string
    automation: string
    trigger: string
    confidence: number
  }>
  total: number
}>> {
  try {
    const routines = await routineDetection()
    const detected = routines.ok ? routines.data.routines : []

    const suggestions: Array<{ title: string; description: string; automation: string; trigger: string; confidence: number }> = []

    for (const r of detected) {
      if (r.pattern.includes("نشاط في الساعة")) {
        const hour = r.pattern.match(/\d+/)?.[0] ?? "9"
        suggestions.push({
          title: `جلسة عمل يومية الساعة ${hour}:00`,
          description: `عادةً ما تكون نشطاً في هذه الساعة — يمكنك جدولة مهمة تلقائية`,
          automation: "daily_work_session",
          trigger: `daily at ${hour}:00`,
          confidence: r.confidence,
        })
      }
      if (r.pattern.includes("إنشاء مهام")) {
        suggestions.push({
          title: "مراجعة المهام اليومية",
          description: "عادةً ما تنشئ مهاماً في هذا الوقت — اقتراح مراجعة المهام تلقائياً",
          automation: "daily_task_review",
          trigger: "daily at task creation hour",
          confidence: r.confidence,
        })
      }
    }

    // Add generic suggestions if no routines detected
    if (suggestions.length === 0) {
      suggestions.push({
        title: "مراجعة صباحية",
        description: "ابدأ يومك بمراجعة المهام والأهداف",
        automation: "morning_review",
        trigger: "daily at 09:00",
        confidence: 50,
      })
      suggestions.push({
        title: "ملخص مسائي",
        description: "احصل على ملخص ما أنجزته اليوم",
        automation: "evening_summary",
        trigger: "daily at 18:00",
        confidence: 40,
      })
    }

    return { ok: true, data: { suggestions, total: suggestions.length } }
  } catch (e) {
    return { ok: false, data: null as any, error: "suggestions_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 7. Decision History (481)
// ---------------------------------------------------------------------------

export async function decisionHistory(): Promise<PIResult<{
  decisions: Array<{
    id: string
    content: string
    source: string
    createdAt: string
  }>
  total: number
}>> {
  try {
    // Decisions are stored as memories with category "decision"
    const decisions = await db.memory.findMany({
      where: { category: "decision" },
      orderBy: { createdAt: "desc" },
      take: 50,
    })

    return {
      ok: true,
      data: {
        decisions: decisions.map(d => ({
          id: d.id,
          content: d.value,
          source: d.source ?? "unknown",
          createdAt: d.createdAt.toISOString(),
        })),
        total: decisions.length,
      },
    }
  } catch (e) {
    return { ok: false, data: null as any, error: "decision_history_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 8. Project Relationships (482)
// ---------------------------------------------------------------------------

export async function projectRelationships(): Promise<PIResult<{
  relationships: Array<{
    projectA: string
    projectB: string
    type: string
    strength: number
    sharedItems: number
  }>
  totalProjects: number
}>> {
  try {
    const projects = await db.project.findMany({ take: 20 })

    const relationships: Array<{ projectA: string; projectB: string; type: string; strength: number; sharedItems: number }> = []

    // Find projects with shared tasks
    for (let i = 0; i < projects.length; i++) {
      for (let j = i + 1; j < projects.length; j++) {
        const a = projects[i]
        const b = projects[j]

        // Check if they share tags
        const tagsA = a.milestones ? JSON.parse(a.milestones as string) : []
        const tagsB = b.milestones ? JSON.parse(b.milestones as string) : []
        const shared = Array.isArray(tagsA) && Array.isArray(tagsB)
          ? tagsA.filter((t: string) => tagsB.includes(t)).length
          : 0

        if (shared > 0) {
          relationships.push({
            projectA: a.name,
            projectB: b.name,
            type: "shared_milestones",
            strength: Math.min(100, shared * 20),
            sharedItems: shared,
          })
        }
      }
    }

    return {
      ok: true,
      data: {
        relationships,
        totalProjects: projects.length,
      },
    }
  } catch (e) {
    return { ok: false, data: null as any, error: "project_rels_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 9. Knowledge Relationships (483)
// ---------------------------------------------------------------------------

export async function knowledgeRelationships(): Promise<PIResult<{
  clusters: Array<{
    tag: string
    items: number
    titles: string[]
  }>
  totalItems: number
  totalTags: number
}>> {
  try {
    // Get knowledge from memories + shared knowledge
    const [memories, knowledge] = await Promise.all([
      db.memory.findMany({ select: { key: true, value: true, category: true, source: true } }),
      (db as any).collabSharedKnowledge?.findMany({ select: { title: true, tags: true } }).catch(() => []) ?? [],
    ])

    // Group by category/tag
    const tagMap: Record<string, string[]> = {}

    for (const m of memories) {
      const cat = m.category ?? "general"
      if (!tagMap[cat]) tagMap[cat] = []
      tagMap[cat].push(m.key)
    }

    for (const k of knowledge as any[]) {
      try {
        const tags = JSON.parse(k.tags ?? "[]") as string[]
        for (const tag of tags) {
          if (!tagMap[tag]) tagMap[tag] = []
          tagMap[tag].push(k.title)
        }
      } catch {}
    }

    const clusters = Object.entries(tagMap)
      .map(([tag, items]) => ({
        tag,
        items: items.length,
        titles: items.slice(0, 5),
      }))
      .sort((a, b) => b.items - a.items)
      .slice(0, 15)

    return {
      ok: true,
      data: {
        clusters,
        totalItems: memories.length + (knowledge as any[]).length,
        totalTags: Object.keys(tagMap).length,
      },
    }
  } catch (e) {
    return { ok: false, data: null as any, error: "knowledge_rels_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 10. Personal Timeline (484)
// ---------------------------------------------------------------------------

export async function personalTimeline(limit: number = 50): Promise<PIResult<{
  events: Array<{
    timestamp: string
    type: string
    title: string
    description: string
    source: string
  }>
  total: number
}>> {
  try {
    const events: Array<{ timestamp: string; type: string; title: string; description: string; source: string }> = []

    // Gather from multiple sources in parallel
    const [conversations, tasks, memories, projects, goals] = await Promise.all([
      db.conversation.findMany({ select: { id: true, title: true, createdAt: true, updatedAt: true }, take: 20, orderBy: { updatedAt: "desc" } }),
      db.pTask.findMany({ select: { id: true, title: true, status: true, createdAt: true, updatedAt: true }, take: 20, orderBy: { createdAt: "desc" } }),
      db.memory.findMany({ select: { id: true, key: true, value: true, category: true, createdAt: true }, take: 20, orderBy: { createdAt: "desc" } }),
      db.project.findMany({ select: { id: true, name: true, createdAt: true }, take: 10, orderBy: { createdAt: "desc" } }),
      db.goal.findMany({ select: { id: true, title: true, createdAt: true }, take: 10, orderBy: { createdAt: "desc" } }),
    ])

    for (const c of conversations) {
      events.push({ timestamp: c.updatedAt.toISOString(), type: "conversation", title: c.title ?? "محادثة", description: `محادثة ${c.id.slice(-6)}`, source: "chat" })
    }
    for (const t of tasks) {
      events.push({
        timestamp: (t.updatedAt ?? t.createdAt).toISOString(),
        type: t.status === "done" ? "task_completed" : "task_created",
        title: t.title,
        description: t.status === "done" ? "تم إنجاز المهمة" : "مهمة جديدة",
        source: "productivity",
      })
    }
    for (const m of memories) {
      events.push({ timestamp: m.createdAt.toISOString(), type: "memory", title: m.key, description: m.value.slice(0, 80), source: "memory" })
    }
    for (const p of projects) {
      events.push({ timestamp: p.createdAt.toISOString(), type: "project", title: p.name, description: "مشروع جديد", source: "productivity" })
    }
    for (const g of goals) {
      events.push({ timestamp: g.createdAt.toISOString(), type: "goal", title: g.title, description: "هدف جديد", source: "productivity" })
    }

    // Sort by timestamp descending
    events.sort((a, b) => b.timestamp.localeCompare(a.timestamp))

    return {
      ok: true,
      data: {
        events: events.slice(0, limit),
        total: events.length,
      },
    }
  } catch (e) {
    return { ok: false, data: null as any, error: "timeline_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export async function personalIntelligenceSnapshot(): Promise<PIResult<{
  userName: string
  totalConversations: number
  totalMemories: number
  totalTasks: number
  totalProjects: number
  totalGoals: number
  totalDecisions: number
  routinesDetected: number
  preferencesCount: number
}>> {
  try {
    const profile = await personalProfile()
    const routines = await routineDetection()
    const prefs = await preferenceEngine("list")
    const decisions = await decisionHistory()

    return {
      ok: true,
      data: {
        userName: profile.ok ? profile.data.name : "مستخدم",
        totalConversations: profile.ok ? profile.data.totalConversations : 0,
        totalMemories: profile.ok ? profile.data.totalMemories : 0,
        totalTasks: profile.ok ? profile.data.totalTasks : 0,
        totalProjects: profile.ok ? profile.data.activeProjects : 0,
        totalGoals: profile.ok ? profile.data.activeGoals : 0,
        totalDecisions: decisions.ok ? decisions.data.total : 0,
        routinesDetected: routines.ok ? routines.data.total : 0,
        preferencesCount: Array.isArray(prefs.data) ? prefs.data.length : 0,
      },
    }
  } catch (e) {
    return { ok: false, data: null as any, error: "snapshot_failed", message: String(e) }
  }
}
