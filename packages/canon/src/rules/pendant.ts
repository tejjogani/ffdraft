/** Fine pendants, bails and chain pairing: research 09 §2 "Bail and chain". */
import { add, and, clamp, gt, lt, max, mul, v } from '../expr'
import { ALLOY_ADD } from './ring'
import { band, rule, src } from './rule'

const W = v('W')
const H = v('H')
const chainW = v('chainW')
const opening = max(mul(1.3, chainW), add(chainW, 2))
const smallWire = add(max(0.8, add(mul(0.08, W), 0.3)), ALLOY_ADD)
const NOT_RING = ['pendant', 'necklace', 'earrings', 'bracelet', 'brooch', 'other'] as const
const linked = and(v('pendant'), gt(H, 0))

export const PENDANT_RULES = [
  rule({
    id: 'pendant.head.wire',
    title: 'Claws on pendants and earrings',
    applies: { kinds: [...NOT_RING], nodeKind: 'setting', when: v('claw') },
    paths: ['setting.prongDiameter'],
    band: band(
      smallWire,
      max(0.8, add(mul(0.08, W), 0.3)),
      add(max(1.0, mul(0.15, W)), ALLOY_ADD, mul(0.5, v('doubleTip'))),
    ),
    lintAt: {
      below: max(0.8, add(mul(0.08, W), 0.3)),
      above: add(max(1.1, mul(0.18, W)), ALLOY_ADD, mul(0.5, v('doubleTip'))),
    },
    rationale:
      'Off the hand claws can be finer, 0.08 × stone + 0.3, but never under the 0.8 mm casting floor.',
    source: src('R', '§3 Stud head; kernel prong floor'),
    confidence: 'high',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'pendant.fine.linkWidth',
    title: 'Chain for a solitaire pendant',
    applies: { archetypes: ['pendantSolitaire'], nodeKind: 'chain' },
    paths: ['chain.linkWidth'],
    band: band(clamp(mul(0.18, W), 0.9, 2.0), 0.9, add(clamp(mul(0.18, W), 0.9, 2.0), 0.5)),
    rationale:
      'A solitaire hangs on a chain 0.18 of its width, 0.9–2.0 mm: heavier chain upstages the stone.',
    source: src('EJ', '§2 Fine pendants'),
    confidence: 'low',
    severity: 'default',
  }),
  rule({
    id: 'pendant.name.linkWidth',
    title: 'Chain for a name pendant',
    applies: { archetypes: ['namePendant'], nodeKind: 'chain' },
    paths: ['chain.linkWidth'],
    band: band(1.2, 0.9, 1.8),
    rationale:
      'Under 3 g hangs on 0.9–1.1 mm chain, 3–8 g on 1.3–1.8: a name plate is light, so keep the chain fine.',
    source: src('EJ', '§2 Fine pendants'),
    confidence: 'low',
    severity: 'default',
  }),
  rule({
    id: 'bail.opening',
    title: 'Bail opening',
    applies: { nodeKind: 'bail', when: gt(chainW, 0) },
    paths: ['bail.opening'],
    band: band(opening, add(chainW, 1.5), add(opening, 1.5)),
    lintAt: { below: add(chainW, 1.5) },
    rationale:
      'The bail must pass the chain and its clasp: link + 2 mm, or 1.3× on heavy chain; under +1.5 it will not thread.',
    source: src('K', '§2 Bail and chain'),
    confidence: 'high',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'bail.wire',
    title: 'Bail wire',
    applies: { nodeKind: 'bail', when: lt(v('icedBail'), 0.5) },
    paths: ['bail.wire'],
    band: band(1.1, 1.0, 2.5),
    lintAt: { below: 1.0 },
    rationale:
      'A bail takes the whole weight on one bend: never under 1.0 mm of wire, more on heavy pieces.',
    source: src('R', '§2 Bail and chain; 06-freeform bail wall'),
    confidence: 'high',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'bail.icedWire',
    title: 'Wire under an iced bail',
    applies: { nodeKind: 'bail', when: v('icedBail') },
    paths: ['bail.wire'],
    band: band(add(mul(0.65, v('paveMax')), 0.9), add(mul(0.65, v('paveMax')), 0.8), 4),
    lintAt: { below: add(mul(0.65, v('paveMax')), 0.8) },
    rationale:
      'Stones on a bail need seats: wire at least 0.65 × stone + 0.8 mm, or the seats cut through.',
    source: src('EJ', '§2 Bail and chain'),
    confidence: 'medium',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'bail.heightRatio',
    title: 'Bail to pendant',
    applies: { nodeKind: 'bail', when: gt(H, 14.99) },
    paths: ['bail.opening', 'bail.wire'],
    measure: 'bailRatio',
    band: band(0.18, 0.15, 0.22),
    lintAt: { below: 0.12 },
    rationale:
      'A bail 15–22 % of the pendant height looks built for the weight; under 12 % it looks like it will snap.',
    source: src('EJ', '§2 Bail and chain'),
    confidence: 'medium',
    severity: 'info',
  }),
  rule({
    id: 'bail.solitaire',
    title: 'Bail to stone',
    applies: { archetypes: ['pendantSolitaire'], nodeKind: 'bail' },
    paths: ['bail.opening', 'bail.wire'],
    measure: 'bailToStone',
    band: band(0.8, 0.6, 1.0),
    lintAt: { below: 0.5, above: 1.5 },
    rationale:
      'On a solitaire the bail is 60–100 % of the stone width: bigger and it becomes the jewel.',
    source: src('EJ', '§2 Bail and chain'),
    confidence: 'medium',
    severity: 'info',
  }),
  rule({
    id: 'bail.roundChain',
    title: 'Bail for round chain',
    applies: { nodeKind: 'bail', when: v('roundChain') },
    paths: ['bail.style'],
    measure: 'loopOnRoundChain',
    band: band(0, 0, 0),
    lintAt: { above: 0.5 },
    rationale:
      'Rope, box and tennis chains are round in section: they want a tube or ring bail, not a flat loop.',
    source: src('EJ', '§2 Bail and chain'),
    confidence: 'medium',
    severity: 'info',
  }),
  rule({
    id: 'chain.cubanToPendant',
    title: 'Cuban width for the pendant',
    applies: { nodeKind: 'chain', when: and(v('cuban'), linked) },
    paths: ['chain.linkWidth'],
    band: band(mul(0.12, H), mul(0.08, H), mul(0.16, H)),
    lintAt: { below: mul(0.06, H), above: mul(0.2, H) },
    rationale:
      'A Cuban under a pendant is 8–16 % of its height: thinner looks under-built, heavier swallows the piece.',
    source: src('S', '§2 Bail and chain (GLD, IceCartel)'),
    confidence: 'medium',
    severity: 'info',
    fix: 'clampToBand',
  }),
  rule({
    id: 'chain.ropeToPendant',
    title: 'Rope or box width for the pendant',
    applies: { nodeKind: 'chain', when: and(v('roundChain'), lt(v('tennis'), 0.5), linked) },
    paths: ['chain.linkWidth'],
    band: band(mul(0.07, H), mul(0.05, H), mul(0.1, H)),
    rationale: 'Rope and box chains carry a pendant at 5–10 % of its height.',
    source: src('EJ', '§2 Bail and chain'),
    confidence: 'medium',
    severity: 'default',
  }),
  rule({
    id: 'chain.tennisToPendant',
    title: 'Tennis chain under a pendant',
    applies: { nodeKind: 'chain', when: and(v('tennis'), linked) },
    paths: ['chain.linkWidth'],
    band: band(3.4, 3.4, 5.4),
    lintAt: { below: 2.4 },
    rationale:
      'A tennis chain carries pendants up to 100 mm on 3–5 mm stones; under 2 mm it reads as thread.',
    source: src('EJ', '§2 Bail and chain'),
    confidence: 'medium',
    severity: 'info',
    fix: 'clampToBand',
  }),
  rule({
    id: 'chain.massToPendant',
    title: 'Chain weight against the pendant',
    applies: { nodeKind: 'chain', when: and(v('cuban'), linked) },
    paths: ['chain.linkWidth'],
    measure: 'chainToPendantMass',
    band: band(1.0, 0.5, 1.5),
    lintAt: { below: 0.3 },
    rationale:
      'A solid chain weighs 0.5–1.5× its pendant; under 0.3× the pendant flips and the chain kinks.',
    source: src('S', '§2 Bail and chain (GLD, IceCartel)'),
    confidence: 'medium',
    severity: 'info',
  }),
  rule({
    id: 'chain.figaroLoad',
    title: 'What a Figaro carries',
    applies: { nodeKind: 'chain', when: and(v('figaro'), linked) },
    paths: ['chain.style'],
    measure: 'pendantHeight',
    band: band(35, 0, 45),
    lintAt: { above: 50 },
    rationale:
      'A 3–5 mm Figaro carries crosses and medallions to about 45 mm; iced pieces of 50+ need a Cuban or rope.',
    source: src('EJ', '§2 Bail and chain'),
    confidence: 'medium',
    severity: 'info',
  }),
  rule({
    id: 'chain.length',
    title: 'Necklace length',
    applies: {
      kinds: ['pendant', 'necklace'],
      archetypes: ['pendantSolitaire', 'namePendant', 'medallion', 'tennis', 'custom'],
      nodeKind: 'chain',
      when: lt(v('mens'), 0.5),
    },
    paths: ['chain.length'],
    band: band(457, 356, 900),
    rationale:
      'Choker 356–406, princess 432–483 (457 the default), matinee 508–660, opera from 661 mm.',
    source: src('S', '§2 Length names'),
    confidence: 'high',
    severity: 'default',
  }),
  rule({
    id: 'chain.mensLength',
    title: "Men's chain length",
    applies: {
      archetypes: ['icedPendant', 'cuban'],
      nodeKind: 'chain',
      when: lt(v('bracelet'), 0.5),
    },
    paths: ['chain.length'],
    band: band(559, 508, 762),
    rationale:
      "Men's chains default to 559 mm (22 in): 508 at the collarbone, 610 mid-chest, 660–762 for a statement.",
    source: src('S', '§2 Bail and chain'),
    confidence: 'high',
    severity: 'default',
  }),
]
