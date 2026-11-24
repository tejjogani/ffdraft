/**
 * The inspector: the selected feature's fields, generated from its schema. Essentials first;
 * "Fine-tune" reveals the `advanced` fields. With nothing selected it shows the piece itself.
 */
import type { Evaluation } from '@pave/kernel'
import { type Design, nodeTitle } from '@pave/schema'
import { Button, Chip, cn, ScrollArea, Switch } from '@pave/ui'
import { Eye, EyeOff, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import type { DesignSession } from '../../../lib/design-session/store'
import { carats, mm } from '../../../lib/format'
import { setIncluded } from '../ops'
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

  if (!node || !model || !edit) return <>{empty}</>

  const included = node.visible !== false
  const picked = stone ? evaluation?.stones.find((s) => s.id === stone) : undefined
  return (
    <FieldEditContext value={edit}>
      <div className="flex h-full flex-col">
        <header className="flex items-start gap-2 border-b border-line px-4 pt-3.5 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-medium text-fg">{nodeTitle(node)}</h2>
            <p className="mt-0.5 truncate text-xs text-fg-subtle" title={model.description}>
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
        <ScrollArea className="flex-1">
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
                  {included ? (
                    <Eye className="size-4" aria-hidden />
                  ) : (
                    <EyeOff className="size-4" aria-hidden />
                  )}
                  Part of the piece
                </span>
                <Switch
                  checked={included}
                  disabled={edit.readOnly}
                  aria-label="Part of the piece"
                  onChange={(on) => session?.commit([setIncluded(node.id, on)])}
                />
              </div>
              {!included && (
                <p className="-mt-1 text-xs text-fg-subtle">
                  Excluded: not weighed, not exported. Hiding it with the eye in the list only hides
                  it from view.
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
