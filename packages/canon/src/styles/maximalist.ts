/** Research 09 §5 "Maximalist". */
import { gt, v } from '../expr'
import { band, HEADED, src } from '../rules/rule'
import { guide } from './guide'

/** The look needs its big stone: never a wide band under a centre below 10 mm (09 §5). */
const BIG_CENTRE = gt(v('cW'), 9.99)

export const MAXIMALIST = guide({
  id: 'maximalist',
  label: 'Maximalist',
  aliases: ['maximalist', 'maximal', 'red carpet', 'more is more'],
  reads: [
    'Scale, held steady: a big centre (10 mm+) on a band that can carry it.',
    'Every element bigger, but the proportions still classic.',
    'A euro base so the head stays upright.',
  ],
  vocabulary: {
    motifs: ['double halo', 'wide shoulders', 'split shank'],
    cuts: ['cushion', 'oval', 'emerald', 'radiant'],
    metals: ['pt950', 'au18k-white', 'au18k-yellow'],
    finishes: ['polished'],
    settings: ['heavy claws 1.3–1.8', 'double halo'],
  },
  recipes: [
    { path: 'gem.width', band: band(10.5, 10, 13) },
    {
      path: 'ringShank.widthTop',
      band: band(5, 4, 8),
      note: 'plain; 2.5–4 when split',
      applies: { archetypes: [...HEADED], when: BIG_CENTRE },
    },
    { path: 'setting.prongDiameter', band: band(1.5, 1.3, 1.8), applies: { archetypes: [...HEADED], when: BIG_CENTRE } },
  ],
  overrides: [
    { ruleId: 'ring.solitaire.bandWidth', band: band(5, 2.5, 8), when: BIG_CENTRE },
    { ruleId: 'ring.scale.headToFinger', band: band(1.0, 0.6, 1.25), when: BIG_CENTRE },
  ],
  do: ['Scale everything together.', 'Use a euro base.', 'Keep claws heavy, 1.3–1.8 mm.'],
  dont: [
    'A big centre on a thin band.',
    'Mixed vocabularies to add "more".',
    'Bands under 2.5 mm.',
  ],
  cannotExpress: [],
  source: src('EJ', '§5 Maximalist'),
  confidence: 'medium',
})
