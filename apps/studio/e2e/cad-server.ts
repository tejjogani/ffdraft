/**
 * The real Pavé server for the Design-tab checks (`cad.ts`): local mode on a throwaway data dir,
 * plus one test-only route that commits a design change as an assistant run, so a remote agent
 * edit can be watched arriving over SSE.
 *
 *   PAVE_DATA_DIR=$(mktemp -d) tsx apps/studio/e2e/cad-server.ts
 */
import { createRequire } from 'node:module'
import { createApp } from '../../server/src/app'
import { startRun } from '../../server/src/traces'

// The HTTP adapter is the server package's dependency, not the studio's.
const { serve } = createRequire(new URL('../../server/package.json', import.meta.url))(
  '@hono/node-server',
) as typeof import('@hono/node-server')

const server = await createApp({
  routes: (app, runtime) => {
    app.post('/__agent/apply', async (c) => {
      const body = (await c.req.json()) as { pieceId: string; label: string; ops: unknown[] }
      const local = runtime.local
      if (!local) return c.json({ error: 'local mode only' }, 400)
      const run = await startRun(await runtime.context(local), {
        model: 'e2e',
        pieceId: body.pieceId,
      })
      const ctx = await runtime.context({
        ...local,
        actor: { type: 'agent', runId: run.id, model: 'e2e' },
      })
      const result = await runtime.execute(
        'design.apply',
        { pieceId: body.pieceId, label: body.label, ops: body.ops },
        ctx,
      )
      return c.json({ runId: run.id, result })
    })
  },
})
const port = Number(process.env.PORT ?? 8787)
serve({ fetch: server.app.fetch, port, hostname: '127.0.0.1' }, () =>
  console.log(`Pavé e2e server on http://127.0.0.1:${port}`),
)
