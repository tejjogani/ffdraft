/** Research 09 §5 "Organic". */

import { mul, v } from '../expr'
import { band, src } from '../rules/rule'
import { guide } from './guide'

export const ORGANIC = guide({
  id: 'organic',
  label: 'Organic',
  aliases: ['organic', 'molten', 'hand-made', 'handmade', 'hammered', 'nugget', 'sculptural'],
  reads: [
    'Soft mass that looks shaped by hand, not machined.',
    'Matte or hammered surfaces that catch light unevenly.',
    'Irregular, flowing outlines; no straight edges.',
  ],
  vocabulary: {
    motifs: ['pebble', 'molten drip', 'branch', 'nugget'],
    cuts: ['cabochon', 'round', 'pear'],
    metals: ['au18k-yellow', 'au14k-yellow', 'ag925-sterling'],
    finishes: ['matte', 'hammered', 'satin'],
    settings: ['flush', 'bezel'],
  },
  recipes: [
    {
      path: 'vectorBody.bevelSize',
      band: band(mul(0.5, v('T')), mul(0.4, v('T')), mul(0.6, v('T'))),
      note: 'pillow, leaving ≥ 0.8 edge',
    },
    { path: 'pipe.width', band: band(1.8, 1.2, 3.0), note: 'section ≥ 1.2' },
    { path: 'meshBody.flatBack', band: band(0.3, 0.2, 0.4) },
  ],
  do: [
    'Use a sculpt (meshBody) or swept wire.',
    'Finish matte or hammered.',
    'Keep sections at 1.2 mm or more.',
  ],
  dont: ['Polished flat planes.', 'Rigid symmetry.', 'Pillow so deep the edge drops under 0.8 mm.'],
  cannotExpress: [
    { feature: 'true granulation and reticulation', fallback: 'hammered finish plus a maker note' },
  ],
  source: src('EJ', '§5 Organic'),
  confidence: 'medium',
})
