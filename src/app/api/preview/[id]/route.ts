// /api/preview/[id] — Serve artifact content for browser preview.
// Adapted from mimo-life-os. Since we don't have an Artifact model, the
// "id" parameter is `<messageId>_<blockIndex>` and we re-extract the block
// from the assistant message at request time.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { extractCodeBlocks } from "@/lib/agent/code-extractor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // id format: <messageId>_<blockIndex>
  const sepIdx = id.lastIndexOf("_");
  if (sepIdx < 0) {
    return new Response("Invalid artifact id", { status: 400 });
  }
  const messageId = id.slice(0, sepIdx);
  const blockIndex = parseInt(id.slice(sepIdx + 1), 10);

  if (!messageId || Number.isNaN(blockIndex)) {
    return new Response("Invalid artifact id", { status: 400 });
  }

  const message = await db.message.findUnique({
    where: { id: messageId },
    select: { content: true },
  });

  if (!message) {
    return new Response("Artifact not found", { status: 404 });
  }

  const blocks = extractCodeBlocks(message.content);
  const block = blocks[blockIndex];
  if (!block) {
    return new Response("Artifact not found", { status: 404 });
  }

  const format = block.lang.toLowerCase();
  const name = (block.filename ?? `preview.${format}`).toLowerCase();

  let contentType = "text/plain; charset=utf-8";
  let body = block.code;

  if (format === "html" || name.endsWith(".html") || name.endsWith(".htm")) {
    contentType = "text/html; charset=utf-8";
    // Wrap partial HTML
    if (!body.includes("<html") && !body.includes("<!DOCTYPE")) {
      body = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${name}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 2rem; background: #0a0a0a; color: #e5e5e5; }
  * { box-sizing: border-box; }
</style>
</head>
<body>
${body}
</body>
</html>`;
    }
  } else if (format === "svg" || name.endsWith(".svg")) {
    contentType = "image/svg+xml";
  } else if (format === "css" || name.endsWith(".css")) {
    contentType = "text/css; charset=utf-8";
  } else if (format === "javascript" || format === "js" || name.endsWith(".js")) {
    contentType = "application/javascript; charset=utf-8";
  } else if (format === "json" || name.endsWith(".json")) {
    contentType = "application/json; charset=utf-8";
    try {
      body = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      /* leave as-is */
    }
  }

  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
