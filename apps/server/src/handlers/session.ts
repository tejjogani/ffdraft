import { effectiveRole } from '../auth/roles'
import type { Ctx } from '../context'
import type { HandlerGroup } from './types'

/** The deployment's capabilities, with the assistant only where this organisation has a key. */
async function capabilities(ctx: Ctx) {
  const caps = ctx.services.capabilities()
  const assistant = ctx.services.optional('assistant')
  if (caps.assistant && assistant?.available) caps.assistant = await assistant.available(ctx.orgId)
  return caps
}

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
      capabilities: await capabilities(ctx),
    }
  },
}
