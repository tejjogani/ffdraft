/** Research 09 §5 "Vintage-revival". */

import { sub, v } from '../expr'
import { band, src } from '../rules/rule'
import { guide } from './guide'

export const VINTAGE_REVIVAL = guide({
  id: 'vintageRevival',
  label: 'Vintage revival',
  aliases: ['vintage', 'vintage-inspired', 'antique-inspired', 'heirloom', 'romantic'],
  reads: [
    'A small halo round a moderate centre (6–7.5 mm).',
    'Fine pavé on a cathedral, with a delicate under-gallery.',
    'Romance in detail rather than size.',
  ],
  vocabulary: {
    motifs: ['halo', 'cathedral', 'pavé shoulders', 'scalloped gallery'],
    cuts: ['round', 'cushion', 'oval'],
    metals: ['pt950', 'au18k-white', 'au18k-rose'],
    finishes: ['polished'],
    settings: ['halo', 'fine pavé', 'basket with rails'],
  },
  recipes: [
    { path: 'gem.width', band: band(6.8, 6.0, 7.5), note: 'centre' },
    {
      path: 'gemRow.stoneWidth',
      band: band(sub(v('bandW'), 1.0), 0.8, sub(v('bandW'), 0.8)),
      note: 'fine pavé',
    },
    { path: 'gemRow.coverage', band: band(150, 120, 180) },
  ],
  do: [
    'Keep the centre moderate and the halo tight.',
    'Use a cathedral with pavé to the shoulders.',
    'Rails in the gallery.',
  ],
  dont: ['Oversized halos (tyre look).', 'Full eternity shanks.', 'Thick bands.'],
  cannotExpress: [
    { feature: 'milgrain edges', fallback: '0.5–0.7 mm rail, "milgrain by maker"' },
    { feature: 'hand engraving on the shank', fallback: 'a maker note' },
  ],
  source: src('EJ', '§5 Vintage-revival'),
  confidence: 'high',
})
