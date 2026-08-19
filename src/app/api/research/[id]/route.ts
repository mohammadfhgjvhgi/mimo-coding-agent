import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface Params { params: Promise<{ id: string }> }

// GET — get research job result
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const job = await db.researchJob.findUnique({ where: { id } })
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 })

    return NextResponse.json({
      job: {
        ...job,
        plan: job.plan ? JSON.parse(job.plan) : [],
        sources: job.sources ? JSON.parse(job.sources) : [],
        findings: job.findings ? JSON.parse(job.findings) : [],
        claims: job.claims ? JSON.parse(job.claims) : [],
        citations: job.citations ? JSON.parse(job.citations) : null,
      },
    })
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

// DELETE — delete a research job
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    await db.researchJob.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
