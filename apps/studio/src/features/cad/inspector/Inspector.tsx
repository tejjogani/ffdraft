/**
 * The inspector: the selected feature's fields, generated from its schema. Essentials first;
 * "Fine-tune" reveals the `advanced` fields. With nothing selected it shows the piece itself.
 */
import type { Evaluation } from '@pave/kernel'
import { type Design, nodeTitle } from '@pave/schema'
import { Button, Chip, cn, ScrollArea, Switch } from '@pave/ui'
import { ArrowUpRight, Scale, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { runCommand } from '../../../lib/commands'
import type { DesignSession } from '../../../lib/design-session/store'
import { carats, mm } from '../../../lib/format'
import { diaexBrowseLink } from '../../sourcing/links'
import { useWorkspace } from '../state/workspace'
import { FieldEditContext, useNodeEdit } from './edit'
import { FieldControl } from './FieldControl'
import { inspectorModel } from './model'

export interface InspectorProps {
  design: Design
  session: DesignSession | null
  evaluation: Evaluation | null
  /** The assistant's latest run: values before it, by node and field. */
  prior: Record<string, Record<string, unknown>> | null
  readOnly: boolean
  onDelete(ids: string[]): void
  empty: React.ReactNode
}

export function Inspector({
  design,
  session,
  evaluation,
  prior,
  readOnly,
  onDelete,
  empty,
}: InspectorProps) {
  const selection = useWorkspace((s) => s.selection)
  const stone = useWorkspace((s) => s.stone)
  const fineTune = useWorkspace((s) => s.fineTune)
  const setFineTune = useWorkspace((s) => s.setFineTune)
  const node = design.nodes[selection.at(-1) ?? '']
  const model = useMemo(
    () => (node ? inspectorModel(node, { advanced: fineTune }) : null),
    [node, fineTune],
  )

  const edit = useNodeEdit(node, design, session, readOnly, prior)
  // A gesture belongs to the feature it was started on: leaving that feature (or the
  // inspector) ends it as a change rather than leaving it live and unsaved.
  const nodeId = node?.id
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs its cleanup when the inspected feature changes
  useEffect(() => () => session?.commitGesture(), [nodeId, session])

  if (!node || !model || !edit) return <>{empty}</>

  const listed = node.kind === 'gem' && node.sourcing?.provider === 'diaex' ? node.sourcing : null
  const listing = diaexBrowseLink(listed?.url)
  const included = node.visible !== false
  const picked = stone ? evaluation?.stones.find((s) => s.id === stone) : undefined
  return (
    <FieldEditContext value={edit}>
      <div className="flex h-full flex-col">
        <header className="flex items-start gap-2 border-b border-line px-4 pt-3.5 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-medium text-fg">{nodeTitle(node)}</h2>
            <p className="mt-0.5 line-clamp-2 text-xs text-fg-subtle" title={model.description}>
              {nodeTitle(node) === model.title ? (model.description ?? model.title) : model.title}
            </p>
          </div>
          {selection.length > 1 && <Chip>{selection.length} selected</Chip>}
        </header>
        {picked && (
          <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-xs text-fg-muted">
            <span className="text-fg-subtle">This stone</span>
            <span className="font-mono tabular text-fg">
              {mm(picked.dims.width)}
              {picked.dims.length !== picked.dims.width && ` × ${mm(picked.dims.length)}`} ·{' '}
              {carats(picked.carat)}
            </span>
          </div>
        )}
        {listed && (
          <div className="border-b border-line px-4 py-2 text-xs">
            <p className="text-fg-muted">Fitted diamond</p>
            {listing ? (
              <a
                href={listing.href}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 break-all text-fg underline decoration-line-strong underline-offset-2"
              >
                {listed.sku}
                <ArrowUpRight className="size-3 shrink-0" aria-hidden />
              </a>
            ) : (
              <p className="mt-1 break-all text-fg">{listed.sku}</p>
            )}
          </div>
        )}
        {/* Keyed by feature: another feature's form opens at its top, not where this one was scrolled. */}
        <ScrollArea key={node.id} className="flex-1">
          <div className="flex flex-col pb-6">
            {model.sections.map((section) => (
              <section key={section.id} className="border-b border-line px-4 py-3 last:border-b-0">
                {section.title && (
                  <h3 className="mb-1.5 text-2xs font-medium tracking-wide text-fg-subtle uppercase">
                    {section.title}
                  </h3>
                )}
                <div className="flex flex-col gap-1">
                  {section.rows.map((row) => (
                    <FieldControl key={row.path.join('.')} row={row} />
                  ))}
                </div>
              </section>
            ))}
            <div className="flex flex-col gap-2 px-4 pt-3">
              {model.advanced > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={SlidersHorizontal}
                  aria-pressed={fineTune}
                  onClick={() => setFineTune(!fineTune)}
                  className={cn('-ml-2 self-start', fineTune && 'text-fg')}
                >
                  {fineTune ? 'Fewer settings' : `Fine-tune · ${model.advanced} more`}
                </Button>
              )}
              <div className="flex items-center justify-between gap-3 py-1 text-sm text-fg-muted">
                <span className="flex items-center gap-2">
                  <Scale className="size-4 text-fg-subtle" aria-hidden />
                  Count in weight and export
                </span>
                <Switch
                  checked={included}
                  disabled={edit.readOnly}
                  aria-label="Count in weight and export"
                  onChange={() => runCommand('design.excludeSelected')}
                />
              </div>
              {!included && (
                <p className="-mt-1 text-xs text-fg-subtle">
                  Left out: not weighed, not exported. The eye in the list only hides a feature from
                  view.
                </p>
              )}
              {!edit.readOnly && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Trash2}
                  onClick={() => onDelete(selection)}
                  className="-ml-2 self-start hover:text-danger"
                >
                  Delete
                </Button>
              )}
            </div>
          </div>
        </ScrollArea>
      </div>
    </FieldEditContext>
  )
}
