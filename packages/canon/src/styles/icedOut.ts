/** Research 09 §2 (pendants, chains, conventions) and 06-freeform. */
import { add, clamp, mul, snap, v } from '../expr'
import { band, src } from '../rules/rule'
import { guide } from './guide'

const H = v('H')

export const ICED_OUT = guide({
  id: 'icedOut',
  label: 'Iced out',
  aliases: [
    'iced',
    'iced out',
    'iced-out',
    'hip hop',
    'hip-hop',
    'flooded',
    'bust down',
    'custom chain',
  ],
  reads: [
    'Scale first: 50 mm and up reads across a room; 25 mm is the floor.',
    'Fully flooded fields (ice level 1) inside a polished rim that draws the silhouette.',
    'Depth: 2–4 stacked levels 0.8–1.5 mm apart, each fully iced.',
    'A chain heavy enough to carry it: Cuban 8–16 % of the pendant height.',
    'Small, even melee: 1.0–1.5 mm reads as ice; 2 mm stones read as gravel.',
  ],
  vocabulary: {
    motifs: ['initials', 'logos', 'crosses', 'characters', 'shields'],
    cuts: ['round', 'baguette', 'princess'],
    metals: ['au14k-yellow', 'au14k-white', 'au10k-yellow', 'ag925-sterling'],
    finishes: ['polished'],
    settings: ['bead-set pavé', 'tennis', 'polished rim'],
  },
  recipes: [
    {
      path: 'vectorBody.thickness',
      band: band(
        add(1.5, mul(0.055, H)),
        mul(0.75, add(1.5, mul(0.055, H))),
        mul(1.25, add(1.5, mul(0.055, H))),
      ),
    },
    { path: 'pave.sizeMax', band: band(snap(clamp(mul(0.02, H), 1.0, 2.0)), 1.0, 2.0) },
    { path: 'pave.coverage', band: band(1, 1, 1), note: 'accents are a separate pavé node' },
    { path: 'vectorBody.border', band: band(clamp(mul(0.85, v('paveMax')), 0.6, 3), 0.6, 3) },
    {
      path: 'chain.linkWidth',
      band: band(mul(0.12, H), mul(0.08, H), mul(0.16, H)),
      note: 'Cuban or curb',
    },
  ],
  do: [
    'Ask artwork, height, ice level, stone tier and chain before anything else.',
    'Flood every field; build accents and two-tone as separate nodes.',
    'Give script one or two clean rows of stones (2.0 / 3.3 mm stroke at 1.3 mm stones).',
    'Use rhodium-plated white gold for "all ice"; yellow gold with white stones is classic too.',
  ],
  dont: [
    'Leave a hip-hop piece at default scale (22 mm).',
    'Partial ice levels on a field.',
    'Union levels of different tones.',
    'Hang 50 mm+ iced pieces on a Figaro.',
  ],
  cannotExpress: [
    {
      feature: 'pavé on chain links',
      fallback: 'a plain Cuban with a maker note, or a tennis chain',
    },
    { feature: 'scooped back', fallback: 'quote the solid mass; note the maker may scoop' },
    { feature: 'per-region plating', fallback: 'separate nodes per tone' },
    {
      feature: 'franco, herringbone, snake, paperclip chains',
      fallback: 'nearest of cable, curb, Cuban, Figaro, rope, box, tennis',
    },
  ],
  source: src('EJ', '§2 Pendants, chains and hip-hop'),
  confidence: 'medium',
})
