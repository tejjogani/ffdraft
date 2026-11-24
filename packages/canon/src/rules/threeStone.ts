/** Three-stone rules: research 09 §1 "Three-stone". */
import { add, and, asin, cos, div, lt, max, mul, sub, v } from '../expr'
import { band, rule, src } from './rule'

const cW = v('cW')
const side = lt(v('hero'), 0.5)
const plain = and(side, lt(v('pointed'), 0.5), lt(v('baguette'), 0.5))
const r = div(v('ID'), 2)
/** Side culet clearance that gives a table `drop` below the centre's (09 §1, measured). */
const sideE = (drop: number) =>
  max(
    0.2,
    sub(
      div(sub(add(r, v('ce'), mul(v('cDepth'), cW)), drop), cos(v('angle'))),
      add(r, mul(v('depthPct'), v('W'))),
    ),
  )
/** Angle round the band that leaves a plan-view girdle `gap` to the centre. */
const sideAngle = (gap: number) =>
  asin(
    div(
      add(mul(0.5, v('cAlong')), gap, mul(0.5, v('along'))),
      add(r, v('e'), mul(v('pavPct'), v('W'))),
    ),
  )

export const THREE_STONE_RULES = [
  rule({
    id: 'threeStone.sideSize',
    title: 'Side stone size',
    applies: { archetypes: ['threeStone'], nodeKind: 'gem', when: plain },
    paths: ['gem.width'],
    band: band(mul(0.75, cW), mul(0.55, cW), mul(0.8, cW)),
    variants: {
      delicate: band(mul(0.6, cW), mul(0.55, cW), mul(0.65, cW)),
      classic: band(mul(0.75, cW), mul(0.7, cW), mul(0.8, cW)),
      bold: band(mul(0.78, cW), mul(0.75, cW), mul(0.8, cW)),
    },
    lintAt: { below: mul(0.45, cW), above: mul(0.85, cW) },
    rationale:
      'Sides at 0.70–0.80 of the centre width balance (each a third to half its weight); 0.55–0.65 lets the centre dominate.',
    source: src('S', '§1 Three-stone: side size'),
    confidence: 'high',
    severity: 'info',
    fix: 'clampToBand',
  }),
  rule({
    id: 'threeStone.pointedSides',
    title: 'Pear and marquise side size',
    applies: { archetypes: ['threeStone'], nodeKind: 'gem', when: and(side, v('pointed')) },
    paths: ['gem.width'],
    band: band(mul(0.5, cW), mul(0.45, cW), mul(0.55, cW)),
    lintAt: { below: mul(0.35, cW), above: mul(0.7, cW) },
    rationale:
      'Pear and marquise sides are long: keep them 0.45–0.55 of the centre width so their length does not outgrow it.',
    source: src('EJ', '§1 Three-stone: side size'),
    confidence: 'medium',
    severity: 'info',
    fix: 'clampToBand',
  }),
  rule({
    id: 'threeStone.pearLw',
    title: 'Pear side length',
    applies: { archetypes: ['threeStone'], nodeKind: 'gem', when: and(side, v('pear')) },
    paths: ['gem.lw'],
    band: band(1.5, 1.4, 1.6),
    rationale:
      'Pear sides at 1.4–1.6 L:W nestle against the centre; longer ones point away like wings.',
    source: src('EJ', '§1 Three-stone: side size'),
    confidence: 'medium',
    severity: 'default',
  }),
  rule({
    id: 'threeStone.baguetteWidth',
    title: 'Baguette stand-in size',
    applies: { archetypes: ['threeStone'], nodeKind: 'gem', when: and(side, v('baguette')) },
    paths: ['gem.width'],
    band: band(mul(0.42, cW), mul(0.4, cW), mul(0.45, cW)),
    rationale:
      'Straight baguettes stand in for tapered ones at 0.40–0.45 of the centre width; say it is a stand-in.',
    source: src('EJ', '§1 Three-stone: pairing'),
    confidence: 'medium',
    severity: 'default',
  }),
  rule({
    id: 'threeStone.baguetteLw',
    title: 'Baguette stand-in length',
    applies: { archetypes: ['threeStone'], nodeKind: 'gem', when: and(side, v('baguette')) },
    paths: ['gem.lw'],
    band: band(1.6, 1.5, 1.7),
    rationale:
      'A 1.5–1.7 baguette reads like the tapered side stones of a classic Deco three-stone.',
    source: src('EJ', '§1 Three-stone: pairing'),
    confidence: 'medium',
    severity: 'default',
  }),
  rule({
    id: 'threeStone.baguetteSpin',
    title: 'Baguettes along the band',
    applies: { archetypes: ['threeStone'], nodeKind: 'gem', when: and(side, v('baguette')) },
    paths: ['gem.placement.spin'],
    band: band(90, 90, 90),
    rationale:
      'Baguette sides lie along the band, pointing at the centre, so they lead the eye in.',
    source: src('EJ', '§1 Three-stone: pairing'),
    confidence: 'medium',
    severity: 'default',
  }),
  rule({
    id: 'threeStone.sideElevation',
    title: 'Side stone height',
    applies: { archetypes: ['threeStone'], nodeKind: 'gem', when: side },
    paths: ['gem.placement.elevation'],
    band: band(sideE(0.6), sideE(0.9), sideE(0.3)),
    rationale:
      'Sides sit higher off the finger than the centre so their tables land 0.3–0.9 mm below its table.',
    source: src('K', '§1 Three-stone: heights'),
    confidence: 'medium',
    severity: 'default',
  }),
  rule({
    id: 'threeStone.tableDrop',
    title: 'Side table drop',
    applies: { archetypes: ['threeStone'], nodeKind: 'gem', when: side },
    paths: ['gem.placement.elevation'],
    measure: 'tableDrop',
    band: band(0.6, 0.3, 0.9),
    lintAt: { below: 0.3, above: 1.5 },
    rationale:
      'The tables should step down 0.3–0.9 mm from the centre: level reads flat, deeper reads sunk.',
    source: src('K', '§1 Three-stone: heights (measured)'),
    confidence: 'medium',
    severity: 'warning',
  }),
  rule({
    id: 'threeStone.angle',
    title: 'Side stone spacing',
    applies: { archetypes: ['threeStone'], nodeKind: 'gem', when: side },
    paths: ['gem.placement.angle'],
    band: band(sideAngle(0.5), sideAngle(0.3), sideAngle(0.9)),
    rationale:
      'Space the sides for a 0.5 mm plan-view gap with claws between, about 25–28° round a US 6 band.',
    source: src('K', '§1 Three-stone: spacing'),
    confidence: 'medium',
    severity: 'default',
  }),
  rule({
    id: 'threeStone.gap',
    title: 'Girdle gap between stones',
    applies: { archetypes: ['threeStone'], nodeKind: 'gem', when: side },
    paths: ['gem.placement.angle'],
    measure: 'sideGap',
    band: band(0.5, 0.3, 0.9),
    lintAt: { below: 0.15, above: 1.6 },
    rationale:
      'Stones closer than 0.15 mm leave no room for the claws; past 1.6 mm the three read as separate rings.',
    source: src('K', '§1 Three-stone: spacing'),
    confidence: 'medium',
    severity: 'info',
  }),
  rule({
    id: 'threeStone.cutPairing',
    title: 'Pair cut families',
    applies: { archetypes: ['threeStone'], nodeKind: 'gem', when: side },
    paths: ['gem.cut'],
    measure: 'facetMismatch',
    band: band(0, 0, 0),
    lintAt: { above: 0.5 },
    rationale:
      'Step with step, brilliant with brilliant: mixed facet patterns flash at different rates. Baguettes excepted.',
    source: src('S', '§1 Three-stone: pairing'),
    confidence: 'high',
    severity: 'info',
  }),
]
