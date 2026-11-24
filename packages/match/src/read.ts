/**
 * The model-backed "read" (plan §3) as an interface, with a scripted fixture so the whole loop
 * runs without any model. A real reader asks a vision model per region crop, three times; the
 * agreement of those runs, not a stated confidence, sets each field's status.
 *
 * `PhotoRead` here is the part of the plan's read that the fit consumes. The full read extends
 * the canon's `DesignRead`; this package may not import `@pave/canon`, so the two meet in the
 * server job that runs both. No millimetres and no stone counts are ever read from a model.
 */
import type { Design, PieceKind } from '@pave/schema'
import type { ViewSeed } from './camera'
import { mulberry32 } from './rng'
import type { TargetView } from './types'

export type Visibility = 'yes' | 'partly' | 'no'
export interface ReadValue {
  value: string
  visible: Visibility
  /** How many of three runs gave this value. */
  agreement: 1 | 2 | 3
}
export type ReadStatus = 'seen' | 'unsure' | 'assumed'

export interface PhotoRead {
  kind: PieceKind
  /** The recipe: a template id standing in for the canon's archetype. */
  template: ReadValue
  /** Discrete fields by parameter key, values as strings (`head.prongCount` → "4"). */
  fields: Record<string, ReadValue>
  views: { viewId: string; label: ViewSeed | 'onBody' }[]
  sculpted: { present: boolean; regionKeys: string[] }
  notVisible: string[]
}

export interface PhotoReader {
  read(views: TargetView[], o?: { signal?: AbortSignal }): Promise<PhotoRead>
}

/** Three of three and visible is seen; not visible is assumed; anything else is unsure. */
export function readStatus(v: ReadValue | undefined): ReadStatus {
  if (!v || v.visible === 'no') return 'assumed'
  return v.agreement === 3 && v.visible === 'yes' ? 'seen' : 'unsure'
}

/** The current values of discrete fields of a design, as a read would report them. */
export function fieldsOf(d: Design, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of keys) {
    const [id, ...path] = key.split('.')
    let v: unknown = d.nodes[id!]
    for (const p of path) v = (v as Record<string, unknown> | undefined)?.[p]
    if (v !== undefined) out[key] = String(v)
  }
  return out
}

/**
 * A fixture reader: the truth, with seeded errors biased toward the familiar answer (a model
 * that has seen mostly four-claw solitaires says "4"). Errors come back unsure (two of three
 * runs) unless `confident`, which models a reader that is wrong and sure of it.
 */
export function scriptedReader(
  truth: {
    kind: PieceKind
    templateId: string
    fields: Record<string, string>
    views: Record<string, ViewSeed | 'onBody'>
  },
  o: {
    seed?: number
    errorRate?: number
    familiar?: Record<string, string>
    options?: Record<string, string[]>
    confident?: boolean
  } = {},
): PhotoReader & { errors: string[] } {
  const errors: string[] = []
  return {
    errors,
    async read(views) {
      const rnd = mulberry32(o.seed ?? 1)
      const fields: Record<string, ReadValue> = {}
      for (const [key, value] of Object.entries(truth.fields)) {
        let read = value
        if (rnd() < (o.errorRate ?? 0)) {
          const familiar = o.familiar?.[key]
          const others = (o.options?.[key] ?? []).filter((x) => x !== value)
          const wrong =
            familiar && familiar !== value ? familiar : others[Math.floor(rnd() * others.length)]
          if (wrong !== undefined) {
            read = wrong
            errors.push(key)
          }
        }
        const wrong = read !== value
        fields[key] = {
          value: read,
          visible: wrong && !o.confident ? 'partly' : 'yes',
          agreement: wrong && !o.confident ? 2 : 3,
        }
      }
      return {
        kind: truth.kind,
        template: { value: truth.templateId, visible: 'yes', agreement: 3 },
        fields,
        views: views.map((v) => ({ viewId: v.id, label: truth.views[v.id] ?? 'threeQuarter' })),
        sculpted: { present: false, regionKeys: [] },
        notVisible: [],
      }
    },
  }
}
