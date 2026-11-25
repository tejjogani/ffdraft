/**
 * `GET /api/runs/:id/events[?after=<seq>]` — one run as it happens, as server-sent events named
 * by type (`run.started`, `text.delta`, …, `run.finished`). Open only while the run is live (and
 * for a minute after, to catch up): a studio opens it when `run.updated` says a run is running
 * and closes it when the run ends, so it never holds a second connection for nothing. A run that
 * is not live here answers 204; `threads.get` and `traces.run` have its whole story.
 *
 * Scoped like `traces.run`: the run must be in the caller's organisation (another org's run is
 * not found) and be their own, unless they are an admin or owner.
 */
import { type RunEvent, roleAllows } from '@pave/schema'
import type { MiddlewareHandler } from 'hono'
import { streamSSE } from 'hono/streaming'
import { badRequest, notFound } from '../errors'
import type { App, Env } from '../http/types'
import { getRun } from '../lookups'
import type { Driver } from './driver'

const HEARTBEAT_MS = 15_000

export function mountRunEvents(app: App, driver: Driver, withCtx: MiddlewareHandler<Env>): void {
  app.use('/api/runs/*', withCtx)
  app.get('/api/runs/:id/events', async (c) => {
    const ctx = c.var.ctx
    const runId = c.req.param('id')
    const run = await getRun(ctx, runId)
    if (run.userId !== ctx.user.id && !roleAllows(ctx.role, 'admin')) throw notFound('Run', runId)
    const afterRaw = c.req.query('after') ?? c.req.header('last-event-id') ?? '0'
    if (!/^\d{1,9}$/.test(afterRaw)) throw badRequest('`after` must be a whole number')
    const after = Number(afterRaw)

    const queue: RunEvent[] = []
    let closed = false
    let wake: (() => void) | null = null
    const sub = driver.subscribe(runId, after, {
      event: (e) => {
        queue.push(e)
        wake?.()
      },
      close: () => {
        closed = true
        wake?.()
      },
    })
    if (!sub) return c.body(null, 204)
    queue.unshift(...sub.backlog)
    if (!sub.live) closed = true

    return streamSSE(c, async (stream) => {
      let open = true
      stream.onAbort(() => {
        open = false
        wake?.()
      })
      const heartbeat = setInterval(() => wake?.(), HEARTBEAT_MS)
      try {
        while (open) {
          const event = queue.shift()
          if (event) {
            await stream.writeSSE({
              id: String(event.seq),
              event: event.type,
              data: JSON.stringify(event),
            })
            continue
          }
          if (closed) break
          await new Promise<void>((resolve) => {
            wake = resolve
          })
          wake = null
          if (open && !closed && queue.length === 0)
            await stream.writeSSE({ event: 'ping', data: '' })
        }
      } finally {
        clearInterval(heartbeat)
        sub.unsubscribe()
      }
    })
  })
}
