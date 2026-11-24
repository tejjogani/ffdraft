/** Research 09 §5 "Celestial / nature". */
import { add, mul, v } from '../expr'
import { band, src } from '../rules/rule'
import { guide } from './guide'

export const CELESTIAL = guide({
  id: 'celestial',
  label: 'Celestial and nature',
  aliases: ['celestial', 'moon', 'botanical', 'floral', 'leaf', 'flower'],
  reads: [
    'Alternation reads botanical: big–small, leaf–stone, petal–gap.',
    'Stars and moons need depth to read as objects, not stickers.',
    'Leaves angle off the stem at 30–45°.',
  ],
  vocabulary: {
    motifs: ['star', 'crescent', 'petals', 'leaves', 'vine'],
    cuts: ['round', 'marquise', 'pear'],
    metals: ['au18k-yellow', 'au14k-yellow', 'au18k-rose'],
    finishes: ['polished', 'satin'],
    settings: ['claw petals', 'bezel centre', 'flush stars'],
  },
  recipes: [
    {
      path: 'vectorBody.thickness',
      band: band(
        add(mul(0.65, v('W')), 0.6),
        add(mul(0.65, v('W')), 0.4),
        add(mul(0.65, v('W')), 1.2),
      ),
      note: 'star around a set stone',
    },
    {
      path: 'gem.width',
      band: band(mul(0.9, v('cW')), mul(0.85, v('cW')), v('cW')),
      note: 'six petals; five at 1.3–1.4 × centre',
    },
  ],
  do: [
    'Alternate sizes or elements.',
    'Angle leaves 30–45° off the stem.',
    'Give stars real thickness.',
  ],
  dont: [
    'Perfect grids of identical stones.',
    'Paper-thin stars.',
    'Leaves at 90° (they read as a fishbone).',
  ],
  cannotExpress: [
    { feature: 'enamelled petals', fallback: 'polished metal petals plus a maker note' },
  ],
  source: src('EJ', '§5 Celestial / nature'),
  confidence: 'medium',
})
