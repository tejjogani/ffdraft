/**
 * Per-catalogue tables the rules read through facts. Keyed by @pave/schema ids so a new cut,
 * stone or alloy fails the type check here until the canon has an opinion about it.
 */
import {
  GEM_CUT_IDS,
  GEM_CUTS,
  type GemCutId,
  type GemMaterialId,
  type MetalId,
  type NodeOf,
} from '@pave/schema'

type ChainStyle = NodeOf<'chain'>['style']

/**
 * Prong counts by shape: [min, typical, max] for a claw head (research 09 §1 "Prongs by shape").
 * The numbers live in @pave/schema's `GEM_CUTS[cut].prongs`, where the mount rules that pick a
 * head's claw count read them too, so the lint and the default never disagree.
 */
export const PRONGS_BY_CUT = Object.fromEntries(
  GEM_CUT_IDS.map((cut) => {
    const p = GEM_CUTS[cut].prongs
    return [cut, [p.min, p.typical, p.max] as const]
  }),
) as Record<GemCutId, readonly [number, number, number]>

/** Sharp points on the outline; each needs a V-claw (research 09 §1 "Tip"). */
export const POINTS_BY_CUT: Record<GemCutId, number> = {
  round: 0,
  oval: 0,
  princess: 4,
  emerald: 0,
  asscher: 0,
  cushion: 0,
  radiant: 0,
  marquise: 2,
  pear: 1,
  heart: 1,
  baguette: 0,
  trillion: 3,
  cabochon: 0,
}

/** Preferred length:width as [min, typical, max]: defaults, not lints (research 09 §1 "L:W"). */
export const LW_BY_CUT: Partial<Record<GemCutId, readonly [number, number, number]>> = {
  oval: [1.35, 1.42, 1.5],
  pear: [1.5, 1.6, 1.75],
  marquise: [1.75, 2.0, 2.25],
  emerald: [1.35, 1.42, 1.5],
  cushion: [1.0, 1.05, 1.25],
  radiant: [1.0, 1.25, 1.4],
}

/**
 * Wearability: 0 good, 1 fair (note only), 2 poor (no open ring heads, never flush or pavé).
 * Research 09 §1 "Wearability class", to move into GEM_MATERIALS when the schema adopts it.
 */
export const WEAR_CLASS: Record<GemMaterialId, 0 | 1 | 2> = {
  diamond: 0,
  'diamond-lab': 0,
  'diamond-yellow': 0,
  'diamond-pink': 0,
  'diamond-black': 0,
  moissanite: 0,
  cz: 0,
  'sapphire-blue': 0,
  'sapphire-pink': 0,
  'sapphire-yellow': 0,
  'sapphire-white': 0,
  ruby: 0,
  spinel: 0,
  alexandrite: 0,
  emerald: 2,
  opal: 2,
  tanzanite: 2,
  pearl: 2,
  turquoise: 2,
  peridot: 2,
  amethyst: 1,
  citrine: 1,
  garnet: 1,
  tourmaline: 1,
  onyx: 1,
  morganite: 1,
  aquamarine: 1,
  topaz: 1,
}

/**
 * Alloy class for the modifier of research 09 (preamble): 0 pt950/14k and harder (table values),
 * 1 18k, 2 sterling, 3 22k/24k/fine silver (soft), 4 titanium (cannot be sized or cast).
 */
export const ALLOY_CLASS: Record<MetalId, 0 | 1 | 2 | 3 | 4> = {
  'au24k-yellow': 3,
  'au22k-yellow': 3,
  'au18k-yellow': 1,
  'au18k-white': 1,
  'au18k-rose': 1,
  'au14k-yellow': 0,
  'au14k-white': 0,
  'au14k-rose': 0,
  'au10k-yellow': 0,
  'au10k-white': 0,
  'au9k-yellow': 0,
  pt950: 0,
  pt900: 0,
  pd950: 0,
  'ag925-sterling': 2,
  'ag999-fine': 3,
  'ti-grade5': 4,
  brass: 0,
}

/** Metal colour family for the unity rule; plating can change it (rhodium whitens yellow gold). */
export const METAL_COLOUR: Record<MetalId, 'yellow' | 'white' | 'rose'> = {
  'au24k-yellow': 'yellow',
  'au22k-yellow': 'yellow',
  'au18k-yellow': 'yellow',
  'au18k-white': 'white',
  'au18k-rose': 'rose',
  'au14k-yellow': 'yellow',
  'au14k-white': 'white',
  'au14k-rose': 'rose',
  'au10k-yellow': 'yellow',
  'au10k-white': 'white',
  'au9k-yellow': 'yellow',
  pt950: 'white',
  pt900: 'white',
  pd950: 'white',
  'ag925-sterling': 'white',
  'ag999-fine': 'white',
  'ti-grade5': 'white',
  brass: 'yellow',
}

/**
 * Chain mass ≈ k·w²·L·ρ (g, with w and L in mm and ρ in g/cm³ /1000), measured on the kernel's
 * links at the recipe's wire (0.26·w), 2026-11-24. Research 09 §2 gives 0.23 for a trade Cuban
 * and 0.29 for the kernel's; the kernel has since been recalibrated to 0.197. Tennis carries
 * stones and is not estimated. Replace with per-node masses once the summary carries them.
 */
export const CHAIN_MASS_K: Partial<Record<ChainStyle, number>> = {
  cable: 0.195,
  rope: 0.177,
  box: 0.55,
  figaro: 0.13,
  curb: 0.2,
  cuban: 0.197,
}
