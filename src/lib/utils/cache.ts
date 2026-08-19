// Cache Utility — in-memory cache with TTL + hit/miss stats.
// Adapted from mehani-lms.

interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number
}

interface CacheStats {
  hits: number
  misses: number
  size: number
  hitRate: string
}

class MemoryCache {
  private cache = new Map<string, CacheEntry<unknown>>()
  private stats = { hits: 0, misses: 0 }

  set<T>(key: string, data: T, ttl: number = 60000): void {
    this.cache.set(key, { data, timestamp: Date.now(), ttl })
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key)
    if (!entry) {
      this.stats.misses++
      return null
    }
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key)
      this.stats.misses++
      return null
    }
    this.stats.hits++
    return entry.data as T
  }

  has(key: string): boolean {
    return this.get(key) !== null
  }

  delete(key: string): void {
    this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
    this.stats = { hits: 0, misses: 0 }
  }

  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      size: this.cache.size,
      hitRate: total > 0 ? `${Math.round((this.stats.hits / total) * 100)}%` : "0%",
    }
  }
}

export const cache = new MemoryCache()
