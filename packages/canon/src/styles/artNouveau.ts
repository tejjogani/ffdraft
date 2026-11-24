/** Research 09 §5 "Art Nouveau". */
import { band, src } from '../rules/rule'
import { guide } from './guide'

export const ART_NOUVEAU = guide({
  id: 'artNouveau',
  label: 'Art Nouveau',
  aliases: ['art nouveau', 'nouveau', 'whiplash', 'jugendstil', 'vine'],
  reads: [
    'One asymmetric whiplash line carries the whole piece.',
    "Nature as line: vines, tendrils, dragonflies, women's hair.",
    'Artistry over carats: cabochons and opals, soft satin gold.',
  ],
  vocabulary: {
    motifs: ['whiplash curve', 'vine', 'tendril', 'leaf', 'dragonfly'],
    cuts: ['cabochon', 'pear', 'oval'],
    metals: ['au18k-yellow', 'au14k-yellow', 'au18k-rose'],
    finishes: ['satin', 'polished'],
    settings: ['bezel cabochons', 'wire tendrils'],
  },
  recipes: [
    { path: 'pipe.width', band: band(1.8, 1.5, 2.2), note: 'half-round section' },
    {
      path: 'pipe.taper',
      band: band(0.5, 0.3, 0.66),
      note: 'tip = width × (1 − taper) ≥ 0.6; taper thins both ends',
    },
    { path: 'setting.wall', band: band(0.6, 0.5, 0.7), note: 'cabochons in bezels' },
  ],
  do: [
    'Let one line lead, and break symmetry on purpose.',
    'Use cabochons and opals in bezels.',
    'Finish satin.',
  ],
  dont: ['Mirror patterns.', 'Big faceted hero stones.', 'Tips under 0.6 mm (they will not cast).'],
  cannotExpress: [
    {
      feature: 'plique-à-jour and enamel',
      fallback: 'call it "Nouveau line" only, with a maker note',
    },
    { feature: 'carved horn or glass', fallback: 'a cabochon stand-in' },
  ],
  source: src('S', '§5 Art Nouveau'),
  confidence: 'medium',
})
