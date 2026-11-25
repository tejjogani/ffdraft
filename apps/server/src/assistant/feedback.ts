/**
 * The feedback hook: after a person commits a change, did it correct or remove what an assistant
 * run did to the piece shortly before? Runs after the commit, off the request path (like the
 * facts refresh), and records what it finds as implicit feedback on the run. Undo is recorded
 * exactly by `design.revert` itself, not here.
 */
import { detectFeedback, FEEDBACK_WINDOW } from '@pave/agent'
import type { ServerEvent } from '@pave/schema'
import { and, asc, eq, gte, lte } from 'drizzle-orm'
import * as t from '../db/schema'
import { toStoredChange } from '../design'
import { createId } from '../ids'
import type { Runtime } from '../runtime'

type Changed = Extract<ServerEvent, { type: 'design.changed' }>

export class FeedbackHook {
  readonly #runtime: Runtime
  readonly #pending = new Set<Promise<void>>()
  readonly #off: () => void

  constructor(runtime: Runtime) {
    this.#runtime = runtime
    this.#off = runtime.events.subscribeAll((orgId, event) => {
      if (event.type !== 'design.changed' || event.change.actor.type !== 'user') return
      const p = this.#detect(orgId, event).catch((err) =>
        console.error('Reading feedback from an edit failed:', err),
      )
      this.#pending.add(p)
      void p.finally(() => this.#pending.delete(p))
    })
  }

  /** Waits for detections in flight (tests, shutdown). */
  async idle(): Promise<void> {
    await Promise.allSettled([...this.#pending])
  }

  async dispose(): Promise<void> {
    this.#off()
    await this.idle()
  }

  async #detect(orgId: string, event: Changed): Promise<void> {
    const actor = event.change.actor
    if (actor.type !== 'user') return
    const ctx = await this.#runtime.context({ userId: actor.id, orgId })
    const rows = await ctx.repo.changes.many({
      where: and(
        eq(t.designChange.pieceId, event.pieceId),
        gte(t.designChange.seq, event.version - FEEDBACK_WINDOW),
        lte(t.designChange.seq, event.version),
      ),
      orderBy: asc(t.designChange.seq),
    })
    const changes = rows.map(toStoredChange)
    const found = rows.flatMap((row, i) =>
      row.runId && row.seq < event.version
        ? detectFeedback(changes[i]!, changes.slice(i + 1))
            // Only what this change says: earlier changes were judged when they were made.
            .filter((f) => f.byChangeId === event.change.id)
            .map((f) => ({ ...f, runId: row.runId! }))
        : [],
    )
    if (!found.length) return
    await ctx.repo.feedback.insertMany(
      found.map((f) => ({
        id: createId('fb'),
        runId: f.runId,
        source: 'implicit' as const,
        kind: f.kind,
        changeId: f.changeId,
        note: f.detail,
        userId: actor.id,
      })),
    )
  }
}
