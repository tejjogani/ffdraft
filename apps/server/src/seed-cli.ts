/**
 * `pnpm --filter @pave/server seed [--org=<id>]` — creates the welcome workspace on demand:
 * in the local workspace by default, or in the given org (acting as its first owner).
 */
import { parseArgs } from 'node:util'
import { createApp } from './app'
import { seedWelcome } from './seed'

const { values } = parseArgs({ options: { org: { type: 'string' }, user: { type: 'string' } } })
const server = await createApp({ config: { seed: false } })
try {
  const { runtime } = server
  const target =
    values.org && values.user ? { orgId: values.org, userId: values.user } : runtime.local
  if (!target)
    throw new Error('In accounts mode pass --org=<organisation id> --user=<member user id>')
  await seedWelcome(runtime, await runtime.context({ ...target, actor: { type: 'system' } }))
  console.log(`Seeded the welcome workspace into organisation ${target.orgId}`)
} finally {
  await server.close()
}
