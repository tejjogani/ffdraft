/** Signet, seal and championship rules: research 09 §4. Engraving minimums from §4 and 02-production. */
import { add, clamp, div, gt, lt, min, mul, sub, v } from '../expr'
import { band, rule, src } from './rule'

const ID = v('ID')
const faceW = v('reliefW')
const faceH = v('reliefH')
const bandW = v('bandW')
const flushMax = div(sub(v('bandT'), 0.2), v('depthPct'))

export const SIGNET_RULES = [
  rule({
    id: 'signet.faceAcross',
    title: 'Signet face across the finger',
    applies: { archetypes: ['signet'], nodeKind: 'relief', when: lt(v('champion'), 0.5) },
    paths: ['relief.width'],
    band: band(mul(0.72, ID), mul(0.65, ID), mul(0.8, ID)),
    lintAt: { below: mul(0.55, ID), above: mul(0.9, ID) },
    rationale:
      'The face spans 0.65–0.80 of the finger: 12–14 mm at US 9–10, the stock 12 × 10 to 14 × 12 faces.',
    source: src('S', '§4 Signet face'),
    confidence: 'high',
    severity: 'info',
    fix: 'clampToBand',
  }),
  rule({
    id: 'signet.faceAlong',
    title: 'Signet face along the finger',
    applies: { archetypes: ['signet'], nodeKind: 'relief' },
    paths: ['relief.height'],
    band: band(mul(0.83, faceW), mul(0.8, faceW), mul(0.87, faceW)),
    lintAt: { below: mul(0.7, faceW), above: mul(1.05, faceW) },
    rationale:
      'A signet face is landscape, 0.80–0.87 as long as it is wide, so it sits across the finger like a seal.',
    source: src('S', '§4 Signet face'),
    confidence: 'high',
    severity: 'info',
    fix: 'clampToBand',
  }),
  rule({
    id: 'signet.shankTop',
    title: 'Shank under the face',
    applies: { archetypes: ['signet'], nodeKind: 'ringShank', when: gt(faceH, 0) },
    paths: ['ringShank.widthTop'],
    band: band(min(14, mul(0.9, faceH)), min(14, mul(0.7, faceH)), min(14, faceH)),
    rationale:
      'The shoulders swell into the face: the band top is about as wide as the face is long.',
    source: src('S', '§4 Signet face'),
    confidence: 'medium',
    severity: 'default',
  }),
  rule({
    id: 'signet.taper',
    title: 'Signet taper',
    applies: { archetypes: ['signet'], nodeKind: 'ringShank' },
    paths: ['ringShank.widthBottom'],
    band: band(
      clamp(mul(0.34, bandW), 3.5, 5),
      clamp(mul(0.28, bandW), 3.0, 5),
      clamp(mul(0.4, bandW), 3.5, 6),
    ),
    lintAt: { below: 2.5, above: mul(0.6, bandW) },
    rationale:
      'A signet tapers to a third of its top, 3.5–5 mm at the palm: the taper is what makes it a signet.',
    source: src('S', '§4 Taper, plate'),
    confidence: 'high',
    severity: 'info',
    fix: 'clampToBand',
  }),
  rule({
    id: 'signet.plate',
    title: 'Signet plate',
    applies: { archetypes: ['signet'], nodeKind: 'ringShank' },
    paths: ['ringShank.thicknessTop'],
    band: band(2.6, 2.2, 3.0),
    lintAt: { below: 2.0 },
    rationale: 'The plate carries the engraving and decades of wear: 2.2–3.0 mm under the face.',
    source: src('S', '§4 Taper, plate'),
    confidence: 'high',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'signet.base',
    title: 'Signet base',
    applies: { archetypes: ['signet'], nodeKind: 'ringShank' },
    paths: ['ringShank.thicknessBottom'],
    band: band(1.8, 1.5, 2.0),
    rationale: 'Keep 1.5–2.0 mm under the palm: comfortable, and enough to size.',
    source: src('S', '§4 Taper, plate'),
    confidence: 'high',
    severity: 'default',
  }),
  rule({
    id: 'engraving.castDepth',
    title: 'Cast-in engraving depth',
    applies: { nodeKind: 'engraving' },
    paths: ['engraving.depth'],
    band: band(0.35, 0.25, 0.5),
    lintAt: { below: 0.2, above: 0.5 },
    rationale:
      'Cast lettering 0.25–0.5 mm deep survives polishing; finer lines are a hand finish for the production notes.',
    source: src('R', '§4 Engraving; 02-production recessed text'),
    confidence: 'high',
    severity: 'info',
    fix: 'clampToBand',
  }),
  rule({
    id: 'engraving.stroke',
    title: 'Letter height for cast lettering',
    applies: { nodeKind: 'engraving', when: v('outside') },
    paths: ['engraving.size'],
    band: band(3, 2.5, 20),
    lintAt: { below: 2.5 },
    rationale:
      'Cast strokes must be 0.3 mm wide, so outside letters start at 2.5 mm high; smaller is laser work.',
    source: src('R', '§4 Engraving; 02-production recessed text'),
    confidence: 'medium',
    severity: 'info',
    fix: 'clampToBand',
  }),
  rule({
    id: 'signet.sealDepth',
    title: 'Seal depth',
    applies: { nodeKind: 'relief', when: v('invert') },
    paths: ['relief.depth'],
    band: band(0.8, 0.6, 1.0),
    lintAt: { below: 0.4, above: 1.2 },
    rationale: 'A seal must print in wax: cut 0.6–1.0 mm deep, after casting, by the engraver.',
    source: src('R', '§4 Engraving (seals)'),
    confidence: 'medium',
    severity: 'info',
    fix: 'clampToBand',
  }),
  rule({
    id: 'signet.sealPlate',
    title: 'Plate behind a seal',
    applies: { nodeKind: 'relief', when: v('invert') },
    paths: ['relief.baseThickness'],
    band: band(add(v('reliefDepth'), 1.4), add(v('reliefDepth'), 1.2), add(v('reliefDepth'), 2.0)),
    lintAt: { below: add(v('reliefDepth'), 1.2) },
    rationale:
      'Leave at least 1.2 mm of plate behind the deepest cut of a seal, or it dents in wear.',
    source: src('K', '§4 Engraving (seals)'),
    confidence: 'high',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'signet.flushStone',
    title: 'Flush stone in a plate',
    applies: { kinds: ['ring'], nodeKind: 'gem', when: v('flush') },
    paths: ['gem.width'],
    band: band(mul(0.9, flushMax), min(1.5, flushMax), flushMax),
    lintAt: { above: flushMax },
    rationale:
      'A flush stone sinks its whole depth into the metal: (plate − 0.2)/0.615 mm, 3.2 in 2.2 mm. Larger goes in a bezel.',
    source: src('D', '§4 Flush stone'),
    confidence: 'high',
    severity: 'warning',
    fix: 'clampToBand',
  }),
]
