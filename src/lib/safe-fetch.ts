// ===================================================================
// Safe Fetch — handles server down or HTML instead of JSON.
// Generic version: parses JSON automatically, prevents "Unexpected token '<'".
// Adapted from mimo-ai (merged with workspace's existing version).
// ===================================================================

export class ApiError extends Error {
  status: number
  isServerDown: boolean

  constructor(message: string, status: number = 0, isServerDown: boolean = false) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.isServerDown = isServerDown
  }
}

/**
 * Safe JSON fetch — handles HTML responses, network errors, and server down.
 * Returns the parsed JSON as `T`. Throws `ApiError` on failure.
 */
export async function safeFetch<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  let response: Response

  try {
    response = await fetch(url, options)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error"
    throw new ApiError(
      `Cannot connect to server. Make sure dev server is running (bun run dev). ${msg}`,
      0,
      true
    )
  }

  if (!response.ok) {
    // Try to read error body
    let bodyText = ""
    try {
      bodyText = await response.text()
    } catch {
      /* ignore */
    }

    // Detect server-side error pages (HTML responses)
    const isHtml = bodyText.trimStart().startsWith("<")
    if (response.status >= 500) {
      throw new ApiError(
        isHtml
          ? `Server error ${response.status}: server returned HTML (likely a crash). Check dev server logs.`
          : `Server error ${response.status}: ${bodyText.slice(0, 200) || response.statusText}`,
        response.status,
        true
      )
    }

    // 4xx — try to parse JSON error
    try {
      const errJson = JSON.parse(bodyText)
      throw new ApiError(
        errJson?.error || errJson?.message || `Request failed (${response.status})`,
        response.status,
        false
      )
    } catch (e) {
      if (e instanceof ApiError) throw e
      throw new ApiError(
        isHtml
          ? `Request failed (${response.status}): server returned HTML.`
          : `Request failed (${response.status}): ${bodyText.slice(0, 200) || response.statusText}`,
        response.status,
        isHtml
      )
    }
  }

  // Success — parse JSON. Detect HTML response (server returned a page instead of JSON).
  const contentType = response.headers.get("content-type") || ""
  const text = await response.text()

  if (!contentType.includes("application/json") && text.trimStart().startsWith("<")) {
    throw new ApiError(
      "Server returned HTML instead of JSON. Make sure dev server is running.",
      response.status,
      true
    )
  }

  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiError("Server returned invalid JSON.", response.status, false)
  }
}
