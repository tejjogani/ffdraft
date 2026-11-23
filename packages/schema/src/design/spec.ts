/**
 * The piece spec: what the assistant pins down with the designer before any geometry exists.
 * It is deliberately small and human-readable — the "plan" shown for confirmation — and it is
 * turned into a design by a recipe (see ../recipes).
 */
import { z } from 'zod'
import { GEM_CUT_IDS, GEM_MATERIAL_IDS } from '../domain/gems'
import { FINISH_IDS, METAL_IDS, PLATING_IDS } from '../domain/metals'
import { RING_SIZE_SYSTEMS } from '../domain/sizes'
import { PIECE_KINDS } from './design'

export const ARCHETYPES = [
  'solitaire',
  'halo',
  'threeStone',
  'eternity',
  'band',
  'signet',
  'pendantSolitaire',
  'namePendant',
  'icedPendant',
  'medallion',
  'studs',
  'tennis',
  'cuban',
  'custom',
] as const
export type Archetype = (typeof ARCHETYPES)[number]

export const StoneSpec = z.object({
  role: z.enum(['center', 'side', 'accent', 'halo', 'pave']),
  cut: z.enum(GEM_CUT_IDS).default('round'),
  stone: z.enum(GEM_MATERIAL_IDS).default('diamond'),
  /** Give one of carat or widthMm; carat wins. */
  carat: z.number().positive().max(100).optional(),
  widthMm: z.number().positive().max(40).optional(),
  lw: z.number().min(0.8).max(5).optional(),
  count: z.number().int().positive().max(5000).optional(),
  setting: z.enum(['prong', 'basket', 'bezel', 'halfBezel', 'flush', 'pave', 'channel']).optional(),
  prongs: z.number().int().min(3).max(8).optional(),
  quality: z
    .object({
      color: z.string().max(20).optional(),
      clarity: z.string().max(20).optional(),
      origin: z.enum(['natural', 'lab', 'any']).optional(),
      certified: z.boolean().optional(),
    })
    .optional(),
})
export type StoneSpec = z.infer<typeof StoneSpec>

export const PieceSpecSchema = z.object({
  kind: z.enum(PIECE_KINDS),
  archetype: z.enum(ARCHETYPES).describe('Closest known construction; "custom" when none fits.'),
  title: z.string().max(120),
  summary: z.string().max(1200).describe('One short paragraph a client could read.'),
  style: z.array(z.string().max(40)).max(12).default([]),
  metal: z
    .object({
      alloy: z.enum(METAL_IDS).default('au18k-yellow'),
      finish: z.enum(FINISH_IDS).default('polished'),
      plating: z.enum(PLATING_IDS).default('none'),
    })
    .default({ alloy: 'au18k-yellow', finish: 'polished', plating: 'none' }),
  ring: z
    .object({
      size: z.object({ system: z.enum(RING_SIZE_SYSTEMS), value: z.number() }),
      bandWidthMm: z.number().min(1).max(14).optional(),
      bandThicknessMm: z.number().min(0.9).max(5).optional(),
      profile: z.enum(['court', 'dShape', 'flat', 'flatCourt', 'knifeEdge']).optional(),
      shoulder: z.enum(['plain', 'cathedral', 'split']).optional(),
    })
    .optional(),
  /** Overall size for pendants, charms, earrings. */
  body: z
    .object({
      heightMm: z.number().min(3).max(200),
      thicknessMm: z.number().min(0.6).max(30).optional(),
      /** What the body is: text for name pendants, a prompt/asset for sculpted pieces. */
      text: z.string().max(60).optional(),
      shape: z.string().max(40).optional(),
      meshAssetId: z.string().optional(),
      iceLevel: z.number().min(0).max(1).optional(),
    })
    .optional(),
  chain: z
    .object({
      style: z.enum(['cable', 'curb', 'cuban', 'figaro', 'rope', 'box', 'tennis']),
      lengthMm: z.number().min(100).max(900),
      widthMm: z.number().min(0.8).max(25),
    })
    .optional(),
  stones: z.array(StoneSpec).max(12).default([]),
  engraving: z.string().max(60).optional(),
  targetWeightG: z.number().positive().optional(),
  budgetUsd: z.number().positive().optional(),
  notes: z.string().max(2000).optional(),
  /** Anything the assistant still needs from the designer before building. */
  openQuestions: z.array(z.string().max(200)).max(8).default([]),
})
export type PieceSpec = z.infer<typeof PieceSpecSchema>
export type PieceSpecInput = z.input<typeof PieceSpecSchema>
