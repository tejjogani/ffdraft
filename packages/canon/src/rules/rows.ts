/** Rows and eternity rules: research 09 §1 "Rows, eternity, plain bands". */
import { add, and, asin, div, eq, gt, iff, lt, max, min, mul, snap, sub, v } from '../expr'
import { band, HEADED, rule, src } from './rule'

const bandW = v('bandW')
const rows = v('rowRows')
const gap = v('rowGap')
const d = v('rowD')
const walled = lt(v('shared'), 0.5)
/** Largest stone that leaves `metal` either side across `rows` rows. */
const fitting = (metal: number) => div(sub(bandW, metal, mul(sub(rows, 1), gap)), rows)
const walledMax = max(0.8, fitting(0.8))
const walledTyp = min(walledMax, max(0.8, snap(fitting(1.0))))
const sharedMax = max(0.8, fitting(0.4))
const sharedTyp = min(sharedMax, max(0.8, snap(fitting(0.6))))
const underFloor = iff(
  v('shared'),
  max(1.5, add(mul(0.35, d), 0.6)),
  max(1.5, add(mul(0.6, d), 0.6)),
)
/** Half-width the row must clear: the halo outline, or the head's base plus its wire. */
const clearHalf = iff(
  v('halo'),
  add(mul(0.5, v('cW')), v('haloOffset'), mul(v('haloRows'), v('haloD')), 0.55),
  add(mul(sub(1, v('headTaper')), add(mul(0.5, v('cW')), 0.35)), mul(0.5, v('headWire')), 0.3),
)
const skipMin = mul(2, asin(div(clearHalf, add(div(v('ID'), 2), v('bandT')))))
const graduate = snap(sub(d, 0.4))

export const ROW_RULES = [
  rule({
    id: 'rows.walledPave',
    title: 'Walled pavé and channel stone size',
    applies: { nodeKind: 'gemRow', when: walled },
    paths: ['gemRow.stoneWidth'],
    band: band(walledTyp, max(0.8, sub(walledMax, 0.6)), walledMax),
    lintAt: { above: walledMax },
    rationale:
      'Walled pavé and channel need 0.4 mm of metal each side: a 2.0 band takes 1.0–1.2 stones, a 2.4 band 1.4–1.6.',
    source: src('R', '§1 Rows: walled pavé (GIA 0.5, Stuller 0.4)'),
    confidence: 'high',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'rows.bandForStones',
    title: 'Band wide enough for its row',
    applies: { kinds: ['ring'], nodeKind: 'ringShank', when: and(gt(d, 0), walled) },
    paths: ['ringShank.widthTop'],
    band: band(
      add(mul(rows, d), mul(sub(rows, 1), gap), 1.0),
      add(mul(rows, d), mul(sub(rows, 1), gap), 0.8),
      14,
    ),
    rationale:
      'When the stones are chosen first, widen the band to them: stones plus 0.4 mm of wall each side.',
    source: src('R', '§1 Rows: walled pavé'),
    confidence: 'high',
    severity: 'default',
  }),
  rule({
    id: 'rows.sharedProng',
    title: 'Shared-prong stone size',
    applies: { nodeKind: 'gemRow', when: v('shared') },
    paths: ['gemRow.stoneWidth'],
    band: band(sharedTyp, max(0.8, sub(sharedMax, 0.6)), sharedMax),
    lintAt: { above: sharedMax },
    rationale:
      'Shared claws grip from the edges, so stones may reach 0.4 mm short of the band width, no further.',
    source: src('K', '§1 Rows: shared prong'),
    confidence: 'high',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'rows.frenchCut',
    title: 'French and U-cut pavé',
    applies: { nodeKind: 'gemRow' },
    paths: ['gemRow.setting'],
    band: band(0, 0, 0),
    rationale:
      'French and U-cut pavé cannot be modelled: build shared prong and say the setter will cut it.',
    source: src('K', '§1 Rows: shared prong'),
    confidence: 'high',
    severity: 'default',
    expressible: false,
  }),
  rule({
    id: 'rows.rowCount',
    title: 'Rows across the band',
    applies: { nodeKind: 'gemRow' },
    paths: ['gemRow.rows'],
    band: band(iff(lt(bandW, 3), 1, iff(lt(bandW, 4.05), 2, 3)), 1, 3),
    rationale:
      'One row below 3 mm of band, two at 3–4 mm, three from 4.1: more rows of smaller stones read as a sheet.',
    source: src('K', '§1 Rows: rows'),
    confidence: 'medium',
    severity: 'default',
  }),
  rule({
    id: 'rows.multiRowFit',
    title: 'Rows fit the band',
    applies: { nodeKind: 'gemRow', when: and(walled, gt(rows, 1.5)) },
    paths: ['gemRow.rows', 'gemRow.stoneWidth'],
    measure: 'rowExcess',
    band: band(-0.2, -1, 0),
    lintAt: { above: 0 },
    rationale:
      'Rows × stone + gaps + 0.8 mm of wall must fit the band width, or the outer rows hang over the edge.',
    source: src('K', '§1 Rows: rows'),
    confidence: 'high',
    severity: 'warning',
  }),
  rule({
    id: 'rows.metalUnder',
    title: 'Metal under the row',
    applies: { kinds: ['ring'], nodeKind: 'ringShank', when: gt(d, 0) },
    paths: ['ringShank.thicknessTop'],
    band: band(add(underFloor, 0.1), underFloor, add(underFloor, 0.5)),
    lintAt: { below: underFloor },
    rationale:
      'Seats are drilled through: keep 0.6 × stone + 0.6 mm of band under walled pavé (0.35× for shared claws).',
    source: src('K', '§1 Rows: metal under stones'),
    confidence: 'high',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'rows.eternityBase',
    title: 'Metal under a full row',
    applies: { kinds: ['ring'], nodeKind: 'ringShank', when: gt(v('rowCov'), 299) },
    paths: ['ringShank.thicknessBottom'],
    band: band(add(underFloor, 0.1), underFloor, add(underFloor, 0.5)),
    lintAt: { below: underFloor },
    rationale:
      'An eternity has stones under the palm too, so the base needs the same metal under the seats as the top.',
    source: src('K', '§1 Rows: metal under stones'),
    confidence: 'high',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'rows.coverage',
    title: 'Coverage of a part row',
    applies: { archetypes: [...HEADED, 'band', 'signet', 'custom'], nodeKind: 'gemRow' },
    paths: ['gemRow.coverage'],
    band: band(160, 120, 270),
    variants: {
      delicate: band(150, 120, 180),
      classic: band(165, 150, 180),
      bold: band(255, 240, 270),
    },
    lintAt: { above: 270 },
    rationale:
      'Half (150–180°) or three-quarter (240–270°) leaves the palm plain for resizing; more is an eternity.',
    source: src('EJ', '§1 Rows: coverage'),
    confidence: 'high',
    severity: 'info',
    fix: 'clampToBand',
  }),
  rule({
    id: 'rows.eternityCoverage',
    title: 'Eternity coverage',
    applies: { archetypes: ['eternity'], nodeKind: 'gemRow' },
    paths: ['gemRow.coverage'],
    band: band(360, 150, 360),
    rationale:
      'A full eternity is sized exactly and cannot be resized; offer a half or three-quarter when size may change.',
    source: src('EJ', '§1 Rows: coverage'),
    confidence: 'high',
    severity: 'default',
  }),
  rule({
    id: 'rows.gap',
    title: 'Gap between row stones',
    applies: { nodeKind: 'gemRow' },
    paths: ['gemRow.gap'],
    band: band(
      iff(v('channel'), 0.08, iff(v('bar'), 0.6, 0.15)),
      iff(v('channel'), 0.05, iff(v('bar'), 0.5, 0.1)),
      iff(v('channel'), 0.1, iff(v('bar'), 0.7, 0.25)),
    ),
    lintAt: { below: 0.05, above: iff(v('bar'), 0.8, 0.35) },
    rationale:
      'Pavé 0.10–0.25 mm leaves room for beads; channel stones nearly touch (0.05–0.10); bars need 0.5–0.7.',
    source: src('R', '§1 Rows: gap'),
    confidence: 'high',
    severity: 'info',
    fix: 'clampToBand',
  }),
  rule({
    id: 'rows.skipCenter',
    title: 'Row clear of the head',
    applies: { kinds: ['ring'], nodeKind: 'gemRow', when: v('head') },
    paths: ['gemRow.skipCenter'],
    band: band(add(skipMin, 4), skipMin, add(skipMin, 24)),
    lintAt: { below: skipMin },
    rationale:
      'Start the row where the head or halo ends: about 36° at 1 ct, 49° at 3 ct, or the first stones hit the claws.',
    source: src('D', '§1 Rows: clear of the head'),
    confidence: 'medium',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'rows.graduation',
    title: 'Graduated row ends',
    applies: { nodeKind: 'gemRow', when: v('graduated') },
    paths: ['gemRow.graduateTo'],
    band: band(iff(eq(graduate, 1.5), 1.4, graduate), max(0.8, sub(d, 0.5)), max(0.8, sub(d, 0.3))),
    rationale: 'Graduate 0.3–0.5 mm smaller toward the back so the row tapers away from the head.',
    source: src('R', '§1 Rows: graduation'),
    confidence: 'medium',
    severity: 'default',
  }),
  rule({
    id: 'rows.eternityScale',
    title: 'Eternity stone size',
    applies: { archetypes: ['eternity'], nodeKind: 'gemRow' },
    paths: ['gemRow.stoneWidth'],
    band: band(2.0, 1.3, 4.0),
    variants: {
      delicate: band(1.4, 1.3, 1.5),
      classic: band(2.0, 1.8, 2.2),
      bold: band(2.8, 2.7, 3.0),
    },
    rationale:
      'Eternity sizes come in steps: 1.3–1.5 delicate, 1.8–2.2 classic, 2.7–3.0 bold, 3.5–4.0 statement.',
    source: src('K', '§1 Rows: eternity scale'),
    confidence: 'high',
    severity: 'default',
  }),
  rule({
    id: 'rows.flatProfile',
    title: 'Flat profile under long rows',
    applies: {
      kinds: ['ring'],
      nodeKind: 'ringShank',
      when: and(gt(v('rowCov'), 239), lt(v('shared'), 0.5)),
    },
    paths: ['ringShank.profile'],
    measure: 'flatProfile',
    band: band(1, 1, 1),
    rationale:
      'Walled rows sit on a flat or flat-court top: a domed court profile tilts the outer stones.',
    source: src('EJ', '§1 Solitaire: profile, base'),
    confidence: 'medium',
    severity: 'default',
  }),
]
