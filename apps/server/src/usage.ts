import type { METERS, UsageEvent } from '@pave/schema'
import { type Ctx, actorRunId } from './context'
import type { usageEvent } from './db/schema'
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

export const toUsageEvent = (r: typeof usageEvent.$inferSelect): UsageEvent => ({
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
