/**
 * Field builders. Every design parameter is declared once, here-style, with its range, default
 * and presentation metadata. The inspector UI, the agent's tool schemas and validation are all
 * derived from the resulting zod schema (via `z.toJSONSchema`), so nothing is described twice.
 */
import { z } from 'zod'

/** Widgets a field may ask for. The library widgets (`metal`, `stone`, `cut`, …) pick from @pave/schema's catalogues. */
export const FIELD_WIDGETS = [
  'slider',
  'segmented',
  'select',
  'text',
  'textarea',
  'vec3',
  'path',
  'asset',
  'ringSize',
  'stoneSize',
  'metal',
  'finish',
  'plating',
  'stone',
  'cut',
] as const
export type FieldWidget = (typeof FIELD_WIDGETS)[number]

export interface FieldMeta {
  title: string
  description?: string
  unit?: 'mm' | 'deg' | 'ct' | '%' | 's' | 'px'
  step?: number
  /** Inspector section this field is grouped under. */
  group?: string
  /** For node references: which node kinds may be picked. */
  refKinds?: readonly string[]
  /** Hint for the widget; inferred from the type when omitted. */
  widget?: FieldWidget
  /** Only show when another field has one of the given values. */
  when?: Record<string, readonly (string | number | boolean)[]>
  /** Fine-tuning a designer rarely needs: hidden behind "Fine-tune" in the inspector. */
  advanced?: boolean
  /** Values snap to stock sizes: `melee` = calibrated melee diameters (`MELEE_SIZES_MM`). */
  snap?: 'melee'
  /** Human labels for enum values whose ids do not read well ("dShape" → "D-shape"). */
  labels?: Record<string, string>
}

type Opts = Omit<FieldMeta, 'title' | 'unit'>

const num =
  (unit: FieldMeta['unit'], defaultStep: number) =>
  (title: string, min: number, max: number, def: number, opts: Opts = {}) =>
    z
      .number()
      .min(min)
      .max(max)
      .default(def)
      .meta({ title, unit, step: defaultStep, ...opts })

/** Length in millimetres. */
export const mm = num('mm', 0.05)
/** Angle in degrees. */
export const deg = num('deg', 1)
/** Unitless ratio / fraction. */
export const ratio = num(undefined, 0.01)

export const int = (title: string, min: number, max: number, def: number, opts: Opts = {}) =>
  z
    .number()
    .int()
    .min(min)
    .max(max)
    .default(def)
    .meta({ title, step: 1, ...opts })

export const choice = <const T extends readonly [string, ...string[]]>(
  title: string,
  values: T,
  def: T[number],
  opts: Opts = {},
) => z.enum(values).default(def).meta({ title, ...opts })

export const toggle = (title: string, def: boolean, opts: Opts = {}) =>
  z
    .boolean()
    .default(def)
    .meta({ title, ...opts })

export const text = (title: string, def: string, opts: Opts = {}) =>
  z
    .string()
    .max(4000)
    .default(def)
    .meta({ title, ...opts })

/** Reference to another node in the same design. */
export const ref = (title: string, refKinds: readonly string[], opts: Opts = {}) =>
  z.string().meta({ title, refKinds, ...opts })

export const vec3 = (title: string, def: [number, number, number], opts: Opts = {}) =>
  z
    .tuple([z.number(), z.number(), z.number()])
    .default(def)
    .meta({ title, widget: 'vec3', ...opts })
