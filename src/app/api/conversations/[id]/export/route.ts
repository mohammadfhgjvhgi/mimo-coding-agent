import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface Params { params: Promise<{ id: string }> }

// Export conversation in multiple formats: ?format=md|json|html (default: json)
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const format = req.nextUrl.searchParams.get("format") || "json"

    const conv = await db.conversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    })
    if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const messages = conv.messages.map(m => ({
      role: m.role,
      content: m.content,
      model: m.model,
      tokens: m.tokens,
      thinking: m.thinking,
      toolCalls: m.toolCalls ? JSON.parse(m.toolCalls) : null,
      createdAt: m.createdAt.toISOString(),
    }))

    const baseData = {
      title: conv.title,
      model: conv.model,
      systemPrompt: conv.systemPrompt,
      folder: conv.folder,
      tags: JSON.parse(conv.tags || "[]"),
      createdAt: conv.createdAt.toISOString(),
      updatedAt: conv.updatedAt.toISOString(),
      messages,
    }

    if (format === "json") {
      return new NextResponse(JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        conversation: baseData,
      }, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(conv.title).slice(0, 50)}.json"`,
        },
      })
    }

    if (format === "md") {
      let md = `# ${conv.title}\n\n`
      md += `> Exported from MiMo X on ${new Date().toISOString()}\n`
      md += `> Model: ${conv.model}\n`
      md += `> Messages: ${messages.length}\n\n---\n\n`

      for (const m of messages) {
        const time = new Date(m.createdAt).toLocaleString("ar")
        const roleLabel = m.role === "user" ? "👤 المستخدم" : m.role === "assistant" ? "🤖 المساعد" : `🔧 ${m.role}`
        md += `## ${roleLabel}\n*${time}*\n\n${m.content}\n\n`
        if (m.toolCalls && Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
          md += `<details><summary>Tool Calls (${m.toolCalls.length})</summary>\n\n`
          for (const tc of m.toolCalls) {
            md += `- **${tc.name}**: \`${JSON.stringify(tc.args).slice(0, 100)}\`\n`
          }
          md += "\n</details>\n\n"
        }
      }

      return new NextResponse(md, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(conv.title).slice(0, 50)}.md"`,
        },
      })
    }

    if (format === "html") {
      const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(conv.title)}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", "IBM Plex Sans Arabic", sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; background: #fafaf9; color: #1a1a1a; line-height: 1.7; }
  h1 { color: #0c7a64; border-bottom: 2px solid #0c7a64; padding-bottom: 0.5rem; }
  .meta { color: #666; font-size: 0.85rem; margin-bottom: 2rem; }
  .msg { margin: 1.5rem 0; padding: 1rem; border-radius: 8px; }
  .msg.user { background: #f0fdf4; border-right: 3px solid #10b981; }
  .msg.assistant { background: #f8fafc; border-right: 3px solid #64748b; }
  .msg .role { font-weight: 600; margin-bottom: 0.5rem; font-size: 0.85rem; }
  .msg .time { font-size: 0.7rem; color: #999; }
  .msg pre { background: #1e293b; color: #e2e8f0; padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.8rem; }
  .msg code { background: #e2e8f0; padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.85em; }
  .msg pre code { background: none; padding: 0; }
</style>
</head>
<body>
  <h1>${escapeHtml(conv.title)}</h1>
  <div class="meta">
    <p><strong>Model:</strong> ${escapeHtml(conv.model)} | <strong>Messages:</strong> ${messages.length} | <strong>Exported:</strong> ${new Date().toISOString()}</p>
  </div>
  ${messages.map(m => `
  <div class="msg ${m.role}">
    <div class="role">${m.role === "user" ? "👤 المستخدم" : m.role === "assistant" ? "🤖 المساعد" : "🔧 " + m.role}</div>
    <div class="time">${new Date(m.createdAt).toLocaleString("ar")}</div>
    <div>${escapeHtml(m.content).replace(/\`\`\`(\w*)\n([\s\S]*?)\`\`\`/g, (_, lang, code) => `<pre><code>${escapeHtml(code)}</code></pre>`).replace(/\`([^\`]+)\`/g, "<code>$1</code>")}</div>
  </div>`).join("")}
</body>
</html>`

      return new NextResponse(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(conv.title).slice(0, 50)}.html"`,
        },
      })
    }

    return NextResponse.json({ error: "unsupported format" }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: "Export failed: " + String(e) }, { status: 500 })
  }
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}
