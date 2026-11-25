/**
 * Design directions: two to four distinct takes on one brief, each a one-line idea plus a built
 * parametric variant, compared side by side before any CAD work starts.
 *
 * Directions are alternatives of one piece, not pieces of their own: they come before the piece
 * has an identity, a person returns to them on that piece ("show me B again"), and the chosen one
 * becomes the piece's design as one undoable change. Separate pieces would fill the library with
 * drafts and need a link back that the schema does not have (`pieces.duplicate` copies, it does
 * not relate; collections group finished work; render variants are render-only). So a piece
 * carries its directions in one field, and the contract grows by that field and three commands.
 *
 * Pure: the server builds and stores them; the studio and the assistant read them.
 */
import { z } from 'zod'
import { DesignSchema } from './design'
import { type PieceSpec, PieceSpecSchema, type StoneSpec } from './spec'

const id = z.string()

/** How many directions a piece keeps; the oldest unchosen ones give way to new ones. */
export const MAX_DIRECTIONS = 12

/**
 * What a direction can lend to a mix ("the band of B with the head of A"):
 * - head: the archetype and the hero stones with their settings (centre, side, halo), or a
 *   pendant's body;
 * - band: the band's width, thickness, profile and shoulders with the stones set in it (accent,
 *   pavé), or a pendant's chain;
 * - metal: alloy, finish and plating;
 * - style: the style words.
 * The ring size always stays the base's: it is the wearer's, not the design's.
 */
export const MIX_PARTS = ['head', 'band', 'metal', 'style'] as const
export type MixPart = (typeof MIX_PARTS)[number]

const HEAD_ROLES: readonly StoneSpec['role'][] = ['center', 'side', 'halo']

export const DirectionFactsSchema = z.object({
  metalMassG: z.number(),
  caratTotal: z.number(),
  stoneCount: z.number(),
  metal: z.string(),
  /** Overall size in millimetres. */
  boundsMm: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  /** A rough cost from the production estimate's placeholder rates; null when it cannot price it. */
  costUsd: z.number().nullable(),
  /** Kernel errors and warnings on the built variant (stones that do not fit, thin walls). */
  errors: z.number().int(),
  warnings: z.number().int(),
})
export type DirectionFacts = z.infer<typeof DirectionFactsSchema>

/** One direction as the studio and the assistant see it (the built design stays on the server). */
export const DirectionSchema = z.object({
  id,
  /** A, B, C…, in the order proposed; never reused on the piece, so "B" keeps meaning B. */
  letter: z.string(),
  /** Two to four words. */
  name: z.string(),
  /** The one-line idea. */
  idea: z.string(),
  /** The honest cost of the idea (budget, durability, comfort); empty when none was given. */
  tradeOff: z.string(),
  spec: PieceSpecSchema,
  /** Null when no geometry engine could evaluate the variant. */
  facts: DirectionFactsSchema.nullable(),
  /** The canon's style findings and the recipe's notes, as sentences. */
  notes: z.array(z.string()),
  /** Identical shaded-clay views (hero first); empty when the server cannot draw. */
  previewAssetIds: z.array(id),
  origin: z.enum(['assistant', 'template', 'mix', 'person']),
  /** For a mix: which direction lent which parts ("Band of B, head of A"). */
  basis: z.string().nullable(),
  runId: id.nullable(),
  toolCallId: z.string().nullable(),
  createdAt: z.string(),
})
export type Direction = z.infer<typeof DirectionSchema>

/** As stored on the piece: the direction plus the design built for it. */
export const StoredDirectionSchema = DirectionSchema.extend({ design: DesignSchema })
export type StoredDirection = z.infer<typeof StoredDirectionSchema>

/** The letter of the n-th direction proposed on a piece (1-based): A…Z, then AA, AB… */
export function directionLetter(n: number): string {
  let out = ''
  for (let k = Math.max(1, Math.floor(n)); k > 0; k = Math.floor((k - 1) / 26))
    out = String.fromCharCode(65 + ((k - 1) % 26)) + out
  return out
}

/**
 * A mix: the base direction's spec with parts taken from others. Later takes win over earlier
 * ones for the same part. Throws on a part taken from a piece of another kind, which has no
 * matching part.
 */
export function mixSpecs(
  base: PieceSpec,
  takes: readonly { spec: PieceSpec; parts: readonly MixPart[] }[],
): PieceSpec {
  let out: PieceSpec = structuredClone(base)
  for (const take of takes) {
    const from = take.spec
    if (from.kind !== out.kind) throw new Error(`A ${from.kind} has no parts to lend a ${out.kind}`)
    for (const part of take.parts) out = lend(out, from, part)
  }
  return out
}

function lend(to: PieceSpec, from: PieceSpec, part: MixPart): PieceSpec {
  const isHead = (s: StoneSpec) => HEAD_ROLES.includes(s.role)
  switch (part) {
    case 'head':
      return {
        ...to,
        archetype: from.archetype,
        stones: [...from.stones.filter(isHead), ...to.stones.filter((s) => !isHead(s))].map((s) =>
          structuredClone(s),
        ),
        ...(from.body ? { body: structuredClone(from.body) } : {}),
      }
    case 'band': {
      const ring = from.ring
        ? { ...structuredClone(from.ring), size: structuredClone((to.ring ?? from.ring).size) }
        : to.ring
      const next: PieceSpec = {
        ...to,
        stones: [...to.stones.filter(isHead), ...from.stones.filter((s) => !isHead(s))].map((s) =>
          structuredClone(s),
        ),
      }
      if (ring) next.ring = ring
      if (from.chain) next.chain = structuredClone(from.chain)
      return next
    }
    case 'metal':
      return { ...to, metal: structuredClone(from.metal) }
    case 'style':
      return { ...to, style: [...from.style] }
  }
}
