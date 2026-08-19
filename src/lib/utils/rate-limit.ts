// Rate Limiter — in-memory per-IP limiter.
// Adapted from mimo-ai.

const RATE_LIMIT_WINDOW_MS = 60_000

export const RATE_LIMITS = {
  chat: 10,
  write: 30,
  read: 60,
  build: 5,
} as const

interface RateLimitEntry {
  count: number
  resetAt: number
}

const limitMaps = new Map<string, Map<string, RateLimitEntry>>()

export function checkRateLimit(
  endpoint: keyof typeof RATE_LIMITS,
  ip: string
): { allowed: boolean; remaining: number; resetAt: number } {
  const limit = RATE_LIMITS[endpoint]
  const key = `${endpoint}:${ip}`
  
  if (!limitMaps.has(endpoint)) {
    limitMaps.set(endpoint, new Map())
  }
  
  const map = limitMaps.get(endpoint)!
  const now = Date.now()
  let entry = map.get(key)
  
  if (!entry || now > entry.resetAt) {
    entry = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS }
    map.set(key, entry)
    return { allowed: true, remaining: limit - 1, resetAt: entry.resetAt }
  }
  
  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt }
  }
  
  entry.count++
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt }
}

// Cleanup expired entries periodically
setInterval(() => {
  const now = Date.now()
  for (const map of limitMaps.values()) {
    for (const [key, entry] of map) {
      if (now > entry.resetAt) map.delete(key)
    }
  }
}, 60_000).unref?.()
