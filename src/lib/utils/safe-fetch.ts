// Safe Fetch — handles server down or HTML instead of JSON.
// Prevents "Unexpected token '<'" errors.
// Adapted from mimo-ai.

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

export async function safeFetch(url: string, options?: RequestInit): Promise<Response> {
  try {
    const res = await fetch(url, options)
    if (!res.ok && res.status >= 500) {
      throw new ApiError(`Server error: ${res.status}`, res.status, true)
    }
    return res
  } catch (err) {
    if (err instanceof TypeError) {
      throw new ApiError("Server is down or unreachable", 0, true)
    }
    throw err
  }
}

export async function safeJson<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const res = await safeFetch(url, options)
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    if (text.startsWith("<") || text.startsWith("<!DOCTYPE")) {
      throw new ApiError("Server returned HTML instead of JSON (likely an error page)", res.status, true)
    }
    throw new ApiError(`Invalid JSON response: ${text.slice(0, 100)}`, res.status)
  }
}
