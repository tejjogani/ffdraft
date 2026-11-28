/**
 * The node reference: every node kind and field the design document accepts, printed from the
 * node schemas themselves (`NODE_SCHEMAS`), so it cannot drift from what `design.apply`
 * validates. `design.apply` takes nodes as free-form objects (the kernel checks them), which is
 * why the model needs this page to write them. Inspector-only metadata (groups, widgets, steps)
 * is left out; ranges, defaults, units, references and conditions are kept.
 */
import {
  BODY_KINDS,
  FINISH_IDS,
  GEM_CUT_IDS,
  GEM_MATERIAL_IDS,
  METAL_IDS,
  NODE_KINDS,
  NODE_SCHEMAS,
  type NodeKind,
  PLATING_IDS,
  RING_SIZE_SYSTEMS,
} from '@pave/schema'
import { z } from 'zod'

interface Js {
  [k: string]: unknown
  type?: string
  title?: string
  description?: string
  properties?: Record<string, Js>
  required?: string[]
  enum?: string[]
  const?: unknown
  oneOf?: Js[]
  anyOf?: Js[]
  items?: Js
  prefixItems?: Js[]
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
  default?: unknown
  unit?: string
  refKinds?: string[]
  when?: Record<string, unknown[]>
  internal?: boolean
}

/** Value lists printed once at the top instead of under every node that uses them. */
const SHARED: Record<string, readonly string[]> = {
  metal: METAL_IDS,
  finish: FINISH_IDS,
  plating: PLATING_IDS,
  cut: GEM_CUT_IDS,
  stone: GEM_MATERIAL_IDS,
}

const sharedName = (values: readonly string[]): string | null => {
  for (const [name, list] of Object.entries(SHARED))
    if (list.length === values.length && list.every((v, i) => v === values[i])) return name
  return null
}

const UNIT: Record<string, string> = { mm: ' mm', deg: '°', ct: ' ct', '%': '%' }
const num = (n: number) => String(Number(n.toFixed(4)))
const SAFE = Number.MAX_SAFE_INTEGER

/** The fields every node has, explained once in the header. */
const COMMON = new Set(['id', 'kind', 'name', 'visible', 'transform'])

/** Stone objects shared by every stone-bearing node, printed once in the header. */
const SHARED_OBJECTS: Record<string, string> = {
  quality: 'quality',
  sourcing: 'sourcing',
}

function typeOf(js: Js): string {
  if (js.anyOf?.some((option) => option.type === 'null')) return js.anyOf.map(typeOf).join(' | ')
  if (js.enum) {
    const shared = sharedName(js.enum)
    return shared ? `<${shared}>` : js.enum.join(' | ')
  }
  if (js.const !== undefined) return JSON.stringify(js.const)
  if (js.refKinds)
    return js.refKinds.length === BODY_KINDS.length &&
      BODY_KINDS.every((k) => js.refKinds?.includes(k))
      ? 'id of a body node'
      : `id of a ${js.refKinds.join(' / ')} node`
  switch (js.type) {
    case 'number':
    case 'integer': {
      const unit = js.unit ? (UNIT[js.unit] ?? '') : ''
      const lo = js.minimum !== undefined && Math.abs(js.minimum) < SAFE ? num(js.minimum) : null
      const hi = js.maximum !== undefined && Math.abs(js.maximum) < SAFE ? num(js.maximum) : null
      const range = lo !== null && hi !== null ? ` ${lo}–${hi}${unit}` : unit
      return `${js.type === 'integer' ? 'integer' : 'number'}${range}`
    }
    case 'null':
    case 'boolean':
      return js.type
    case 'string':
      return 'string'
    case 'array': {
      if (js.prefixItems?.length === 3) return `[x, y, z]${js.unit ? (UNIT[js.unit] ?? '') : ''}`
      const items = js.items ? typeOf(js.items) : 'any'
      const n =
        js.minItems !== undefined || js.maxItems !== undefined
          ? ` (${js.minItems ?? 0}–${js.maxItems ?? '∞'} items)`
          : ''
      return `list of ${items}${n}`
    }
    case 'object':
      return 'object'
    default:
      return 'any'
  }
}

function notes(js: Js): string {
  const out: string[] = []
  if (js.when)
    out.push(
      `only when ${Object.entries(js.when)
        .map(([k, v]) => `${k} is ${v.join(' or ')}`)
        .join(' and ')}`,
    )
  if (js.description) out.push(js.description)
  return out.length ? `. ${out.join('. ')}` : ''
}

function defaultOf(js: Js): string {
  return js.default === undefined ? '' : ` = ${JSON.stringify(js.default)}`
}

function fieldLines(js: Js, indent: string, skip: ReadonlySet<string>): string[] {
  const required = new Set(js.required ?? [])
  const lines: string[] = []
  for (const [key, prop] of Object.entries(js.properties ?? {})) {
    if (skip.has(key) || prop.internal) continue
    const mark = required.has(key) && prop.default === undefined ? ' (required)' : ''
    const variants = prop.oneOf ?? prop.anyOf
    const sharedObject = indent === '' ? SHARED_OBJECTS[key] : undefined
    if (sharedObject) lines.push(`${indent}- ${key}: <${sharedObject}>, optional`)
    else if (variants && variants.every((v) => v.properties?.type?.const !== undefined)) {
      lines.push(`${indent}- ${key}${mark}: one of${defaultOf(prop)}${notes(prop)}`)
      for (const v of variants) {
        lines.push(`${indent}  - type ${JSON.stringify(v.properties?.type?.const)}:`)
        lines.push(...fieldLines(v, `${indent}    `, new Set(['type'])))
      }
    } else if (prop.type === 'object' && prop.properties) {
      lines.push(`${indent}- ${key}${mark}: object${defaultOf(prop)}${notes(prop)}`)
      lines.push(...fieldLines(prop, `${indent}  `, new Set()))
    } else lines.push(`${indent}- ${key}${mark}: ${typeOf(prop)}${defaultOf(prop)}${notes(prop)}`)
  }
  return lines
}

function nodeSection(kind: NodeKind): string[] {
  const schema = NODE_SCHEMAS[kind]
  const js = z.toJSONSchema(schema, { io: 'input' }) as Js
  const meta = (schema.meta() ?? {}) as { title?: string; description?: string }
  const head = `## ${kind}: ${meta.title ?? kind}${meta.description ? `. ${meta.description}` : ''}`
  return [head, ...fieldLines(js, '', COMMON)]
}

/** The first stone-bearing node's object field, printed once as a shared block. */
function sharedObject(key: string): string[] {
  const js = z.toJSONSchema(NODE_SCHEMAS.gem, { io: 'input' }) as Js
  const prop = js.properties?.[key]
  return prop ? fieldLines(prop, '  ', new Set()) : []
}

function build(): string {
  return [
    '# Node reference',
    'Generated from the node schemas: what design.apply accepts. A design is a flat map of nodes that refer to each other by id. Space: millimetres, Z up. A ring is centred on the origin with the finger along Y and the head at +Z; flat pieces stand in the XZ plane facing −Y. Angles are degrees. A field left out takes the default after "=". Nested objects merge on update (JSON merge patch); lists and values replace; null deletes a field.',
    'Every node has: id (unique string you choose, e.g. "head" or "row-left"), kind, name (optional label), visible = true, transform (optional, rarely needed: position [x, y, z] mm, rotation [x, y, z]°, scale).',
    'Shared value lists:',
    ...Object.entries(SHARED).map(([name, list]) => `- <${name}>: ${list.join(', ')}`),
    `- ring size systems: ${RING_SIZE_SYSTEMS.join(', ')}`,
    `- body nodes (solids that host stones, bails, findings, engravings and booleans): ${BODY_KINDS.join(', ')}`,
    '- <quality> (what to buy; the stone list and sourcing read it):',
    ...sharedObject('quality'),
    '- <sourcing> (a real stone linked by the sourcing workflow; do not write it yourself):',
    ...sharedObject('sourcing'),
    ...NODE_KINDS.flatMap(nodeSection),
  ].join('\n')
}

export const NODE_REFERENCE = build()
