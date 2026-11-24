/** Solitaire and head rules: research 09 §1 "Solitaire" and the alloy modifier. */
import { add, and, clamp, eq, gt, iff, lt, max, min, mul, or, sub, v } from '../expr'
import { band, HEADED, rule, src } from './rule'

const W = v('W')
const bandT = v('bandT')
const bandTB = v('bandTB')
const wire = v('wire')
const prongs = v('prongs')

/** Alloy modifier on claws: 18k +0.05–0.1, sterling +0.1–0.2, 22k and softer +0.2 (09 preamble). */
export const ALLOY_ADD = iff(
  eq(v('alloy'), 1),
  0.075,
  iff(eq(v('alloy'), 2), 0.15, iff(gt(v('alloy'), 2.5), 0.2, 0)),
)
/** Six claws share the load (× 0.88); a halo protects the girdle (− 0.1). Before the floor. */
const SIX = iff(gt(prongs, 5), 0.88, 1)
const HALO_LESS = mul(0.1, v('halo'))
const rawWire = add(sub(mul(add(mul(0.1, W), 0.35), SIX), HALO_LESS), ALLOY_ADD)
const heavyWire = add(max(mul(0.18, W), 1.0), ALLOY_ADD, mul(0.5, v('doubleTip')))
/** Past 0.45 of the stone (2.6 mm at least) a band outweighs its stone (09 §1 band width lint). */
const heavyBand = max(mul(0.45, W), 2.6)
/** Room for a cathedral arch under the girdle: e + 0.44·W − bandT (09 §1 "Cathedral"). */
const archRoom = sub(add(v('ce'), mul(0.44, v('cW'))), bandT)

export const RING_RULES = [
  rule({
    id: 'ring.solitaire.bandWidth',
    title: 'Solitaire band width',
    applies: {
      kinds: ['ring'],
      archetypes: [...HEADED],
      nodeKind: 'ringShank',
      when: lt(v('split'), 0.5),
    },
    paths: ['ringShank.widthTop'],
    band: band(clamp(mul(0.3, W), 1.8, 2.4), 1.5, min(3.0, heavyBand)),
    variants: {
      delicate: band(1.65, 1.5, 1.8),
      classic: band(clamp(mul(0.3, W), 1.8, 2.2), 1.8, 2.2),
      bold: band(min(2.7, heavyBand), min(2.5, heavyBand), min(3.0, heavyBand)),
    },
    lintAt: { below: max(1.5, min(mul(0.2, W), 2.0)), above: heavyBand },
    rationale:
      'The band frames the stone: under 1.8 mm reads fragile and bends, over 2.4 mm on a 1 ct swamps it. Delicate needs W ≤ 6.5.',
    source: src('S', '§1 Solitaire: band width'),
    confidence: 'high',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'ring.solitaire.thicknessBottom',
    title: 'Band thickness at the base',
    applies: { kinds: ['ring'], archetypes: [...HEADED], nodeKind: 'ringShank' },
    paths: ['ringShank.thicknessBottom'],
    band: band(1.6, 1.5, 1.8),
    rationale: 'The base takes the knocks and the resizing: 1.5–1.8 mm keeps it round for decades.',
    source: src('R', '§1 Solitaire: band thickness'),
    confidence: 'high',
    severity: 'default',
  }),
  rule({
    id: 'ring.solitaire.thicknessTop',
    title: 'Band thickness under the head',
    applies: { kinds: ['ring'], archetypes: [...HEADED], nodeKind: 'ringShank' },
    paths: ['ringShank.thicknessTop'],
    band: band(add(bandTB, 0.2), add(bandTB, 0.1), add(bandTB, 0.3)),
    lintAt: { below: bandTB, above: add(bandTB, 1.0) },
    rationale:
      'Thicken 0.1–0.3 mm toward the head: that is where the claws are soldered and the band works hardest.',
    source: src('R', '§1 Solitaire: band thickness'),
    confidence: 'medium',
    severity: 'info',
    fix: 'clampToBand',
  }),
  rule({
    id: 'ring.solitaire.narrowBandDepth',
    title: 'Depth of a narrow band',
    applies: {
      kinds: ['ring'],
      archetypes: [...HEADED],
      nodeKind: 'ringShank',
      when: lt(v('bandW'), 2.0),
    },
    paths: ['ringShank.thicknessTop'],
    band: band(max(1.6, v('bandW')), max(1.5, sub(v('bandW'), 0.1)), 2.2),
    lintAt: { below: max(1.5, sub(v('bandW'), 0.1)) },
    rationale:
      'A band under 2 mm wide must be nearly as deep as it is wide, or the head levers it out of round.',
    source: src('K', '§1 Solitaire: band thickness'),
    confidence: 'high',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'ring.solitaire.elevation',
    title: 'Head height class',
    applies: { kinds: ['ring'], archetypes: [...HEADED], nodeKind: 'gem', when: v('hero') },
    paths: ['gem.placement.elevation'],
    band: band(add(bandT, 0.5), add(bandT, 0.2), add(bandT, 0.8)),
    lintAt: {
      below: iff(v('bezel'), 0.5, iff(v('basket'), 0.8, add(bandT, 0.2))),
      above: iff(gt(W, 8.99), 8, 4),
    },
    rationale:
      'Classic sits 0.2–0.8 mm above the band; low (0.8–1.2) only in a basket or bezel; above 4 mm it catches on everything.',
    source: src('K', '§1 Solitaire: elevation class'),
    confidence: 'medium',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'ring.solitaire.tableHeight',
    title: 'Table height above the finger',
    applies: { kinds: ['ring'], archetypes: [...HEADED], nodeKind: 'gem', when: v('hero') },
    paths: ['gem.placement.elevation'],
    measure: 'tableHeight',
    band: band(
      add(bandT, 0.5, mul(v('depthPct'), W)),
      add(0.5, mul(v('depthPct'), W)),
      min(10.5, add(mul(0.62, W), 4.2)),
    ),
    lintAt: { above: add(mul(0.62, W), 4.2) },
    rationale:
      'Height is what the hand feels: 6–7 mm for a classic 1 ct, 7 for everyday, 10.5 only for a cocktail ring.',
    source: src('D', '§1 Solitaire: table height'),
    confidence: 'medium',
    severity: 'warning',
  }),
  rule({
    id: 'ring.head.prongWire',
    title: 'Claw wire',
    applies: { kinds: ['ring'], nodeKind: 'setting', when: v('claw') },
    paths: ['setting.prongDiameter'],
    band: band(max(0.8, rawWire), max(0.8, sub(rawWire, 0.1)), heavyWire),
    lintAt: {
      below: max(0.8, sub(mul(add(mul(0.08, W), 0.3), SIX), HALO_LESS)),
      above: heavyWire,
    },
    rationale:
      'Claws scale with the stone: 0.85 mm on 5 mm, 1.0 on 6.5, 1.15 on 8. Fatter looks clumsy; thinner wears through.',
    source: src('EJ', '§1 Solitaire: prong wire'),
    confidence: 'high',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'ring.head.doubleTip',
    title: 'Wire for double claws',
    applies: { nodeKind: 'setting', when: and(v('claw'), v('doubleTip')) },
    paths: ['setting.prongDiameter'],
    band: band(1.3, 1.3, 1.6),
    lintAt: { below: 1.3 },
    rationale:
      'A double claw is split down its length: start from 1.3 mm or each half is too thin to hold.',
    source: src('K', '§1 Solitaire: prong wire'),
    confidence: 'medium',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'ring.head.prongCountRound',
    title: 'Claws on a round',
    applies: { kinds: ['ring'], nodeKind: 'setting', when: and(v('claw'), v('round')) },
    paths: ['setting.prongCount'],
    band: band(iff(gt(W, 7.39), 6, 4), 4, 6),
    rationale:
      'Four claws show more stone; six from about 7.4 mm (1.5 ct) for security and a rounder look.',
    source: src('S', '§1 Solitaire: prong count'),
    confidence: 'high',
    severity: 'default',
  }),
  rule({
    id: 'ring.head.prongCoverage',
    title: 'Metal over the girdle',
    applies: { nodeKind: 'setting', when: v('claw') },
    paths: ['setting.prongCount', 'setting.prongDiameter'],
    measure: 'prongCoverage',
    band: band(0.2, 0.1, 0.35),
    lintAt: { above: 0.35 },
    rationale:
      'Claws should hide no more than a third of the girdle; past that the stone looks caged.',
    source: src('S', '§1 Solitaire: prong count'),
    confidence: 'medium',
    severity: 'info',
  }),
  rule({
    id: 'ring.head.prongsForShape',
    title: 'Claws for the shape',
    applies: { nodeKind: 'setting', when: and(v('claw'), lt(v('round'), 0.5)) },
    paths: ['setting.prongCount'],
    band: band(
      v('prongsTyp'),
      iff(and(v('pear'), lt(v('L'), 6)), 3, v('prongsMin')),
      v('prongsMax'),
    ),
    rationale:
      'Princess, emerald, cushion 4; oval 4 (6 from 9 long); pear 5–6; marquise 6; heart 3–5; trillion 3.',
    source: src('R', '§1 Prongs by shape'),
    confidence: 'high',
    severity: 'default',
  }),
  rule({
    id: 'ring.head.pointsCovered',
    title: 'Every point held',
    applies: { nodeKind: 'setting', when: v('claw') },
    paths: ['setting.prongCount'],
    band: band(
      max(v('prongsTyp'), v('points')),
      max(3, v('points')),
      max(v('prongsMax'), v('points')),
    ),
    lintAt: { below: v('points') },
    rationale:
      'A point is where a stone chips: each needs its own V-claw, so never fewer claws than points.',
    source: src('K', '§1 Solitaire: tip'),
    confidence: 'high',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'ring.head.clawPosition',
    title: 'Claw rotation',
    applies: { nodeKind: 'setting', when: and(v('claw'), v('round')) },
    paths: ['setting.prongSpin'],
    band: band(iff(eq(prongs, 4), 45, 30), 0, 90),
    rationale:
      'Four claws at 45° (or 0°), six at 30° (or 0°), three at 30° or 90°: square to the finger.',
    source: src('K', '§1 Solitaire: claw positions'),
    confidence: 'high',
    severity: 'default',
  }),
  rule({
    id: 'ring.head.clawSymmetry',
    title: 'Claws square to the finger',
    applies: { nodeKind: 'setting', when: and(v('claw'), v('round')) },
    paths: ['setting.prongSpin'],
    measure: 'clawOffset',
    band: band(0, 0, 2),
    lintAt: { above: 2 },
    rationale:
      'Claws off the finger axis look knocked crooked from every angle; turn them onto a symmetric position.',
    source: src('K', '§1 Solitaire: claw positions'),
    confidence: 'high',
    severity: 'info',
  }),
  rule({
    id: 'ring.head.basketRails',
    title: 'Gallery rails',
    applies: { kinds: ['ring'], nodeKind: 'setting', when: v('basket') },
    paths: ['setting.rails'],
    band: band(
      iff(gt(v('free'), 5), 2, iff(or(gt(W, 4.49), gt(v('free'), mul(3, wire))), 1, 0)),
      iff(or(gt(W, 4.49), gt(v('free'), mul(3, wire))), 1, 0),
      2,
    ),
    lintAt: { below: iff(or(gt(W, 4.49), gt(v('free'), mul(3, wire))), 1, 0) },
    rationale:
      'Claws longer than three wire-widths need a rail to brace them; two rails above about 5 mm of free claw.',
    source: src('R', '§1 Solitaire: head style (3× rule)'),
    confidence: 'high',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'ring.head.bareClaws',
    title: 'Bare claws only when short',
    applies: {
      kinds: ['ring'],
      nodeKind: 'setting',
      when: and(v('claw'), lt(v('basket'), 0.5), gt(W, 4.49)),
    },
    paths: ['setting.style'],
    measure: 'freeRatio',
    band: band(2, 0, 3),
    lintAt: { above: 3 },
    rationale:
      'Unbraced claws taller than three wire-widths flex and snag: from 4.5 mm use a basket head.',
    source: src('K', '§1 Solitaire: head style'),
    confidence: 'high',
    severity: 'warning',
  }),
  rule({
    id: 'ring.head.taper',
    title: 'Head taper',
    applies: { nodeKind: 'setting', when: v('claw') },
    paths: ['setting.taper'],
    band: band(
      iff(v('stepLike'), 0.25, 0.47),
      iff(v('stepLike'), 0.2, 0.4),
      iff(v('stepLike'), 0.3, 0.55),
    ),
    lintAt: { below: iff(v('stepLike'), 0.1, 0.25), above: iff(v('stepLike'), 0.45, 0.7) },
    rationale:
      'A round head narrows to half its width so the shank shows; step cuts and cushions stay 70–80 % wide to keep their corners.',
    source: src('K', '§1 Solitaire: head taper'),
    confidence: 'medium',
    severity: 'info',
    fix: 'clampToBand',
  }),
  rule({
    id: 'ring.cathedral.rise',
    title: 'Cathedral rise',
    applies: { kinds: ['ring'], nodeKind: 'ringShank', when: v('cathedral') },
    paths: ['ringShank.shoulderHeight'],
    band: band(max(0.5, sub(archRoom, 1.2)), 0.5, max(0.5, sub(archRoom, 0.8))),
    lintAt: { above: max(0.5, sub(archRoom, 0.3)) },
    rationale:
      'Arches should meet the head 0.8 mm under the girdle; any higher and they crowd the stone and trap dirt.',
    source: src('K', '§1 Solitaire: cathedral (disagreement noted)'),
    confidence: 'medium',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'ring.cathedral.elevation',
    title: 'Height for a cathedral',
    applies: { kinds: ['ring'], nodeKind: 'gem', when: and(v('hero'), v('cathedral')) },
    paths: ['gem.placement.elevation'],
    band: band(add(bandT, 1.2), add(bandT, 1.0), add(bandT, 2.2)),
    lintAt: { below: add(bandT, 1.0) },
    rationale:
      'Cathedral shoulders need the stone at least 1 mm above the band, or the arches have nowhere to rise.',
    source: src('K', '§1 Solitaire: cathedral'),
    confidence: 'medium',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'ring.split.gap',
    title: 'Split-shank gap',
    applies: { kinds: ['ring'], nodeKind: 'ringShank', when: v('split') },
    paths: ['ringShank.splitGap'],
    band: band(mul(0.35, W), mul(0.25, W), mul(0.45, W)),
    lintAt: { below: mul(0.2, W), above: mul(0.55, W) },
    rationale:
      'The split should open to a third of the stone: narrower reads as a crack, wider as two rings.',
    source: src('K', '§1 Solitaire: split shank'),
    confidence: 'medium',
    severity: 'info',
    fix: 'clampToBand',
  }),
  rule({
    id: 'ring.split.width',
    title: 'Split-shank width',
    applies: { kinds: ['ring'], nodeKind: 'ringShank', when: v('split') },
    paths: ['ringShank.widthTop'],
    band: band(2.8, 2.0, 4.0),
    lintAt: { below: 1.8 },
    rationale:
      'Each strand is 0.6 of the top width: under 2 mm total the strands are wires, not a band.',
    source: src('K', '§1 Solitaire: split shank'),
    confidence: 'medium',
    severity: 'info',
    fix: 'clampToBand',
  }),
  rule({
    id: 'ring.knifeEdge.width',
    title: 'Knife-edge width',
    applies: { kinds: ['ring'], nodeKind: 'ringShank', when: v('knife') },
    paths: ['ringShank.widthTop'],
    band: band(2.0, 1.8, 2.2),
    rationale: 'A knife edge is a fine ridge: 1.8–2.2 mm wide, or the ridge loses its line.',
    source: src('EJ', '§1 Solitaire: profile'),
    confidence: 'medium',
    severity: 'default',
  }),
  rule({
    id: 'ring.knifeEdge.depth',
    title: 'Knife-edge depth',
    applies: { kinds: ['ring'], nodeKind: 'ringShank', when: v('knife') },
    paths: ['ringShank.thicknessBottom'],
    band: band(1.9, 1.8, 2.2),
    lintAt: { below: 1.8 },
    rationale:
      'A knife edge has little metal at its shoulders, so it must be at least 1.8 mm deep everywhere.',
    source: src('EJ', '§1 Solitaire: profile'),
    confidence: 'medium',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'ring.base.euro',
    title: 'Euro base for big heads',
    applies: { kinds: ['ring'], nodeKind: 'ringShank', when: v('head') },
    paths: ['ringShank.baseShape'],
    measure: 'euroBase',
    band: band(iff(or(gt(W, 7.99), and(v('halo'), gt(W, 7.49))), 1, 0), 0, 1),
    rationale:
      'A heavy head rolls the ring sideways; a squared euro base from 8 mm (or an 11 mm halo) keeps it upright.',
    source: src('EJ', '§1 Solitaire: profile, base'),
    confidence: 'medium',
    severity: 'default',
  }),
  rule({
    id: 'ring.scale.stoneToFinger',
    title: 'Stone to finger',
    applies: { kinds: ['ring'], archetypes: [...HEADED] },
    paths: ['gem.width'],
    measure: 'stoneToFinger',
    band: band(0.42, 0.3, 0.65),
    variants: {
      delicate: band(0.34, 0.3, 0.38),
      classic: band(0.42, 0.38, 0.48),
      bold: band(0.55, 0.5, 0.65),
    },
    rationale:
      'Read the stone against the finger: a third of its width is delicate, under half classic, two-thirds bold.',
    source: src('EJ', '§1 Scale to hand'),
    confidence: 'medium',
    severity: 'default',
  }),
  rule({
    id: 'ring.scale.headToFinger',
    title: 'Head to finger',
    applies: { kinds: ['ring'], archetypes: [...HEADED] },
    paths: ['gem.width'],
    measure: 'headToFinger',
    band: band(0.55, 0.3, 0.8),
    lintAt: { above: 0.8 },
    rationale:
      'The whole head, claws and halo included, should stay within 80 % of the finger width or it tips over.',
    source: src('EJ', '§1 Scale to hand'),
    confidence: 'medium',
    severity: 'info',
  }),
]
