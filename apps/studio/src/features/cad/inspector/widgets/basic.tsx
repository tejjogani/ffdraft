/**
 * The generic widgets: numbers, choices, toggles, text, vectors, references, files and
 * summaries. A widget that takes the row's `label` renders it as well (a number's label is its
 * scrub handle), as two siblings for the row's grid.
 */
import {
  type FieldInfo,
  GEM_MATERIALS,
  type GemMaterialId,
  isSectionSurface,
  METALS,
  type MetalId,
  nodeTitle,
} from '@pave/schema'
import {
  Button,
  IconButton,
  Input,
  NumberField,
  Segmented,
  Select,
  type SelectOption,
  Slider,
  Swatch,
  Switch,
  toast,
} from '@pave/ui'
import { FileUp, X } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { uploadAsset } from '../../../../lib/assets'
import { classifyImport, IMPORT_ACCEPT } from '../../empty/importers'
import { dependentsOf } from '../../ops'
import { useFieldEdit } from '../edit'
import type { InspectorRow } from '../model'

export interface WidgetProps {
  row: InspectorRow
  /** The row's label, for widgets that place it themselves. */
  label?: ReactNode
}

const UNIT: Record<string, string> = { mm: 'mm', deg: '°', ct: 'ct', '%': '%', s: 's', px: 'px' }
export const unitOf = (f: FieldInfo) => (f.meta.unit ? UNIT[f.meta.unit] : undefined)

/** A number; dragging its label scrubs it live and the release is one change. */
export function NumberWidget({ row, label }: WidgetProps) {
  const edit = useFieldEdit()
  const { field } = row
  const value = typeof row.value === 'number' ? row.value : null
  const step = field.meta.step ?? (field.type === 'integer' ? 1 : 0.05)
  const slider = field.widget === 'slider' && (
    <div className="min-w-0 flex-[1.6]">
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
    </div>
  )
  return (
    <NumberField
      size="sm"
      rowLabel={label}
      leading={slider}
      value={value}
      min={field.min}
      max={field.max}
      step={step}
      unit={unitOf(field)}
      disabled={edit.readOnly}
      aria-label={field.title}
      onChange={(v) => v !== null && edit.preview(row.path, v)}
      onCommit={(v) => v !== null && edit.commit(row.path, v)}
    />
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

export function ChoiceWidget({ row }: WidgetProps) {
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
        disabled={edit.readOnly}
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

export function ToggleWidget({ row }: WidgetProps) {
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

/**
 * Text previews as it is typed (the model follows) and becomes one change on blur or Enter;
 * Escape drops what was typed. `row.value` already includes the preview, so the commit is
 * unconditional: the session records nothing when the text is back where it started.
 */
export function TextWidget({ row }: WidgetProps) {
  const edit = useFieldEdit()
  const [draft, setDraft] = useState(String(row.value ?? ''))
  const typing = useRef(false)
  useEffect(() => {
    if (!typing.current) setDraft(String(row.value ?? ''))
  }, [row.value])
  const commit = () => {
    if (!typing.current) return
    typing.current = false
    edit.commit(row.path, draft)
  }
  return (
    <Input
      value={draft}
      disabled={edit.readOnly}
      aria-label={row.field.title}
      onChange={(e) => {
        typing.current = true
        setDraft(e.target.value)
        edit.preview(row.path, e.target.value)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape' && typing.current) {
          typing.current = false
          edit.cancel(row.path)
        }
      }}
      className="h-7"
    />
  )
}

export function Vec3Widget({ row }: WidgetProps) {
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
  const sectionSurfacesOnly = edit.node.kind === 'thickenSurface' && row.field.key === 'surface'
  const exclude = new Set([edit.node.id, ...dependentsOf(edit.design, edit.node.id)])
  return edit.design.order
    .map((id) => edit.design.nodes[id]!)
    .filter(
      (n) =>
        !exclude.has(n.id) &&
        (!kinds || kinds.includes(n.kind)) &&
        (!sectionSurfacesOnly || isSectionSurface(n)),
    )
    .map((n) => ({ value: n.id, label: nodeTitle(n) }))
}

export function RefWidget({ row }: WidgetProps) {
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

/**
 * Several references (a group's children, a combine's tools): the chosen features as removable
 * rows and a menu of the rest, from the same candidates a single reference offers.
 */
export function RefsWidget({ row }: WidgetProps) {
  const edit = useFieldEdit()
  const chosen = Array.isArray(row.value) ? (row.value as string[]) : []
  const options = candidates(row, edit)
  const rest = options.filter((o) => !chosen.includes(o.value))
  const title = (id: string) => (edit.design.nodes[id] ? nodeTitle(edit.design.nodes[id]!) : id)
  const min = row.field.min ?? 0
  return (
    <div className="flex flex-col gap-1">
      {chosen.map((id) => (
        <div
          key={id}
          className="flex h-7 items-center justify-between gap-2 rounded-sm bg-bg-muted pr-0.5 pl-2 text-sm text-fg"
        >
          <span className="truncate">{title(id)}</span>
          {!edit.readOnly && chosen.length > min && (
            <IconButton
              icon={X}
              size="sm"
              label={`Remove ${title(id)}`}
              tooltip={false}
              onClick={() =>
                edit.commit(
                  row.path,
                  chosen.filter((x) => x !== id),
                )
              }
            />
          )}
        </div>
      ))}
      <Select
        value={null}
        options={rest}
        placeholder={
          rest.length ? 'Add…' : chosen.length ? 'Nothing else to add' : 'Nothing to pick'
        }
        disabled={edit.readOnly || rest.length === 0}
        aria-label={`Add to ${row.field.title}`}
        onChange={(v) => edit.commit(row.path, [...chosen, v])}
        className="h-7 w-full"
      />
    </div>
  )
}

/**
 * A file the feature is made from (an imported mesh, a height map): the current one, and a
 * button to upload a replacement. The kernel says when a file does not suit the feature.
 */
export function AssetWidget({ row }: WidgetProps) {
  const edit = useFieldEdit()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const has = typeof row.value === 'string' && row.value.length > 0
  const upload = async (file: File) => {
    if (!classifyImport(file.name)) {
      toast.error('That file type can’t be used', `Use one of ${IMPORT_ACCEPT}.`)
      return
    }
    setBusy(true)
    try {
      const asset = await uploadAsset(file)
      edit.commit(row.path, asset.id)
    } catch (e) {
      toast.error('Upload failed', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">
        {has ? 'Uploaded file' : 'None yet'}
      </span>
      <Button
        size="sm"
        variant="secondary"
        icon={FileUp}
        disabled={edit.readOnly || busy}
        onClick={() => input.current?.click()}
      >
        {busy ? 'Uploading…' : has ? 'Replace' : 'Choose file'}
      </Button>
      <input
        ref={input}
        type="file"
        accept={IMPORT_ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void upload(file)
        }}
      />
    </div>
  )
}

/** Outlines and point lists: shown, edited elsewhere (sketching is not inline). */
export function SummaryWidget({ row }: WidgetProps) {
  const v = row.value
  const text = Array.isArray(v)
    ? `${v.length} ${v.length === 1 ? 'point' : 'points'}`
    : typeof v === 'string' && row.field.widget === 'path'
      ? `Outline · ${v.length.toLocaleString()} characters`
      : '—'
  return <p className="truncate py-1 text-sm text-fg-muted">{text}</p>
}
