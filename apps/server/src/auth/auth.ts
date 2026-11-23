import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'
import { adminAc, memberAc, ownerAc } from 'better-auth/plugins/organization/access'
import type { Config } from '../config'
import type { Db } from '../db/client'
import * as schema from '../db/schema'
import { createPersonalOrganization } from './workspace'

/**
 * Better Auth with the organization plugin. Pavé's own roles map onto its access control:
 * owners and admins manage the organisation; designers, viewers and guests are plain members
 * whose product permissions are enforced by the command registry (`minimumRole`).
 */
export function createAuth(db: Db, config: Config, secret: string) {
  return betterAuth({
    appName: 'Pavé',
    basePath: '/api/auth',
    baseURL: config.publicUrl,
    secret,
    trustedOrigins: [config.publicUrl, ...config.corsOrigins],
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    emailAndPassword: { enabled: config.auth === 'accounts' },
    telemetry: { enabled: false },
    databaseHooks: {
      user: {
        create: {
          // Everyone gets a workspace of their own, so a session always has an organisation.
          after: async (user) => {
            await createPersonalOrganization(db, { userId: user.id, userName: user.name })
          },
        },
      },
    },
    plugins: [
      organization({
        roles: {
          owner: ownerAc,
          admin: adminAc,
          designer: memberAc,
          viewer: memberAc,
          guest: memberAc,
        },
        creatorRole: 'owner',
        teams: { enabled: false },
      }),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
