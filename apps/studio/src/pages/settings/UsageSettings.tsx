import type { METERS } from '@pave/schema'
import { EmptyState, InlineError, Segmented, Skeleton, Tooltip } from '@pave/ui'
import { useMemo, useState } from 'react'
import { compact, dateTime, num, relativeTime, shortDate, usd } from '../../lib/format'
import { useRpc } from '../../lib/query'
import { SettingsTitle } from './SettingsLayout'

type Meter = (typeof METERS)[number]

const METER_LABEL: Record<Meter, string> = {
  llm: 'Assistant',
  image: 'Image generation',
  search: 'Reference search',
  embedding: 'Embeddings',
  mesh3d: '3D generation',
  render: 'Rendering',
  storage: 'Storage',
}

const PERIODS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
] as const

export function UsageSettings() {
  const [days, setDays] = useState<'7' | '30' | '90'>('30')
  const usage = useRpc('usage.summary', { days: Number(days) })
  return (
    <>
      <SettingsTitle
        title="Usage"
        description="What the assistant, generators and renders have cost this workspace."
        actions={
          <Segmented aria-label="Period" value={days} onChange={setDays} options={[...PERIODS]} />
        }
      />
      {usage.isError ? (
        <InlineError message={usage.error.message} onRetry={() => void usage.refetch()} />
      ) : usage.isPending ? (
        <div className="flex flex-col gap-6">
          <Skeleton className="h-12 w-40" />
          <Skeleton className="h-44" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <>
          <div className="mb-8">
            <div className="text-xs text-fg-subtle">Total, last {days} days</div>
            <div className="mt-1 font-mono text-title tracking-tight tabular">
              {usd(usage.data.totalUsd)}
            </div>
          </div>
          {usage.data.totalUsd > 0 ? (
            <DailyBars data={usage.data.byDay} days={Number(days)} />
          ) : (
            <p className="text-sm text-fg-subtle">No spend in this period.</p>
          )}
          <section className="mt-10">
            <h2 className="mb-2 text-sm font-medium">By meter</h2>
            {usage.data.byMeter.length === 0 ? (
              <p className="text-sm text-fg-subtle">Nothing metered in this period.</p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <tbody>
                  {[...usage.data.byMeter]
                    .sort((a, b) => b.costUsd - a.costUsd)
                    .map((m) => {
                      const share = usage.data.totalUsd ? m.costUsd / usage.data.totalUsd : 0
                      return (
                        <tr key={m.meter} className="border-b border-line">
                          <td className="h-10 pr-3">{METER_LABEL[m.meter]}</td>
                          <td className="w-[38%] pr-4">
                            <div className="h-1 overflow-hidden rounded-full bg-bg-muted">
                              <div
                                className="h-full rounded-full bg-fg-muted"
                                style={{ width: `${share * 100}%` }}
                              />
                            </div>
                          </td>
                          <td className="pr-3 text-right font-mono text-xs text-fg-muted tabular">
                            {compact(m.quantity)} {m.unit}
                          </td>
                          <td className="w-24 text-right font-mono text-xs tabular">
                            {usd(m.costUsd)}
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            )}
          </section>
          <section className="mt-10">
            <h2 className="mb-2 text-sm font-medium">Recent activity</h2>
            {usage.data.recent.length === 0 ? (
              <EmptyState
                className="py-8"
                title="No activity yet"
                description="Metered events appear here as they happen."
              />
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-xs text-fg-subtle">
                    <th className="h-8 pr-3 text-left font-normal">Meter</th>
                    <th className="h-8 pr-3 text-left font-normal">Provider</th>
                    <th className="h-8 pr-3 text-right font-normal">Quantity</th>
                    <th className="h-8 pr-3 text-right font-normal">Cost</th>
                    <th className="h-8 text-right font-normal">When</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.data.recent.slice(0, 12).map((e) => (
                    <tr key={e.id} className="border-b border-line">
                      <td className="h-9 pr-3">{METER_LABEL[e.meter]}</td>
                      <td className="pr-3 text-fg-muted">
                        {e.provider}
                        {e.model && (
                          <span className="ml-1.5 font-mono text-2xs text-fg-subtle">
                            {e.model}
                          </span>
                        )}
                      </td>
                      <td className="pr-3 text-right font-mono text-xs text-fg-muted tabular">
                        {num(e.quantity, 0)} {e.unit}
                      </td>
                      <td className="pr-3 text-right font-mono text-xs tabular">
                        {usd(e.costUsd)}
                      </td>
                      <td className="text-right text-xs text-fg-subtle" title={dateTime(e.at)}>
                        {relativeTime(e.at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </>
  )
}

/** Spend per day: one neutral series, rounded data-ends on the baseline, a tooltip per bar. */
function DailyBars({ data, days }: { data: { day: string; costUsd: number }[]; days: number }) {
  const series = useMemo(() => {
    const byDay = new Map(data.map((d) => [d.day.slice(0, 10), d.costUsd]))
    const out: { day: string; costUsd: number }[] = []
    const today = new Date()
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      out.push({ day: key, costUsd: byDay.get(key) ?? 0 })
    }
    return out
  }, [data, days])
  const max = Math.max(...series.map((d) => d.costUsd), 0.01)
  return (
    <figure aria-label="Spend per day" className="pt-5">
      <div className="relative h-44">
        <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-line" />
        <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-line" />
        <span className="absolute -top-5 left-0 font-mono text-2xs text-fg-subtle tabular">
          {usd(max)}
        </span>
        <div className="absolute inset-0 flex items-end gap-0.5 border-b border-line-strong">
          {series.map((d) => (
            <Tooltip
              key={d.day}
              side="top"
              content={
                <span className="font-mono tabular">
                  {shortDate(`${d.day}T12:00:00`)} · {usd(d.costUsd)}
                </span>
              }
            >
              <div
                className="group flex h-full flex-1 items-end"
                aria-label={`${d.day}: ${usd(d.costUsd)}`}
                role="img"
              >
                <div
                  className="w-full rounded-t-[4px] bg-fg-faint transition-colors duration-120 group-hover:bg-fg-muted"
                  style={{ height: d.costUsd ? `max(2px, ${(d.costUsd / max) * 100}%)` : 0 }}
                />
              </div>
            </Tooltip>
          ))}
        </div>
      </div>
      <figcaption className="mt-1.5 flex justify-between font-mono text-2xs text-fg-subtle tabular">
        <span>{shortDate(`${series[0]!.day}T12:00:00`)}</span>
        <span>Today</span>
      </figcaption>
    </figure>
  )
}
