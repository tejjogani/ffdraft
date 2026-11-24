/** Research 09 §5 "Art Deco" (GIA). */

import { sub, v } from '../expr'
import { band, HEADED, src } from '../rules/rule'
import { guide } from './guide'

export const ART_DECO = guide({
  id: 'artDeco',
  label: 'Art Deco',
  aliases: ['art deco', '1920s', 'gatsby'],
  reads: [
    'Bilateral symmetry: every element mirrored across the finger axis.',
    'Geometry: step-cut accents, calibré lines and octagonal frames, round or step-cut centre.',
    'White metal with colour contrast: sapphire, ruby or onyx against diamond.',
    'Flat planes and crisp edges, never soft domes.',
  ],
  vocabulary: {
    motifs: ['stepped shoulders', 'chevrons', 'calibré lines', 'geometric halo'],
    // Most period rings carry an old European round centre in a geometric surround (09 §5 says
    // only that step cuts read right; it bans no centre). Round stands in for old European.
    cuts: ['emerald', 'asscher', 'round', 'baguette', 'princess'],
    metals: ['pt950', 'au18k-white'],
    finishes: ['polished'],
    settings: ['tab claws', 'double claws', 'bezel 0.6–0.7', 'channel'],
  },
  recipes: [
    { path: 'gem.lw', band: band(1.4, 1.35, 1.45), note: 'emerald cut at 1.4' },
    { path: 'setting.wall', band: band(0.65, 0.6, 0.7), note: 'or tab/double claws' },
    { path: 'halo.stoneWidth', band: band(1.5, 1.3, 1.7), note: 'princess sapphire or ruby halo' },
    { path: 'halo.gap', band: band(0.11, 0.1, 0.12), note: 'calibré-tight' },
    {
      path: 'ringShank.widthTop',
      band: band(2.6, 2.3, 3.0),
      note: 'flat band',
      applies: { archetypes: [...HEADED] },
    },
    {
      path: 'gemRow.stoneWidth',
      band: band(sub(v('bandW'), 1.0), 0.8, sub(v('bandW'), 0.8)),
      note: 'channel',
    },
  ],
  do: [
    'Mirror everything across the finger axis.',
    'Use a flat or flat-court band.',
    'Contrast one colour against white.',
    'Make baguette sides 0.55–0.70 of the centre’s length.',
  ],
  dont: [
    'A round centre without a geometric frame: give it step-cut sides, an octagonal or square halo, a flat band.',
    'Yellow gold as the main metal.',
    'Organic curves or pillowed surfaces.',
  ],
  cannotExpress: [
    { feature: 'milgrain', fallback: 'leave a 0.5–0.7 mm rail and note "milgrain by maker"' },
    { feature: 'calibré-cut coloured stones', fallback: 'princess or baguette melee in a channel' },
    { feature: 'tapered baguettes', fallback: 'straight baguettes, declared as a stand-in' },
    { feature: 'old European cut', fallback: 'a round brilliant, declared as a stand-in' },
    { feature: 'filigree and hand engraving', fallback: 'a maker note on plain planes' },
  ],
  source: src('S', '§5 Art Deco (GIA)'),
  confidence: 'high',
})
