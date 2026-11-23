import type { METERS, UsageEvent } from '@pave/schema'
import { gte, sum } from 'drizzle-orm'
import { actorRunId, type Ctx } from './context'
import * as t from './db/schema'
import { AppError } from './errors'
import { createId } from './ids'

export interface NewUsage {
  meter: (typeof METERS)[number]
  provider: string
  model?: string | null
  quantity: number
  unit: string
  costUsd: number
  /**
   * Makes retries safe: a second event with the same key is ignored. Derive it from what is
   * being measured, e.g. `${runId}:${stepIndex}:llm`. Omitted → every call is a new event.
   */
  idempotencyKey?: string
  runId?: string | null
  pieceId?: string | null
}

export const toMicros = (usd: number): number => Math.round(usd * 1_000_000)
export const fromMicros = (micros: number): number => micros / 1_000_000

/** Appends to the usage ledger. Returns false when the idempotency key was already recorded. */
export async function recordUsage(ctx: Ctx, event: NewUsage): Promise<boolean> {
  const row = await ctx.repo.usage.insertIfAbsent({
    id: createId('use'),
    idempotencyKey: event.idempotencyKey ?? createId('idem'),
    meter: event.meter,
    provider: event.provider,
    model: event.model ?? null,
    quantity: event.quantity,
    unit: event.unit,
    costMicros: toMicros(event.costUsd),
    userId: ctx.user.id,
    runId: event.runId ?? actorRunId(ctx.actor),
    pieceId: event.pieceId ?? null,
  })
  return row !== undefined
}

/** What the org has spent this calendar month (UTC), in USD. */
export async function monthSpendUsd(ctx: Ctx): Promise<number> {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const [row] = await ctx.repo.usage.select(
    { micros: sum(t.usageEvent.costMicros).mapWith(Number) },
    gte(t.usageEvent.occurredAt, start),
  )
  return fromMicros(row?.micros ?? 0)
}

const usd = (n: number) => `$${n.toFixed(2)}`

/**
 * Call before anything that spends money: refuses with `budget_exceeded` (402) once the org's
 * monthly budget is used up, or when `upcomingUsd` more would pass it. No budget, no limit.
 */
export async function assertBudget(ctx: Ctx, upcomingUsd = 0): Promise<void> {
  const settings = await ctx.repo.settings.first()
  const budgetUsd = settings?.monthlyBudgetUsd ?? null
  if (budgetUsd === null) return
  const spentUsd = await monthSpendUsd(ctx)
  if (spentUsd >= budgetUsd || spentUsd + upcomingUsd > budgetUsd)
    throw new AppError(
      'budget_exceeded',
      `This would pass the organisation’s monthly budget of ${usd(budgetUsd)} (${usd(spentUsd)} spent so far). An admin can raise it in Settings → Usage.`,
      { budgetUsd, spentUsd },
    )
}

export const toUsageEvent = (r: typeof t.usageEvent.$inferSelect): UsageEvent => ({
  id: r.id,
  meter: r.meter,
  provider: r.provider,
  model: r.model,
  quantity: r.quantity,
  unit: r.unit,
  costUsd: fromMicros(r.costMicros),
  userId: r.userId,
  runId: r.runId,
  pieceId: r.pieceId,
  at: r.occurredAt.toISOString(),
})
