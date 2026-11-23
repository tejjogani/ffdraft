import { desc, gte, sql, sum } from 'drizzle-orm'
import * as t from '../db/schema'
import { fromMicros, toUsageEvent } from '../usage'
import type { HandlerGroup } from './types'

const RECENT = 50
const DAY_MS = 24 * 60 * 60 * 1000

export const usage: HandlerGroup<'usage'> = {
  'usage.summary': async (ctx, { days }) => {
    const since = gte(t.usageEvent.occurredAt, new Date(Date.now() - days * DAY_MS))
    const day = sql<string>`to_char(${t.usageEvent.occurredAt} at time zone 'UTC', 'YYYY-MM-DD')`
    const [byMeter, byDay, recent] = await Promise.all([
      ctx.repo.usage
        .select(
          {
            meter: t.usageEvent.meter,
            unit: t.usageEvent.unit,
            quantity: sql<number>`sum(${t.usageEvent.quantity})`.mapWith(Number),
            micros: sum(t.usageEvent.costMicros).mapWith(Number),
          },
          since,
        )
        .groupBy(t.usageEvent.meter, t.usageEvent.unit)
        .orderBy(t.usageEvent.meter),
      ctx.repo.usage
        .select({ day, micros: sum(t.usageEvent.costMicros).mapWith(Number) }, since)
        .groupBy(day)
        .orderBy(day),
      ctx.repo.usage.many({ where: since, orderBy: desc(t.usageEvent.occurredAt), limit: RECENT }),
    ])
    return {
      totalUsd: fromMicros(byMeter.reduce((n, m) => n + m.micros, 0)),
      byMeter: byMeter.map((m) => ({
        meter: m.meter,
        unit: m.unit,
        quantity: m.quantity,
        costUsd: fromMicros(m.micros),
      })),
      byDay: byDay.map((d) => ({ day: d.day, costUsd: fromMicros(d.micros) })),
      recent: recent.map(toUsageEvent),
    }
  },
}
