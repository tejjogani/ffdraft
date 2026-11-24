/**
 * Free numbers of a fit, read from the schema's field declarations (`describeNode`), and the ops
 * that apply a candidate. A key is `${nodeId}.${field path}`, as in the canon's RECIPE_PARAMS.
 */
import {
  type Design,
  describeNode,
  type FieldInfo,
  type NodeKind,
  type Op,
  resolveDesign,
  snapToMelee,
} from '@pave/schema'
import type { FitParam } from './types'

type AnyNode = Record<string, unknown> & { kind: NodeKind }

function parseKey(key: string) {
  const [nodeId, ...path] = key.split('.')
  if (!nodeId || !path.length) throw new Error(`paramsFor: "${key}" is not nodeId.field`)
  return { nodeId, path }
}

/** The field at `path`, entering groups and the variant the node currently uses. */
function fieldAt(node: AnyNode, path: string[], key: string): { field: FieldInfo; value: unknown } {
  let fields = describeNode(node.kind).fields
  let value: unknown = node
  let field: FieldInfo | undefined
  for (const [i, name] of path.entries()) {
    field = fields.find((f) => f.key === name)
    if (!field)
      throw new Error(
        `paramsFor: "${key}": ${node.kind} has no field "${path.slice(0, i + 1).join('.')}"`,
      )
    value = (value as Record<string, unknown> | undefined)?.[name] ?? field.default
    if (i === path.length - 1) break
    if (field.type === 'group') fields = field.fields ?? []
    else if (field.type === 'variant') {
      const type = (value as { type?: string } | undefined)?.type
      const variant = field.variants?.find((v) => v.value === type)
      if (!variant) throw new Error(`paramsFor: "${key}": no variant "${type}"`)
      fields = variant.fields
    } else throw new Error(`paramsFor: "${key}": "${name}" has no sub-fields`)
  }
  return { field: field!, value }
}

export function paramsFor(
  d: Design,
  keys: string[],
  o: {
    bands?: Record<string, [number, number]>
    pins?: Record<string, number>
    ties?: Record<string, string[]>
  } = {},
): FitParam[] {
  // Start from what is built: follow fields left to the stone have no stored value.
  const built = resolveDesign(d)
  return keys.map((key) => {
    const { nodeId, path } = parseKey(key)
    const node = built.nodes[nodeId] as AnyNode | undefined
    if (!node) throw new Error(`paramsFor: "${key}": no node "${nodeId}"`)
    const { field, value } = fieldAt(node, path, key)
    if (field.type !== 'number' && field.type !== 'integer')
      throw new Error(`paramsFor: "${key}" is not a number (${field.type})`)
    if (field.min === undefined || field.max === undefined)
      throw new Error(`paramsFor: "${key}" declares no range`)
    let min = field.min
    let max = field.max
    const band = o.bands?.[key]
    if (band) {
      min = Math.max(min, Math.min(band[0], band[1]))
      max = Math.min(max, Math.max(band[0], band[1]))
      if (min > max)
        throw new Error(
          `paramsFor: "${key}": band [${band}] is outside [${field.min}, ${field.max}]`,
        )
    }
    const integer = field.type === 'integer'
    let start = typeof value === 'number' ? value : (min + max) / 2
    start = Math.min(max, Math.max(min, start))
    const p: FitParam = {
      key,
      nodeId,
      path,
      min,
      max,
      step: field.meta.step ?? (integer ? 1 : 0.01),
      start,
      ...(integer ? { integer } : {}),
      ...(field.meta.snap ? { snap: field.meta.snap } : {}),
      ...(o.ties?.[key] ? { tie: o.ties[key] } : {}),
    }
    const pin = o.pins?.[key]
    if (pin !== undefined) Object.assign(p, { min: pin, max: pin, start: pin, pinned: true })
    return p
  })
}

/** The value a parameter actually takes: clamped, rounded for integers, snapped for melee. */
export function settle(p: FitParam, v: number): number {
  let x = Math.min(p.max, Math.max(p.min, v))
  if (p.integer) x = Math.round(x)
  if (p.snap === 'melee') x = snapToMelee(x)
  return x
}

function setPath(patch: Record<string, unknown>, path: string[], v: number) {
  let o = patch
  for (const name of path.slice(0, -1)) {
    o[name] ??= {}
    o = o[name] as Record<string, unknown>
  }
  o[path[path.length - 1]!] = v
}

/** One `update` op per node, as JSON merge patches: nested fields merge, the variant stays. */
export function opsFor(params: FitParam[], values: number[]): Op[] {
  const patches = new Map<string, Record<string, unknown>>()
  const put = (nodeId: string, path: string[], v: number) => {
    let p = patches.get(nodeId)
    if (!p) {
      p = {}
      patches.set(nodeId, p)
    }
    setPath(p, path, v)
  }
  params.forEach((p, i) => {
    const v = settle(p, values[i] ?? p.start)
    put(p.nodeId, p.path, v)
    for (const t of p.tie ?? []) {
      const k = parseKey(t)
      put(k.nodeId, k.path, v)
    }
  })
  return [...patches].map(([id, patch]) => ({ t: 'update', id, patch }))
}
