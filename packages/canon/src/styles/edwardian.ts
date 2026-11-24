/** Research 09 §5 "Edwardian" (Lang, GIA). */
import { band, HEADED, src } from '../rules/rule'
import { guide } from './guide'

export const EDWARDIAN = guide({
  id: 'edwardian',
  label: 'Edwardian',
  aliases: ['edwardian', 'belle epoque', 'belle époque', 'garland'],
  reads: [
    'White on white: platinum and diamonds, nothing coloured.',
    'Lace: fine knife-edge wires and openwork that looks impossibly light.',
    'Small stones in quantity; the centre modest (5–6.5 mm).',
  ],
  vocabulary: {
    motifs: ['garlands', 'bows', 'lace openwork', 'knife-edge wires'],
    cuts: ['round', 'pear', 'marquise'],
    metals: ['pt950'],
    finishes: ['polished'],
    settings: ['bezel 0.55', 'six claws 0.8–0.9', 'millegrain bezels'],
  },
  recipes: [
    { path: 'gem.width', band: band(5.8, 5.0, 6.5), note: 'round centre' },
    { path: 'setting.wall', band: band(0.55, 0.5, 0.6) },
    {
      path: 'setting.prongDiameter',
      band: band(0.85, 0.8, 0.9),
      note: 'six claws',
      applies: { kinds: ['ring'] },
    },
    { path: 'ringShank.widthTop', band: band(2.0, 1.8, 2.2), note: 'knife edge', applies: { archetypes: [...HEADED] } },
    { path: 'pipe.width', band: band(0.7, 0.7, 0.8), note: 'lace wire, ≥ 1.0 deep, spans ≤ 8' },
    {
      path: 'chain.linkWidth',
      band: band(1.0, 0.9, 1.1),
      note: 'pear drops on fine cable',
      applies: { archetypes: ['pendantSolitaire', 'custom'] },
    },
  ],
  do: [
    'Keep it white: platinum, diamonds.',
    'Use a knife-edge band.',
    'Let lace wires stay 1.0 mm deep with spans of 8 mm or less.',
  ],
  dont: [
    'Coloured stones or yellow gold.',
    'Heavy bands or big centres.',
    'Wire spans longer than 8 mm (they sag in casting).',
  ],
  cannotExpress: [
    { feature: 'milgrain', fallback: '0.5–0.7 mm rail, "milgrain by maker"' },
    { feature: 'old European and rose cuts', fallback: 'round brilliant, declared as a stand-in' },
    { feature: 'pierced lace galleries', fallback: 'pipe wires; true piercing is a maker note' },
  ],
  source: src('S', '§5 Edwardian (Lang, GIA)'),
  confidence: 'high',
})
