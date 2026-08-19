// Event Bus — typed event emitter with SSE replay buffer.
// Adapted from my-nextjs-project.

interface MiMoEvent {
  type: string
  data?: Record<string, unknown>
  ts: number
}

type AsyncEventHandler = (event: MiMoEvent) => void | Promise<void>

class EventBus {
  private handlers = new Map<string, Set<AsyncEventHandler>>()
  private wildcardHandlers = new Set<AsyncEventHandler>()
  private outbox: MiMoEvent[] = []
  private readonly MAX_OUTBOX = 100

  on(type: string, handler: AsyncEventHandler): () => void {
    if (type === "*") {
      this.wildcardHandlers.add(handler)
      return () => this.wildcardHandlers.delete(handler)
    }
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type)!.add(handler)
    return () => this.handlers.get(type)?.delete(handler)
  }

  async emit(event: MiMoEvent): Promise<void> {
    const handlers = this.handlers.get(event.type)
    const all = [...(handlers ?? []), ...this.wildcardHandlers]
    await Promise.all(all.map(h => Promise.resolve(h(event)).catch(() => {})))
    this.outbox.push({ ...event, ts: Date.now() })
    if (this.outbox.length > this.MAX_OUTBOX) this.outbox.shift()
  }

  getOutbox(): MiMoEvent[] {
    return [...this.outbox]
  }

  clearOutbox(): void {
    this.outbox = []
  }
}

export const eventBus = new EventBus()
export type { MiMoEvent }
