/**
 * Schema paths (`<nodeKind>.<field>[.<field>]`) resolved against the node schemas' JSON Schema,
 * so ranges, steps and stock-size snapping are read from @pave/schema, never restated here.
 */
import { MELEE_SIZES_MM, NODE_SCHEMAS, type Node, type NodeKind } from '@pave/schema'
import { z } from 'zod'

export interface FieldInfo {
  type?: string
  minimum?: number
  maximum?: number
  step?: number
  snap?: 'melee'
  enum?: string[]
}

type JsonSchema = {
  type?: string
  minimum?: number
  maximum?: number
  step?: number
  snap?: 'melee'
  enum?: string[]
  properties?: Record<string, JsonSchema>
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
}

const cache = new Map<NodeKind, JsonSchema>()
const jsonOf = (kind: NodeKind): JsonSchema => {
  let s = cache.get(kind)
  if (!s) {
    s = z.toJSONSchema(NODE_SCHEMAS[kind], { io: 'input', unrepresentable: 'any' }) as JsonSchema
    cache.set(kind, s)
  }
  return s
}

const child = (s: JsonSchema, key: string): JsonSchema | undefined =>
  s.properties?.[key] ??
  [...(s.anyOf ?? []), ...(s.oneOf ?? [])].map((o) => child(o, key)).find((c) => c !== undefined)

/** The kind a path is on and the field path inside the node. */
export function splitPath(path: string): { kind: NodeKind; fields: string[] } | undefined {
  const [kind, ...fields] = path.split('.')
  return kind && kind in NODE_SCHEMAS && fields.length
    ? { kind: kind as NodeKind, fields }
    : undefined
}

/** JSON Schema facts for a path, or undefined when the schema has no such field. */
export function fieldInfo(path: string): FieldInfo | undefined {
  const p = splitPath(path)
  if (!p) return undefined
  let s: JsonSchema | undefined = jsonOf(p.kind)
  for (const f of p.fields) s = s && child(s, f)
  if (!s) return undefined
  const { type, minimum, maximum, step, snap } = s
  return { type, minimum, maximum, step, snap, ...(s.enum ? { enum: s.enum } : {}) }
}

/** Placement angles are signed by side; rules speak in magnitudes. */
const SIGNED = new Set(['placement.angle'])

/** The value of a path on a node (magnitude for signed fields), when it is a number. */
export function readPath(node: Node, path: string): number | undefined {
  const p = splitPath(path)
  if (!p || p.kind !== node.kind) return undefined
  let v: unknown = node
  for (const f of p.fields)
    v = v && typeof v === 'object' ? (v as Record<string, unknown>)[f] : undefined
  if (typeof v !== 'number') return undefined
  return SIGNED.has(p.fields.join('.')) ? Math.abs(v) : v
}

/** A merge patch that sets `fields` to `value` (keeping the sign of a signed field). */
export function patchFor(
  node: Node,
  path: string,
  value: number | string,
): Record<string, unknown> {
  const p = splitPath(path)
  if (!p) return {}
  const joined = p.fields.join('.')
  let out: unknown = value
  if (typeof value === 'number' && SIGNED.has(joined)) {
    const current = p.fields.reduce<unknown>(
      (v, f) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[f] : undefined),
      node,
    )
    // A side stone that follows (no angle stored yet) takes the sign of its side.
    const side = (node as { placement?: { side?: string } }).placement?.side
    out = (typeof current === 'number' ? current < 0 : side === 'left') ? -value : value
  }
  for (const f of [...p.fields].reverse()) out = { [f]: out }
  return out as Record<string, unknown>
}

/** Rounds a value onto the field's grid, staying inside [lo, hi] when the grid allows. */
export function roundFor(path: string, value: number, lo = -Infinity, hi = Infinity): number {
  const info = fieldInfo(path)
  const step = info?.type === 'integer' ? 1 : (info?.step ?? 0.01)
  const clampSchema = (x: number) =>
    Math.min(info?.maximum ?? Infinity, Math.max(info?.minimum ?? -Infinity, x))
  const fix = (x: number) => Number(x.toFixed(4))
  if (info?.snap === 'melee') {
    // Stock melee only: the nearest calibrated size inside [lo, hi], else the nearest at all.
    const inside = MELEE_SIZES_MM.filter((m) => m >= lo - 1e-9 && m <= hi + 1e-9)
    const pool = inside.length ? inside : MELEE_SIZES_MM
    return pool.reduce((a, b) => (Math.abs(b - value) < Math.abs(a - value) ? b : a))
  }
  let r = fix(Math.round(value / step) * step)
  if (r < lo - 1e-9) r = fix(Math.ceil(lo / step - 1e-9) * step)
  if (r > hi + 1e-9) r = fix(Math.floor(hi / step + 1e-9) * step)
  // No grid point inside [lo, hi]: the exact bound beats a tidy number outside the range.
  if (r < lo - 1e-9 || r > hi + 1e-9) r = fix(Math.min(hi, Math.max(lo, value)))
  return clampSchema(r)
}
