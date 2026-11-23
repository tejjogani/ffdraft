import { effectiveRole } from '../auth/roles'
import type { HandlerGroup } from './types'

export const session: HandlerGroup<'session'> = {
  'session.get': async (ctx) => {
    const memberships = await ctx.account.memberships()
    return {
      user: ctx.user,
      orgs: memberships.map(({ org, role }) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        logo: org.logo,
        role: effectiveRole(role),
      })),
      activeOrgId: ctx.orgId,
      capabilities: ctx.services.capabilities(),
    }
  },
}
