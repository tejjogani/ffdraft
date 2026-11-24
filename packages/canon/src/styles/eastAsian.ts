/** Research 09 §5 "Cultural traditions": East Asian, labelled "-inspired". */
import { band, src } from '../rules/rule'
import { guide } from './guide'

export const EAST_ASIAN = guide({
  id: 'eastAsian',
  label: 'East Asian-inspired',
  aliases: ['east asian', 'chinese', 'zodiac', 'lunar', 'japanese', 'korean'],
  reads: [
    'Pure 24k gold with soft, rounded relief.',
    'Auspicious symbols: zodiac animals, characters, clouds, coins.',
    'Weight is part of the value: solid, polished, simple outlines.',
  ],
  vocabulary: {
    motifs: ['zodiac animal', 'auspicious character', 'cloud', 'coin', 'lotus'],
    cuts: ['round', 'cabochon'],
    metals: ['au24k-yellow', 'au22k-yellow', 'au18k-yellow'],
    finishes: ['polished', 'matte'],
    settings: ['bezel'],
  },
  recipes: [
    { path: 'relief.depth', band: band(0.8, 0.6, 1.2) },
    {
      path: 'relief.baseThickness',
      band: band(1.6, 1.4, 2.0),
      note: '24k is soft: keep plates thick',
    },
  ],
  do: [
    'Ask region and occasion; confirm the symbol’s meaning.',
    'Relief in 24k.',
    'Say "-inspired".',
  ],
  dont: ['Fine claws or pavé in 24k.', 'Jade: it does not exist here.'],
  cannotExpress: [
    { feature: 'jade and carved stone', fallback: 'a cabochon stand-in in a bezel, declared' },
    { feature: 'cloisonné enamel', fallback: 'a maker note' },
  ],
  source: src('EJ', '§5 Cultural traditions'),
  confidence: 'medium',
})
