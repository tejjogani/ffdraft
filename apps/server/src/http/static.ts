import { existsSync } from 'node:fs'
import { serveStatic } from '@hono/node-server/serve-static'
import type { App } from './types'

/**
 * Serves the built studio, when present, so one process is the whole app. Unknown non-API paths
 * get `index.html` for client-side routing.
 */
export function mountStudio(app: App, dist: string): boolean {
  if (!existsSync(dist)) return false
  app.use('*', serveStatic({ root: dist }))
  app.get('*', async (c, next) => {
    if (c.req.path.startsWith('/api/')) return next()
    return serveStatic({ root: dist, path: 'index.html' })(c, next)
  })
  return true
}
