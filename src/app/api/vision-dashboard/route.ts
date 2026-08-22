// Vision Dashboard API — aggregates stats from ALL systems
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { systemMetrics } from "@/lib/observability/os"
import { resourceIntelligenceSnapshot } from "@/lib/resource-intelligence/os"
import { personalIntelligenceSnapshot } from "@/lib/personal-intelligence/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    // KNOW
    const [memories, knowledgeChunks, conversations, messages] = await Promise.all([
      db.memory.count(),
      db.knowledgeChunk.count(),
      db.conversation.count(),
      db.message.count(),
    ])

    // THINK
    const models = await db.modelProfile.count({ where: { active: true } })
    const providers = await db.provider.count({ where: { enabled: true } })

    // ACT
    const [tasks, projects, goals, habits, skills, prompts, artifacts, plugins, mcpServers] = await Promise.all([
      db.pTask.count(),
      db.project.count(),
      db.goal.count(),
      db.habit.count(),
      (db as any).collabSkillLibrary?.count().catch(() => 0) ?? 0,
      (db as any).collabPromptLibrary?.count().catch(() => 0) ?? 0,
      (db as any).collabSharedArtifact?.count().catch(() => 0) ?? 0,
      db.plugin.count().catch(() => 0),
      0,
    ])

    // VERIFY
    const [auditEntries, healthScans, benchmarks] = await Promise.all([
      db.auditEntry.count().catch(() => 0),
      db.autonomousHealthScan.count().catch(() => 0),
      db.modelBenchmark.count().catch(() => 0),
    ])

    // REMEMBER
    const [failures, checkpoints, decisions] = await Promise.all([
      (db as any).reliabilityFailure?.count().catch(() => 0) ?? 0,
      (db as any).reliabilityCheckpoint?.count().catch(() => 0) ?? 0,
      db.memory.count({ where: { category: "decision" } }).catch(() => 0),
    ])

    // AUTOMATE
    const [scheduledTasks, backlogItems] = await Promise.all([
      db.scheduledTask.count().catch(() => 0),
      db.autonomousBacklogItem.count().catch(() => 0),
    ])

    // SYSTEM
    const sys = systemMetrics()
    let resourceSnapshot: any = null
    try { resourceSnapshot = resourceIntelligenceSnapshot() } catch {}
    let personalSnapshot: any = null
    try {
      const ps = await personalIntelligenceSnapshot()
      personalSnapshot = ps.ok ? ps.data : null
    } catch {}

    return NextResponse.json({
      // KNOW
      know: {
        memories,
        knowledgeChunks,
        conversations,
        messages,
        label: "معرفة / Knowledge",
        icon: "🧠",
        items: [
          { label: "ذكريات", value: memories },
          { label: "معرفة", value: knowledgeChunks },
          { label: "محادثات", value: conversations },
          { label: "رسائل", value: messages },
        ],
      },
      // THINK
      think: {
        models,
        providers,
        label: "تفكير / Think",
        icon: "💭",
        items: [
          { label: "نماذج نشطة", value: models },
          { label: "مزودين", value: providers },
        ],
      },
      // ACT
      act: {
        tasks, projects, goals, habits, skills, prompts, artifacts, plugins,
        label: "تنفيذ / Act",
        icon: "⚡",
        items: [
          { label: "مهام", value: tasks },
          { label: "مشاريع", value: projects },
          { label: "أهداف", value: goals },
          { label: "عادات", value: habits },
          { label: "skills", value: skills },
          { label: "prompts", value: prompts },
          { label: "artifacts", value: artifacts },
          { label: "إضافات", value: plugins },
        ],
      },
      // VERIFY
      verify: {
        auditEntries, healthScans, benchmarks,
        label: "تحقق / Verify",
        icon: "✅",
        items: [
          { label: "مدخلات audit", value: auditEntries },
          { label: "فحوصات صحة", value: healthScans },
          { label: "benchmarks", value: benchmarks },
        ],
      },
      // REMEMBER
      remember: {
        failures, checkpoints, decisions,
        label: "تذكر / Remember",
        icon: "📌",
        items: [
          { label: "فشل مسجل", value: failures },
          { label: "نقاط حفظ", value: checkpoints },
          { label: "قرارات", value: decisions },
        ],
      },
      // AUTOMATE
      automate: {
        scheduledTasks, backlogItems,
        label: "أتمتة / Automate",
        icon: "🔄",
        items: [
          { label: "مهام مجدولة", value: scheduledTasks },
          { label: "backlog ذكي", value: backlogItems },
        ],
      },
      // CONTINUE
      system: {
        ramUsagePct: sys.ramUsagePct,
        cpuCores: sys.cpuCount,
        uptime: sys.processUptimeSec,
        health: resourceSnapshot?.ok ? resourceSnapshot.data.mode : "GREEN",
        userName: personalSnapshot?.userName ?? "مستخدم",
        totalSections: 37,
        totalFeatures: 484,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
