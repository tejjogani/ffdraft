/**
 * The facts strip over the viewport: weight, carats, stone count, and whether the piece is
 * ready to cast. Draft numbers are approximate (seats are not cut), so they carry "≈"; only a
 * production check of the current version may say "Ready to cast".
 */
import type { Diagnostic, Evaluation } from '@pave/kernel'
import { METALS, type MetalId, nodeTitle } from '@pave/schema'
import type { Design } from '@pave/schema'
import { Button, cn, Popover, Spinner } from '@pave/ui'
import { Check, Crosshair, TriangleAlert, Wrench } from 'lucide-react'
import { carats, grams, plural } from '../../../lib/format'
import type { ProductionCheck } from './useProductionCheck'

export interface HudProps {
  design: Design
  evaluation: Evaluation | null
  check: ProductionCheck
  evaluating: boolean
  readOnly: boolean
  onShow(d: Diagnostic): void
  onFix(d: Diagnostic): void
}

const metalName = (id: string) => (id in METALS ? METALS[id as MetalId].label : id)

interface Issue {
  d: Diagnostic
  /** How many identical findings this stands for (one per stone of a pavé field, say). */
  count: number
}

/** Problems first, then warnings; identical findings on one feature count once. Information never counts. */
function toCheck(ds: readonly Diagnostic[]): Issue[] {
  const groups = new Map<string, Issue>()
  for (const d of ds) {
    if (d.level === 'info') continue
    const key = `${d.level}|${d.code}|${d.nodeId ?? ''}|${d.message}`
    const g = groups.get(key)
    if (g) g.count++
    else groups.set(key, { d, count: 1 })
  }
  return [...groups.values()].toSorted((a, b) =>
    a.d.level === b.d.level ? 0 : a.d.level === 'error' ? -1 : 1,
  )
}

export function Hud({ design, evaluation, check, evaluating, readOnly, onShow, onFix }: HudProps) {
  if (!evaluation) return null
  const r = evaluation.report
  const metal = r.metals.toSorted((a, b) => b.massG - a.massG)[0]
  const issues = toCheck(check.state === 'done' ? check.diagnostics : evaluation.diagnostics)
  return (
    <div
      role="status"
      aria-live="polite"
      className="glass shadow-md flex h-9 items-center gap-3 rounded-lg pr-1.5 pl-3.5 text-sm"
    >
      <span className="flex items-center gap-1.5 font-mono text-xs text-fg tabular">
        <span className="text-fg-subtle" title="Approximate until a production check: seats are not cut yet">
          ≈
        </span>
        {grams(r.metalMassG)}
        {metal && <span className="font-sans text-fg-muted">{metalName(metal.material)}</span>}
      </span>
      {r.stoneCount > 0 && (
        <>
          <span aria-hidden className="h-3.5 w-px bg-line-strong" />
          <span className="font-mono text-xs text-fg tabular">{carats(r.caratTotal)}</span>
          <span className="text-xs text-fg-muted">{plural(r.stoneCount, 'stone')}</span>
        </>
      )}
      <span aria-hidden className="h-3.5 w-px bg-line-strong" />
      {evaluating && <Spinner className="size-3.5" label="Updating" />}
      <Checks design={design} issues={issues} check={check} readOnly={readOnly} onShow={onShow} onFix={onFix} />
    </div>
  )
}

function Checks({
  design,
  issues,
  check,
  readOnly,
  onShow,
  onFix,
}: {
  design: Design
  issues: Issue[]
  check: ProductionCheck
  readOnly: boolean
  onShow(d: Diagnostic): void
  onFix(d: Diagnostic): void
}) {
  if (issues.length === 0)
    return check.state === 'done' ? (
      <span className="flex h-7 items-center gap-1.5 px-1.5 text-xs font-medium text-ok">
        <Check className="size-3.5" aria-hidden /> Ready to cast
      </span>
    ) : (
      <span className="flex h-7 items-center gap-1.5 px-1.5 text-xs text-fg-subtle">
        {check.state === 'running' ? <Spinner className="size-3" label="Checking" /> : null}
        {check.state === 'running' ? 'Checking for casting…' : 'Not checked yet'}
      </span>
    )
  const errors = issues.some((i) => i.d.level === 'error')
  return (
    <Popover
      side="top"
      align="end"
      title="Things to check"
      className="w-[360px] p-1.5"
      trigger={
        <button
          type="button"
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium hover:bg-bg-hover',
            errors ? 'text-danger' : 'text-warn',
          )}
        >
          <TriangleAlert className="size-3.5" aria-hidden />
          {plural(issues.length, 'thing')} to check
        </button>
      }
    >
      <ul className="flex max-h-[50vh] flex-col overflow-y-auto">
        {issues.map(({ d, count }, i) => {
          const node = d.nodeId ? design.nodes[d.nodeId] : undefined
          return (
            <li key={`${d.code}-${d.nodeId}-${i}`} className="flex gap-2.5 rounded-md p-2 hover:bg-bg-hover">
              <span
                aria-hidden
                className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', d.level === 'error' ? 'bg-danger' : 'bg-warn')}
              />
              <div className="min-w-0 flex-1">
                {node && (
                  <p className="text-xs text-fg-subtle">
                    {nodeTitle(node)}
                    {count > 1 && ` · ${count} places`}
                  </p>
                )}
                <p className="text-sm text-fg">{d.message}</p>
                <div className="mt-1.5 -ml-1.5 flex gap-1">
                  {(d.nodeId || d.at) && (
                    <Button variant="ghost" size="sm" icon={Crosshair} onClick={() => onShow(d)}>
                      Show me
                    </Button>
                  )}
                  {d.fix && !readOnly && (
                    <Button variant="secondary" size="sm" icon={Wrench} onClick={() => onFix(d)}>
                      {d.fix.label}
                    </Button>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </Popover>
  )
}
