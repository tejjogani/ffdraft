/**
 * The facts strip over the viewport: weight, carats, stone count, and whether the piece is
 * ready to cast. Draft numbers are approximate (seats are not cut), so they carry "≈"; only a
 * production check of the current version may say "Ready to cast". Only the verdict is a live
 * region: the numbers change on every edit and would be re-announced each time.
 */
import type { Diagnostic, Evaluation } from '@pave/kernel'
import type { Design } from '@pave/schema'
import { METALS, type MetalId, nodeTitle } from '@pave/schema'
import { Button, cn, Popover, Spinner } from '@pave/ui'
import { Check, Crosshair, TriangleAlert, Wrench } from 'lucide-react'
import { useState } from 'react'
import { carats, grams, plural } from '../../../lib/format'
import { type Issue, readableMessage } from './issues'
import type { ProductionCheck } from './useProductionCheck'

export interface HudProps {
  design: Design
  evaluation: Evaluation | null
  issues: readonly Issue[]
  check: ProductionCheck
  evaluating: boolean
  readOnly: boolean
  onShow(d: Diagnostic): void
  onFix(d: Diagnostic): void
}

const metalName = (id: string) => (id in METALS ? METALS[id as MetalId].label : id)

export function Hud({
  design,
  evaluation,
  issues,
  check,
  evaluating,
  readOnly,
  onShow,
  onFix,
}: HudProps) {
  if (!evaluation) return null
  const r = evaluation.report
  const metal = r.metals.toSorted((a, b) => b.massG - a.massG)[0]
  return (
    <div className="glass shadow-md flex h-9 max-w-full min-w-0 items-center gap-3 rounded-lg pr-1.5 pl-3.5 text-xs whitespace-nowrap">
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          className="font-mono text-fg-subtle"
          title="Approximate until a production check: seats are not cut yet"
        >
          ≈
        </span>
        <span className="font-mono text-fg tabular">{grams(r.metalMassG)}</span>
        {metal && (
          <span className="min-w-0 truncate text-fg-muted">{metalName(metal.material)}</span>
        )}
      </span>
      {r.stoneCount > 0 && (
        <>
          <span aria-hidden className="h-3.5 w-px shrink-0 bg-line-strong" />
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="font-mono text-fg tabular">{carats(r.caratTotal)}</span>
            <span className="text-fg-muted">{plural(r.stoneCount, 'stone')}</span>
          </span>
        </>
      )}
      <span aria-hidden className="h-3.5 w-px shrink-0 bg-line-strong" />
      <div role="status" aria-live="polite" className="shrink-0">
        <Checks
          evaluating={evaluating}
          design={design}
          issues={issues}
          check={check}
          readOnly={readOnly}
          onShow={onShow}
          onFix={onFix}
        />
      </div>
    </div>
  )
}

function Checks({
  evaluating,
  design,
  issues,
  check,
  readOnly,
  onShow,
  onFix,
}: Omit<HudProps, 'evaluation'>) {
  const [open, setOpen] = useState(false)
  if (issues.length === 0 && check.state === 'failed')
    return (
      <span className="flex h-7 items-center px-1.5 text-fg-subtle" title={check.error}>
        Couldn’t run the casting check
      </span>
    )
  if (evaluating || (issues.length === 0 && check.state !== 'done'))
    return (
      <span
        className="flex h-7 items-center gap-1.5 px-1.5 text-fg-subtle"
        title={evaluating ? undefined : 'A casting check runs a moment after you stop editing'}
      >
        <Spinner className="size-3" label={evaluating ? 'Updating' : 'Checking'} />
        {evaluating ? 'Updating…' : 'Checking…'}
      </span>
    )
  if (issues.length === 0)
    return (
      <span className="flex h-7 items-center gap-1.5 px-1.5 font-medium text-ok">
        <Check className="size-3.5" aria-hidden /> Ready to cast
      </span>
    )
  const errors = issues.some((i) => i.d.level === 'error')
  return (
    <Popover
      side="top"
      align="end"
      title="Things to check"
      className="w-[360px] p-1.5"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md px-2 font-medium hover:bg-bg-hover',
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
            <li
              key={`${d.code}-${d.nodeId}-${i}`}
              className="flex gap-2.5 rounded-md p-2 hover:bg-bg-hover"
            >
              <span
                aria-hidden
                className={cn(
                  'mt-1.5 size-1.5 shrink-0 rounded-full',
                  d.level === 'error' ? 'bg-danger' : 'bg-warn',
                )}
              />
              <div className="min-w-0 flex-1">
                {node && (
                  <p className="text-xs text-fg-subtle">
                    {nodeTitle(node)}
                    {count > 1 && ` · ${count} places`}
                  </p>
                )}
                <p className="text-sm text-fg">{readableMessage(d.message, design)}</p>
                <div className="mt-1.5 -ml-1.5 flex gap-1">
                  {(d.nodeId || d.at) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Crosshair}
                      onClick={() => {
                        // The list would cover the very spot it frames.
                        setOpen(false)
                        onShow(d)
                      }}
                    >
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
