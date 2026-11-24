/** Research 09 §5 "Mid-century". */
import { band, src } from '../rules/rule'
import { guide } from './guide'

export const MID_CENTURY = guide({
  id: 'midCentury',
  label: 'Mid-century',
  aliases: ['mid-century', 'mid century', '1950s', 'atomic', 'starburst', 'spray'],
  reads: [
    'Sprays and starbursts: stones radiating from a point.',
    'Textured gold against bright marquise and round stones.',
    'Movement: elements fan out, never sit in a grid.',
  ],
  vocabulary: {
    motifs: ['spray', 'starburst', 'atomic rays', 'leaf fans'],
    cuts: ['marquise', 'round', 'pear'],
    metals: ['au18k-yellow', 'au14k-yellow', 'pt950'],
    finishes: ['satin', 'brushed', 'polished'],
    settings: ['marquise claws', 'polar rays'],
  },
  recipes: [
    { path: 'gem.lw', band: band(2.0, 1.9, 2.1), note: 'marquise' },
    { path: 'pipe.width', band: band(1.0, 0.8, 1.2), note: 'polar rays' },
    { path: 'pipe.taper', band: band(0.25, 0.1, 0.3) },
  ],
  do: [
    'Fan elements from a point with a polar pattern.',
    'Pair satin gold with bright stones.',
    'Use marquise at 1.9–2.1.',
  ],
  dont: ['Rigid grids.', 'Rays thinner than 0.8 mm.', 'Taper rays past 0.3 (the tips vanish).'],
  cannotExpress: [
    {
      feature: 'Florentine and bark textures',
      fallback: 'brushed or hammered finish plus a maker note',
    },
  ],
  source: src('EJ', '§5 Mid-century'),
  confidence: 'medium',
})
