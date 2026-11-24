/**
 * The only widget switch: a schema field's declared (or inferred) widget picks its control.
 * Rows lay out label and control; a choice of variants shows its options with the active
 * variant's fields nested beneath; grouped objects (the transform) nest the same way. Number
 * widgets place the label themselves: it is their scrub handle.
 */
import type { Widget } from '@pave/schema'
import { AiMark, cn, Segmented, toast } from '@pave/ui'
import type { ReactNode } from 'react'
import { useFieldEdit } from './edit'
import type { InspectorRow } from './model'
import {
  AssetWidget,
  ChoiceWidget,
  NumberWidget,
  RefsWidget,
  RefWidget,
  SummaryWidget,
  TextWidget,
  ToggleWidget,
  Vec3Widget,
} from './widgets/basic'
import { RingSizeWidget, StoneSizeWidget } from './widgets/measures'

function control(widget: Widget, row: InspectorRow, label: ReactNode): ReactNode {
  switch (widget) {
    case 'number':
    case 'slider':
      return <NumberWidget row={row} label={label} />
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
      return <StoneSizeWidget row={row} label={label} />
    case 'refs':
      return <RefsWidget row={row} />
    case 'asset':
      return <AssetWidget row={row} />
    case 'list':
    case 'path':
      return <SummaryWidget row={row} />
    case 'variant':
      return <VariantControl row={row} />
    case 'group':
      return null
  }
}

/** Fields whose control needs the whole row width (it carries two inputs, a hint or a list). */
const WIDE: ReadonlySet<Widget> = new Set(['ringSize', 'vec3', 'refs'])
/** Widgets that render the row's label themselves (as their scrub handle). */
const OWNS_LABEL: ReadonlySet<Widget> = new Set(['number', 'slider', 'stoneSize'])

export function FieldControl({ row }: { row: InspectorRow }) {
  const edit = useFieldEdit()
  const { field } = row
  const prior = edit.prior(row.path)
  const label = (
    <span
      className="flex min-w-0 items-center gap-1.5 text-sm text-fg-muted"
      title={field.description ?? field.title}
    >
      <span className="line-clamp-2 leading-4">{field.title}</span>
      {prior.changed && (
        <span
          className="shrink-0"
          title={
            prior.label ? `The assistant changed ${prior.label}` : 'The assistant changed this'
          }
        >
          <AiMark className="size-2.5" />
        </span>
      )}
    </span>
  )
  const nested = row.children.length > 0 && (
    <div
      className={cn(
        'flex flex-col gap-1',
        field.widget === 'variant' && 'mt-1 border-l border-line pl-3',
      )}
    >
      {row.children.map((child) => (
        <FieldControl key={child.path.join('.')} row={child} />
      ))}
    </div>
  )
  if (field.widget === 'group') return <div className="flex flex-col gap-1">{nested}</div>
  if (WIDE.has(field.widget) || field.widget === 'variant')
    return (
      <div className="flex flex-col gap-1.5 py-1">
        {label}
        {control(field.widget, row, label)}
        {nested}
      </div>
    )
  return (
    <div className="grid min-h-8 grid-cols-[minmax(0,44%)_minmax(0,1fr)] items-center gap-3">
      {OWNS_LABEL.has(field.widget) ? (
        control(field.widget, row, label)
      ) : (
        <>
          {label}
          <div className="min-w-0">{control(field.widget, row, label)}</div>
        </>
      )}
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
      disabled={edit.readOnly}
      aria-label={row.field.title}
      className="w-full [&>*]:flex-1"
      onChange={(next) => {
        const missing = edit.switchVariant(row.path, next)
        if (missing) toast({ title: 'Can’t switch yet', description: missing })
      }}
    />
  )
}
