/** Research 09 §4 "Men's and signets". */
import { add, clamp, mul, v } from '../expr'
import { band, src } from '../rules/rule'
import { guide } from './guide'

export const HERITAGE_SIGNET = guide({
  id: 'heritageSignet',
  label: 'Heritage signet',
  aliases: ['signet', 'heritage', 'crest', 'seal', 'family ring', 'pinky ring', 'heraldic'],
  reads: [
    'A landscape face 0.65–0.80 of the finger across, 0.80–0.87 as long.',
    'A strong taper: the base a third of the top.',
    'A plate thick enough to engrave and wear for generations (2.2–3.0 mm).',
    'Polished face, crisp edges; the crest is the only ornament.',
  ],
  vocabulary: {
    motifs: ['crest', 'monogram', 'seal', 'flush stone'],
    cuts: ['round', 'cabochon'],
    metals: ['au18k-yellow', 'au14k-yellow', 'au9k-yellow', 'ag925-sterling'],
    finishes: ['polished', 'satin'],
    settings: ['flush', 'seal cut (relief, inverted)'],
  },
  recipes: [
    { path: 'relief.width', band: band(mul(0.72, v('ID')), mul(0.65, v('ID')), mul(0.8, v('ID'))) },
    {
      path: 'relief.height',
      band: band(mul(0.83, v('reliefW')), mul(0.8, v('reliefW')), mul(0.87, v('reliefW'))),
    },
    { path: 'ringShank.widthBottom', band: band(clamp(mul(0.34, v('bandW')), 3.5, 5), 3.5, 5) },
    { path: 'ringShank.thicknessTop', band: band(2.6, 2.2, 3.0) },
    { path: 'relief.depth', band: band(0.8, 0.6, 1.0), note: 'seal, inverted, cut after casting' },
    {
      path: 'relief.baseThickness',
      band: band(
        add(v('reliefDepth'), 1.4),
        add(v('reliefDepth'), 1.2),
        add(v('reliefDepth'), 2.0),
      ),
    },
  ],
  do: [
    'Ask face size and content first.',
    'Taper hard to the palm.',
    'Cut seals 0.6–1.0 deep after casting, with 1.2 mm of plate behind.',
  ],
  dont: [
    'Portrait faces taller than wide.',
    'Engraving lines under 0.3 mm wide cast in.',
    'Flush stones deeper than the plate allows.',
  ],
  cannotExpress: [
    { feature: 'hand-cut heraldry', fallback: 'an SVG relief plus "hand finish by engraver"' },
    { feature: 'enamelled crests', fallback: 'a maker note' },
  ],
  source: src('S', '§4 Signet (AJLuxe, Asprey, Deakin & Francis)'),
  confidence: 'high',
})
