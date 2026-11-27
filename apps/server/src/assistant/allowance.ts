/**
 * The plan's allowances as the assistant meets them. The server refuses work past the limit
 * whoever asks (plans.ts); this adds what an agent must do on top: ask the person before it
 * spends the last free render or export of the month, even where a Render job's plan would
 * otherwise approve the call by itself.
 */
import { ALLOWANCE_WORDS, type Allowance, exportCounts, PLANS, renderCost } from '@pave/schema'
import type { Ctx } from '../context'
import { engineFor } from '../handlers/render'
import { getScene } from '../lookups'
import { allowanceLeft } from '../plans'

/** Which allowance a tool call would spend, if any. */
export function allowanceOf(ctx: Ctx, command: string, input: unknown): Allowance | null {
  const i = (input ?? {}) as Record<string, unknown>
  switch (command) {
    case 'renders.create':
      return engineFor(
        ctx,
        (i.engine as 'auto' | 'blender' | 'browser') ?? 'auto',
        i.purpose === 'reference' ? 'reference' : 'take',
      ) === 'blender'
        ? 'render'
        : null
    case 'design.export':
      return typeof i.format === 'string' && exportCounts(i.format) ? 'export' : null
    case 'production.create':
      return i.cadFiles === false ? null : 'export'
    default:
      return null
  }
}

/** How many of its allowance a call spends: an animation take counts as more than one render. */
async function costOf(ctx: Ctx, command: string, input: unknown): Promise<number> {
  if (command !== 'renders.create') return 1
  const i = (input ?? {}) as { scene?: { animation?: unknown }; sceneId?: string }
  if (i.scene) return renderCost(i.scene)
  if (!i.sceneId) return 1
  const saved = await getScene(ctx, i.sceneId).catch(() => null)
  return renderCost(saved?.scene)
}

/**
 * Counts what one model turn's calls would spend, in the model's order, and says which call
 * would take the last free one. Built per turn: what is left is read once, then counted down.
 */
export function lastFreeTracker(ctx: Ctx) {
  const left = new Map<Allowance, number | null>()
  return {
    /** The sentence for the approval card when this call spends the last free one, else null. */
    async spend(command: string, input: unknown): Promise<string | null> {
      const allowance = allowanceOf(ctx, command, input)
      if (!allowance) return null
      if (!left.has(allowance)) {
        const a = await allowanceLeft(ctx, allowance)
        // Unlimited plans only have a fair-use ceiling, which nobody should be asked about.
        left.set(allowance, a.limited ? a.left : null)
      }
      const remaining = left.get(allowance) ?? null
      if (remaining === null) return null
      const cost = await costOf(ctx, command, input)
      left.set(allowance, Math.max(0, remaining - cost))
      if (remaining <= 0 || remaining > cost) return null
      const words = ALLOWANCE_WORDS[allowance]
      const what =
        cost === 1
          ? `your last free ${words.one}`
          : `your last ${remaining === 1 ? `free ${words.one}` : `${remaining} free ${words.many}`} (an animation counts as ${cost})`
      return `It uses ${what} this month (${PLANS.pro.label} has unlimited).`
    },
  }
}
