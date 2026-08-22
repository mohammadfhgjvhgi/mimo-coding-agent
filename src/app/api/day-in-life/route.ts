// Day in the Life API — maps a real day's activities to the MiMo X journey
import { NextResponse } from "next/server"
import { db } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    // Gather real stats for each time slot
    const [tasks, goals, knowledgeChunks, conversations, projects, memories, habits, scheduledTasks, backlogItems, skills, artifacts, prompts, auditEntries, healthScans] = await Promise.all([
      db.pTask.count(),
      db.goal.count(),
      db.knowledgeChunk.count(),
      db.conversation.count(),
      db.project.count(),
      db.memory.count(),
      db.habit.count(),
      db.scheduledTask.count().catch(() => 0),
      db.autonomousBacklogItem.count().catch(() => 0),
      (db as any).collabSkillLibrary?.count().catch(() => 0) ?? 0,
      (db as any).collabSharedArtifact?.count().catch(() => 0) ?? 0,
      (db as any).collabPromptLibrary?.count().catch(() => 0) ?? 0,
      db.auditEntry.count().catch(() => 0),
      db.autonomousHealthScan.count().catch(() => 0),
    ])

    // The "Day in the Life" timeline with real data
    const day = [
      {
        time: "08:00",
        timeAr: "٨:٠٠ ص",
        phase: "الدراسة",
        phaseEn: "Study",
        icon: "📚",
        color: "amber",
        command: "ما عندي اليوم؟",
        tools: ["Task Manager", "Daily Planner", "Goals"],
        stats: [
          { label: "مهام معلّقة", value: tasks },
          { label: "أهداف نشطة", value: goals },
          { label: "عادات", value: habits },
        ],
        flow: "يقرأ المهام والخطط → يعرض الأولويات → يقترح خطة اليوم",
      },
      {
        time: "09:00",
        timeAr: "٩:٠٠ ص",
        phase: "الجامعة",
        phaseEn: "University",
        icon: "🎓",
        color: "blue",
        command: "لخّص محاضرة PLC",
        tools: ["Knowledge OS", "Study Workspace", "Flashcards", "Quiz Generator"],
        stats: [
          { label: "معرفة محفوظة", value: knowledgeChunks },
          { label: "محادثات", value: conversations },
        ],
        flow: "تلخيص → اختبرني → أضف للمعرفة → بطاقات مراجعة",
      },
      {
        time: "12:00",
        timeAr: "١٢:٠٠ م",
        phase: "بحث",
        phaseEn: "Research",
        icon: "🔍",
        color: "purple",
        command: "أعمل بحثًا موثقًا عن تقنية معينة",
        tools: ["Research Agent", "Web Search", "Source Ranking", "Citation Graph", "Report Generator"],
        stats: [
          { label: "معرفة بحثية", value: knowledgeChunks },
          { label: "prompts جاهزة", value: prompts },
        ],
        flow: "Search → Sources → Compare → Citations → Report → Knowledge",
      },
      {
        time: "15:00",
        timeAr: "٣:٠٠ م",
        phase: "البرمجة",
        phaseEn: "Coding",
        icon: "💻",
        color: "emerald",
        command: "حلل المشروع",
        tools: ["Repo Scanner", "Architecture Scan", "Dead Code Detection", "Hotspot Analysis", "Backlog Generator"],
        stats: [
          { label: "مشاريع", value: projects },
          { label: "backlog ذكي", value: backlogItems },
          { label: "فحوصات صحة", value: healthScans },
        ],
        flow: "Repo Map → Architecture → Problems → Backlog",
      },
      {
        time: "16:00",
        timeAr: "٤:٠٠ م",
        phase: "التنفيذ",
        phaseEn: "Execution",
        icon: "⚡",
        color: "orange",
        command: "ابدأ بإصلاح أهم 5 مشاكل",
        tools: ["Task DAG", "Sequential Execute", "Code Editor", "Terminal", "Git Checkpoint"],
        stats: [
          { label: "مهام", value: tasks },
          { label: "audit entries", value: auditEntries },
          { label: "skills", value: skills },
        ],
        flow: "Task 1 → Evidence → Edit → Test → Checkpoint → Task 2 → ...",
      },
      {
        time: "18:00",
        timeAr: "٦:٠٠ م",
        phase: "الويب",
        phaseEn: "Web Testing",
        icon: "🌐",
        color: "cyan",
        command: "اختبر الموقع",
        tools: ["Browser Agent", "Playwright", "Screenshot Capture", "Bug Detection", "Report"],
        stats: [
          { label: "artifacts", value: artifacts },
          { label: "محادثات", value: conversations },
        ],
        flow: "Open → Navigate → Click → Screenshot → Detect Bug → Report",
      },
      {
        time: "20:00",
        timeAr: "٨:٠٠ م",
        phase: "التنظيم",
        phaseEn: "Organize",
        icon: "📋",
        color: "pink",
        command: "شو بقي علي؟",
        tools: ["Personal Intelligence", "Priority Engine", "Timeline", "Decision History"],
        stats: [
          { label: "ذكريات", value: memories },
          { label: "مهام", value: tasks },
          { label: "مشاريع", value: projects },
        ],
        flow: "Tasks → Projects → Knowledge → Sessions → الصورة الكاملة",
      },
      {
        time: "22:00",
        timeAr: "١٠:٠٠ م",
        phase: "الأتمتة",
        phaseEn: "Automate",
        icon: "🔄",
        color: "indigo",
        command: "كل أسبوع افحص المشروع",
        tools: ["Automation OS", "Scheduled Jobs", "Workflow Builder", "Health Loop"],
        stats: [
          { label: "مهام مجدولة", value: scheduledTasks },
          { label: "backlog", value: backlogItems },
        ],
        flow: "يصبح Automation → يعمل في الخلفية → يفحص → يبلغ → يصلح",
      },
    ]

    // The "replacement" message
    const replaced = [
      { name: "ChatGPT", replacedBy: "MiMo Chat + 9 LLM Providers" },
      { name: "Cursor", replacedBy: "Monaco Editor + Code Intelligence" },
      { name: "Codex", replacedBy: "Agent OS + Task DAG" },
      { name: "Open WebUI", replacedBy: "MiMo Chat Workspace" },
      { name: "Notion AI", replacedBy: "Knowledge OS + Memory" },
      { name: "Perplexity", replacedBy: "Research Agent + Citations" },
      { name: "Task App", replacedBy: "Productivity OS + Priorities" },
      { name: "Research App", replacedBy: "Research OS + Timeline" },
      { name: "Terminal AI", replacedBy: "Terminal Agent + Shell" },
      { name: "Browser AI", replacedBy: "Browser Agent + Playwright" },
    ]

    return NextResponse.json({
      day,
      replaced,
      totalTools: replaced.length,
      quote: "MiMo X = طبقة موحدة فوق كل هذه الوظائف",
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
