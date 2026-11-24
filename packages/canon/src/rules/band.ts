/** Plain and men's bands: research 09 §1 "Rows, eternity, plain bands" and §4 "Men's band". */
import { add, div, gt, lt, max, mul, sub, v } from '../expr'
import { band, rule, src } from './rule'

const ID = v('ID')
const bandW = v('bandW')
const notMens = lt(v('mens'), 0.5)
const mensT = add(1.6, mul(0.1, bandW))
/** 14k at US 10: 4 mm ≈ 5.5 g, 6 mm ≈ 9, 8 mm ≈ 12.5; scaled by alloy density and finger. */
const mensMass = mul(sub(mul(1.75, bandW), 1.5), div(v('density'), 13.1), div(ID, 19.8))

export const BAND_RULES = [
  rule({
    id: 'band.plain.width',
    title: 'Plain band width',
    applies: { kinds: ['ring'], archetypes: ['band'], nodeKind: 'ringShank', when: notMens },
    paths: ['ringShank.widthTop'],
    band: band(2.5, 1.5, 5.0),
    variants: {
      delicate: band(1.75, 1.5, 2.0),
      classic: band(2.5, 2.0, 3.0),
      bold: band(4.0, 3.5, 5.0),
    },
    lintAt: { above: mul(0.42, ID) },
    rationale:
      'Stacking bands are 1.5–2 mm, a classic wedding band 2–3; past 0.42 of the finger width the knuckle fights it.',
    source: src('S', '§1 Plain band'),
    confidence: 'high',
    severity: 'info',
    fix: 'clampToBand',
  }),
  rule({
    id: 'band.mens.width',
    title: "Men's band width",
    applies: { kinds: ['ring'], archetypes: ['band'], nodeKind: 'ringShank', when: v('mens') },
    paths: ['ringShank.widthTop'],
    band: band(mul(0.3, ID), mul(0.22, ID), mul(0.4, ID)),
    variants: {
      delicate: band(mul(0.22, ID), mul(0.2, ID), mul(0.25, ID)),
      classic: band(mul(0.3, ID), mul(0.27, ID), mul(0.33, ID)),
      bold: band(mul(0.39, ID), mul(0.37, ID), mul(0.4, ID)),
    },
    lintAt: { above: mul(0.42, ID) },
    rationale:
      "A man's band reads by its share of the finger: 0.22 slim, 0.30 classic (6 mm at US 10), 0.40 bold.",
    source: src('S', '§1 Plain band'),
    confidence: 'high',
    severity: 'info',
    fix: 'clampToBand',
  }),
  rule({
    id: 'band.plain.thickness',
    title: 'Plain band thickness',
    applies: { kinds: ['ring'], archetypes: ['band'], nodeKind: 'ringShank', when: notMens },
    paths: ['ringShank.thicknessTop'],
    band: band(1.6, 1.5, 1.8),
    lintAt: { below: 1.3 },
    rationale:
      "Women's bands are 1.5–1.8 mm deep; 1.3 only for a plain stacker, and the kernel will warn under 1.5.",
    source: src('K', '§1 Plain band'),
    confidence: 'high',
    severity: 'info',
    fix: 'clampToBand',
  }),
  rule({
    id: 'band.mens.thickness',
    title: "Men's band thickness",
    applies: { kinds: ['ring'], archetypes: ['band'], nodeKind: 'ringShank', when: v('mens') },
    paths: ['ringShank.thicknessTop'],
    band: band(mensT, max(1.5, sub(mensT, 0.2)), add(mensT, 0.3)),
    lintAt: { below: max(1.5, sub(mensT, 0.4)) },
    rationale:
      'Depth grows with width, about 1.6 + 0.1 × width: 2.0 on 4 mm, 2.2 on 6, 2.4 on 8, or a wide band looks flimsy.',
    source: src('K', '§1 Plain band (masses)'),
    confidence: 'high',
    severity: 'info',
    fix: 'clampToBand',
  }),
  rule({
    id: 'band.evenThickness',
    title: 'Even band depth',
    applies: { kinds: ['ring'], archetypes: ['band', 'eternity'], nodeKind: 'ringShank' },
    paths: ['ringShank.thicknessBottom'],
    band: band(v('bandT'), max(1.5, sub(v('bandT'), 0.2)), v('bandT')),
    rationale:
      'A band without a head is the same all round, at most 0.2 mm thinner under the palm.',
    source: src('EJ', '§1 Plain band'),
    confidence: 'medium',
    severity: 'default',
  }),
  rule({
    id: 'band.evenWidth',
    title: 'Even band width',
    applies: { kinds: ['ring'], archetypes: ['band', 'eternity'], nodeKind: 'ringShank' },
    paths: ['ringShank.widthBottom'],
    band: band(bandW, sub(bandW, 0.5), bandW),
    rationale:
      'Plain and eternity bands keep their width all round; taper is for rings with a head.',
    source: src('EJ', '§1 Plain band'),
    confidence: 'medium',
    severity: 'default',
  }),
  rule({
    id: 'band.fit',
    title: 'Fit of wide flat interiors',
    applies: { kinds: ['ring'], archetypes: ['band', 'signet'] },
    paths: ['ringShank.profile', 'ringShank.widthTop'],
    measure: 'wideFlatInterior',
    band: band(0, 0, 0),
    rationale:
      'Flat or D interiors 6 mm and wider wear a quarter to half size tight; size up or use a court profile.',
    source: src('S', '§1 Fit, pair'),
    confidence: 'medium',
    severity: 'default',
  }),
  rule({
    id: 'band.pair.width',
    title: 'Wedding band against its engagement ring',
    applies: { kinds: ['ring'], archetypes: ['band', 'eternity'], nodeKind: 'ringShank', when: gt(v('pairW'), 0) },
    paths: ['ringShank.widthTop'],
    band: band(v('pairW'), sub(v('pairW'), 0.3), add(v('pairW'), 0.3)),
    refines: 'band.plain.width',
    rationale:
      'A wedding band sits within 0.3 mm of its engagement shank’s width: any wider or narrower and the pair reads as two rings.',
    source: src('EJ', '§1 Fit, pair'),
    confidence: 'medium',
    severity: 'info',
    fix: 'clampToBand',
  }),
  rule({
    id: 'band.pair.thickness',
    title: 'Wedding band depth against its engagement ring',
    applies: { kinds: ['ring'], archetypes: ['band', 'eternity'], nodeKind: 'ringShank', when: gt(v('pairT'), 0) },
    paths: ['ringShank.thicknessTop'],
    band: band(v('pairT'), max(1.5, sub(v('pairT'), 0.2)), add(v('pairT'), 0.2)),
    refines: 'band.plain.thickness',
    rationale:
      'Match the engagement shank’s depth within 0.2 mm, so the two stand level on the finger.',
    source: src('EJ', '§1 Fit, pair'),
    confidence: 'medium',
    severity: 'info',
    fix: 'clampToBand',
  }),
  rule({
    id: 'band.mens.mass',
    title: "Men's band weight",
    applies: { kinds: ['ring'], archetypes: ['band'], when: v('mens') },
    paths: ['ringShank.widthTop', 'ringShank.thicknessTop'],
    measure: 'massG',
    band: band(mensMass, mul(0.8, mensMass), mul(1.25, mensMass)),
    rationale:
      'A 14k US 10 band weighs about 5.5 g at 4 mm, 9 g at 6, 12.5 g at 8: much lighter feels cheap.',
    source: src('D', "§4 Men's band"),
    confidence: 'medium',
    severity: 'default',
  }),
]
