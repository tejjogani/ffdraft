/** Research 09 §5 "Cultural traditions": Middle Eastern, labelled "-inspired". */
import { band, src } from '../rules/rule'
import { guide } from './guide'

export const MIDDLE_EASTERN = guide({
  id: 'middleEastern',
  label: 'Middle Eastern-inspired',
  aliases: ['middle eastern', 'arabic', 'calligraphy', 'khaleeji', 'persian'],
  reads: [
    'Calligraphy as the form: the name or word is the outline.',
    'High-karat yellow gold, often 21k–22k.',
    'Geometric arabesque borders.',
  ],
  vocabulary: {
    motifs: ['calligraphy', 'arabesque', 'crescent', 'geometric star'],
    cuts: ['round', 'pear'],
    metals: ['au22k-yellow', 'au18k-yellow'],
    finishes: ['polished'],
    settings: ['bezel'],
  },
  recipes: [{ path: 'vectorBody.thickness', band: band(1.4, 1.2, 1.8), note: 'calligraphy plate' }],
  do: [
    'Ask region and occasion; take calligraphy only as the client’s SVG.',
    'Use 22k (21k is not available here).',
    'Say "-inspired".',
  ],
  dont: ['Set calligraphy from a font: letters must join correctly.', 'Strokes under 0.6 mm wide.'],
  cannotExpress: [
    { feature: '21k gold', fallback: '22k or 18k; say so' },
    { feature: 'hand-pierced filigree', fallback: 'a maker note' },
  ],
  source: src('EJ', '§5 Cultural traditions'),
  confidence: 'medium',
})
