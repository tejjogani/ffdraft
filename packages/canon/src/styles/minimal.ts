/** Research 09 §5 "Minimal". */
import { band, src } from '../rules/rule'
import { guide } from './guide'

export const MINIMAL = guide({
  id: 'minimal',
  label: 'Minimal',
  aliases: ['minimal', 'minimalist', 'scandi'],
  reads: [
    'Proportion and weight are the design: nothing hides a bad number.',
    'One finish, one metal, one stone or none.',
    'Low profiles and closed shapes: bezels, cigar bands, plain court.',
  ],
  vocabulary: {
    motifs: ['bezel dot', 'cigar band', 'knife edge', 'bar'],
    cuts: ['round', 'oval', 'emerald'],
    metals: ['au18k-yellow', 'au14k-yellow', 'pt950', 'au18k-white'],
    finishes: ['polished', 'satin'],
    settings: ['bezel 0.5–0.7', 'four claws 0.9–1.1'],
  },
  recipes: [
    { path: 'ringShank.widthTop', band: band(1.9, 1.8, 2.0), note: 'or a 5–8 mm cigar band' },
    { path: 'setting.wall', band: band(0.6, 0.5, 0.7) },
    { path: 'setting.prongDiameter', band: band(1.0, 0.9, 1.1), note: 'four claws on 6.5 mm' },
    { path: 'gem.placement.elevation', band: band(1.0, 0.5, 1.2), note: 'low' },
  ],
  do: [
    'Set low.',
    'Keep to one finish.',
    'Check every proportion twice: there is nowhere to hide.',
  ],
  dont: ['Halos or pavé shoulders.', 'Two metals.', 'Decoration that does not carry the stone.'],
  cannotExpress: [],
  source: src('EJ', '§5 Minimal'),
  confidence: 'high',
})
