/** The generic widgets: numbers, choices, toggles, text, vectors, references and summaries. */
import {
  type FieldInfo,
  GEM_MATERIALS,
  type GemMaterialId,
  METALS,
  type MetalId,
  nodeTitle,
} from '@pave/schema'
import {
  Input,
  NumberField,
  Segmented,
  Select,
  type SelectOption,
  Slider,
  Swatch,
  Switch,
} from '@pave/ui'
import { useEffect, useState } from 'react'
import { dependentsOf } from '../../ops'
import { useFieldEdit } from '../edit'
import type { InspectorRow } from '../model'

const UNIT: Record<string, string> = { mm: 'mm', deg: '°', ct: 'ct', '%': '%', s: 's', px: 'px' }
export const unitOf = (f: FieldInfo) => (f.meta.unit ? UNIT[f.meta.unit] : undefined)

export function NumberWidget({ row }: { row: InspectorRow }) {
  const edit = useFieldEdit()
  const { field } = row
  const value = typeof row.value === 'number' ? row.value : null
  const step = field.meta.step ?? (field.type === 'integer' ? 1 : 0.05)
  const number = (
    <NumberField
      size="sm"
      value={value}
      min={field.min}
      max={field.max}
      step={step}
      unit={unitOf(field)}
      disabled={edit.readOnly}
      aria-label={field.title}
      onChange={(v) => v !== null && edit.preview(row.path, v)}
      onCommit={(v) => v !== null && edit.commit(row.path, v)}
      className={field.widget === 'slider' ? 'w-20 shrink-0' : undefined}
    />
  )
  if (field.widget !== 'slider') return number
  return (
    <div className="flex items-center gap-2.5">
      <Slider
        value={value ?? field.min ?? 0}
        min={field.min}
        max={field.max}
        step={step}
        disabled={edit.readOnly}
        aria-label={field.title}
        onChange={(v) => edit.preview(row.path, v)}
        onCommit={(v) => edit.commit(row.path, v)}
      />
      {number}
    </div>
  )
}

/** Leading visual for a library choice: a metal or stone swatch. */
function libraryIcon(field: FieldInfo, value: string) {
  if (field.widget === 'metal' && value in METALS)
    return <Swatch color={METALS[value as MetalId].swatch} kind="metal" size="sm" />
  if (field.widget === 'stone' && value in GEM_MATERIALS)
    return <Swatch color={GEM_MATERIALS[value as GemMaterialId].color} kind="gem" size="sm" />
  return undefined
}

export function ChoiceWidget({ row }: { row: InspectorRow }) {
  const edit = useFieldEdit()
  const { field } = row
  const options = field.options ?? []
  const value = String(row.value ?? '')
  // A segmented control only while its labels fit the inspector column; otherwise a menu.
  const fits = options.length <= 3 && options.reduce((n, o) => n + o.label.length, 0) <= 16
  if (field.widget === 'segmented' && fits)
    return (
      <Segmented
        value={value}
        options={options}
        aria-label={field.title}
        onChange={(v) => edit.commit(row.path, v)}
        className="w-full [&>*]:flex-1"
      />
    )
  const choices: SelectOption[] = options.map((o) => ({
    value: o.value,
    label: o.label,
    icon: libraryIcon(field, o.value),
  }))
  return (
    <Select
      value={value}
      options={choices}
      disabled={edit.readOnly}
      aria-label={field.title}
      onChange={(v) => edit.commit(row.path, v)}
      className="h-7 w-full"
    />
  )
}

export function ToggleWidget({ row }: { row: InspectorRow }) {
  const edit = useFieldEdit()
  return (
    <Switch
      checked={row.value === true}
      disabled={edit.readOnly}
      aria-label={row.field.title}
      onChange={(v) => edit.commit(row.path, v)}
    />
  )
}

export function TextWidget({ row }: { row: InspectorRow }) {
  const edit = useFieldEdit()
  const [draft, setDraft] = useState(String(row.value ?? ''))
  useEffect(() => setDraft(String(row.value ?? '')), [row.value])
  const commit = () => {
    if (draft !== row.value) edit.commit(row.path, draft)
  }
  return (
    <Input
      value={draft}
      disabled={edit.readOnly}
      aria-label={row.field.title}
      onChange={(e) => {
        setDraft(e.target.value)
        edit.preview(row.path, e.target.value)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(String(row.value ?? ''))
      }}
      className="h-7"
    />
  )
}

export function Vec3Widget({ row }: { row: InspectorRow }) {
  const edit = useFieldEdit()
  const v = Array.isArray(row.value) ? (row.value as number[]) : [0, 0, 0]
  const unit = unitOf(row.field)
  const set = (i: number, n: number | null, done: boolean) => {
    if (n === null) return
    const next = v.map((x, j) => (j === i ? n : x))
    done ? edit.commit(row.path, next) : edit.preview(row.path, next)
  }
  return (
    <div className="grid grid-cols-3 gap-1">
      {(['X', 'Y', 'Z'] as const).map((axis, i) => (
        <NumberField
          key={axis}
          size="sm"
          label={axis}
          value={v[i] ?? 0}
          step={row.field.meta.step ?? 0.1}
          unit={unit}
          disabled={edit.readOnly}
          aria-label={`${row.field.title} ${axis}`}
          onChange={(n) => set(i, n, false)}
          onCommit={(n) => set(i, n, true)}
        />
      ))}
    </div>
  )
}

/** Nodes a reference field may point at: the right kinds, never itself or its dependents. */
function candidates(row: InspectorRow, edit: ReturnType<typeof useFieldEdit>): SelectOption[] {
  const kinds = row.field.meta.refKinds
  const exclude = new Set([edit.node.id, ...dependentsOf(edit.design, edit.node.id)])
  return edit.design.order
    .map((id) => edit.design.nodes[id]!)
    .filter((n) => !exclude.has(n.id) && (!kinds || kinds.includes(n.kind)))
    .map((n) => ({ value: n.id, label: nodeTitle(n) }))
}

export function RefWidget({ row }: { row: InspectorRow }) {
  const edit = useFieldEdit()
  const options = candidates(row, edit)
  return (
    <Select
      value={typeof row.value === 'string' ? row.value : null}
      options={options}
      placeholder={options.length ? 'Choose…' : 'Nothing to pick'}
      disabled={edit.readOnly || options.length === 0}
      aria-label={row.field.title}
      onChange={(v) => edit.commit(row.path, v)}
      className="h-7 w-full"
    />
  )
}

/** Lists, paths and assets: shown, edited elsewhere (sketching and re-import are not inline). */
export function SummaryWidget({ row }: { row: InspectorRow }) {
  const edit = useFieldEdit()
  const v = row.value
  const text = Array.isArray(v)
    ? row.field.widget === 'refs'
      ? v
          .map((id) => (edit.design.nodes[id] ? nodeTitle(edit.design.nodes[id]!) : id))
          .join(', ') || 'None'
      : `${v.length} ${v.length === 1 ? 'point' : 'points'}`
    : typeof v === 'string'
      ? row.field.widget === 'path'
        ? `Outline · ${v.length.toLocaleString()} characters`
        : row.field.widget === 'asset'
          ? 'Uploaded file'
          : v
      : '—'
  return <p className="truncate py-1 text-sm text-fg-muted">{text}</p>
}
