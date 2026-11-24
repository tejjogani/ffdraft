import type { EventAudience, JobKind, ServerEvent } from '@pave/schema'

export type { EventAudience, JobKind, ServerEvent }

type Listener = (event: ServerEvent) => void
/** Sees every org-wide event of every org, e.g. the assistant's post-commit feedback detection. */
type GlobalListener = (orgId: string, event: ServerEvent) => void

interface Subscriber {
  listener: Listener
  /** Null for in-process listeners, which only see org-wide events. */
  userId: string | null
  /** The studio window (`/api/events?client=<id>`), when it said which it is. */
  clientId: string | null
}

/**
 * In-process pub/sub. One server process owns its subscribers; events never cross orgs. An event
 * may be addressed to one user: then it reaches that user's window `clientId` when it is
 * connected, otherwise every window of theirs.
 */
export class EventBus {
  readonly #subscribers = new Map<string, Set<Subscriber>>()
  readonly #global = new Set<GlobalListener>()

  /**
   * Delivers `event` and returns how many org subscribers received it. Org-wide events also go
   * to {@link subscribeAll} listeners; events addressed to one user never do.
   */
  publish(orgId: string, event: ServerEvent, to?: EventAudience): number {
    const recipients = this.#recipients(orgId, to)
    for (const s of recipients) s.listener(event)
    if (!to) for (const listener of this.#global) listener(orgId, event)
    return recipients.length
  }

  /**
   * Listens to org-wide events across all orgs — server-side only (it crosses tenants): rebuild
   * a context with `runtime.context` before acting on one. Returns the unsubscribe function.
   */
  subscribeAll(listener: GlobalListener): () => void {
    this.#global.add(listener)
    return () => this.#global.delete(listener)
  }

  /** Whether a targeted event would reach anyone: is the user (or that window) connected? */
  isConnected(orgId: string, to: EventAudience): boolean {
    return this.#recipients(orgId, to).length > 0
  }

  subscribe(
    orgId: string,
    listener: Listener,
    who: { userId: string; clientId?: string | null } | null = null,
  ): () => void {
    const set = this.#subscribers.get(orgId) ?? new Set()
    const sub: Subscriber = {
      listener,
      userId: who?.userId ?? null,
      clientId: who?.clientId ?? null,
    }
    set.add(sub)
    this.#subscribers.set(orgId, set)
    return () => {
      set.delete(sub)
      if (set.size === 0) this.#subscribers.delete(orgId)
    }
  }

  #recipients(orgId: string, to: EventAudience | undefined): Subscriber[] {
    const all = [...(this.#subscribers.get(orgId) ?? [])]
    if (!to) return all
    const theirs = all.filter((s) => s.userId === to.userId)
    const window = to.clientId ? theirs.filter((s) => s.clientId === to.clientId) : []
    return window.length ? window : theirs
  }
}
