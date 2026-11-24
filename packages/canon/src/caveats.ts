/**
 * What Pavé cannot build (research 09 §5 "What the schema cannot express", plus kernel gaps the
 * skeptics found). A caveat is not a rule: it never lints and has no band, so it has its own type.
 */
import type { Caveat } from './model'
import { HEADED, src } from './rules/rule'

const ICED = ['icedPendant'] as const

export const CAVEATS: readonly Caveat[] = [
  {
    id: 'halo.hidden',
    feature: 'Hidden halo',
    fallback:
      'tables face up, so a deep drop makes a skirt: build a visible halo and record a maker note',
    applies: { kinds: ['ring'], archetypes: ['halo'] },
    source: src('K', '§1 Halo: hidden halo'),
    confidence: 'high',
  },
  {
    id: 'threeStone.taperedBaguette',
    feature: 'Tapered baguettes, trapezoids, half-moons',
    fallback: 'straight baguettes at 0.40–0.45 of the centre width, declared as a stand-in',
    applies: { archetypes: ['threeStone'] },
    source: src('K', '§1 Three-stone: pairing'),
    confidence: 'high',
  },
  {
    id: 'rows.frenchCut',
    feature: 'French and U-cut pavé',
    fallback: 'build shared prong and say the setter will cut it',
    applies: { kinds: ['ring'], archetypes: [...HEADED, 'eternity', 'band'] },
    source: src('K', '§1 Rows: shared prong'),
    confidence: 'high',
  },
  {
    id: 'bezel.halfArc',
    feature: 'Half-bezel arc other than 110°',
    fallback: 'the arc is fixed at 110° a side: a wider or narrower grip is a maker note',
    applies: { kinds: ['ring', 'pendant', 'earrings'] },
    source: src('K', '§1 Bezel'),
    confidence: 'high',
  },
  {
    id: 'stones.antiqueCuts',
    feature: 'Antique and fancy cuts',
    fallback:
      'old European, rose, polki, tapered baguette, trapezoid and half-moon are not cuts here: name the stand-in',
    applies: {},
    source: src('K', '§5 What the schema cannot express'),
    confidence: 'high',
  },
  {
    id: 'metals.unsupported',
    feature: 'Alloys and finishes we cannot specify',
    fallback:
      '21k, enamel, per-region plating and hand engraving: pick the nearest alloy and note the rest',
    applies: {},
    source: src('K', '§5 What the schema cannot express'),
    confidence: 'high',
  },
  {
    id: 'iced.scoop',
    feature: 'Scooped back',
    fallback:
      'an outline body cannot be scooped: quote the solid mass and note that the maker may scoop',
    applies: { archetypes: [...ICED] },
    source: src('K', '§2 Mass'),
    confidence: 'high',
  },
  {
    id: 'iced.pavedLinks',
    feature: 'Pavé on chain links',
    fallback: 'a plain Cuban with a maker note, or a tennis chain instead',
    applies: { archetypes: [...ICED, 'cuban', 'tennis'] },
    source: src('K', '§5 What the schema cannot express'),
    confidence: 'high',
  },
  {
    id: 'iced.density',
    feature: 'Pavé density and partial rows on strokes',
    fallback:
      'the kernel does not report iced area yet: compare stone count with 100/(0.866·(d + gap)²) per cm² by hand; on script, one or two clean rows',
    applies: { archetypes: [...ICED, 'namePendant'] },
    source: src('D', '§2 Density, Iced strokes'),
    confidence: 'medium',
  },
  {
    id: 'iced.grillz',
    feature: 'Grillz',
    fallback: 'start from a dental scan, imported as a sculpt with a 0.8 mm wall; never freehand',
    applies: { archetypes: ['custom'] },
    source: src('EJ', '§2 Conventions'),
    confidence: 'medium',
  },
  {
    id: 'chain.styles',
    feature: 'Franco, herringbone, snake and paperclip chains, bezel tennis',
    fallback: 'the nearest of cable, curb, Cuban, Figaro, rope, box and tennis',
    applies: { kinds: ['pendant', 'necklace', 'chain', 'bracelet'] },
    source: src('K', '§5 What the schema cannot express'),
    confidence: 'high',
  },
  {
    id: 'earring.screwBack',
    feature: 'Screw backs',
    fallback: 'model a butterfly and note screw backs for studs from about 1 ct each',
    applies: { kinds: ['earrings'] },
    source: src('EJ', '§3 Stud head'),
    confidence: 'medium',
  },
  {
    id: 'earring.bezelPost',
    feature: 'Posts on bezel studs',
    fallback:
      'the kernel cannot fix a post to a bezel cup yet: build a basket, or a bezel with a maker note for the post',
    applies: { kinds: ['earrings'] },
    source: src('K', 'kernel metal.disconnected on bezel studs, 2026-11-24'),
    confidence: 'high',
  },
  {
    id: 'earring.hollowHoops',
    feature: 'Hollow hoops',
    fallback: 'offer the solid wire limit for the hoop size, or a maker note',
    applies: { kinds: ['earrings'] },
    source: src('D', '§3 Hoops'),
    confidence: 'high',
  },
  {
    id: 'bangle.hinge',
    feature: 'Hinges and box clasps',
    fallback: 'a hinged oval (57–60 × 43–48) is a maker note on a closed bangle',
    applies: { kinds: ['bracelet'] },
    source: src('S', '§3 Bangles'),
    confidence: 'high',
  },
  {
    id: 'signet.championship',
    feature: 'Championship face body',
    fallback:
      'the shank stops at 14 mm: build the face as a separate raised relief (rise 6–10) and quote 40–75 g',
    applies: { archetypes: ['signet'], styles: ['championship'] },
    source: src('S', '§4 Championship ring'),
    confidence: 'medium',
  },
]
