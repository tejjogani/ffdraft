/**
 * A person's hand on the piece pauses its AI job. When a person commits a change to a piece
 * while a job is working on it, the job stops where it is (its own edits stay), so the two never
 * fight over the design; Resume replans from the piece as the person left it, and the overlap
 * check in the loop keeps their edit if the job comes back to the same feature.
 *
 * Runs off the request path, after the commit, like the feedback hook.
 */
import type { ServerEvent } from '@pave/schema'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import * as t from '../db/schema'
import type { Runtime } from '../runtime'
import { serviceContext } from '../service-context'
import type { AssistantService } from '../services'

type Changed = Extract<ServerEvent, { type: 'design.changed' }>

export class JobWatch {
  readonly #runtime: Runtime
  readonly #assistant: Pick<AssistantService, 'pause'>
  readonly #pending = new Set<Promise<void>>()
  readonly #off: () => void

  constructor(runtime: Runtime, assistant: Pick<AssistantService, 'pause'>) {
    this.#runtime = runtime
    this.#assistant = assistant
    this.#off = runtime.events.subscribeAll((orgId, event) => {
      if (event.type !== 'design.changed' || event.change.actor.type !== 'user') return
      const p = this.#pauseJobs(orgId, event).catch((err) =>
        console.error('Pausing an AI job after an edit failed:', err),
      )
      this.#pending.add(p)
      void p.finally(() => this.#pending.delete(p))
    })
  }

  /** Waits for pauses in flight (tests, shutdown). */
  async idle(): Promise<void> {
    await Promise.allSettled([...this.#pending])
  }

  async dispose(): Promise<void> {
    this.#off()
    await this.idle()
  }

  async #pauseJobs(orgId: string, event: Changed): Promise<void> {
    if (event.change.actor.type !== 'user') return
    const ctx = await this.#runtime.context({ userId: event.change.actor.id, orgId })
    const working = await ctx.repo.runs.many({
      where: and(
        eq(t.agentRun.pieceId, event.pieceId),
        inArray(t.agentRun.status, ['running', 'awaiting-approval', 'waiting']),
        isNotNull(t.agentRun.job),
      )!,
    })
    for (const run of working) {
      // The job is paused as its own user, who owns the run (a teammate's edit pauses it too).
      const owner = await this.#runtime.context({ userId: run.userId, orgId })
      await this.#assistant.pause(run.id, 'edit', serviceContext(owner))
    }
  }
}
