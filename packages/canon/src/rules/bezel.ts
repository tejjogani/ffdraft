/** Bezel, east-west and toi-et-moi: research 09 §1 "Bezel, east-west, toi-et-moi, stones". */
import { add, and, gt, iff, lt, mul, v } from '../expr'
import { band, rule, src } from './rule'

const W = v('W')
/** 22k, 24k and fine silver need 0.2 mm more wall (09 preamble, alloy modifier). */
const soft = iff(gt(v('alloy'), 2.5), 0.2, 0)
const byW = (small: number, mid: number, large: number) =>
  add(iff(lt(W, 5.01), small, iff(lt(W, 7.01), mid, large)), soft)
const eastWest = and(v('hero'), v('eastWest'))

export const BEZEL_RULES = [
  rule({
    id: 'bezel.wall',
    title: 'Bezel wall',
    applies: { nodeKind: 'setting', when: v('bezel') },
    paths: ['setting.wall'],
    band: band(byW(0.55, 0.7, 0.85), byW(0.5, 0.6, 0.7), byW(0.6, 0.8, 1.0)),
    lintAt: { below: byW(0.45, 0.5, 0.55), above: byW(0.9, 1.1, 1.3) },
    rationale:
      'The wall grows with the stone: 0.5–0.6 mm to 5 mm, 0.6–0.8 to 7, 0.7–1.0 above; +0.2 in 22k. Under 0.45 it will not cast.',
    source: src('K', '§1 Bezel'),
    confidence: 'high',
    severity: 'warning',
    fix: 'clampToBand',
  }),
  rule({
    id: 'eastWest.spin',
    title: 'East-west orientation',
    applies: { kinds: ['ring'], nodeKind: 'gem', when: eastWest },
    paths: ['gem.placement.spin'],
    band: band(90, 90, 90),
    rationale:
      'East-west turns a long stone across the finger: spin 90, so its length runs with the band.',
    source: src('EJ', '§1 East-west'),
    confidence: 'high',
    severity: 'default',
  }),
  rule({
    id: 'eastWest.span',
    title: 'East-west length',
    applies: { kinds: ['ring'], nodeKind: 'gem', when: eastWest },
    paths: ['gem.width'],
    measure: 'eastWestSpan',
    band: band(mul(0.5, v('ID')), mul(0.3, v('ID')), mul(0.65, v('ID'))),
    lintAt: { above: mul(0.65, v('ID')) },
    rationale:
      'Across the finger a stone may run to 0.65 of its width; longer and it overhangs the neighbouring fingers.',
    source: src('EJ', '§1 East-west'),
    confidence: 'medium',
    severity: 'info',
  }),
  rule({
    id: 'eastWest.band',
    title: 'East-west band',
    applies: { kinds: ['ring'], nodeKind: 'ringShank', when: v('eastWest') },
    paths: ['ringShank.widthTop'],
    band: band(2.0, 1.8, 2.5),
    rationale: 'Keep the band slim, 1.8–2.5 mm: the stone already supplies the width.',
    source: src('EJ', '§1 East-west'),
    confidence: 'medium',
    severity: 'default',
  }),
  rule({
    id: 'eastWest.low',
    title: 'East-west sits low',
    applies: { kinds: ['ring'], nodeKind: 'gem', when: eastWest },
    paths: ['gem.placement.elevation'],
    band: band(iff(v('bezel'), 0.6, 1.0), iff(v('bezel'), 0.5, 0.8), 1.2),
    rationale:
      'An east-west stone is set low, 0.8–1.2 mm off the finger (0.5 in a bezel): a tall one tips over.',
    source: src('EJ', '§1 East-west'),
    confidence: 'medium',
    severity: 'default',
  }),
  rule({
    id: 'toiEtMoi.balance',
    title: 'Toi-et-moi balance',
    applies: { kinds: ['ring'], when: v('toi') },
    paths: ['gem.width'],
    measure: 'areaBalance',
    band: band(0.9, 0.75, 1.0),
    lintAt: { below: 0.6 },
    rationale:
      'Two stones of contrasting shape but near-equal face-up area: a toi-et-moi is a pair, not a hero and a guest.',
    source: src('EJ', '§1 Toi-et-moi'),
    confidence: 'medium',
    severity: 'info',
  }),
  rule({
    id: 'toiEtMoi.gap',
    title: 'Toi-et-moi gap',
    applies: { kinds: ['ring'], when: v('toi') },
    paths: ['gem.placement.angle'],
    measure: 'heroGap',
    band: band(0.5, 0.3, 0.8),
    lintAt: { below: 0.15, above: 1.5 },
    rationale:
      'The two stones nearly kiss, 0.3–0.8 mm apart; there is no bypass shank here, so the gap does the work.',
    source: src('EJ', '§1 Toi-et-moi'),
    confidence: 'medium',
    severity: 'info',
  }),
]
