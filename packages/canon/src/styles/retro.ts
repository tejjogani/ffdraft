/** Research 09 §5 "Retro" (Lang, Macklowe). */
import { band, src } from '../rules/rule'
import { guide } from './guide'

export const RETRO = guide({
  id: 'retro',
  label: 'Retro',
  aliases: ['retro', '1940s', 'machine age'],
  reads: [
    'Big and sculptural: wide bands that swell into scrolls.',
    'Bi-colour gold: rose and yellow side by side, as separate nodes.',
    'One large coloured step cut: aquamarine or citrine 10–14 mm.',
  ],
  vocabulary: {
    motifs: ['scrolls', 'buckles', 'bows', 'tank shoulders'],
    cuts: ['emerald', 'cushion', 'oval'],
    metals: ['au18k-rose', 'au18k-yellow', 'au14k-rose'],
    finishes: ['polished'],
    settings: ['heavy claws 1.3–2.0', 'low bezel above 12 mm'],
  },
  recipes: [
    { path: 'ringShank.widthTop', band: band(7, 6, 10) },
    { path: 'ringShank.thicknessTop', band: band(2.5, 2.3, 2.8) },
    { path: 'gem.width', band: band(11, 10, 14), note: 'emerald-cut aquamarine or citrine' },
    { path: 'setting.prongDiameter', band: band(1.5, 1.3, 2.0) },
  ],
  overrides: [
    { ruleId: 'ring.solitaire.bandWidth', band: band(7, 6, 10) },
    { ruleId: 'ring.solitaire.thicknessBottom', band: band(2.3, 2.0, 2.5) },
  ],
  do: [
    'Go wide and sculptural.',
    'Put rose and yellow on separate nodes.',
    'Set a big step cut low.',
  ],
  dont: ['Thin bands.', 'Platinum or white gold.', 'Union two tones into one body.'],
  cannotExpress: [
    {
      feature: 'hollow scroll construction',
      fallback: 'solid scrolls 3–6 mm wide; quote the weight',
    },
    { feature: 'tank-track links', fallback: 'a curb chain stand-in' },
  ],
  source: src('S', '§5 Retro (Lang, Macklowe)'),
  confidence: 'medium',
})
