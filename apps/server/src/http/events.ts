import { roleAllows } from '@pave/schema'
import { streamSSE } from 'hono/streaming'
import { badRequest, forbidden } from '../errors'
import type { ServerEvent } from '../events'
import type { App } from './types'

const HEARTBEAT_MS = 20_000
const CLIENT_ID = /^[A-Za-z0-9_-]{1,64}$/

/**
 * `GET /api/events[?client=<id>]` — the caller's org events as server-sent events, named by
 * `type`, plus events addressed to the caller. `client` names the studio window, so requests
 * meant for it (`client.request`) reach it; while the stream is open the window counts as present.
 */
export function mountEvents(app: App) {
  app.get('/api/events', (c) => {
    const ctx = c.var.ctx
    // The stream carries whole design changes: it needs the role every query needs.
    if (!roleAllows(ctx.role, 'viewer')) throw forbidden('Live updates need the viewer role')
    const clientId = c.req.query('client') ?? null
    if (clientId !== null && !CLIENT_ID.test(clientId))
      throw badRequest('`client` must be 1–64 letters, digits, - or _')
    return streamSSE(c, async (stream) => {
      const queue: ServerEvent[] = []
      let wake: (() => void) | null = null
      const unsubscribe = ctx.events.subscribe(
        ctx.orgId,
        (event) => {
          queue.push(event)
          wake?.()
        },
        { userId: ctx.user.id, clientId },
      )
      const heartbeat = setInterval(() => wake?.(), HEARTBEAT_MS)
      let open = true
      stream.onAbort(() => {
        open = false
        wake?.()
      })
      try {
        await stream.writeSSE({ event: 'ready', data: JSON.stringify({ orgId: ctx.orgId }) })
        while (open) {
          const event = queue.shift()
          if (event) await stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
          else {
            await new Promise<void>((resolve) => {
              wake = resolve
            })
            wake = null
            if (open && queue.length === 0) await stream.writeSSE({ event: 'ping', data: '' })
          }
        }
      } finally {
        clearInterval(heartbeat)
        unsubscribe()
      }
    })
  })
}
