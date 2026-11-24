/** Cuban, tennis and rope chains: research 09 §2 "Chains". */
import { and, div, gt, iff, lt, mul, v } from '../expr'
import { band, rule, src } from './rule'

const w = v('chainW')
const stone = v('tennisStone')
const prong = iff(gt(stone, 2.49), 0.8, iff(gt(stone, 1.69), 0.7, 0.6))
/** Cuban mass ≈ 0.23·w²·L·density, four listings ± 8 % (the kernel's link weighs ≈ 0.29). */
const cubanMass = div(mul(0.23, w, w, v('chainL'), v('density')), 1000)
const alone = lt(v('pendant'), 0.5)

export const CHAIN_RULES = [
  rule({
    id: 'chain.cuban.width',
    title: 'Cuban link width',
    applies: { archetypes: ['cuban'], nodeKind: 'chain' },
    paths: ['chain.linkWidth'],
    band: band(6, 2, 25),
    variants: { delicate: band(3, 2, 4), classic: band(6, 5, 7), bold: band(9, 8, 10) },
    rationale:
      'Cuban widths name the look: 2–4 subtle, 5–7 everyday, 8–10 statement, 11–14 bold, 15+ centrepiece.',
    source: src('S', '§2 Chains'),
    confidence: 'high',
    severity: 'default',
  }),
  rule({
    id: 'chain.cuban.wire',
    title: 'Cuban wire',
    applies: { nodeKind: 'chain', when: v('cuban') },
    paths: ['chain.wire'],
    band: band(mul(0.26, w), mul(0.22, w), mul(0.3, w)),
    lintAt: { above: mul(0.3, w) },
    rationale:
      'Cuban wire stays under 0.30 of the link width, or the links cannot twist flat and the chain turns stiff.',
    source: src('D', '§2 Chains'),
    confidence: 'medium',
    severity: 'info',
    fix: 'clampToBand',
  }),
  rule({
    id: 'chain.cuban.mass',
    title: 'Cuban weight',
    applies: { archetypes: ['cuban'], when: and(v('cuban'), alone) },
    paths: ['chain.linkWidth', 'chain.length'],
    measure: 'massG',
    band: band(cubanMass, mul(0.85, cubanMass), mul(1.35, cubanMass)),
    rationale:
      'A Cuban weighs about 0.23 × width² × length × density: 10 mm × 22 in in 14k is about 170 g. Quote from the report.',
    source: src('D', '§2 Chains'),
    confidence: 'medium',
    severity: 'default',
  }),
  rule({
    id: 'chain.tennis.link',
    title: 'Tennis stone size',
    applies: { nodeKind: 'chain', when: and(v('tennis'), alone) },
    paths: ['chain.linkWidth'],
    band: band(3.4, 2.1, 4.9),
    variants: {
      delicate: band(2.4, 2.1, 2.6),
      classic: band(3.4, 3.1, 3.7),
      bold: band(4.6, 4.2, 4.9),
    },
    rationale:
      'Tennis links are the stone + 0.4 mm: 1.7–2.2 delicate, 2.7–3.3 classic, 3.8–4.5 bold stones.',
    source: src('S', '§2 Chains'),
    confidence: 'high',
    severity: 'default',
  }),
  rule({
    id: 'chain.tennis.wire',
    title: 'Tennis claw wire',
    applies: { nodeKind: 'chain', when: v('tennis') },
    paths: ['chain.wire'],
    band: band(prong, prong, mul(prong, 1.15)),
    lintAt: { below: prong },
    rationale:
      'Each tennis stone hangs on four small claws: 0.7–0.8 mm wire, and the kernel floor for the stone size wins.',
    source: src('K', '§2 Chains'),
    confidence: 'high',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'chain.styles',
    title: 'Chain styles we cannot model',
    applies: { nodeKind: 'chain' },
    paths: ['chain.style'],
    band: band(0, 0, 0),
    rationale:
      'Franco, herringbone, snake and paperclip are not here, nor bezel tennis: offer the nearest of the seven.',
    source: src('K', '§5 What the schema cannot express'),
    confidence: 'high',
    severity: 'default',
    expressible: false,
  }),
]
