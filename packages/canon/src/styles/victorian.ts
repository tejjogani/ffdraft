/** Research 09 §5 "Victorian". */

import { gt, mul, v } from '../expr'
import { band, src } from '../rules/rule'
import { guide } from './guide'

export const VICTORIAN = guide({
  id: 'victorian',
  label: 'Victorian',
  aliases: ['victorian', 'half hoop', 'daisy cluster', 'sentimental'],
  reads: [
    'Warm gold: 18k yellow or 14k rose.',
    'Sentiment: clusters, hearts, half hoops, hand-worked texture.',
    'Graduated stones that swell to the centre.',
  ],
  vocabulary: {
    motifs: ['daisy cluster', 'half hoop', 'hearts', 'serpents', 'forget-me-nots'],
    cuts: ['round', 'cushion', 'cabochon', 'pear'],
    metals: ['au18k-yellow', 'au14k-rose'],
    finishes: ['polished', 'satin'],
    settings: ['shared prong', 'cluster claws', 'closed-back bezels'],
  },
  recipes: [
    {
      path: 'gem.width',
      band: band(mul(0.62, v('cW')), mul(0.6, v('cW')), mul(0.65, v('cW'))),
      note: 'daisy: 8 petals at 0.62 × centre, or 6 at ≈ 1.0, each a gem + setting in a polar pattern',
    },
    {
      path: 'gemRow.stoneWidth',
      band: band(3.5, 3.0, 3.5),
      note: 'half hoop graduating 3.5 → 2.5',
      applies: { archetypes: ['band', 'eternity', 'custom'], when: gt(v('rowD'), 0) },
    },
    {
      path: 'gemRow.graduateTo',
      band: band(2.5, 2.3, 2.7),
      applies: { archetypes: ['band', 'eternity', 'custom'], when: gt(v('rowD'), 0) },
    },
    {
      path: 'ringShank.widthTop',
      band: band(4.0, 3.9, 4.1),
      note: 'half-hoop band',
      applies: { archetypes: ['band', 'eternity', 'custom'], when: gt(v('rowD'), 0) },
    },
  ],
  do: [
    'Use warm gold.',
    'Graduate stones toward the centre.',
    'Build clusters as a polar pattern of gem + setting.',
  ],
  dont: ['White metal.', 'Flat geometric planes.', 'Ungraduated rows on a half hoop.'],
  cannotExpress: [
    { feature: 'enamel and hair-work', fallback: 'a maker note' },
    { feature: 'rose and old mine cuts', fallback: 'cushion or round, declared as a stand-in' },
    { feature: 'repoussé and chasing', fallback: 'satin finish plus a maker note' },
    {
      feature: 'Georgian closed foiled backs, rose and table cuts',
      fallback: 'an earlier vocabulary than Victorian: a closed bezel and a maker note',
    },
  ],
  source: src('EJ', '§5 Victorian'),
  confidence: 'high',
})
