import { roleAllows } from '@pave/schema'
import { and, eq, ne } from 'drizzle-orm'
import { effectiveRole } from '../auth/roles'
import type { Ctx } from '../context'
import * as t from '../db/schema'
import { conflict, forbidden, notFound } from '../errors'
import { createId } from '../ids'
import type { HandlerGroup } from './types'

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Settings live in one row per org, created with the column defaults on first use. */
async function readSettings(ctx: Ctx) {
  await ctx.repo.settings.insertIfAbsent({})
  const row = await ctx.repo.settings.first()
  const { traceRetentionDays, allowEvalUse, assistantModel, monthlyBudgetUsd } = row!
  return { traceRetentionDays, allowEvalUse, assistantModel, monthlyBudgetUsd }
}

export const org: HandlerGroup<'org'> = {
  'org.members': async (ctx) => {
    const rows = await ctx.repo.members()
    return rows.map(({ member, user }) => ({
      user: { id: user.id, name: user.name, email: user.email, image: user.image },
      role: effectiveRole(member.role),
      joinedAt: member.createdAt.toISOString(),
    }))
  },

  // Written in Better Auth's invitation shape so its accept-invitation endpoint completes the flow.
  'org.invite': async (ctx, input) => {
    if (input.role === 'owner' && ctx.role !== 'owner')
      throw forbidden('Only an owner can invite another owner')
    const email = input.email.toLowerCase()
    const already = (await ctx.repo.members()).some((m) => m.user.email.toLowerCase() === email)
    if (already) throw conflict(`${email} is already a member`)
    await ctx.repo.transaction(async (tx) => {
      await tx.invitations.update(
        and(eq(t.invitation.email, email), eq(t.invitation.status, 'pending'))!,
        {
          status: 'canceled',
        },
      )
      await tx.invitations.insert({
        id: createId('inv'),
        email,
        role: input.role,
        status: 'pending',
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        inviterId: ctx.user.id,
      })
    })
    return { ok: true }
  },

  'org.setRole': async (ctx, input) => {
    const target = await ctx.repo.memberships.first(eq(t.member.userId, input.userId))
    if (!target) throw notFound('Member', input.userId)
    const current = effectiveRole(target.role)
    const touchesOwner = current === 'owner' || input.role === 'owner'
    if (touchesOwner && !roleAllows(ctx.role, 'owner'))
      throw forbidden('Only an owner can grant or revoke ownership')
    if (current === 'owner' && input.role !== 'owner') {
      const others = await ctx.repo.memberships.many({ where: ne(t.member.userId, input.userId) })
      if (!others.some((m) => effectiveRole(m.role) === 'owner'))
        throw conflict('An organisation needs at least one owner; make someone else owner first')
    }
    await ctx.repo.memberships.update(eq(t.member.id, target.id), { role: input.role })
    return { ok: true }
  },

  'org.settings.get': readSettings,

  'org.settings.update': async (ctx, input) => {
    await ctx.repo.settings.insertIfAbsent({})
    // Drizzle leaves columns whose value is `undefined` untouched, which is exactly a partial update.
    await ctx.repo.settings.update(eq(t.orgSettings.orgId, ctx.orgId), {
      ...input,
      updatedAt: new Date(),
    })
    return { ok: true }
  },
}
