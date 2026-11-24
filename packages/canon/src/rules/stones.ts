/** Stones and durability: research 09 §1 "stones" and §6 principles (one hero). */
import { and, gt, lt, mul, v } from '../expr'
import { band, rule, src } from './rule'

export const STONE_RULES = [
  rule({
    id: 'stones.lw',
    title: 'Length to width',
    applies: { nodeKind: 'gem', when: gt(v('lwTyp'), 0) },
    paths: ['gem.lw'],
    band: band(v('lwTyp'), v('lwMin'), v('lwMax')),
    rationale:
      'Proportions the trade prizes: oval and emerald 1.35–1.50, pear 1.50–1.75, marquise 1.75–2.25, cushion near square.',
    source: src('S', '§1 L:W defaults (GIA, PriceScope)'),
    confidence: 'high',
    severity: 'default',
  }),
  rule({
    id: 'stones.poorOpenHead',
    title: 'Soft stones in open claws on a ring',
    applies: { kinds: ['ring'] },
    paths: ['setting.style'],
    measure: 'poorOpenHead',
    band: band(0, 0, 0),
    lintAt: { above: 0.5 },
    rationale:
      'Emerald, opal, tanzanite, pearl, turquoise and peridot chip in open claws on a hand: bezel them or set them high-sided.',
    source: src('EJ', '§1 Wearability class (GIA framework)'),
    confidence: 'high',
    severity: 'warning',
  }),
  rule({
    id: 'stones.softInPave',
    title: 'Hardness for flush and pavé',
    applies: {},
    paths: ['pave.stone', 'gemRow.stone', 'halo.stone'],
    measure: 'softestInPave',
    band: band(10, 8, 10),
    lintAt: { below: 8 },
    rationale:
      'Flush, channel, bar and pavé stones take the knocks face-on: only Mohs 8 and harder survive them.',
    source: src('EJ', '§1 Wearability class'),
    confidence: 'high',
    severity: 'warning',
  }),
  rule({
    id: 'stones.pearl',
    title: 'Pearls in a cup',
    applies: {},
    paths: ['setting.style'],
    measure: 'pearlNotCup',
    band: band(0, 0, 0),
    lintAt: { above: 0.5 },
    rationale:
      'Pearls are glued on a peg in a cup: model a bezel cup (wall ≥ 0.45) and add a maker note, never claws.',
    source: src('S', '§1 Wearability class (pearls)'),
    confidence: 'high',
    severity: 'info',
  }),
  rule({
    id: 'stones.oneHero',
    title: 'One hero',
    applies: {
      kinds: ['ring', 'pendant', 'necklace', 'brooch'],
      when: and(lt(v('toi'), 0.5), lt(v('earrings'), 0.5)),
    },
    paths: ['gem.width'],
    measure: 'secondStone',
    band: band(mul(0.7, v('cW')), 0, mul(0.85, v('cW'))),
    lintAt: { above: mul(0.85, v('cW')) },
    rationale:
      'One stone must win in a blink: the second-largest at most 0.85 of the hero, or the eye cannot settle.',
    source: src('EJ', '§6 Principles'),
    confidence: 'high',
    severity: 'warning',
  }),
  rule({
    id: 'stones.meleeColour',
    title: 'Melee colour against the centre',
    applies: {},
    paths: ['halo.quality', 'gemRow.quality', 'pave.quality'],
    measure: 'meleeColourGap',
    band: band(1, 0, 2),
    lintAt: { above: 2 },
    rationale:
      'Melee more than two colour grades below the centre makes it look yellow by contrast.',
    source: src('EJ', '§1 Colour'),
    confidence: 'high',
    severity: 'info',
  }),
  rule({
    id: 'stones.whiteHead',
    title: 'White head for colourless stones',
    applies: { kinds: ['ring'], archetypes: ['solitaire', 'halo', 'threeStone'] },
    paths: ['setting.material'],
    measure: 'colourlessInYellowHead',
    band: band(0, 0, 0),
    rationale:
      'A colourless stone in yellow claws picks up their colour: give the head its own white node on a yellow band.',
    source: src('EJ', '§1 Colour'),
    confidence: 'high',
    severity: 'default',
  }),
  rule({
    id: 'stones.antiqueCuts',
    title: 'Antique and fancy cuts',
    applies: {},
    paths: ['gem.cut'],
    band: band(0, 0, 0),
    rationale:
      'Old European, rose, polki, tapered baguette, trapezoid and half-moon are not cuts here: name the stand-in.',
    source: src('K', '§5 What the schema cannot express'),
    confidence: 'high',
    severity: 'default',
    expressible: false,
  }),
]
