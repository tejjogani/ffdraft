/** Research 09 §5 "Cultural traditions": South Asian bridal, labelled "-inspired". */
import { band, src } from '../rules/rule'
import { guide } from './guide'

export const SOUTH_ASIAN = guide({
  id: 'southAsian',
  label: 'South Asian-inspired',
  aliases: ['south asian', 'indian', 'kundan', 'polki', 'jhumka', 'bridal 22k', 'desi'],
  reads: [
    'Rich 22k yellow gold, often matte, worn generously.',
    'Closed bezels round every stone (kundan is the foil setting).',
    'Domes, bells and drops that move: jhumkas, chandbalis.',
  ],
  vocabulary: {
    motifs: ['jhumka bell', 'paisley', 'peacock', 'lotus', 'chandbali crescent'],
    cuts: ['cabochon', 'round', 'pear'],
    metals: ['au22k-yellow', 'au18k-yellow'],
    finishes: ['matte', 'polished'],
    settings: ['closed bezel 0.6–0.9'],
  },
  recipes: [
    { path: 'setting.wall', band: band(0.75, 0.6, 0.9), note: 'closed bezels' },
    {
      path: 'revolve.angle',
      band: band(360, 360, 360),
      note: 'jhumka dome: revolve shell, wall 0.7–0.8 (≈ 2.5 g at Ø 12 in 22k)',
    },
  ],
  do: [
    'Ask region and occasion first.',
    'Use 22k and closed bezels.',
    'Say "-inspired": we do not build kundan or polki.',
  ],
  dont: [
    'Claim kundan or polki.',
    'Shared prongs or micro-pavé in 22k.',
    'Thin bezels in soft gold.',
  ],
  cannotExpress: [
    { feature: 'kundan foil setting', fallback: 'closed bezels plus a maker note' },
    { feature: 'polki (uncut diamonds)', fallback: 'cabochon or rose stand-in, declared' },
    { feature: 'meenakari enamel', fallback: 'a maker note' },
  ],
  source: src('EJ', '§5 Cultural traditions'),
  confidence: 'medium',
})
