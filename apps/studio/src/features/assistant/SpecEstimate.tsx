/**
 * What the spec would weigh and cost, shown on the spec card before "Build it": the canon's
 * build of the spec, evaluated and priced on the server (pieces.estimate). A rough cost at the
 * production estimate's placeholder rates, never a quote.
 */
import type { PieceSpec } from '@pave/schema'
import { Skeleton } from '@pave/ui'
import { carats, grams } from '../../lib/format'
import { metalLabel } from '../../lib/domain'
import { useRpc } from '../../lib/query'
import { usd } from '../projects/cost'

export function SpecEstimate({ pieceId, spec }: { pieceId: string; spec: PieceSpec }) {
  // The spec is in the query's key, so a changed spec is estimated again.
  const estimate = useRpc('pieces.estimate', { id: pieceId, spec }, { staleTime: 60_000 })
  if (estimate.isError) return null
  if (!estimate.data) return <Skeleton className="mx-4 mb-3 h-10" />
  const e = estimate.data
  return (
    <section
      aria-label="Estimate"
      data-spec-estimate
      className="mx-4 mb-3 rounded-md bg-bg-muted px-3 py-2.5 text-xs"
    >
      <p className="mb-1.5 font-medium text-fg-muted">Estimate before building</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <div>
          <dt className="text-fg-subtle">Metal</dt>
          <dd className="font-mono tabular">
            {grams(e.metalMassG)} {metalLabel(e.metal)}
          </dd>
        </div>
        <div>
          <dt className="text-fg-subtle">Stones</dt>
          <dd className="font-mono tabular">
            {e.stoneCount} · {carats(e.caratTotal)}
          </dd>
        </div>
        <div>
          <dt className="text-fg-subtle">Size</dt>
          <dd className="font-mono tabular">
            {e.boundsMm.x.toFixed(1)} × {e.boundsMm.y.toFixed(1)} × {e.boundsMm.z.toFixed(1)} mm
          </dd>
        </div>
        <div>
          <dt className="text-fg-subtle">Rough cost</dt>
          <dd className="font-mono tabular">{e.costUsd !== null ? `≈ ${usd(e.costUsd)}` : '—'}</dd>
        </div>
      </dl>
      {e.notes.length > 0 && (
        <ul className="mt-2 list-disc pl-4 text-fg-subtle">
          {e.notes.slice(0, 3).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <p className="mt-1.5 text-3xs text-fg-faint">Placeholder rates, not a quote.</p>
    </section>
  )
}
