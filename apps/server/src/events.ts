import type { StoredChange } from '@pave/schema'

export type JobKind = 'render' | 'shot' | 'production'

/** Live, org-scoped notifications streamed to clients over `GET /api/events`. */
export type ServerEvent =
  | { type: 'design.changed'; pieceId: string; version: number; change: StoredChange }
  | { type: 'job.updated'; kind: JobKind; id: string; pieceId: string }
  | { type: 'piece.updated'; pieceId: string }

type Listener = (event: ServerEvent) => void

/** In-process pub/sub. One server process owns its subscribers; events never cross orgs. */
export class EventBus {
  readonly #listeners = new Map<string, Set<Listener>>()

  publish(orgId: string, event: ServerEvent): void {
    for (const listener of this.#listeners.get(orgId) ?? []) listener(event)
  }

  subscribe(orgId: string, listener: Listener): () => void {
    const set = this.#listeners.get(orgId) ?? new Set()
    set.add(listener)
    this.#listeners.set(orgId, set)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.#listeners.delete(orgId)
    }
  }
}
