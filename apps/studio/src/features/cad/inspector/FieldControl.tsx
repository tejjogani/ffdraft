/**
 * The only widget switch: a schema field's declared (or inferred) widget picks its control.
 * Rows lay out label and control; a choice of variants shows its options with the active
 * variant's fields nested beneath; grouped objects (the transform) nest the same way.
 */
import type { Widget } from '@pave/schema'
import { AiMark, cn, Segmented, toast } from '@pave/ui'
import type { ReactNode } from 'react'
import { useFieldEdit } from './edit'
import type { InspectorRow } from './model'
import {
  ChoiceWidget,
  NumberWidget,
  RefWidget,
  SummaryWidget,
  TextWidget,
  ToggleWidget,
  Vec3Widget,
} from './widgets/basic'
import { RingSizeWidget, StoneSizeWidget } from './widgets/measures'

function control(widget: Widget, row: InspectorRow): ReactNode {
  switch (widget) {
    case 'number':
    case 'slider':
      return <NumberWidget row={row} />
    case 'segmented':
    case 'select':
    case 'metal':
    case 'finish':
    case 'plating':
    case 'stone':
    case 'cut':
      return <ChoiceWidget row={row} />
    case 'toggle':
      return <ToggleWidget row={row} />
    case 'text':
    case 'textarea':
      return <TextWidget row={row} />
    case 'vec3':
      return <Vec3Widget row={row} />
    case 'ref':
      return <RefWidget row={row} />
    case 'ringSize':
      return <RingSizeWidget row={row} />
    case 'stoneSize':
      return <StoneSizeWidget row={row} />
    case 'refs':
    case 'list':
    case 'path':
    case 'asset':
      return <SummaryWidget row={row} />
    case 'variant':
      return <VariantControl row={row} />
    case 'group':
      return null
  }
}

/** Fields whose control needs the whole row width (it carries two inputs or a hint line). */
const WIDE: ReadonlySet<Widget> = new Set(['ringSize', 'vec3'])

export function FieldControl({ row }: { row: InspectorRow }) {
  const edit = useFieldEdit()
  const { field } = row
  const prior = edit.prior(row.path)
  const label = (
    <span className="flex min-w-0 items-center gap-1.5" title={field.description}>
      <span className="truncate">{field.title}</span>
      {prior.changed && (
        <span title={`The assistant changed this (was ${String(prior.value ?? 'unset')})`}>
          <AiMark className="size-2.5" />
        </span>
      )}
    </span>
  )
  const nested = row.children.length > 0 && (
    <div className={cn('flex flex-col gap-1', field.widget === 'variant' && 'mt-1 border-l border-line pl-3')}>
      {row.children.map((child) => (
        <FieldControl key={child.path.join('.')} row={child} />
      ))}
    </div>
  )
  if (field.widget === 'group')
    return <div className="flex flex-col gap-1">{nested}</div>
  if (WIDE.has(field.widget) || field.widget === 'variant')
    return (
      <div className="flex flex-col gap-1.5 py-1">
        <div className="text-sm text-fg-muted">{label}</div>
        {control(field.widget, row)}
        {nested}
      </div>
    )
  return (
    <div className="grid min-h-8 grid-cols-[minmax(0,40%)_minmax(0,1fr)] items-center gap-3">
      <div className="text-sm text-fg-muted">{label}</div>
      <div className="min-w-0">{control(field.widget, row)}</div>
    </div>
  )
}

function VariantControl({ row }: { row: InspectorRow }) {
  const edit = useFieldEdit()
  const current = (row.value as { type?: string } | undefined)?.type ?? ''
  const options = (row.field.variants ?? []).map((v) => ({ value: v.value, label: v.title }))
  return (
    <Segmented
      value={current}
      options={options}
      aria-label={row.field.title}
      className="w-full [&>*]:flex-1"
      onChange={(next) => {
        const missing = edit.switchVariant(row.path, next)
        if (missing) toast({ title: 'Can’t switch yet', description: missing })
      }}
    />
  )
}
