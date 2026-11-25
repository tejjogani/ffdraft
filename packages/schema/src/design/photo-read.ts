/**
 * A read of a photo of a piece (`reference.read`): what the piece is, part by part, and what the
 * photo does not show. It is the structured answer of one vision call, so it is written in the
 * piece spec's own words (kinds, archetypes, cuts, settings, band profiles) and maps straight
 * onto a spec. Proportions are ratios, never millimetres: scale is not in a photo. Every part
 * says whether it is visible, so a value the photo hides is reported as assumed, not seen.
 *
 * The schema is also the structured-output format sent to Claude, so it stays inside what that
 * accepts: every field required (null when unknown), enums, no numeric or length limits.
 */
import { z } from 'zod'
import { GEM_CUT_IDS } from '../domain/gems'
import { FINISH_IDS } from '../domain/metals'
import { PIECE_KINDS } from './design'
import { ARCHETYPES, StoneSpec } from './spec'

export const VISIBILITY = ['yes', 'partly', 'no'] as const
export const Visibility = z
  .enum(VISIBILITY)
  .describe('yes = clearly seen; partly = seen in part or at a steep angle; no = hidden.')

/** Camera angles a photo is read as; the first six are the viewport's capture angles. */
export const PHOTO_VIEWS = [
  'top',
  'front',
  'side',
  'threeQuarter',
  'back',
  'under',
  'onBody',
  'other',
] as const
export type PhotoView = (typeof PHOTO_VIEWS)[number]

export const METAL_COLOURS = ['yellow', 'white', 'rose', 'twoTone', 'black', 'other'] as const

const ratio = (what: string) => z.number().nullable().describe(`${what}; null when not visible.`)

export const PhotoStoneSchema = z.object({
  role: StoneSpec.shape.role,
  cut: z.enum(GEM_CUT_IDS),
  arrangement: z
    .enum(['single', 'pair', 'three', 'halo', 'row', 'cluster', 'field', 'scatter'])
    .describe('How the stones of this group sit: one, two, three in a line, around a centre, …'),
  setting: StoneSpec.shape.setting.unwrap(),
  prongs: z
    .number()
    .int()
    .nullable()
    .describe('Claws holding one stone of this group, counted on the head itself; null if hidden.'),
  countVisible: z
    .number()
    .int()
    .nullable()
    .describe(
      'Stones you can count, only up to about ten; null for more (the kernel counts those).',
    ),
  widthToCentre: ratio("This stone's width over the centre stone's width (1 for the centre)"),
  visible: Visibility,
})
export type PhotoStone = z.infer<typeof PhotoStoneSchema>

export const PhotoReadSchema = z.object({
  observations: z
    .string()
    .describe(
      'First, in a few plain lines, part by part (head, shoulders, band, gallery, body, bail, chain): what you see and how sure you are.',
    ),
  kind: z.object({ value: z.enum(PIECE_KINDS), visible: Visibility }),
  view: z.enum(PHOTO_VIEWS).describe('The capture angle closest to the photo’s camera.'),
  archetype: z.object({
    value: z.enum(ARCHETYPES).describe('Closest known construction; "custom" when none fits.'),
    visible: Visibility,
  }),
  stones: z.array(PhotoStoneSchema).describe('One entry per group of like stones, centre first.'),
  band: z
    .object({
      profile: z.enum(['court', 'dShape', 'flat', 'flatCourt', 'knifeEdge']).nullable(),
      shoulder: z.enum(['plain', 'cathedral', 'split']).nullable(),
      widthToStone: ratio("The band's width at the top over the centre stone's width"),
      taperTopToBottom: ratio("The band's width at the top over its width at the bottom"),
      visible: Visibility,
    })
    .nullable()
    .describe('Rings only; null for other pieces.'),
  body: z
    .object({
      shape: z.string().describe('The outline in a few words: "heart", "round medallion", …'),
      thicknessToHeight: ratio("The body's thickness over its height"),
      sculpted: z
        .boolean()
        .describe('True when no recipe explains the body (a figure, a crest, an organic form).'),
      visible: Visibility,
    })
    .nullable()
    .describe('Pendants, charms and earrings; null for rings without a body.'),
  metal: z.object({
    colour: z.enum(METAL_COLOURS),
    finish: z.enum(FINISH_IDS),
    visible: Visibility,
  }),
  notVisible: z
    .array(z.string())
    .describe('Parts the photo hides (the back, the gallery, the inside of the band, depth).'),
  unsure: z
    .array(z.object({ field: z.string(), why: z.string() }))
    .describe(
      'Fields you are not sure of, and the question or second photo that would settle each.',
    ),
  plainBackground: z
    .boolean()
    .describe(
      'True when the piece stands on a plain, even background that a cut-out can separate.',
    ),
})
export type PhotoRead = z.infer<typeof PhotoReadSchema>
