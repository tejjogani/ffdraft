import { streamSSE } from 'hono/streaming'
import type { ServerEvent } from '../events'
import type { App } from './types'

const HEARTBEAT_MS = 20_000

/** `GET /api/events` — the caller's org events as server-sent events, named by `type`. */
export function mountEvents(app: App) {
  app.get('/api/events', (c) => {
    const ctx = c.var.ctx
    return streamSSE(c, async (stream) => {
      const queue: ServerEvent[] = []
      let wake: (() => void) | null = null
      const unsubscribe = ctx.events.subscribe(ctx.orgId, (event) => {
        queue.push(event)
        wake?.()
      })
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
