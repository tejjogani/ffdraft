import type { Ctx } from './context'
import { createId } from './ids'

/** Appends to the org's audit log; called for every mutation, whoever made it. */
export async function writeAudit(
  ctx: Ctx,
  entry: { action: string; input: unknown; targetId: string | null },
): Promise<void> {
  await ctx.repo.audit.insert({
    id: createId('aud'),
    action: entry.action,
    actor: ctx.actor,
    userId: ctx.actor.type === 'system' ? null : ctx.user.id,
    targetId: entry.targetId,
    input: entry.input,
  })
}
