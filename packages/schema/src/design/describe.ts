/**
 * Presentation derived from the node schemas, in one place: what the inspector shows, what the
 * add menu can add, how history rows and the assistant's change chips describe an edit. Every
 * answer is read from the field declarations in ./nodes (through `z.toJSONSchema`, the same view
 * the assistant's tools get), so a new field or node kind needs no UI code. All functions are pure.
 */
import { z } from 'zod'
import { GEM_CUTS, GEM_MATERIALS } from '../domain/gems'
import { FINISHES, METALS, PLATINGS } from '../domain/metals'
import { formatRingSize, type RingSize } from '../domain/sizes'
import { defaultRevolveOffset, revolveProfileError } from './curve'
import { applyOps, type Design, newId, type Op } from './design'
import type { FieldMeta, FieldWidget } from './fields'
import { NODE_SCHEMAS, type Node, type NodeInput, type NodeKind, nodeRefs } from './nodes'

export type FieldType =
  | 'number'
  | 'integer'
  | 'string'
  | 'boolean'
  | 'enum'
  | 'list'
  | 'group'
  | 'variant'

/** The control to render: the declared widget, or one inferred from the field's type. */
export type Widget =
  | FieldWidget
  | 'number'
  | 'toggle'
  | 'ref'
  | 'refs'
  | 'list'
  | 'group'
  | 'variant'

export interface FieldOption {
  value: string
  label: string
}

export interface FieldVariant {
  /** The discriminator (`type`) value. */
  value: string
  title: string
  fields: FieldInfo[]
}

export interface FieldInfo {
  key: string
  title: string
  description?: string
  type: FieldType
  widget: Widget
  meta: FieldMeta
  /** Must be given when creating a node (no default). */
  required: boolean
  default?: unknown
  /** Numeric range, or the item-count range of a list. */
  min?: number
  max?: number
  options?: FieldOption[]
  /** For a choice of variants: each variant's discriminator and fields. */
  variants?: FieldVariant[]
  /** For a nested object such as `transform`. */
  fields?: FieldInfo[]
}

export interface NodeDescription {
  kind: NodeKind
  title: string
  description?: string
  /** The fields a person edits, in declaration order. `id`, `kind`, `name` and `visible` are not fields. */
  fields: FieldInfo[]
}

/** A field `defaultNode` / `variantPatch` could not fill on its own. */
export interface MissingField {
  key: string
  title: string
  /** For references: the node kinds that would satisfy it. */
  refKinds?: readonly string[]
}

// ── Reading the schemas ──────────────────────────────────────────────────────────────────────

interface Json {
  [k: string]: unknown
  type?: string
  title?: string
  description?: string
  properties?: Record<string, Json>
  required?: string[]
  enum?: string[]
  const?: unknown
  oneOf?: Json[]
  items?: Json | false
  prefixItems?: Json[]
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
  default?: unknown
}

const META_KEYS = [
  'title',
  'description',
  'unit',
  'step',
  'group',
  'refKinds',
  'widget',
  'when',
  'advanced',
  'snap',
  'labels',
  'follows',
] as const satisfies readonly (keyof FieldMeta)[]

function metaOf(js: Json): FieldMeta {
  const meta: Record<string, unknown> = {}
  for (const k of META_KEYS) if (js[k] !== undefined) meta[k] = js[k]
  return meta as unknown as FieldMeta
}

/** "dShape" → "D shape", "three-quarter" → "Three quarter". */
export function humanize(id: string): string {
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const LIBRARIES: Partial<Record<FieldWidget, Record<string, { label: string }>>> = {
  metal: METALS,
  finish: FINISHES,
  plating: PLATINGS,
  stone: GEM_MATERIALS,
  cut: GEM_CUTS,
}

function optionLabel(meta: FieldMeta, value: string): string {
  return (
    meta.labels?.[value] ??
    (meta.widget && LIBRARIES[meta.widget]?.[value]?.label) ??
    humanize(value)
  )
}

function fieldsOf(js: Json, skip: readonly string[] = []): FieldInfo[] {
  const required = new Set(js.required ?? [])
  const out: FieldInfo[] = []
  for (const [key, prop] of Object.entries(js.properties ?? {})) {
    if (skip.includes(key)) continue
    const field = fieldOf(key, prop, required.has(key))
    if (field) out.push(field)
  }
  return out
}

function fieldOf(key: string, js: Json, required: boolean): FieldInfo | null {
  // A list of references may be titled on its items (`tools: z.array(ref('Tool', …))`).
  const items = js.type === 'array' && js.items ? js.items : undefined
  const title = js.title ?? items?.title
  if (typeof title !== 'string') return null
  const meta = js.title ? metaOf(js) : metaOf(items!)
  const base = {
    key,
    title,
    ...(js.description ? { description: js.description } : {}),
    meta,
    required,
    ...(js.default !== undefined ? { default: js.default } : {}),
  }
  if (js.oneOf)
    return {
      ...base,
      type: 'variant',
      widget: 'variant',
      variants: js.oneOf.map((v) => {
        const value = String(v.properties?.type?.const)
        return { value, title: optionLabel(meta, value), fields: fieldsOf(v, ['type']) }
      }),
    }
  switch (js.type) {
    case 'number':
    case 'integer':
      return {
        ...base,
        type: js.type,
        widget: meta.widget ?? 'number',
        ...(js.minimum !== undefined ? { min: js.minimum } : {}),
        ...(js.maximum !== undefined ? { max: js.maximum } : {}),
      }
    case 'boolean':
      return { ...base, type: 'boolean', widget: 'toggle' }
    case 'string':
      if (js.enum)
        return {
          ...base,
          type: 'enum',
          widget: meta.widget ?? (js.enum.length <= 4 ? 'segmented' : 'select'),
          options: js.enum.map((value) => ({ value, label: optionLabel(meta, value) })),
        }
      return { ...base, type: 'string', widget: meta.widget ?? (meta.refKinds ? 'ref' : 'text') }
    case 'array': {
      const range = {
        ...(js.minItems !== undefined ? { min: js.minItems } : {}),
        ...(js.maxItems !== undefined ? { max: js.maxItems } : {}),
      }
      if (js.prefixItems?.length === 3)
        return { ...base, type: 'list', widget: meta.widget ?? 'vec3' }
      if (items && items.type === 'string')
        return {
          ...base,
          ...range,
          type: 'list',
          widget: 'refs',
          // A list of node ids takes its kinds from the item declaration.
          meta: items.refKinds ? { ...meta, refKinds: items.refKinds as readonly string[] } : meta,
        }
      return { ...base, ...range, type: 'list', widget: meta.widget ?? 'list' }
    }
    case 'object':
      return { ...base, type: 'group', widget: meta.widget ?? 'group', fields: fieldsOf(js) }
    default:
      return null
  }
}

/**
 * The titled fields of any object schema, read the same way as a node's: a field shows when it
 * declares a `title` (see ./fields). Use it for schemas other than nodes that carry field
 * metadata, e.g. the render scene's inspector (`describeFields(RenderSceneSchema)`).
 */
export function describeFields(schema: z.ZodType, skip: readonly string[] = []): FieldInfo[] {
  return fieldsOf(z.toJSONSchema(schema, { io: 'input' }) as Json, skip)
}

const described = new Map<NodeKind, NodeDescription>()

/** The title, description and fields of a node kind, as the inspector and add menu show them. */
export function describeNode(kind: NodeKind): NodeDescription {
  let d = described.get(kind)
  if (!d) {
    const schema = NODE_SCHEMAS[kind]
    const meta = schema.meta() as { title?: string; description?: string } | undefined
    d = {
      kind,
      title: meta?.title ?? humanize(kind),
      ...(meta?.description ? { description: meta.description } : {}),
      fields: describeFields(schema, ['id', 'kind', 'name', 'visible']),
    }
    described.set(kind, d)
  }
  return d
}

/** A node's display name: its own name, else its kind's title ("Ring band"). */
export function nodeTitle(node: Pick<NodeInput, 'kind'> & { name?: string }): string {
  return node.name || describeNode(node.kind).title
}

/**
 * The fields to show for `value` (a node, or the value of a variant / group field): drops
 * `advanced` fields unless asked, and fields whose `when` condition does not hold. A `when`
 * key that is unset is judged by that field's default.
 */
export function visibleFields(
  fields: readonly FieldInfo[],
  value: Readonly<Record<string, unknown>>,
  opts: { advanced?: boolean } = {},
): FieldInfo[] {
  return fields.filter((f) => {
    if (f.meta.advanced && !opts.advanced) return false
    for (const [k, allowed] of Object.entries(f.meta.when ?? {})) {
      const v = value[k] ?? fields.find((x) => x.key === k)?.default
      if (!allowed.includes(v as string | number | boolean)) return false
    }
    return true
  })
}

// ── Building nodes ───────────────────────────────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Ids of the nodes that (transitively) reference `id`: picking one of them as a ref would cycle. */
function dependentsOf(design: Design, id: string): Set<string> {
  const out = new Set<string>()
  let grew = true
  while (grew) {
    grew = false
    for (const n of Object.values(design.nodes)) {
      if (out.has(n.id)) continue
      if (nodeRefs(n).some((r) => r === id || out.has(r))) {
        out.add(n.id)
        grew = true
      }
    }
  }
  return out
}

interface Picking {
  design: Design
  /** Preferred target (the selection), used whenever its kind fits. */
  prefer?: string
  exclude: ReadonlySet<string>
}

function pickRef(
  p: Picking,
  refKinds: readonly string[] | undefined,
  taken: readonly string[] = [],
) {
  const fits = (id: string | undefined): id is string => {
    const n = id === undefined ? undefined : p.design.nodes[id]
    return (
      n !== undefined &&
      !p.exclude.has(n.id) &&
      !taken.includes(n.id) &&
      (!refKinds || refKinds.includes(n.kind))
    )
  }
  if (fits(p.prefer)) return p.prefer
  return p.design.order.toReversed().find(fits)
}

/** A value for a field that has no default, or undefined when it cannot be chosen automatically. */
function fill(
  f: FieldInfo,
  p: Picking,
  node: Record<string, unknown>,
  preferVariant: boolean,
): unknown {
  if (f.widget === 'ref') return pickRef(p, f.meta.refKinds)
  if (f.widget === 'refs') {
    if (!f.min) return f.required ? [] : undefined
    const taken = Object.values(node).filter((v): v is string => typeof v === 'string')
    const one = pickRef(p, f.meta.refKinds, taken)
    return one === undefined ? undefined : [one]
  }
  if (f.type !== 'variant' || !f.variants) return undefined
  // With a selection, prefer the variant that attaches to it (a stone on the selected band).
  const target = p.prefer === undefined ? undefined : p.design.nodes[p.prefer]
  const attaches = (v: FieldVariant) =>
    target !== undefined &&
    v.fields.some((s) => s.widget === 'ref' && s.meta.refKinds?.includes(target.kind))
  const ordered = [...f.variants.filter(attaches), ...f.variants.filter((v) => !attaches(v))]
  for (const v of ordered) {
    if (f.default !== undefined && !(preferVariant && attaches(v))) break
    const value = variantValue(v, p, {})
    if (value) return value
  }
  return undefined
}

function variantValue(v: FieldVariant, p: Picking, given: Record<string, unknown>) {
  const out: Record<string, unknown> = { type: v.value }
  for (const s of v.fields) {
    if (s.key in given) out[s.key] = given[s.key]
    else if (s.default === undefined) {
      const value = fill(s, p, out, true)
      if (value !== undefined) out[s.key] = value
      else if (s.required) return null
    }
  }
  return out
}

/**
 * A new node of `kind` that fits into `design`: defaults from the schema, references pointed at
 * `hint.target` when its kind fits (else the most recent suitable node), `hint.values` taken as
 * given. When a required field cannot be filled — a pavé with no body to cover, a wire with no
 * path — `node` is null and `missing` says what is needed, so the add menu can say why.
 */
export function defaultNode(
  kind: NodeKind,
  design: Design,
  hint: { target?: string; id?: string; values?: Record<string, unknown> } = {},
): { node: NodeInput | null; missing: MissingField[] } {
  const id = hint.id ?? newId(kind)
  const node: Record<string, unknown> = { ...hint.values, id, kind }
  const p: Picking = { design, prefer: hint.target, exclude: new Set([id]) }
  const missing: MissingField[] = []
  for (const f of describeNode(kind).fields) {
    if (f.key in node) continue
    if (kind === 'pipe' && f.key === 'curve' && 'points' in node) continue
    if (kind === 'revolve' && f.key === 'curve') {
      if ('profile' in node) continue
      const matches = [hint.target, ...design.order.toReversed()]
      const curve = matches
        .map((id) => id && design.nodes[id])
        .find(
          (n) =>
            n &&
            n.kind === 'curve' &&
            !revolveProfileError(n, 'vertical', defaultRevolveOffset(n, 'vertical')),
        )
      if (curve && curve.kind === 'curve') {
        node.curve = curve.id
        node.axis = 'vertical'
        node.axisOffset = defaultRevolveOffset(curve, 'vertical')
      } else missing.push({ key: 'curve', title: 'Closed profile curve' })
      continue
    }
    const value = fill(f, p, node, true)
    if (value !== undefined) node[f.key] = value
    else if (f.required && f.default === undefined)
      missing.push({
        key: f.key,
        title: f.title,
        ...(f.meta.refKinds ? { refKinds: f.meta.refKinds } : {}),
      })
  }
  if (kind === 'pipe' && !('curve' in node) && !('points' in node))
    missing.push({ key: 'points', title: 'A construction curve or path points' })
  return missing.length ? { node: null, missing } : { node: node as NodeInput, missing }
}

/**
 * The `update` patch that switches `node[key]` (a choice of variants, e.g. a stone's placement)
 * to the `next` variant: fields the variants share keep their values, the old variant's own
 * fields are nulled (merge-patch delete), and the new variant's references are filled from
 * `design` as in {@link defaultNode}. `values` supplies anything else (an asset id, a path).
 */
export function variantPatch(
  node: Node,
  key: string,
  next: string,
  opts: { design: Design; values?: Record<string, unknown> },
): { patch: Record<string, unknown> | null; missing: MissingField[] } {
  const field = describeNode(node.kind).fields.find((f) => f.key === key)
  const variant = field?.variants?.find((v) => v.value === next)
  if (!field || !variant) throw new Error(`${node.kind}.${key} has no variant "${next}"`)
  const current = (node as unknown as Record<string, unknown>)[key]
  const cur = isObject(current) ? current : {}
  if (cur.type === next) return { patch: {}, missing: [] }

  const exclude = new Set([node.id, ...dependentsOf(opts.design, node.id)])
  const p: Picking = { design: opts.design, exclude }
  const out: Record<string, unknown> = { type: next }
  const missing: MissingField[] = []
  for (const s of variant.fields) {
    if (opts.values && s.key in opts.values) out[s.key] = opts.values[s.key]
    else if (s.key in cur || s.default !== undefined) continue
    else {
      const value = fill(s, p, out, false)
      if (value !== undefined) out[s.key] = value
      else if (s.required)
        missing.push({
          key: s.key,
          title: s.title,
          ...(s.meta.refKinds ? { refKinds: s.meta.refKinds } : {}),
        })
    }
  }
  for (const k of Object.keys(cur))
    if (k !== 'type' && !variant.fields.some((s) => s.key === k)) out[k] = null
  return missing.length ? { patch: null, missing } : { patch: { [key]: out }, missing }
}

// ── Describing edits ─────────────────────────────────────────────────────────────────────────

/**
 * Composes two JSON merge patches into one with the same effect, or null when merge-patch
 * cannot express it: an object written over a scalar the first patch set, or a variant switched
 * (`type` changed) in an object the first patch wrote, since the switch drops the old variant's
 * keys in between.
 */
function composePatches(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> | null {
  if ('type' in b && b.type !== a.type && Object.keys(a).length > 0) return null
  const out = { ...a }
  for (const [k, bv] of Object.entries(b)) {
    if (!(k in a) || !isObject(bv)) out[k] = bv
    else {
      const av = a[k]
      if (!isObject(av)) return null
      const merged = composePatches(av, bv)
      if (!merged) return null
      out[k] = merged
    }
  }
  return out
}

/**
 * Collapses the ops of one gesture (a slider scrub, a gizmo drag) into the fewest ops with the
 * same effect: successive updates of a node merge into one patch, successive moves of a node
 * keep the last, and empty updates drop. Applying the result equals applying the input.
 */
export function squashOps(ops: readonly Op[]): Op[] {
  const out: Op[] = []
  for (const op of ops) {
    if (op.t === 'update') {
      if (Object.keys(op.patch).length === 0) continue
      // Updates of different nodes commute, so look back past them.
      let i = out.length - 1
      while (i >= 0 && out[i]!.t === 'update' && (out[i] as { id: string }).id !== op.id) i--
      const prev = out[i]
      if (prev?.t === 'update' && prev.id === op.id) {
        const patch = composePatches(prev.patch, op.patch)
        if (patch) {
          out[i] = { t: 'update', id: op.id, patch }
          continue
        }
      }
    } else if (op.t === 'move') {
      const prev = out.at(-1)
      if (prev?.t === 'move' && prev.id === op.id) {
        out[out.length - 1] = op
        continue
      }
    }
    out.push(op)
  }
  return out
}

interface Leaf {
  path: string[]
  value: unknown
}

function leaves(patch: Record<string, unknown>, path: string[] = []): Leaf[] {
  return Object.entries(patch).flatMap(([k, v]) =>
    isObject(v) ? leaves(v, [...path, k]) : [{ path: [...path, k], value: v }],
  )
}

const at = (value: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>((v, k) => (isObject(v) ? v[k] : undefined), value)

/** The field a patch path lands on, following variants by the node's own discriminator. */
function fieldAt(
  kind: NodeKind | undefined,
  path: readonly string[],
  node: unknown,
): FieldInfo | undefined {
  if (!kind || !(kind in NODE_SCHEMAS)) return undefined
  let fields = describeNode(kind).fields
  let field: FieldInfo | undefined
  for (const [i, k] of path.entries()) {
    field = fields.find((f) => f.key === k)
    if (!field) return undefined
    if (field.variants) {
      const type = at(node, [...path.slice(0, i + 1), 'type'])
      fields = field.variants.find((v) => v.value === type)?.fields ?? []
    } else fields = field.fields ?? []
  }
  return field
}

const UNIT: Record<NonNullable<FieldMeta['unit']>, string> = {
  mm: ' mm',
  deg: '°',
  ct: ' ct',
  '%': '%',
  s: ' s',
  px: ' px',
}

function show(value: unknown, field: FieldInfo | undefined): string {
  if (value === null || value === undefined) return 'default'
  // At most 3 decimals, never fewer than the value has: a label states what was written.
  if (typeof value === 'number') return String(Number(value.toFixed(3)))
  if (field?.widget === 'ringSize' && isRingSize(value)) return formatRingSize(value)
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (typeof value === 'string')
    return field?.options
      ? optionLabel(field.meta, value)
      : `“${value.length > 24 ? `${value.slice(0, 23)}…` : value}”`
  if (Array.isArray(value)) return `(${value.map((v) => show(v, undefined)).join(', ')})`
  return '…'
}

const isRingSize = (v: unknown): v is RingSize =>
  isObject(v) && typeof v.system === 'string' && typeof v.value === 'number'

const unitOf = (field: FieldInfo | undefined) => (field?.meta.unit ? UNIT[field.meta.unit] : '')
const titleAt = (field: FieldInfo | undefined, path: readonly string[]) =>
  field?.title ?? humanize(path.at(-1) ?? '')

function nodeLabel(node: { kind?: unknown; name?: unknown } | undefined, fallback: string): string {
  if (!node || typeof node.kind !== 'string' || !(node.kind in NODE_SCHEMAS)) return fallback
  return nodeTitle({
    kind: node.kind as NodeKind,
    name: typeof node.name === 'string' ? node.name : undefined,
  })
}

/** One line of a change's details, as the history panel lists them. */
export interface OpLine {
  sign: '+' | '−' | '~'
  nodeId: string | null
  text: string
}

/**
 * Every op of a change as readable lines ("Ring band · Width at top: 2.2 → 2.6 mm"). `inverse`
 * (stored with each change) supplies the before-values; `design` (any version that still has
 * the nodes) names updated nodes, which the ops alone do not. A node added by an earlier op of
 * the same change is named from that op.
 */
export function describeOps(ops: readonly Op[], inverse: readonly Op[], design?: Design): OpLine[] {
  const removed = (id: string) =>
    inverse.find((x): x is Extract<Op, { t: 'add' }> => x.t === 'add' && x.node.id === id)?.node
  const added = new Map<string, unknown>()
  // `inverse` lists undo ops newest first, so the k-th update of a node in `ops` pairs with the
  // k-th from last inverse update of that node.
  const inverseUpdates = (id: string) =>
    inverse.filter((x): x is Extract<Op, { t: 'update' }> => x.t === 'update' && x.id === id)
  const seen = new Map<string, number>()
  return ops.flatMap((op): OpLine[] => {
    switch (op.t) {
      case 'add':
        added.set(op.node.id, op.node)
        return [{ sign: '+', nodeId: op.node.id, text: nodeLabel(op.node, op.node.id) }]
      case 'remove':
        return [
          {
            sign: '−',
            nodeId: op.id,
            text: nodeLabel(removed(op.id) ?? design?.nodes[op.id], op.id),
          },
        ]
      case 'move':
        return [
          {
            sign: '~',
            nodeId: op.id,
            text: `${nodeLabel(design?.nodes[op.id], op.id)} → position ${op.index + 1}`,
          },
        ]
      case 'setKind':
        return [{ sign: '~', nodeId: null, text: `Piece type → ${op.kind}` }]
      default: {
        const node = (design?.nodes[op.id] ?? added.get(op.id)) as
          | { kind?: NodeKind; name?: string }
          | undefined
        const k = seen.get(op.id) ?? 0
        seen.set(op.id, k + 1)
        const candidates = inverseUpdates(op.id)
        const before = candidates[candidates.length - 1 - k]?.patch ?? {}
        const name = nodeLabel(node, op.id)
        return leaves(op.patch).map(({ path, value }) => {
          const field = fieldAt(node?.kind, path, mergeForLookup(node, op.patch))
          const unit = unitOf(field)
          return {
            sign: '~',
            nodeId: op.id,
            text: `${name} · ${titleAt(field, path)}: ${show(at(before, path), field)} → ${show(value, field)}${unit}`,
          }
        })
      }
    }
  })
}

/** The node with the patch's discriminators applied, so variant fields resolve against the new variant. */
function mergeForLookup(node: unknown, patch: Record<string, unknown>): unknown {
  if (!isObject(node)) return patch
  const out: Record<string, unknown> = { ...node }
  for (const [k, v] of Object.entries(patch)) out[k] = isObject(v) ? mergeForLookup(node[k], v) : v
  return out
}

const LABEL_MAX = 200

/** How one update reads: "Width at top 2.2 → 2.6 mm", "Placement On band → Free", "Band: A, B". */
function updatePhrase(node: Node | undefined, id: string, patch: Record<string, unknown>) {
  const after = mergeForLookup(node, patch)
  const parts: { title: string; text: string }[] = []
  // A variant switch reads as one change of its field; the old variant's nulled keys and the
  // new variant's filled ones are part of it.
  const switched = leaves(patch)
    .filter((l) => l.path.at(-1) === 'type' && l.path.length > 1)
    .map((l) => l.path.slice(0, -1))
    .filter((p) => fieldAt(node?.kind, p, after)?.variants)
  const under = (path: readonly string[], prefix: readonly string[]) =>
    prefix.every((k, i) => path[i] === k)
  for (const prefix of switched) {
    const field = fieldAt(node?.kind, prefix, after)!
    const variantTitle = (v: unknown) =>
      field.variants!.find((x) => x.value === v)?.title ?? show(v, undefined)
    const from = at(node, [...prefix, 'type'])
    const to = at(patch, [...prefix, 'type'])
    if (from !== to)
      parts.push({
        title: field.title,
        text: `${field.title} ${variantTitle(from)} → ${variantTitle(to)}`,
      })
  }
  // A leaf inside a whole-value field (a ring size) reads as a change of that field.
  const wholes = new Map<string, { path: string[]; field: FieldInfo }>()
  for (const { path, value } of leaves(patch)) {
    if (switched.some((p) => under(path, p))) continue
    const parent = path.length > 1 ? fieldAt(node?.kind, path.slice(0, -1), after) : undefined
    if (parent?.widget === 'ringSize') {
      wholes.set(path.slice(0, -1).join('.'), { path: path.slice(0, -1), field: parent })
      continue
    }
    const was = at(node, path)
    // Leaves written back to what they were (a scrub that returned) are no change.
    if (value === was || (value === null && was === undefined)) continue
    const field = fieldAt(node?.kind, path, after)
    parts.push({
      title: titleAt(field, path),
      text: `${titleAt(field, path)} ${show(was, field)} → ${show(value, field)}${unitOf(field)}`,
    })
  }
  for (const { path, field } of wholes.values()) {
    const was = at(node, path)
    const now = at(after, path)
    if (JSON.stringify(was) === JSON.stringify(now)) continue
    parts.push({
      title: field.title,
      text: `${field.title} ${show(was, field)} → ${show(now, field)}`,
    })
  }
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]!.text
  return `${nodeLabel(node, id)}: ${[...new Set(parts.map((p) => p.title))].join(', ')}`
}

/**
 * A short past-tense label for a change, made from its ops and the design they apply to:
 * "Width at top 2.2 → 2.6 mm", "Added Halo", "Ring band: Width at top, Width at base". Used for
 * one-gesture history entries and the assistant's change chips. Ops are read in order against
 * the design as it stands at each one, so an update of a node added earlier in the list is named
 * properly; edits that end where they started are left out.
 */
export function labelForOps(ops: readonly Op[], before: Design): string {
  const phrases: string[] = []
  let working = before
  for (const op of squashOps(ops)) {
    let phrase: string | null
    switch (op.t) {
      case 'add':
        phrase = `Added ${nodeLabel(op.node, op.node.id)}`
        break
      case 'remove':
        phrase = `Removed ${nodeLabel(working.nodes[op.id], op.id)}`
        break
      case 'move':
        phrase = `Reordered ${nodeLabel(working.nodes[op.id], op.id)}`
        break
      case 'setKind':
        phrase = `Changed the piece type to ${op.kind}`
        break
      case 'update':
        phrase = updatePhrase(working.nodes[op.id], op.id, op.patch)
    }
    try {
      working = applyOps(working, [op]).design
    } catch {
      // An op that does not apply still gets its phrase; later ops read the design without it.
    }
    if (phrase && !phrases.includes(phrase)) phrases.push(phrase)
  }
  if (phrases.length === 0) return 'No change'
  const label =
    phrases.length > 3
      ? `${phrases.slice(0, 2).join('; ')} and ${phrases.length - 2} more changes`
      : phrases.join('; ')
  return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1)}…` : label
}
