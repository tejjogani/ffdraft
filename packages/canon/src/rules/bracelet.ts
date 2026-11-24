/** Bracelets and bangles: research 09 §2 (lengths) and §3 (bangles). */
import { gt, lt, v } from '../expr'
import { band, rule, src } from './rule'

export const BRACELET_RULES = [
  rule({
    id: 'bracelet.length',
    title: 'Bracelet length',
    applies: { kinds: ['bracelet'], nodeKind: 'chain', when: lt(v('mens'), 0.5) },
    paths: ['chain.length'],
    band: band(178, 165, 190),
    rationale:
      'A bracelet is the wrist plus 13–25 mm: 165, 178 or 190 mm; measure the wrist, never guess.',
    source: src('S', '§2 Bracelet length'),
    confidence: 'high',
    severity: 'default',
  }),
  rule({
    id: 'bracelet.mensLength',
    title: "Men's bracelet length",
    applies: { kinds: ['bracelet'], nodeKind: 'chain', when: v('mens') },
    paths: ['chain.length'],
    band: band(210, 203, 216),
    rationale: "Men's bracelets run 203–216 mm, loose enough to sit on the wrist bone.",
    source: src('S', '§2 Bracelet length'),
    confidence: 'high',
    severity: 'default',
  }),
  rule({
    id: 'bangle.size',
    title: 'Slip-on bangle size',
    applies: { kinds: ['bracelet'], nodeKind: 'pipe', when: gt(v('hoopID'), 0) },
    paths: ['pipe.points'],
    measure: 'hoopDiameter',
    band: band(63.5, 57, 70),
    variants: {
      delicate: band(58.5, 57, 60),
      classic: band(63.5, 62, 65),
      bold: band(68.5, 67, 70),
    },
    lintAt: { below: 52, above: 75 },
    rationale:
      'A slip-on bangle passes the hand: 57–60, 62–65 or 67–70 mm inside (Indian 2-4 to 2-12).',
    source: src('S', '§3 Bangles'),
    confidence: 'high',
    severity: 'info',
  }),
  rule({
    id: 'bangle.wire',
    title: 'Bangle wire',
    applies: { kinds: ['bracelet'], nodeKind: 'pipe' },
    paths: ['pipe.width'],
    band: band(3.0, 2.0, 6.0),
    lintAt: { below: 2.0 },
    rationale: 'A round bangle wire under 2 mm bends out of round the first time it is knocked.',
    source: src('S', '§3 Bangles'),
    confidence: 'high',
    severity: 'warning',
    fix: 'clampToBand',
  }),
]
