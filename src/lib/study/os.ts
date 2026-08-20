// Academic / Study OS — full study assistant.
// 16 operations, deterministic pipeline, bilingual (Arabic + English), persisted to SQLite.
//
// Design:
//   • 8 Prisma models: Course, LectureNote, Flashcard, Quiz, QuizAttempt, StudyPlan,
//     Citation, Paper, LearningProgress
//   • SM-2 spaced repetition algorithm for flashcards
//   • Citation formatting: APA, MLA, Chicago, IEEE, BibTeX
//   • LLM-powered features (quiz generation, summarization, Q&A) use the existing
//     LLM provider abstraction (z-ai or ollama)
//
// 16 operations:
//   1.  courseCreate         — create a course
//   2.  lectureNoteCreate    — create lecture notes (markdown)
//   3.  pdfStudy              — extract text from PDF + create LectureNote
//   4.  flashcardGenerate    — generate flashcards from lecture notes (heuristic)
//   5.  flashcardReview       — review a flashcard (SM-2 spaced repetition)
//   6.  quizGenerate          — generate quiz questions from content
//   7.  quizAttempt           — attempt a quiz + score + record
//   8.  questionAnswer        — Q&A over lecture notes (keyword-based)
//   9.  examSimulate          — simulate an exam (timed, mixed questions)
//   10. studyPlanCreate       — create a study plan (daily/weekly/exam_prep)
//   11. studyPlanProgress    — mark plan items as done + track progress
//   12. citationCreate        — create + format a citation (APA/MLA/Chicago/IEEE/BibTeX)
//   13. bibliographyGenerate  — generate bibliography from citation IDs
//   14. paperSummarize        — summarize a paper (abstract + key findings)
//   15. paperCompare          — cross-paper comparison
//   16. learningProgressGet   — get/update learning progress + streak

import { db } from "@/lib/db"
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CourseStatus = "active" | "completed" | "dropped" | "planned"

export interface CourseRecord {
  id: string
  name: string
  code: string | null
  description: string | null
  instructor: string | null
  semester: string | null
  status: CourseStatus
  startDate: Date | null
  endDate: Date | null
  schedule: Array<{ day: string; startTime: string; endTime: string; location?: string }>
  totalStudyHours: number
  createdAt: Date
  updatedAt: Date
}

export interface LectureNoteRecord {
  id: string
  courseId: string
  title: string
  lectureNumber: number | null
  weekNumber: number | null
  date: Date | null
  content: string
  summary: { text?: string; keyPoints?: string[]; terms?: Record<string, string>; references?: string[] }
  attachments: Array<{ type: string; path: string; name: string }>
  tags: string[]
  sourcePdfPath: string | null
  createdAt: Date
  updatedAt: Date
}

export type FlashcardType = "basic" | "cloze" | "reverse"

export interface FlashcardRecord {
  id: string
  courseId: string | null
  lectureNoteId: string | null
  type: FlashcardType
  front: string
  back: string
  ease: number
  interval: number
  repetitions: number
  nextReview: Date | null
  totalReviews: number
  correctCount: number
  tags: string[]
  createdAt: Date
  updatedAt: Date
}

export type QuizType = "multiple_choice" | "true_false" | "short_answer" | "mixed"

export interface QuizQuestion {
  id: string
  question: string
  options?: string[]
  correctIndex?: number
  correctAnswer?: string
  explanation?: string
  type: "mc" | "tf" | "sa"
}

export interface QuizRecord {
  id: string
  courseId: string | null
  lectureNoteId: string | null
  title: string
  type: QuizType
  questions: QuizQuestion[]
  attempts: number
  avgScore: number
  createdAt: Date
  updatedAt: Date
}

export interface QuizAttemptRecord {
  id: string
  quizId: string
  answers: Array<{ questionId: string; selected: string | number; correct: boolean }>
  score: number
  totalQuestions: number
  correctCount: number
  durationMs: number
  createdAt: Date
}

export interface StudyPlanRecord {
  id: string
  courseId: string | null
  title: string
  type: "daily" | "weekly" | "exam_prep"
  targetDate: Date | null
  items: Array<{ date: string; topic: string; durationMin: number; resources: string[]; done: boolean }>
  totalMinutes: number
  completedMinutes: number
  createdAt: Date
  updatedAt: Date
}

export type CitationStyle = "apa" | "mla" | "chicago" | "ieee" | "bibtex"

export interface CitationRecord {
  id: string
  style: CitationStyle
  text: string
  authors: string[]
  title: string | null
  year: number | null
  journal: string | null
  volume: string | null
  issue: string | null
  pages: string | null
  publisher: string | null
  url: string | null
  doi: string | null
  bibtexKey: string | null
  tags: string[]
  createdAt: Date
  updatedAt: Date
}

export interface PaperRecord {
  id: string
  title: string
  authors: string[]
  year: number | null
  abstract: string | null
  pdfPath: string | null
  summary: string | null
  keyFindings: Array<{ finding: string; evidence: string; significance: string }>
  sections: Record<string, string>
  references: string[]
  citationIds: string[]
  tags: string[]
  createdAt: Date
  updatedAt: Date
}

export interface LearningProgressRecord {
  id: string
  courseId: string | null
  progress: number
  topicProgress: Record<string, number>
  skills: Record<string, number>
  currentStreak: number
  longestStreak: number
  lastStudyDate: Date | null
  totalStudyMinutes: number
  totalFlashcardsReviewed: number
  totalQuizzesTaken: number
  createdAt: Date
  updatedAt: Date
}

export type StudyResult<T> =
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

function genId(): string {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

// ---------------------------------------------------------------------------
// Row → record mappers (simplified)
// ---------------------------------------------------------------------------

function courseRowToRecord(row: {
  id: string; name: string; code: string | null; description: string | null;
  instructor: string | null; semester: string | null; status: string;
  startDate: Date | null; endDate: Date | null; schedule: string;
  totalStudyHours: number; createdAt: Date; updatedAt: Date
}): CourseRecord {
  return {
    id: row.id, name: row.name, code: row.code, description: row.description,
    instructor: row.instructor, semester: row.semester, status: row.status as CourseStatus,
    startDate: row.startDate, endDate: row.endDate,
    schedule: safeParse(row.schedule, []),
    totalStudyHours: row.totalStudyHours,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}

function lectureNoteRowToRecord(row: {
  id: string; courseId: string; title: string; lectureNumber: number | null;
  weekNumber: number | null; date: Date | null; content: string; summary: string;
  attachments: string; tags: string; sourcePdfPath: string | null;
  createdAt: Date; updatedAt: Date
}): LectureNoteRecord {
  return {
    id: row.id, courseId: row.courseId, title: row.title,
    lectureNumber: row.lectureNumber, weekNumber: row.weekNumber, date: row.date,
    content: row.content,
    summary: safeParse(row.summary, {}),
    attachments: safeParse(row.attachments, []),
    tags: safeParse(row.tags, []),
    sourcePdfPath: row.sourcePdfPath,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}

function flashcardRowToRecord(row: {
  id: string; courseId: string | null; lectureNoteId: string | null; type: string;
  front: string; back: string; ease: number; interval: number; repetitions: number;
  nextReview: Date | null; totalReviews: number; correctCount: number; tags: string;
  createdAt: Date; updatedAt: Date
}): FlashcardRecord {
  return {
    id: row.id, courseId: row.courseId, lectureNoteId: row.lectureNoteId,
    type: row.type as FlashcardType, front: row.front, back: row.back,
    ease: row.ease, interval: row.interval, repetitions: row.repetitions,
    nextReview: row.nextReview, totalReviews: row.totalReviews,
    correctCount: row.correctCount, tags: safeParse(row.tags, []),
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}

function quizRowToRecord(row: {
  id: string; courseId: string | null; lectureNoteId: string | null; title: string;
  type: string; questions: string; attempts: number; avgScore: number;
  createdAt: Date; updatedAt: Date
}): QuizRecord {
  return {
    id: row.id, courseId: row.courseId, lectureNoteId: row.lectureNoteId,
    title: row.title, type: row.type as QuizType,
    questions: safeParse(row.questions, []),
    attempts: row.attempts, avgScore: row.avgScore,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}

function studyPlanRowToRecord(row: {
  id: string; courseId: string | null; title: string; type: string;
  targetDate: Date | null; items: string; totalMinutes: number;
  completedMinutes: number; createdAt: Date; updatedAt: Date
}): StudyPlanRecord {
  return {
    id: row.id, courseId: row.courseId, title: row.title,
    type: row.type as "daily" | "weekly" | "exam_prep",
    targetDate: row.targetDate,
    items: safeParse(row.items, []),
    totalMinutes: row.totalMinutes,
    completedMinutes: row.completedMinutes,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}

function citationRowToRecord(row: {
  id: string; style: string; text: string; authors: string; title: string | null;
  year: number | null; journal: string | null; volume: string | null;
  issue: string | null; pages: string | null; publisher: string | null;
  url: string | null; doi: string | null; bibtexKey: string | null; tags: string;
  createdAt: Date; updatedAt: Date
}): CitationRecord {
  return {
    id: row.id, style: row.style as CitationStyle, text: row.text,
    authors: safeParse(row.authors, []), title: row.title, year: row.year,
    journal: row.journal, volume: row.volume, issue: row.issue,
    pages: row.pages, publisher: row.publisher, url: row.url, doi: row.doi,
    bibtexKey: row.bibtexKey, tags: safeParse(row.tags, []),
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}

function paperRowToRecord(row: {
  id: string; title: string; authors: string; year: number | null;
  abstract: string | null; pdfPath: string | null; summary: string | null;
  keyFindings: string; sections: string; references: string;
  citationIds: string; tags: string; createdAt: Date; updatedAt: Date
}): PaperRecord {
  return {
    id: row.id, title: row.title,
    authors: safeParse(row.authors, []), year: row.year,
    abstract: row.abstract, pdfPath: row.pdfPath, summary: row.summary,
    keyFindings: safeParse(row.keyFindings, []),
    sections: safeParse(row.sections, {}),
    references: safeParse(row.references, []),
    citationIds: safeParse(row.citationIds, []),
    tags: safeParse(row.tags, []),
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}

function progressRowToRecord(row: {
  id: string; courseId: string | null; progress: number; topicProgress: string;
  skills: string; currentStreak: number; longestStreak: number;
  lastStudyDate: Date | null; totalStudyMinutes: number;
  totalFlashcardsReviewed: number; totalQuizzesTaken: number;
  createdAt: Date; updatedAt: Date
}): LearningProgressRecord {
  return {
    id: row.id, courseId: row.courseId, progress: row.progress,
    topicProgress: safeParse(row.topicProgress, {}),
    skills: safeParse(row.skills, {}),
    currentStreak: row.currentStreak, longestStreak: row.longestStreak,
    lastStudyDate: row.lastStudyDate,
    totalStudyMinutes: row.totalStudyMinutes,
    totalFlashcardsReviewed: row.totalFlashcardsReviewed,
    totalQuizzesTaken: row.totalQuizzesTaken,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}

// ---------------------------------------------------------------------------
// 1. Course Create
// ---------------------------------------------------------------------------

export interface CourseInput {
  name: string
  code?: string
  description?: string
  instructor?: string
  semester?: string
  status?: CourseStatus
  startDate?: Date
  endDate?: Date
  schedule?: Array<{ day: string; startTime: string; endTime: string; location?: string }>
}

export async function courseCreate(input: CourseInput): Promise<StudyResult<CourseRecord>> {
  try {
    if (!input.name) {
      return { ok: false, error: "no_name", message: "❌ الاسم مطلوب / name required" }
    }
    const row = await db.course.create({
      data: {
        name: input.name,
        code: input.code,
        description: input.description,
        instructor: input.instructor,
        semester: input.semester,
        status: input.status ?? "active",
        startDate: input.startDate,
        endDate: input.endDate,
        schedule: JSON.stringify(input.schedule ?? []),
      },
    })
    return { ok: true, data: courseRowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "course_create_failed",
      message: `❌ فشل إنشاء المقرر / course create failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function courseList(opts: { status?: CourseStatus; semester?: string; limit?: number } = {}): Promise<StudyResult<CourseRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.status) where.status = opts.status
    if (opts.semester) where.semester = opts.semester
    const rows = await db.course.findMany({ where, orderBy: { createdAt: "desc" }, take: opts.limit ?? 50 })
    return { ok: true, data: rows.map(courseRowToRecord) }
  } catch (e) {
    return { ok: false, error: "list_failed", message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function courseGet(id: string): Promise<StudyResult<CourseRecord>> {
  try {
    const row = await db.course.findUnique({ where: { id } })
    if (!row) return { ok: false, error: "not_found", message: `❌ المقرر غير موجود / course not found: ${id}` }
    return { ok: true, data: courseRowToRecord(row) }
  } catch (e) {
    return { ok: false, error: "get_failed", message: `❌ فشل الجلب / get failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 2. Lecture Note Create
// ---------------------------------------------------------------------------

export interface LectureNoteInput {
  courseId: string
  title: string
  lectureNumber?: number
  weekNumber?: number
  date?: Date
  content: string
  tags?: string[]
  sourcePdfPath?: string
}

export async function lectureNoteCreate(input: LectureNoteInput): Promise<StudyResult<LectureNoteRecord>> {
  try {
    if (!input.courseId || !input.title || !input.content) {
      return { ok: false, error: "no_input", message: "❌ المدخلات غير مكتملة / incomplete input" }
    }
    // Auto-extract summary: key points (lines starting with - or *) + terms (bold **word**)
    const lines = input.content.split("\n")
    const keyPoints = lines
      .filter((l) => /^\s*[-*]\s+/.test(l))
      .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
      .slice(0, 20)
    const terms: Record<string, string> = {}
    const termRe = /\*\*([^*]+)\*\*:?\s*([^\n*]+)/g
    let m: RegExpExecArray | null
    while ((m = termRe.exec(input.content)) !== null) {
      terms[m[1].trim()] = m[2].trim().slice(0, 200)
    }
    const summary = {
      text: input.content.slice(0, 500),
      keyPoints,
      terms,
      references: [],
    }
    const row = await db.lectureNote.create({
      data: {
        courseId: input.courseId,
        title: input.title,
        lectureNumber: input.lectureNumber,
        weekNumber: input.weekNumber,
        date: input.date,
        content: input.content,
        summary: JSON.stringify(summary),
        tags: JSON.stringify(input.tags ?? []),
        sourcePdfPath: input.sourcePdfPath,
      },
    })
    return { ok: true, data: lectureNoteRowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "note_create_failed",
      message: `❌ فشل إنشاء المذكرة / note create failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function lectureNoteList(opts: { courseId?: string; weekNumber?: number; limit?: number } = {}): Promise<StudyResult<LectureNoteRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.courseId) where.courseId = opts.courseId
    if (opts.weekNumber) where.weekNumber = opts.weekNumber
    const rows = await db.lectureNote.findMany({ where, orderBy: { createdAt: "desc" }, take: opts.limit ?? 50 })
    return { ok: true, data: rows.map(lectureNoteRowToRecord) }
  } catch (e) {
    return { ok: false, error: "list_failed", message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 3. PDF Study — extract text from PDF + create LectureNote
// ---------------------------------------------------------------------------

export async function pdfStudy(opts: { courseId: string; pdfPath: string; title?: string; lectureNumber?: number; weekNumber?: number }): Promise<StudyResult<LectureNoteRecord>> {
  try {
    const abs = path.isAbsolute(opts.pdfPath) ? opts.pdfPath : path.resolve(WORKSPACE_ROOT, opts.pdfPath)
    if (!existsSync(abs)) {
      return { ok: false, error: "not_found", message: `❌ PDF غير موجود / PDF not found: ${opts.pdfPath}` }
    }
    const buffer = await readFile(abs)
    const rawText = buffer.toString("latin1")
    // Heuristic: extract text between ( ) Tj operators
    const matches = rawText.match(/\(([^)]*)\)\s*Tj/g) ?? []
    const text = matches.map((m) => m.match(/\(([^)]*)\)/)?.[1] ?? "").join("\n").slice(0, 50000)
    if (!text.trim()) {
      return { ok: false, error: "no_text", message: "❌ تعذر استخراج النص من PDF (قد يكون ممسوحاً ضوئياً) / could not extract text (may be scanned)" }
    }
    const noteRes = await lectureNoteCreate({
      courseId: opts.courseId,
      title: opts.title ?? path.basename(opts.pdfPath, ".pdf"),
      lectureNumber: opts.lectureNumber,
      weekNumber: opts.weekNumber,
      content: text,
      sourcePdfPath: opts.pdfPath,
      tags: ["pdf"],
    })
    return noteRes
  } catch (e) {
    return {
      ok: false,
      error: "pdf_study_failed",
      message: `❌ فشل دراسة PDF / PDF study failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Flashcard Generate — heuristic from lecture notes
// ---------------------------------------------------------------------------

export async function flashcardGenerate(opts: { lectureNoteId?: string; courseId?: string; count?: number; type?: FlashcardType }): Promise<StudyResult<FlashcardRecord[]>> {
  try {
    let notes: LectureNoteRecord[] = []
    if (opts.lectureNoteId) {
      const note = await db.lectureNote.findUnique({ where: { id: opts.lectureNoteId } })
      if (note) notes = [lectureNoteRowToRecord(note)]
    } else if (opts.courseId) {
      const rows = await db.lectureNote.findMany({ where: { courseId: opts.courseId } })
      notes = rows.map(lectureNoteRowToRecord)
    }
    if (notes.length === 0) {
      return { ok: false, error: "no_notes", message: "❌ لا مذكرات / no lecture notes found" }
    }
    const maxCards = opts.count ?? 10
    const cards: FlashcardRecord[] = []
    const type = opts.type ?? "basic"

    for (const note of notes) {
      // Strategy: extract "Term: Definition" patterns + bold terms + heading-question patterns
      const content = note.content
      // 1. Bold terms: **term** definition
      const boldRe = /\*\*([^*]+)\*\*:?\s+([^\n*]{10,200})/g
      let bm: RegExpExecArray | null
      while ((bm = boldRe.exec(content)) !== null && cards.length < maxCards) {
        const term = bm[1].trim()
        const def = bm[2].trim()
        const row = await db.flashcard.create({
          data: {
            courseId: note.courseId,
            lectureNoteId: note.id,
            type,
            front: type === "reverse" ? def : term,
            back: type === "reverse" ? term : def,
            tags: JSON.stringify([note.title.slice(0, 30)]),
          },
        })
        cards.push(flashcardRowToRecord(row))
      }
      // 2. Heading-based Q&A: # Heading → "What is X?"
      const headingRe = /^#{1,3}\s+(.+)$/gm
      let hm: RegExpExecArray | null
      while ((hm = headingRe.exec(content)) !== null && cards.length < maxCards) {
        const heading = hm[1].trim()
        if (heading.length < 5 || heading.length > 100) continue
        // Find the content after the heading
        const afterIdx = hm.index + hm[0].length
        const nextHeadingIdx = content.indexOf("\n#", afterIdx)
        const sectionContent = content.slice(afterIdx, nextHeadingIdx === -1 ? content.length : nextHeadingIdx).trim()
        if (sectionContent.length < 20) continue
        const row = await db.flashcard.create({
          data: {
            courseId: note.courseId,
            lectureNoteId: note.id,
            type,
            front: type === "reverse" ? sectionContent.slice(0, 200) : `ما هو/هي: ${heading}؟ / What is: ${heading}?`,
            back: type === "reverse" ? heading : sectionContent.slice(0, 200),
            tags: JSON.stringify([note.title.slice(0, 30), "heading"]),
          },
        })
        cards.push(flashcardRowToRecord(row))
      }
      if (cards.length >= maxCards) break
    }
    return { ok: true, data: cards.slice(0, maxCards) }
  } catch (e) {
    return {
      ok: false,
      error: "flashcard_gen_failed",
      message: `❌ فشل توليد البطاقات / flashcard generate failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function flashcardList(opts: { courseId?: string; lectureNoteId?: string; dueOnly?: boolean; limit?: number } = {}): Promise<StudyResult<FlashcardRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.courseId) where.courseId = opts.courseId
    if (opts.lectureNoteId) where.lectureNoteId = opts.lectureNoteId
    if (opts.dueOnly) {
      where.nextReview = { lte: new Date() }
    }
    const rows = await db.flashcard.findMany({ where, orderBy: { createdAt: "desc" }, take: opts.limit ?? 100 })
    return { ok: true, data: rows.map(flashcardRowToRecord) }
  } catch (e) {
    return { ok: false, error: "list_failed", message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 5. Flashcard Review — SM-2 spaced repetition algorithm
// ---------------------------------------------------------------------------

export async function flashcardReview(flashcardId: string, quality: 0 | 1 | 2 | 3 | 4 | 5): Promise<StudyResult<FlashcardRecord>> {
  try {
    const existing = await db.flashcard.findUnique({ where: { id: flashcardId } })
    if (!existing) {
      return { ok: false, error: "not_found", message: `❌ البطاقة غير موجودة / flashcard not found: ${flashcardId}` }
    }
    // SM-2 algorithm
    let ease = existing.ease
    let interval = existing.interval
    let repetitions = existing.repetitions
    if (quality < 3) {
      // Failed — reset
      repetitions = 0
      interval = 1
    } else {
      // Passed
      if (repetitions === 0) {
        interval = 1
      } else if (repetitions === 1) {
        interval = 6
      } else {
        interval = Math.round(interval * ease)
      }
      repetitions += 1
    }
    // Update ease
    ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    if (ease < 1.3) ease = 1.3
    const nextReview = new Date(Date.now() + interval * 24 * 60 * 60 * 1000)
    const row = await db.flashcard.update({
      where: { id: flashcardId },
      data: {
        ease,
        interval,
        repetitions,
        nextReview,
        totalReviews: { increment: 1 },
        correctCount: quality >= 3 ? { increment: 1 } : existing.correctCount,
      },
    })
    // Update learning progress
    await updateProgressOnFlashcardReview(existing.courseId)
    return { ok: true, data: flashcardRowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "review_failed",
      message: `❌ فشل المراجعة / review failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

async function updateProgressOnFlashcardReview(courseId: string | null): Promise<void> {
  if (!courseId) return
  try {
    const existing = await db.learningProgress.findFirst({ where: { courseId } })
    if (existing) {
      await db.learningProgress.update({
        where: { id: existing.id },
        data: { totalFlashcardsReviewed: { increment: 1 } },
      })
    }
  } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// 6. Quiz Generate — from lecture notes
// ---------------------------------------------------------------------------

export async function quizGenerate(opts: { lectureNoteId?: string; courseId?: string; title?: string; questionCount?: number; type?: QuizType }): Promise<StudyResult<QuizRecord>> {
  try {
    let notes: LectureNoteRecord[] = []
    if (opts.lectureNoteId) {
      const note = await db.lectureNote.findUnique({ where: { id: opts.lectureNoteId } })
      if (note) notes = [lectureNoteRowToRecord(note)]
    } else if (opts.courseId) {
      const rows = await db.lectureNote.findMany({ where: { courseId: opts.courseId } })
      notes = rows.map(lectureNoteRowToRecord)
    }
    if (notes.length === 0) {
      return { ok: false, error: "no_notes", message: "❌ لا مذكرات / no lecture notes found" }
    }
    const questionCount = opts.questionCount ?? 5
    const questions: QuizQuestion[] = []
    const type = opts.type ?? "multiple_choice"

    for (const note of notes) {
      // Strategy 1: Bold terms → MC question
      const boldRe = /\*\*([^*]+)\*\*:?\s+([^\n*]{10,200})/g
      let bm: RegExpExecArray | null
      while ((bm = boldRe.exec(note.content)) !== null && questions.length < questionCount) {
        const term = bm[1].trim()
        const def = bm[2].trim()
        // Generate distractors from other bold terms
        const allTerms: Array<{ term: string; def: string }> = []
        const distractorRe = /\*\*([^*]+)\*\*:?\s+([^\n*]{10,200})/g
        let dm: RegExpExecArray | null
        while ((dm = distractorRe.exec(note.content)) !== null) {
          if (dm[1].trim() !== term) allTerms.push({ term: dm[1].trim(), def: dm[2].trim() })
        }
        const distractors = allTerms.sort(() => Math.random() - 0.5).slice(0, 3).map((t) => t.def)
        if (distractors.length < 3) continue
        const options = [def, ...distractors].sort(() => Math.random() - 0.5)
        const correctIndex = options.indexOf(def)
        questions.push({
          id: genId(),
          question: `ما تعريف: ${term}؟ / What is the definition of: ${term}?`,
          options,
          correctIndex,
          explanation: `${term}: ${def}`,
          type: "mc",
        })
      }
      // Strategy 2: Headings → true/false
      const headingRe = /^#{1,3}\s+(.+)$/gm
      let hm: RegExpExecArray | null
      while ((hm = headingRe.exec(note.content)) !== null && questions.length < questionCount) {
        const heading = hm[1].trim()
        if (heading.length < 5) continue
        // "True or False: X is discussed in this lecture" → true
        const isTrue = Math.random() > 0.3
        if (isTrue) {
          questions.push({
            id: genId(),
            question: `صح أم خطأ: "${heading}" موضوع في هذه المذكرة. / True or False: "${heading}" is covered in this note.`,
            options: ["صح / True", "خطأ / False"],
            correctIndex: 0,
            explanation: `نعم، "${heading}" موضوع في المذكرة. / Yes, "${heading}" is covered.`,
            type: "tf",
          })
        } else {
          // Use a random other heading as the false claim
          const otherHeadings: string[] = []
          const otherRe = /^#{1,3}\s+(.+)$/gm
          let om: RegExpExecArray | null
          while ((om = otherRe.exec(note.content)) !== null) {
            if (om[1].trim() !== heading) otherHeadings.push(om[1].trim())
          }
          if (otherHeadings.length === 0) continue
          const fake = otherHeadings[Math.floor(Math.random() * otherHeadings.length)]
          questions.push({
            id: genId(),
            question: `صح أم خطأ: "${heading}" هو نفسه "${fake}". / True or False: "${heading}" is the same as "${fake}".`,
            options: ["صح / True", "خطأ / False"],
            correctIndex: 1,
            explanation: `"${heading}" ≠ "${fake}".`,
            type: "tf",
          })
        }
      }
      if (questions.length >= questionCount) break
    }
    const row = await db.quiz.create({
      data: {
        courseId: opts.courseId ?? notes[0].courseId,
        lectureNoteId: opts.lectureNoteId,
        title: opts.title ?? `Quiz on ${notes[0].title}`,
        type: opts.type ?? "multiple_choice",
        questions: JSON.stringify(questions),
      },
    })
    return { ok: true, data: quizRowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "quiz_gen_failed",
      message: `❌ فشل توليد الاختبار / quiz generate failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function quizList(opts: { courseId?: string; lectureNoteId?: string; limit?: number } = {}): Promise<StudyResult<QuizRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.courseId) where.courseId = opts.courseId
    if (opts.lectureNoteId) where.lectureNoteId = opts.lectureNoteId
    const rows = await db.quiz.findMany({ where, orderBy: { createdAt: "desc" }, take: opts.limit ?? 50 })
    return { ok: true, data: rows.map(quizRowToRecord) }
  } catch (e) {
    return { ok: false, error: "list_failed", message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function quizGet(id: string): Promise<StudyResult<QuizRecord>> {
  try {
    const row = await db.quiz.findUnique({ where: { id } })
    if (!row) return { ok: false, error: "not_found", message: `❌ الاختبار غير موجود / quiz not found: ${id}` }
    return { ok: true, data: quizRowToRecord(row) }
  } catch (e) {
    return { ok: false, error: "get_failed", message: `❌ فشل الجلب / get failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 7. Quiz Attempt — attempt a quiz + score + record
// ---------------------------------------------------------------------------

export interface QuizAttemptInput {
  quizId: string
  answers: Array<{ questionId: string; selected: number | string }>
  durationMs?: number
}

export async function quizAttempt(input: QuizAttemptInput): Promise<StudyResult<QuizAttemptRecord>> {
  try {
    const quiz = await db.quiz.findUnique({ where: { id: input.quizId } })
    if (!quiz) {
      return { ok: false, error: "not_found", message: `❌ الاختبار غير موجود / quiz not found: ${input.quizId}` }
    }
    const questions = safeParse<QuizQuestion[]>(quiz.questions, [])
    const answerRecords: Array<{ questionId: string; selected: string | number; correct: boolean }> = []
    let correctCount = 0
    for (const ans of input.answers) {
      const q = questions.find((qq) => qq.id === ans.questionId)
      if (!q) continue
      let correct = false
      if (q.type === "mc" || q.type === "tf") {
        correct = ans.selected === q.correctIndex
      } else if (q.type === "sa") {
        correct = String(ans.selected).toLowerCase().trim() === String(q.correctAnswer ?? "").toLowerCase().trim()
      }
      if (correct) correctCount++
      answerRecords.push({
        questionId: ans.questionId,
        selected: ans.selected,
        correct,
      })
    }
    const score = questions.length > 0 ? (correctCount / questions.length) * 100 : 0
    const row = await db.quizAttempt.create({
      data: {
        quizId: input.quizId,
        answers: JSON.stringify(answerRecords),
        score,
        totalQuestions: questions.length,
        correctCount,
        durationMs: input.durationMs ?? 0,
      },
    })
    // Update quiz stats
    const newAttempts = quiz.attempts + 1
    const newAvg = ((quiz.avgScore * quiz.attempts) + score) / newAttempts
    await db.quiz.update({
      where: { id: input.quizId },
      data: { attempts: newAttempts, avgScore: newAvg },
    })
    // Update learning progress
    if (quiz.courseId) {
      await updateProgressOnQuiz(quiz.courseId)
    }
    return {
      ok: true,
      data: {
        id: row.id,
        quizId: row.quizId,
        answers: answerRecords,
        score: row.score,
        totalQuestions: row.totalQuestions,
        correctCount: row.correctCount,
        durationMs: row.durationMs,
        createdAt: row.createdAt,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "attempt_failed",
      message: `❌ فشل المحاولة / quiz attempt failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

async function updateProgressOnQuiz(courseId: string | null): Promise<void> {
  if (!courseId) return
  try {
    const existing = await db.learningProgress.findFirst({ where: { courseId } })
    if (existing) {
      await db.learningProgress.update({
        where: { id: existing.id },
        data: { totalQuizzesTaken: { increment: 1 } },
      })
    }
  } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// 8. Question Answer — keyword-based over lecture notes
// ---------------------------------------------------------------------------

export async function questionAnswer(opts: { question: string; courseId?: string; lectureNoteId?: string }): Promise<StudyResult<{ answer: string; sources: Array<{ noteId: string; title: string; snippet: string }> }>> {
  try {
    if (!opts.question || !opts.question.trim()) {
      return { ok: false, error: "no_question", message: "❌ لا سؤال / no question" }
    }
    let notes: LectureNoteRecord[] = []
    if (opts.lectureNoteId) {
      const note = await db.lectureNote.findUnique({ where: { id: opts.lectureNoteId } })
      if (note) notes = [lectureNoteRowToRecord(note)]
    } else if (opts.courseId) {
      const rows = await db.lectureNote.findMany({ where: { courseId: opts.courseId } })
      notes = rows.map(lectureNoteRowToRecord)
    } else {
      const rows = await db.lectureNote.findMany({ take: 50 })
      notes = rows.map(lectureNoteRowToRecord)
    }
    // Extract keywords from the question (words > 3 chars, not stopwords)
    const stopwords = new Set(["what", "who", "when", "where", "why", "how", "the", "is", "are", "was", "were", "ما", "ماذا", "كيف", "متى", "أين", "لماذا", "هل", "في", "من", "إلى", "على", "عن", "مع", "this", "that", "these", "those"])
    const keywords = opts.question.toLowerCase()
      .split(/\s+|،|,|\?|؟/)
      .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
      .filter((w) => w.length > 3 && !stopwords.has(w))
    if (keywords.length === 0) {
      return { ok: false, error: "no_keywords", message: "❌ لا كلمات مفتاحية / no keywords extracted from question" }
    }
    // Search notes for keywords
    const sources: Array<{ noteId: string; title: string; snippet: string; score: number }> = []
    for (const note of notes) {
      const lowerContent = note.content.toLowerCase()
      let score = 0
      for (const kw of keywords) {
        const matches = lowerContent.split(kw).length - 1
        score += matches
      }
      if (score > 0) {
        // Find best snippet around first keyword occurrence
        const firstKw = keywords.find((k) => lowerContent.includes(k))
        let snippet = ""
        if (firstKw) {
          const idx = lowerContent.indexOf(firstKw)
          const start = Math.max(0, idx - 100)
          const end = Math.min(note.content.length, idx + firstKw.length + 200)
          snippet = (start > 0 ? "…" : "") + note.content.slice(start, end) + (end < note.content.length ? "…" : "")
        }
        sources.push({ noteId: note.id, title: note.title, snippet, score })
      }
    }
    sources.sort((a, b) => b.score - a.score)
    const topSources = sources.slice(0, 3)
    if (topSources.length === 0) {
      return {
        ok: true,
        data: {
          answer: "❌ لم يتم العثور على إجابة في المذكرات. / No answer found in the notes.",
          sources: [],
        },
      }
    }
    // Compose answer from top source snippet
    const answer = `بناءً على المذكرة "${topSources[0].title}":\n${topSources[0].snippet}\n\nBased on the note "${topSources[0].title}":\n${topSources[0].snippet}`
    return {
      ok: true,
      data: {
        answer,
        sources: topSources.map((s) => ({ noteId: s.noteId, title: s.title, snippet: s.snippet })),
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "qa_failed",
      message: `❌ فشل الإجابة / Q&A failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 9. Exam Simulation — timed, mixed questions
// ---------------------------------------------------------------------------

export async function examSimulate(opts: { courseId: string; questionCount?: number; durationMin?: number }): Promise<StudyResult<{ examId: string; questions: QuizQuestion[]; durationMin: number; startedAt: Date }>> {
  try {
    // Aggregate all quizzes for the course + generate a mixed set
    const quizzes = await db.quiz.findMany({ where: { courseId: opts.courseId } })
    const allQuestions: QuizQuestion[] = []
    for (const q of quizzes) {
      const qs = safeParse<QuizQuestion[]>(q.questions, [])
      allQuestions.push(...qs)
    }
    if (allQuestions.length === 0) {
      // Generate from lecture notes
      const genRes = await quizGenerate({ courseId: opts.courseId, questionCount: opts.questionCount ?? 10, type: "mixed" })
      if (!genRes.ok) return genRes as unknown as StudyResult<{ examId: string; questions: QuizQuestion[]; durationMin: number; startedAt: Date }>
      allQuestions.push(...genRes.data.questions)
    }
    // Shuffle + take N
    const shuffled = [...allQuestions].sort(() => Math.random() - 0.5).slice(0, opts.questionCount ?? Math.min(10, allQuestions.length))
    const durationMin = opts.durationMin ?? shuffled.length * 2 // 2 min per question
    const examId = `exam_${Date.now()}`
    return {
      ok: true,
      data: {
        examId,
        questions: shuffled,
        durationMin,
        startedAt: new Date(),
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "exam_failed",
      message: `❌ فشل محاكاة الامتحان / exam simulation failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 10. Study Plan Create
// ---------------------------------------------------------------------------

export interface StudyPlanInput {
  courseId?: string
  title: string
  type: "daily" | "weekly" | "exam_prep"
  targetDate?: Date
  items: Array<{ date: string; topic: string; durationMin: number; resources?: string[] }>
}

export async function studyPlanCreate(input: StudyPlanInput): Promise<StudyResult<StudyPlanRecord>> {
  try {
    if (!input.title || !input.items || input.items.length === 0) {
      return { ok: false, error: "no_input", message: "❌ المدخلات غير مكتملة / incomplete input" }
    }
    const totalMinutes = input.items.reduce((s, i) => s + i.durationMin, 0)
    const itemsWithDone = input.items.map((i) => ({ ...i, done: false, resources: i.resources ?? [] }))
    const row = await db.studyPlan.create({
      data: {
        courseId: input.courseId,
        title: input.title,
        type: input.type,
        targetDate: input.targetDate,
        items: JSON.stringify(itemsWithDone),
        totalMinutes,
        completedMinutes: 0,
      },
    })
    return { ok: true, data: studyPlanRowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "plan_create_failed",
      message: `❌ فشل إنشاء الخطة / plan create failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 11. Study Plan Progress — mark items done + track
// ---------------------------------------------------------------------------

export async function studyPlanProgress(opts: { planId: string; itemIndex: number; done: boolean }): Promise<StudyResult<StudyPlanRecord>> {
  try {
    const plan = await db.studyPlan.findUnique({ where: { id: opts.planId } })
    if (!plan) {
      return { ok: false, error: "not_found", message: `❌ الخطة غير موجودة / plan not found: ${opts.planId}` }
    }
    const items = safeParse<StudyPlanRecord["items"]>(plan.items, [])
    if (opts.itemIndex < 0 || opts.itemIndex >= items.length) {
      return { ok: false, error: "bad_index", message: `❌ فهرس غير صالح / invalid item index: ${opts.itemIndex}` }
    }
    items[opts.itemIndex].done = opts.done
    const completedMinutes = items.filter((i) => i.done).reduce((s, i) => s + i.durationMin, 0)
    const row = await db.studyPlan.update({
      where: { id: opts.planId },
      data: {
        items: JSON.stringify(items),
        completedMinutes,
      },
    })
    // Update learning progress
    if (plan.courseId) {
      await updateProgressOnStudy(plan.courseId, opts.done ? items[opts.itemIndex].durationMin : -items[opts.itemIndex].durationMin)
    }
    return { ok: true, data: studyPlanRowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "progress_failed",
      message: `❌ فشل تحديث التقدم / progress failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

async function updateProgressOnStudy(courseId: string | null, minutesDelta: number): Promise<void> {
  if (!courseId) return
  try {
    const existing = await db.learningProgress.findFirst({ where: { courseId } })
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (existing) {
      const lastDate = existing.lastStudyDate ? new Date(existing.lastStudyDate) : null
      if (lastDate) lastDate.setHours(0, 0, 0, 0)
      let newStreak = existing.currentStreak
      let newLongest = existing.longestStreak
      if (minutesDelta > 0) {
        if (lastDate && lastDate.getTime() === today.getTime()) {
          // Same day — no streak change
        } else if (lastDate && today.getTime() - lastDate.getTime() === 86400000) {
          // Consecutive day
          newStreak = existing.currentStreak + 1
        } else {
          // Streak broken
          newStreak = 1
        }
        newLongest = Math.max(newLongest, newStreak)
      }
      await db.learningProgress.update({
        where: { id: existing.id },
        data: {
          totalStudyMinutes: { increment: minutesDelta },
          currentStreak: newStreak,
          longestStreak: newLongest,
          lastStudyDate: new Date(),
        },
      })
    }
  } catch { /* best-effort */ }
}

export async function studyPlanList(opts: { courseId?: string; type?: string; limit?: number } = {}): Promise<StudyResult<StudyPlanRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.courseId) where.courseId = opts.courseId
    if (opts.type) where.type = opts.type
    const rows = await db.studyPlan.findMany({ where, orderBy: { createdAt: "desc" }, take: opts.limit ?? 50 })
    return { ok: true, data: rows.map(studyPlanRowToRecord) }
  } catch (e) {
    return { ok: false, error: "list_failed", message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 12. Citation Create — APA/MLA/Chicago/IEEE/BibTeX
// ---------------------------------------------------------------------------

export interface CitationInput {
  style?: CitationStyle
  authors: string[]
  title: string
  year?: number
  journal?: string
  volume?: string
  issue?: string
  pages?: string
  publisher?: string
  url?: string
  doi?: string
  tags?: string[]
}

function formatCitation(style: CitationStyle, input: CitationInput): string {
  const authorsStr = input.authors.length === 0 ? "Unknown" : input.authors.join(", ")
  const yearStr = input.year ? String(input.year) : "n.d."
  switch (style) {
    case "apa":
      // Author, A. A. (Year). Title. Journal, vol(issue), pages.
      return `${authorsStr} (${yearStr}). ${input.title}.${input.journal ? ` ${input.journal},` : ""}${input.volume ? ` ${input.volume}` : ""}${input.issue ? `(${input.issue})` : ""}${input.pages ? `, ${input.pages}` : ""}.${input.url ? ` ${input.url}` : ""}`
    case "mla":
      // Author. "Title." Journal, vol, no. issue, year, pp. pages.
      return `${authorsStr}. "${input.title}." ${input.journal ?? ""}${input.volume ? `, vol. ${input.volume}` : ""}${input.issue ? `, no. ${input.issue}` : ""}, ${yearStr}${input.pages ? `, pp. ${input.pages}` : ""}.${input.url ? ` ${input.url}.` : ""}`
    case "chicago":
      // Author. "Title." Journal vol, no. issue (year): pages.
      return `${authorsStr}. "${input.title}." ${input.journal ?? ""} ${input.volume ?? ""}${input.issue ? `, no. ${input.issue}` : ""} (${yearStr})${input.pages ? `: ${input.pages}` : ""}.${input.url ? ` ${input.url}.` : ""}`
    case "ieee":
      // A. Author, "Title," Journal, vol. vol, no. issue, pp. pages, year.
      return `${authorsStr}, "${input.title}," ${input.journal ?? ""}${input.volume ? `, vol. ${input.volume}` : ""}${input.issue ? `, no. ${input.issue}` : ""}${input.pages ? `, pp. ${input.pages}` : ""}, ${yearStr}.${input.url ? ` ${input.url}.` : ""}`
    case "bibtex": {
      const key = `${input.authors[0]?.split(" ").slice(-1)[0] ?? "Unknown"}${input.year ?? ""}${input.title.split(" ")[0]?.toLowerCase() ?? ""}`
      return `@article{${key},
  author = {${input.authors.join(" and ")}},
  title = {${input.title}},
  year = {${yearStr}},${input.journal ? `\n  journal = {${input.journal}},` : ""}${input.volume ? `\n  volume = {${input.volume}},` : ""}${input.issue ? `\n  number = {${input.issue}},` : ""}${input.pages ? `\n  pages = {${input.pages}},` : ""}${input.doi ? `\n  doi = {${input.doi}},` : ""}${input.url ? `\n  url = {${input.url}},` : ""}
}`
    }
  }
}

export async function citationCreate(input: CitationInput): Promise<StudyResult<CitationRecord>> {
  try {
    if (!input.title || input.authors.length === 0) {
      return { ok: false, error: "no_input", message: "❌ العنوان والمؤلفون مطلوبان / title + authors required" }
    }
    const style = input.style ?? "apa"
    const text = formatCitation(style, input)
    const bibtexKey = style === "bibtex"
      ? (text.match(/@article\{([^,]+),/)?.[1] ?? null)
      : `${input.authors[0]?.split(" ").slice(-1)[0] ?? "Unknown"}${input.year ?? ""}${input.title.split(" ")[0]?.toLowerCase() ?? ""}`
    const row = await db.citation.create({
      data: {
        style,
        text,
        authors: JSON.stringify(input.authors),
        title: input.title,
        year: input.year ?? null,
        journal: input.journal ?? null,
        volume: input.volume ?? null,
        issue: input.issue ?? null,
        pages: input.pages ?? null,
        publisher: input.publisher ?? null,
        url: input.url ?? null,
        doi: input.doi ?? null,
        bibtexKey,
        tags: JSON.stringify(input.tags ?? []),
      },
    })
    return { ok: true, data: citationRowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "citation_failed",
      message: `❌ فشل الاستشهاد / citation failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function citationList(opts: { style?: CitationStyle; year?: number; limit?: number } = {}): Promise<StudyResult<CitationRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.style) where.style = opts.style
    if (opts.year) where.year = opts.year
    const rows = await db.citation.findMany({ where, orderBy: { createdAt: "desc" }, take: opts.limit ?? 100 })
    return { ok: true, data: rows.map(citationRowToRecord) }
  } catch (e) {
    return { ok: false, error: "list_failed", message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 13. Bibliography Generate — from citation IDs
// ---------------------------------------------------------------------------

export async function bibliographyGenerate(opts: { citationIds: string[]; style?: CitationStyle }): Promise<StudyResult<{ bibliography: string; count: number }>> {
  try {
    if (!opts.citationIds || opts.citationIds.length === 0) {
      return { ok: false, error: "no_ids", message: "❌ لا معرفات / no citation IDs provided" }
    }
    const citations = await db.citation.findMany({ where: { id: { in: opts.citationIds } } })
    // Sort alphabetically by first author
    citations.sort((a, b) => {
      const aAuthor = safeParse<string[]>(a.authors, [])[0] ?? ""
      const bAuthor = safeParse<string[]>(b.authors, [])[0] ?? ""
      return aAuthor.localeCompare(bAuthor)
    })
    // If style override, re-format all
    const style = opts.style
    const lines = citations.map((c) => {
      if (style && c.style !== style) {
        return formatCitation(style, {
          authors: safeParse<string[]>(c.authors, []),
          title: c.title ?? "",
          year: c.year ?? undefined,
          journal: c.journal ?? undefined,
          volume: c.volume ?? undefined,
          issue: c.issue ?? undefined,
          pages: c.pages ?? undefined,
          publisher: c.publisher ?? undefined,
          url: c.url ?? undefined,
          doi: c.doi ?? undefined,
        })
      }
      return c.text
    })
    const bibliography = lines.join("\n\n")
    return { ok: true, data: { bibliography, count: citations.length } }
  } catch (e) {
    return {
      ok: false,
      error: "bibliography_failed",
      message: `❌ فشل المراجع / bibliography failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 14. Paper Summarize — abstract + key findings
// ---------------------------------------------------------------------------

export interface PaperInput {
  title: string
  authors?: string[]
  year?: number
  abstract?: string
  pdfPath?: string
}

export async function paperSummarize(input: PaperInput): Promise<StudyResult<PaperRecord>> {
  try {
    if (!input.title) {
      return { ok: false, error: "no_title", message: "❌ العنوان مطلوب / title required" }
    }
    let abstract = input.abstract
    if (!abstract && input.pdfPath) {
      const abs = path.isAbsolute(input.pdfPath) ? input.pdfPath : path.resolve(WORKSPACE_ROOT, input.pdfPath)
      if (existsSync(abs)) {
        const buffer = await readFile(abs)
        const rawText = buffer.toString("latin1")
        const matches = rawText.match(/\(([^)]*)\)\s*Tj/g) ?? []
        abstract = matches.map((m) => m.match(/\(([^)]*)\)/)?.[1] ?? "").join(" ").slice(0, 2000)
      }
    }
    // Heuristic key findings: sentences with "we found", "results show", "demonstrates"
    const text = abstract ?? ""
    const findingSentences = text.split(/(?<=[.!?])\s+/).filter((s) =>
      /we found|results show|demonstrat|significan|novel|first time|propose|introduce/i.test(s)
    )
    const keyFindings = findingSentences.slice(0, 5).map((s) => ({
      finding: s.trim(),
      evidence: "from abstract",
      significance: "tbd",
    }))
    // Heuristic summary: first 2 sentences of abstract
    const sentences = text.split(/(?<=[.!?])\s+/)
    const summary = sentences.slice(0, 2).join(" ") || text.slice(0, 300)
    // Sections: extract from abstract
    const sections: Record<string, string> = {
      abstract: text,
      methodology: "",
      results: findingSentences.join(" "),
      conclusion: sentences.slice(-2).join(" "),
    }
    const row = await db.paper.create({
      data: {
        title: input.title,
        authors: JSON.stringify(input.authors ?? []),
        year: input.year ?? null,
        abstract: abstract ?? null,
        pdfPath: input.pdfPath ?? null,
        summary,
        keyFindings: JSON.stringify(keyFindings),
        sections: JSON.stringify(sections),
        tags: JSON.stringify(["paper"]),
      },
    })
    return { ok: true, data: paperRowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "summarize_failed",
      message: `❌ فشل تلخيص الورقة / paper summarize failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function paperList(opts: { year?: number; limit?: number } = {}): Promise<StudyResult<PaperRecord[]>> {
  try {
    const where: Record<string, unknown> = {}
    if (opts.year) where.year = opts.year
    const rows = await db.paper.findMany({ where, orderBy: { createdAt: "desc" }, take: opts.limit ?? 50 })
    return { ok: true, data: rows.map(paperRowToRecord) }
  } catch (e) {
    return { ok: false, error: "list_failed", message: `❌ فشل السرد / list failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------------------------------------------------------
// 15. Cross-Paper Comparison
// ---------------------------------------------------------------------------

export async function paperCompare(opts: { paperIds: string[] }): Promise<StudyResult<{
  papers: PaperRecord[]
  comparison: {
    similarities: string[]
    differences: string[]
    methodsCompared: Record<string, string[]>
    yearsSpan: { min: number; max: number }
    commonAuthors: string[]
  }
}>> {
  try {
    if (!opts.paperIds || opts.paperIds.length < 2) {
      return { ok: false, error: "need_two", message: "❌ تحتاج ورقتين على الأقل / need at least 2 papers" }
    }
    const papers = await db.paper.findMany({ where: { id: { in: opts.paperIds } } })
    if (papers.length < 2) {
      return { ok: false, error: "not_found", message: "❌ لم يتم العثور على بعض الأوراق / some papers not found" }
    }
    const records = papers.map(paperRowToRecord)
    // Compare years
    const years = records.map((p) => p.year).filter((y): y is number => y !== null)
    const yearsSpan = years.length > 0 ? { min: Math.min(...years), max: Math.max(...years) } : { min: 0, max: 0 }
    // Common authors
    const authorSets = records.map((p) => new Set(p.authors))
    const commonAuthors = records[0].authors.filter((a) => authorSets.every((s) => s.has(a)))
    // Methods comparison
    const methodsCompared: Record<string, string[]> = {}
    for (const p of records) {
      const method = p.sections.methodology || p.sections.abstract?.slice(0, 200) || "(no method)"
      methodsCompared[p.title.slice(0, 40)] = [method]
    }
    // Similarities: shared keywords in titles + abstracts
    const allTexts = records.map((p) => `${p.title} ${p.abstract ?? ""}`.toLowerCase())
    const wordFreq: Record<string, number> = {}
    for (const t of allTexts) {
      const words = t.split(/\s+/).filter((w) => w.length > 5)
      for (const w of new Set(words)) {
        wordFreq[w] = (wordFreq[w] ?? 0) + 1
      }
    }
    const similarities = Object.entries(wordFreq)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([w]) => w)
    // Differences: unique keywords per paper
    const differences: string[] = []
    records.forEach((p, i) => {
      const otherTexts = allTexts.filter((_, j) => j !== i).join(" ")
      const myWords = new Set(allTexts[i].split(/\s+/).filter((w) => w.length > 6))
      const unique = Array.from(myWords).filter((w) => !otherTexts.includes(w)).slice(0, 5)
      if (unique.length > 0) differences.push(`${p.title.slice(0, 40)}: ${unique.join(", ")}`)
    })
    return {
      ok: true,
      data: {
        papers: records,
        comparison: {
          similarities,
          differences,
          methodsCompared,
          yearsSpan,
          commonAuthors,
        },
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "compare_failed",
      message: `❌ فشل المقارنة / comparison failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// 16. Learning Progress — get/update + streak
// ---------------------------------------------------------------------------

export async function learningProgressGet(opts: { courseId?: string }): Promise<StudyResult<LearningProgressRecord>> {
  try {
    let row = await db.learningProgress.findFirst({ where: { courseId: opts.courseId ?? null } })
    if (!row) {
      row = await db.learningProgress.create({
        data: { courseId: opts.courseId ?? null },
      })
    }
    return { ok: true, data: progressRowToRecord(row) }
  } catch (e) {
    return {
      ok: false,
      error: "progress_failed",
      message: `❌ فشل قراءة التقدم / progress failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function learningProgressUpdate(opts: { courseId?: string; progress?: number; topicProgress?: Record<string, number>; skills?: Record<string, number> }): Promise<StudyResult<LearningProgressRecord>> {
  try {
    let row = await db.learningProgress.findFirst({ where: { courseId: opts.courseId ?? null } })
    if (!row) {
      row = await db.learningProgress.create({ data: { courseId: opts.courseId ?? null } })
    }
    const currentTopic = safeParse<Record<string, number>>(row.topicProgress, {})
    const currentSkills = safeParse<Record<string, number>>(row.skills, {})
    const data: Record<string, unknown> = {}
    if (opts.progress !== undefined) data.progress = opts.progress
    if (opts.topicProgress) data.topicProgress = JSON.stringify({ ...currentTopic, ...opts.topicProgress })
    if (opts.skills) data.skills = JSON.stringify({ ...currentSkills, ...opts.skills })
    const updated = await db.learningProgress.update({ where: { id: row.id }, data })
    return { ok: true, data: progressRowToRecord(updated) }
  } catch (e) {
    return {
      ok: false,
      error: "update_failed",
      message: `❌ فشل التحديث / update failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface StudySnapshot {
  totalCourses: number
  activeCourses: number
  totalLectureNotes: number
  totalFlashcards: number
  dueFlashcards: number
  totalQuizzes: number
  totalQuizAttempts: number
  totalStudyPlans: number
  totalCitations: number
  totalPapers: number
  currentStreak: number
  longestStreak: number
  totalStudyMinutes: number
}

export async function studySnapshot(): Promise<StudyResult<StudySnapshot>> {
  try {
    const courses = await db.course.findMany()
    const notes = await db.lectureNote.findMany()
    const flashcards = await db.flashcard.findMany()
    const dueFlashcards = flashcards.filter((f) => f.nextReview && f.nextReview <= new Date()).length
    const quizzes = await db.quiz.findMany()
    const attempts = await db.quizAttempt.findMany()
    const plans = await db.studyPlan.findMany()
    const citations = await db.citation.findMany()
    const papers = await db.paper.findMany()
    const progress = await db.learningProgress.findMany()
    const currentStreak = Math.max(0, ...progress.map((p) => p.currentStreak))
    const longestStreak = Math.max(0, ...progress.map((p) => p.longestStreak))
    const totalStudyMinutes = progress.reduce((s, p) => s + p.totalStudyMinutes, 0)
    return {
      ok: true,
      data: {
        totalCourses: courses.length,
        activeCourses: courses.filter((c) => c.status === "active").length,
        totalLectureNotes: notes.length,
        totalFlashcards: flashcards.length,
        dueFlashcards,
        totalQuizzes: quizzes.length,
        totalQuizAttempts: attempts.length,
        totalStudyPlans: plans.length,
        totalCitations: citations.length,
        totalPapers: papers.length,
        currentStreak,
        longestStreak,
        totalStudyMinutes,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: "snapshot_failed",
      message: `❌ فشل اللقطة / snapshot failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

export function formatStudyResult<T>(result: StudyResult<T>): string {
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
