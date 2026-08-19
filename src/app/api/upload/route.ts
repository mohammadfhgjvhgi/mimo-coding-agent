import { NextRequest, NextResponse } from "next/server"
import { writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"
import { ingestFile } from "@/lib/knowledge/ingestion"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/upload — handle file upload + auto-ingest into knowledge base
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get("file") as File | null
    const ingest = formData.get("ingest") === "true"

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 })
    }

    // Save to upload/ directory
    const uploadDir = path.join(path.resolve(WORKSPACE_ROOT), "upload")
    mkdirSync(uploadDir, { recursive: true })

    // Sanitize filename
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
    const filePath = path.join(uploadDir, safeName)
    const buffer = Buffer.from(await file.arrayBuffer())
    writeFileSync(filePath, buffer)

    // Optionally ingest into knowledge base
    let ingestResult = null
    if (ingest) {
      try {
        const result = await ingestFile(filePath)
        ingestResult = result
      } catch (e) {
        // Non-fatal — file is saved but not ingested
        ingestResult = { error: "Ingest failed (binary file?)" }
      }
    }

    return NextResponse.json({
      success: true,
      filename: safeName,
      path: `upload/${safeName}`,
      size: file.size,
      type: file.type,
      ingest: ingestResult,
    })
  } catch (e) {
    console.error("[POST /api/upload]", e)
    return NextResponse.json({ error: "Upload failed" }, { status: 500 })
  }
}
