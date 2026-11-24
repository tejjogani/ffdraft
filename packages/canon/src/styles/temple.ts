/** Research 09 §5 "Cultural traditions": temple jewellery, labelled "-inspired". */
import { band, src } from '../rules/rule'
import { guide } from './guide'

export const TEMPLE = guide({
  id: 'temple',
  label: 'Temple-inspired',
  aliases: ['temple', 'south indian temple', 'deity', 'lakshmi', 'nakshi'],
  reads: [
    'Deep 22k relief: deities, peacocks and lotus in high relief.',
    'Cabochon rubies and emeralds as accents in closed bezels.',
    'Antique matte finish that pools in the recesses.',
  ],
  vocabulary: {
    motifs: ['deity relief', 'lotus', 'peacock', 'temple tower', 'coin'],
    cuts: ['cabochon', 'round'],
    metals: ['au22k-yellow'],
    finishes: ['matte', 'polished'],
    settings: ['closed bezel'],
  },
  recipes: [
    { path: 'relief.depth', band: band(1.0, 0.8, 1.5) },
    { path: 'relief.rim', band: band(1.0, 0.8, 1.5) },
  ],
  do: [
    'Ask region, occasion and the motif’s meaning.',
    'Relief 0.8–1.5 mm deep in 22k.',
    'Say "-inspired".',
  ],
  dont: [
    'Reproduce a specific temple’s icon without the client’s artwork and rights.',
    'Shallow relief that reads flat.',
  ],
  cannotExpress: [
    {
      feature: 'nakshi hand repoussé',
      fallback: 'a relief from the client’s artwork plus a maker note',
    },
    { feature: 'oxidised antique patina', fallback: 'matte finish plus a maker note' },
  ],
  source: src('EJ', '§5 Cultural traditions'),
  confidence: 'medium',
})
