/** Halo rules: research 09 §1 "Halo". */
import { add, and, clamp, gt, iff, lt, max, min, mul, snap, sub, v } from '../expr'
import { band, rule, src } from './rule'

const W = v('W')
const melee = min(1.7, snap(clamp(add(mul(0.1, W), 0.6), 1.0, 2.0)))
const offsetFloor = iff(v('bezel'), add(v('wall'), 0.2), max(0.3, sub(v('wire'), 0.5)))

export const HALO_RULES = [
  rule({
    id: 'halo.melee',
    title: 'Halo melee size',
    applies: { nodeKind: 'halo' },
    paths: ['halo.stoneWidth'],
    band: band(melee, max(0.8, sub(melee, 0.15)), min(1.7, add(melee, 0.15))),
    lintAt: { below: max(0.8, sub(melee, 0.3)), above: min(1.7, add(melee, 0.3)) },
    rationale:
      'Halo melee grows slowly with the centre: 1.1 mm round 5 mm, 1.25 round 6.5, 1.4 round 8. Bigger melee competes with the centre.',
    source: src('S', '§1 Halo: melee size'),
    confidence: 'high',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'halo.outline',
    title: 'Halo outline',
    applies: { nodeKind: 'halo', when: lt(v('haloRows'), 1.5) },
    paths: ['halo.stoneWidth', 'halo.offset'],
    measure: 'haloOutline',
    band: band(1.5, 1.4, 1.6),
    lintAt: { above: iff(lt(W, 6), 1.8, 1.7) },
    rationale:
      'A single halo should take the face to 1.4–1.6× the centre; past 1.7× it reads as a tyre, not a frame.',
    source: src('K', '§1 Halo: outline'),
    confidence: 'medium',
    severity: 'warning',
  }),
  rule({
    id: 'halo.doubleOutline',
    title: 'Double halo outline',
    applies: { nodeKind: 'halo', when: gt(v('haloRows'), 1.5) },
    paths: ['halo.rows', 'halo.stoneWidth'],
    measure: 'haloOutline',
    band: band(1.85, 1.7, 2.0),
    lintAt: { above: 2.0 },
    rationale:
      'Even a double halo stops at twice the centre, or the centre becomes a pinpoint in a field of melee.',
    source: src('EJ', '§1 Halo: double halo'),
    confidence: 'medium',
    severity: 'warning',
  }),
  rule({
    id: 'halo.offset',
    title: 'Halo gap to the centre',
    applies: { nodeKind: 'halo' },
    paths: ['halo.offset'],
    band: band(offsetFloor, offsetFloor, max(offsetFloor, 0.6)),
    lintAt: { below: offsetFloor, above: max(offsetFloor, 0.6) },
    rationale:
      'The halo must clear the claws (wire − 0.5, at least 0.3 mm) or bezel; wider than 0.6 mm it floats loose.',
    source: src('K', '§1 Halo: gap to centre (measured)'),
    confidence: 'high',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'halo.clawWire',
    title: 'Claws inside a halo',
    applies: { nodeKind: 'setting', when: and(v('halo'), v('claw'), lt(W, 7.01)) },
    paths: ['setting.prongDiameter'],
    band: band(0.8, 0.8, 0.9),
    rationale:
      'Inside a halo the claws only hold, the halo guards: 0.8 mm claws for centres up to 7 mm keep the face clean.',
    source: src('K', '§1 Halo: gap to centre'),
    confidence: 'medium',
    severity: 'default',
  }),
  rule({
    id: 'halo.drop',
    title: 'Halo seat height',
    applies: { nodeKind: 'halo' },
    paths: ['halo.drop'],
    band: band(0.4, 0.3, 0.6),
    lintAt: { below: 0, above: 1.5 },
    rationale:
      'Seat the halo 0.3–0.6 mm under the girdle so the centre stands proud; never above it.',
    source: src('EJ', '§1 Halo: seat height'),
    confidence: 'high',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'halo.rows',
    title: 'Rows of halo',
    applies: { nodeKind: 'halo' },
    paths: ['halo.rows'],
    band: band(1, 1, iff(gt(W, 5.99), 2, 1)),
    lintAt: { above: iff(gt(W, 5.99), 2, 1) },
    rationale:
      'A second halo only round a centre of 6 mm or more; on smaller stones it buries them.',
    source: src('EJ', '§1 Halo: double halo'),
    confidence: 'medium',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'halo.meleeZones',
    title: 'Neighbouring melee sizes',
    applies: { kinds: ['ring'] },
    paths: ['halo.stoneWidth', 'gemRow.stoneWidth'],
    measure: 'meleeStep',
    band: band(0, 0, 0),
    lintAt: { above: 0.5 },
    rationale:
      'Melee in touching zones is equal (within 0.1 mm) or clearly stepped (0.4 mm+); in between it looks like a mistake.',
    source: src('S', '§1 Halo: melee zones (GIA)'),
    confidence: 'medium',
    severity: 'info',
  }),
  rule({
    id: 'halo.hidden',
    title: 'Hidden halo',
    applies: { kinds: ['ring'], archetypes: ['halo'] },
    paths: ['halo.drop'],
    band: band(0, 0, 0),
    rationale:
      'A hidden halo cannot be built: tables face up, so a deep drop makes a skirt. Record it as a maker note.',
    source: src('K', '§1 Halo: hidden halo'),
    confidence: 'high',
    severity: 'default',
    expressible: false,
  }),
]
