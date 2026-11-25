/**
 * The plan's allowances as the assistant meets them. The server refuses work past the limit
 * whoever asks (plans.ts); this adds what an agent must do on top: ask the person before it
 * spends the last free render or export of the month, even where a Render job's plan would
 * otherwise approve the call by itself.
 */
import { ALLOWANCE_WORDS, type Allowance, exportCounts, PLANS } from '@pave/schema'
import type { Ctx } from '../context'
import { engineFor } from '../handlers/render'
import { allowanceLeft } from '../plans'

/** Which allowance a tool call would spend, if any. */
export function allowanceOf(ctx: Ctx, command: string, input: unknown): Allowance | null {
  const i = (input ?? {}) as Record<string, unknown>
  switch (command) {
    case 'renders.create':
      return engineFor(ctx, (i.engine as 'auto' | 'blender' | 'browser') ?? 'auto') === 'blender'
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
      left.set(allowance, Math.max(0, remaining - 1))
      if (remaining !== 1) return null
      return `It uses your last free ${ALLOWANCE_WORDS[allowance].one} this month (${PLANS.pro.label} has unlimited).`
    },
  }
}
