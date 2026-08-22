// /api/study — POST (all actions) + GET (list courses/notes/flashcards/quizzes/plans/citations/papers)
import { NextRequest, NextResponse } from "next/server"
import {
  courseCreate, courseList, courseGet,
  lectureNoteCreate, lectureNoteList,
  flashcardGenerate, flashcardList, flashcardReview,
  quizGenerate, quizList, quizGet, quizAttempt,
  questionAnswer, examSimulate,
  studyPlanCreate, studyPlanList, studyPlanProgress,
  citationCreate, citationList, bibliographyGenerate,
  paperSummarize, paperList, paperCompare,
  learningProgressGet, learningProgressUpdate,
} from "@/lib/study/os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      case "course_create": return wrap(await courseCreate(body))
      case "course_get": return wrap(await courseGet(body.id))
      case "lecture_note_create": return wrap(await lectureNoteCreate(body))
      case "flashcard_generate": return wrap(await flashcardGenerate(body))
      case "flashcard_review": return wrap(await flashcardReview(body.flashcardId, body.quality))
      case "quiz_generate": return wrap(await quizGenerate(body))
      case "quiz_get": return wrap(await quizGet(body.id))
      case "quiz_attempt": return wrap(await quizAttempt(body))
      case "question_answer": return wrap(await questionAnswer(body))
      case "exam_simulate": return wrap(await examSimulate(body))
      case "study_plan_create": return wrap(await studyPlanCreate(body))
      case "study_plan_progress": return wrap(await studyPlanProgress(body))
      case "citation_create": return wrap(await citationCreate(body))
      case "bibliography_generate": return wrap(await bibliographyGenerate(body))
      case "paper_summarize": return wrap(await paperSummarize(body))
      case "paper_compare": return wrap(await paperCompare(body))
      case "progress_get": return wrap(await learningProgressGet(body))
      case "progress_update": return wrap(await learningProgressUpdate(body))
      default: return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const mode = sp.get("mode") ?? "courses"
    switch (mode) {
      case "courses": return wrap(await courseList({ status: sp.get("status") as never, semester: sp.get("semester") ?? undefined, limit: sp.get("limit") ? Number(sp.get("limit")) : undefined }))
      case "notes": return wrap(await lectureNoteList({ courseId: sp.get("courseId") ?? undefined, weekNumber: sp.get("weekNumber") ? Number(sp.get("weekNumber")) : undefined, limit: sp.get("limit") ? Number(sp.get("limit")) : undefined }))
      case "flashcards": return wrap(await flashcardList({ courseId: sp.get("courseId") ?? undefined, lectureNoteId: sp.get("lectureNoteId") ?? undefined, dueOnly: sp.get("dueOnly") === "true", limit: sp.get("limit") ? Number(sp.get("limit")) : undefined }))
      case "quizzes": return wrap(await quizList({ courseId: sp.get("courseId") ?? undefined, lectureNoteId: sp.get("lectureNoteId") ?? undefined, limit: sp.get("limit") ? Number(sp.get("limit")) : undefined }))
      case "plans": return wrap(await studyPlanList({ courseId: sp.get("courseId") ?? undefined, type: sp.get("type") ?? undefined, limit: sp.get("limit") ? Number(sp.get("limit")) : undefined }))
      case "citations": return wrap(await citationList({ style: sp.get("style") as never, year: sp.get("year") ? Number(sp.get("year")) : undefined, limit: sp.get("limit") ? Number(sp.get("limit")) : undefined }))
      case "papers": return wrap(await paperList({ year: sp.get("year") ? Number(sp.get("year")) : undefined, limit: sp.get("limit") ? Number(sp.get("limit")) : undefined }))
      default: return NextResponse.json({ error: `unknown mode: ${mode}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

function wrap<T>(result: { ok: boolean; data?: T; error?: string; message?: string }) {
  if (result.ok) {
    return NextResponse.json(result.data)
  }
  return NextResponse.json({ error: result.error, message: result.message }, { status: 400 })
}
