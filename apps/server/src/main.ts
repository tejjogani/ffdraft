import { serve } from '@hono/node-server'
import { createApp } from './app'
import { compose } from './compose'

/**
 * Longest a shutdown may take. Above the engines' own bound (a Blender that ignores its abort is
 * killed after 5 s and waited on for 15 s in all), so they always get to clean up first.
 */
const SHUTDOWN_TIMEOUT_MS = 25_000

const server = await createApp(compose())
const { config } = server.runtime

const http = serve(
  { fetch: server.app.fetch, port: config.port, hostname: config.host },
  (info) => {
    console.log(
      `Pavé server listening on http://${info.address}:${info.port} (${config.auth} mode)`,
    )
  },
)

let closing = false
const shutdown = (signal: string) => {
  if (closing) return
  closing = true
  console.log(`${signal}: shutting down…`)
  setTimeout(() => {
    console.error('Shutdown did not finish in time; exiting anyway.')
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS).unref()
  // Stop accepting, drop open connections (event streams never end on their own), and dispose
  // the engines at once rather than after `close` — which an open stream would hold off for ever.
  http.close()
  if ('closeAllConnections' in http) http.closeAllConnections()
  server.close().then(
    () => process.exit(0),
    (err: unknown) => {
      console.error('Shutting down failed:', err)
      process.exit(1)
    },
  )
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
