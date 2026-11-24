import { serve } from '@hono/node-server'
import { createApp } from './app'
import { compose } from './compose'

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
const shutdown = () => {
  if (closing) return
  closing = true
  http.close(() => void server.close().then(() => process.exit(0)))
  // SSE streams keep connections open; don't wait on them forever.
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
