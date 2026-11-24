/** Iced-out pendants: research 09 §2 table (pavé hosts, ice, edges, depth, size). */
import { add, and, clamp, gt, iff, lt, max, min, mul, snap, sub, v } from '../expr'
import { band, rule, src } from './rule'

const H = v('H')
const T = v('T')
const d = v('paveMax')
const iced = ['icedPendant'] as const
const thick = add(1.5, mul(0.055, H))
const thinFloor = max(2.5, add(1, mul(0.035, H)))
const fill = snap(clamp(mul(0.02, H), 1.0, 2.0))
const fillCap = min(4, iff(lt(H, 60), min(2.0, max(1.3, mul(0.03, H))), max(1.3, mul(0.03, H))))
const underMin = add(mul(0.65, d), 0.8)
const gapTyp = clamp(mul(0.15, d), 0.15, 0.25)
/** Wall under pavé seats in a shell: 0.65 × stone + 0.8, never under 1.2 (06-freeform). */
const shellMin = max(1.2, add(mul(0.65, max(d, 0)), 0.8))

export const ICED_RULES = [
  rule({
    id: 'iced.thickness',
    title: 'Iced body thickness',
    applies: { archetypes: [...iced], nodeKind: 'vectorBody', when: v('main') },
    paths: ['vectorBody.thickness'],
    band: band(thick, max(thinFloor, mul(0.75, thick)), mul(1.25, thick)),
    lintAt: { below: thinFloor },
    rationale:
      'Iced pieces need depth for seats and presence: about 1.5 + 0.055 × height, 3.2 mm at 30, 5.6 at 75.',
    source: src('K', '§2 Thickness (masses)'),
    confidence: 'medium',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'iced.plate',
    title: 'Stacked plate thickness',
    applies: { archetypes: [...iced], nodeKind: 'vectorBody', when: lt(v('main'), 0.5) },
    paths: ['vectorBody.thickness'],
    band: band(2.0, 1.6, 3.0),
    lintAt: { below: 1.6 },
    rationale:
      'A raised plate that carries stones needs 1.6 mm of its own, or the seats break through.',
    source: src('K', '§2 Depth'),
    confidence: 'medium',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'iced.metalUnder',
    title: 'Metal under the pavé',
    applies: { nodeKind: 'pave' },
    paths: ['vectorBody.thickness', 'pave.sizeMax'],
    measure: 'metalUnderPave',
    band: band(add(underMin, 0.4), underMin, max(T, add(underMin, 0.4))),
    lintAt: { below: underMin },
    rationale:
      'Under the recessed field keep 0.65 × stone + 0.8 mm of metal; thinner and the kernel quietly drops stones.',
    source: src('K', '§2 Metal under stones'),
    confidence: 'high',
    severity: 'warning',
  }),
  rule({
    id: 'iced.sizeMax',
    title: 'Fill stone size',
    applies: { archetypes: [...iced], nodeKind: 'pave' },
    paths: ['pave.sizeMax'],
    band: band(fill, max(0.8, sub(fill, 0.2)), max(fill, min(2.0, fillCap))),
    lintAt: { above: fillCap },
    rationale:
      'The largest stone is the bulk of the ice: 2 % of the height, 1.0–1.2 on a micro piece, 1.5–2.0 on XL. Big melee looks coarse.',
    source: src('K', '§2 Fill stone'),
    confidence: 'medium',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'iced.spread',
    title: 'Size spread',
    applies: { nodeKind: 'pave' },
    paths: ['pave.sizeMin'],
    band: band(
      snap(clamp(mul(d, 1 / 1.5), 0.8, 1.2)),
      max(0.8, min(1.2, mul(d, 1 / 1.8))),
      max(0.8, min(1.2, mul(d, 1 / 1.3))),
    ),
    // Capped at the band's top: with fill stones over 2.4 mm the floor would pass the stock range.
    lintAt: { below: min(mul(d, 0.5), max(0.8, min(1.2, mul(d, 1 / 1.3)))) },
    rationale:
      'Fill corners with stones 1.3–1.8× smaller than the bulk; a wider spread reads as gravel.',
    source: src('K', '§2 Spread'),
    confidence: 'medium',
    severity: 'info',
    fix: 'clampToBand',
  }),
  rule({
    id: 'iced.gap',
    title: 'Gap between pavé stones',
    applies: { nodeKind: 'pave' },
    paths: ['pave.gap'],
    band: band(iff(v('beads'), max(0.2, gapTyp), gapTyp), iff(v('beads'), 0.2, 0.15), 0.25),
    lintAt: { below: 0.1, above: max(0.25, mul(0.2, d)) },
    rationale:
      'Bead-set pavé needs 0.20–0.25 mm between stones for the beads; wider shows metal and looks sparse.',
    source: src('R', '§2 Gap'),
    confidence: 'high',
    severity: 'info',
    fix: 'clampToBand',
  }),
  rule({
    id: 'iced.edge',
    title: 'Edge of the field',
    applies: { nodeKind: 'pave' },
    paths: ['pave.margin', 'vectorBody.border'],
    measure: 'paveEdge',
    band: band(0.9, 0.5, 2.5),
    lintAt: { below: 0.4 },
    rationale:
      'Rim plus margin at least 0.5 mm, never under 0.4: the outer stones need metal to be set against.',
    source: src('R', '§2 Edge'),
    confidence: 'high',
    severity: 'warning',
  }),
  rule({
    id: 'iced.margin',
    title: 'Margin inside a rim',
    applies: { nodeKind: 'pave', when: gt(v('border'), 0.59) },
    paths: ['pave.margin'],
    // Research 09 §2 gives 0.15–0.35; at 0.25 the kernel's seat.wall check fails on rimmed
    // outlines, so the kernel's 0.4 wins.
    band: band(0.4, 0.4, 0.5),
    rationale:
      'With a polished rim of 0.6 mm or more, keep the stones 0.4–0.5 mm off it: the seats keep their wall and the rim reads as a line.',
    source: src('K', '§2 Edge (0.15–0.35 corrected on the kernel seat check)'),
    confidence: 'medium',
    severity: 'default',
  }),
  rule({
    id: 'iced.rim',
    title: 'Polished rim',
    applies: { archetypes: [...iced], nodeKind: 'vectorBody', when: and(v('main'), gt(d, 0)) },
    paths: ['vectorBody.border'],
    band: band(clamp(mul(0.85, d), 0.6, 3), clamp(mul(0.7, d), 0.6, 3), clamp(d, 0.6, 3)),
    rationale:
      'A polished rim 0.7–1.0 × the stone size outlines the silhouette so the piece reads from across a room.',
    source: src('R', '§2 Edge'),
    confidence: 'medium',
    severity: 'default',
  }),
  rule({
    id: 'iced.coverage',
    title: 'Ice level',
    applies: { nodeKind: 'pave' },
    paths: ['pave.coverage'],
    band: band(1, 1, 1),
    lintAt: { below: 0.999 },
    rationale:
      'Fill every field fully; for accents add a separate pavé node. Below 1 the field shrinks from its edges.',
    source: src('K', '§2 Ice level'),
    confidence: 'high',
    severity: 'info',
    fix: 'setTypical',
  }),
  rule({
    id: 'iced.height',
    title: 'Iced pendant scale',
    applies: { archetypes: [...iced] },
    paths: ['vectorBody.height', 'meshBody.height'],
    measure: 'bodyHeight',
    band: band(51, 25, 102),
    variants: { delicate: band(32, 25, 38), classic: band(51, 38, 64), bold: band(76, 64, 102) },
    lintAt: { below: 25 },
    rationale:
      'Micro 25–38 mm, small 38–64, mid 64–76, standard 76–102: an iced piece left at 22 mm is a charm.',
    source: src('D', '§2 Tiers'),
    confidence: 'medium',
    severity: 'warning',
  }),
  rule({
    id: 'iced.envelope',
    title: 'Caster envelope',
    applies: { archetypes: [...iced, 'medallion', 'custom'] },
    paths: ['vectorBody.height', 'meshBody.height', 'relief.height'],
    measure: 'bodyHeight',
    band: band(51, 0, 70),
    rationale:
      'Above 70 mm a piece exceeds the default caster’s flask: plan a larger flask or a two-part casting.',
    source: src('K', '§2 Size limits'),
    confidence: 'high',
    severity: 'default',
  }),
  rule({
    id: 'iced.flatBack',
    title: 'Flat back on a sculpt',
    applies: { nodeKind: 'meshBody' },
    paths: ['meshBody.flatBack'],
    // Research 09 §2 says 0.35. Measured on the kernel, 0.35 leaves the built-in trophy 17 mm
    // deep at 45 mm and the crown 47 mm: half or more must go for the 0.3·H depth (iced.depth).
    band: band(0.5, 0.35, 0.85),
    rationale:
      'Slice the back of a sculpt until it stands at most 0.3 of its height off the chest: half for most sculpts, more for round ones.',
    source: src('K', '§2 Size limits (0.35 corrected on kernel depths)'),
    confidence: 'medium',
    severity: 'default',
  }),
  rule({
    id: 'iced.hollow',
    title: 'Hollow sculpts',
    applies: { nodeKind: 'meshBody', when: gt(H, 14.99) },
    paths: ['meshBody.hollow'],
    band: band(max(1.5, shellMin), shellMin, max(2.5, shellMin)),
    rationale:
      'Shell any sculpt thicker than 3 mm: a 1.5 mm wall (0.65 × stone + 0.8 under pavé) halves the metal; a solid sculpt weighs several times market.',
    source: src('R', '06-freeform: hollow above 3 mm; §2 Metal under stones'),
    confidence: 'medium',
    severity: 'default',
  }),
  rule({
    id: 'iced.depth',
    title: 'Depth off the chest',
    applies: { kinds: ['pendant', 'necklace'], when: gt(H, 14.99) },
    paths: ['meshBody.flatBack', 'vectorBody.thickness'],
    measure: 'pendantDepth',
    band: band(mul(0.2, H), mul(0.08, H), mul(0.3, H)),
    lintAt: { above: mul(0.35, H) },
    rationale:
      'A pendant stands at most 0.3 of its height off the chest; deeper and it swings, flips and reads as a lump in profile.',
    source: src('EJ', '§2 Depth, Mass'),
    confidence: 'medium',
    severity: 'warning',
  }),
  rule({
    id: 'iced.mass',
    title: 'Sculpt weight',
    applies: { kinds: ['pendant', 'necklace'], when: and(v('sculpt'), gt(H, 14.99)) },
    paths: ['meshBody.hollow', 'meshBody.flatBack'],
    measure: 'solidEquivalent',
    band: band(2.5, 1.5, 3.5),
    lintAt: { above: 5 },
    rationale:
      'Metal = silhouette × 1.5–3.5 mm solid-equivalent × density; past 5 mm a sculpt is a solid lump: hollow it.',
    source: src('D', '§2 Mass'),
    confidence: 'medium',
    severity: 'warning',
  }),
  rule({
    id: 'iced.levels',
    title: 'Steps between levels',
    applies: {},
    paths: ['vectorBody.thickness', 'vectorBody.transform'],
    measure: 'levelStep',
    band: band(1.2, 0.8, 1.5),
    lintAt: { below: 0.5, above: 3 },
    rationale:
      'Stacked levels step 0.8–1.5 mm: smaller reads as a mistake, bigger as two pieces glued together.',
    source: src('K', '§2 Depth'),
    confidence: 'medium',
    severity: 'info',
  }),
]
