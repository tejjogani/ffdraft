/**
 * Minimum stroke width. Hairlines of script fonts and fine artwork vanish in casting; the
 * Materialise gold/silver guides put the minimum feature at 0.35 mm wide (docs/research/
 * 06-freeform.md §4). Parts of the outline that do not survive a morphological opening of that
 * width are thickened — corners, which an opening also rounds, are left alone.
 */
import type { CrossSection } from 'manifold-3d'
import { runtime } from '../../runtime/index'

export const MIN_STROKE = 0.35

/** Returns the thickened outline (or null when nothing was thinner than `width`). The caller owns it. */
export function thickenStrokes(
  outline: CrossSection,
  width: number,
  segments: number,
): CrossSection | null {
  const { manifold: mf } = runtime()
  const r = width / 2
  const owned: CrossSection[] = []
  const own = (c: CrossSection) => {
    owned.push(c)
    return c
  }
  try {
    const opened = own(
      own(outline.offset(-r, 'Round', 2, segments)).offset(r, 'Round', 2, segments),
    )
    const thin = own(mf.CrossSection.difference(outline, opened))
    // A corner loses ≈ 0.2 r² to the opening; a real hairline loses its whole length × width.
    const strokes = thin.decompose().filter((piece) => {
      own(piece)
      return piece.area() > 2 * width * width
    })
    if (strokes.length === 0) return null
    const grown = strokes.map((piece) => own(piece.offset(r / 2, 'Round', 2, segments)))
    return mf.CrossSection.union([outline, ...grown])
  } finally {
    for (const c of owned) c.delete()
  }
}

/** Width of the ties that join loose parts of lettering, mm: well above the casting minimum. */
export const TIE_WIDTH = 0.5

/** A loose part below this share of the largest is a mark — the dot of an i, an accent. */
const MARK_SHARE = 0.15
/** A tittle is set down onto its stem until it overlaps it by this share of the tie width. */
const MARK_OVERLAP = 0.3
/**
 * A mark links to metal under it: within its own width, give or take this share of it (an
 * italic stem slants under its dot). The nearest metal is sometimes the side of the next
 * letter's ascender, which would take the dot instead.
 */
const MARK_REACH = 0.25
/**
 * A tittle stands over a stem about as wide as itself: the metal under it, across three of its
 * widths, averages at most this many of them. An accent stands over a letter's whole top (the
 * bar of an E, the bowl of an e) or over one arm of a wide letter, in a pair (the dots of Ü).
 */
const TITTLE_STEM = 1.6
/** …and close over it: the gap is at most this share of the letter's height. */
const TITTLE_GAP = 0.25
/** A sprue that holds an accent is at most this share of the accent's width… */
const SPRUE_SHARE = 0.5
/**
 * …and at most this share of its letter's height long, or this many of the accent's own
 * widths, whichever is longer: a lowercase letter is short, and the gap a font leaves over it
 * is set by the accent, not by the letter (a jeweler sprues the dots of a ü routinely).
 */
const SPRUE_REACH = 0.2
const SPRUE_MARK = 1.25

type Ring = readonly (readonly [number, number])[]
type Link = { a: [number, number]; b: [number, number]; d: number }
type Box = { min: readonly number[]; max: readonly number[] }

/**
 * Joins the loose parts of an outline into one piece, the way a jeweler would solder a name,
 * nearest part first:
 *  - Letters get a tie `width` wide, side to side where both stand at full height: kept within
 *    the band both letters share (half a tie in from its top and bottom), a tie never sticks
 *    out over the cap line or under the baseline, and each end lands on an edge as wide as the
 *    tie, so it meets the letter flush instead of standing proud of it. The shortest link when
 *    no such one exists.
 *  - The dot of an i or a j (when `tittles` says the text has one) is set down onto its stem,
 *    closing the gap: a tie across the gap reads as more stem and the i as an l, and one
 *    sideways to the next letter crosses an l or a t and reads as a bar.
 *  - Any other mark (an acute, a grave, the dots of an umlaut, a tilde, a ring) stays where the
 *    font put it, so the name keeps its spelling and its height, and hangs from its letter on a
 *    short, narrow sprue straight down inside its own column. A mark with no metal straight
 *    under it stays loose (the caller reports the loose pieces).
 * Returns the joined outline and how many parts were joined, or null when it is already one
 * piece. The caller owns the result.
 */
export function joinIslands(
  outline: CrossSection,
  width: number,
  segments: number,
  tittles = true,
): { section: CrossSection; ties: number; loose: Box[] } | null {
  const { manifold: mf } = runtime()
  const pieces = outline.decompose()
  try {
    if (pieces.length <= 1) return null
    pieces.sort((a, b) => b.area() - a.area())
    const largest = pieces[0]!.area()
    const rings = pieces.map((p) => p.toPolygons() as Ring[])
    const boxes = pieces.map((p) => p.bounds())
    const spans = boxes.map(({ min, max }) => [min[1], max[1]] as const)
    const isMark = pieces.map((p) => p.area() < MARK_SHARE * largest)
    const r = width / 2
    const joined = new Set([0])
    const left = new Set(rings.keys())
    left.delete(0)
    /**
     * Marks that could not be hung yet: their letter may still be loose (a mark is tried as soon
     * as its link is the shortest, which can come before its letter is tied on). They are tried
     * again after the next letter joins.
     */
    const waiting = new Set<number>()
    const parts: CrossSection[] = [pieces[0]!]
    const made: CrossSection[] = []
    /** How long a sprue from mark k to piece j may be. */
    const reachOf = (k: number, j: number) => {
      const { min, max } = boxes[k]!
      const size = Math.max(max[0] - min[0], max[1] - min[1])
      return Math.max(SPRUE_REACH * (spans[j]![1] - spans[j]![0]), SPRUE_MARK * size)
    }
    /** Links from a mark go down: inside its own column, give or take MARK_REACH… */
    const inColumn = (k: number) => (a: [number, number], b: [number, number]) => {
      const { min, max } = boxes[k]!
      const slack = MARK_REACH * (max[0] - min[0])
      return b[1] < a[1] && b[0] >= min[0] - slack && b[0] <= max[0] + slack
    }
    /**
     * …or, where nothing lies under it within reach (dots set over a capital's counter, inside
     * its arms), down to the side at 45° or steeper: never sideways to the next letter's
     * ascender, which stands beside the mark at its own height.
     */
    const steep = (a: [number, number], b: [number, number]) =>
      b[1] < a[1] && Math.abs(b[0] - a[0]) <= a[1] - b[1]
    /** Whether marks k and m stand side by side at one height: the dots of an umlaut. */
    const pairOf = (k: number, m: number) => {
      if (m === k || !isMark[m]) return false
      const a = boxes[k]!
      const b = boxes[m]!
      const w = a.max[0] - a.min[0]
      const overlap = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1])
      const apart = Math.max(b.min[0] - a.max[0], a.min[0] - b.max[0])
      return overlap > 0.5 * (a.max[1] - a.min[1]) && apart < 2 * w
    }
    const paired = (k: number) => rings.some((_, m) => pairOf(k, m))
    /** Whether mark k, linked down to piece j at point b, is the dot of an i or a j. */
    const isTittle = (k: number, j: number, b: [number, number]): boolean => {
      if (!tittles || rings[k]!.length !== 1 || paired(k)) return false
      const { min, max } = boxes[k]!
      const w = max[0] - min[0]
      const h = max[1] - min[1]
      if (min[1] - b[1] > TITTLE_GAP * (spans[j]![1] - spans[j]![0])) return false
      const cx = (min[0] + max[0]) / 2
      const window = mf.CrossSection.square([3 * w, h]).translate([cx - 1.5 * w, b[1] - h])
      const under = mf.CrossSection.intersection(pieces[j]!, window)
      try {
        return under.area() / h <= TITTLE_STEM * w
      } finally {
        window.delete()
        under.delete()
      }
    }
    /**
     * The sprue that hangs mark k from the joined letters, linked first to piece j at `link`: a
     * straight one inside its column, else one along the link, else one down the steepest short
     * link to any joined letter. Null when none reaches.
     */
    const hang = (k: number, j: number, link: Link): CrossSection | null => {
      const straight = sprue(rings[k]!, rings[j]!, boxes[k]!, width, reachOf(k, j))
      if (straight) return straight
      const tries: (Link & { to: number })[] = [{ ...link, to: j }]
      for (const m of joined) {
        if (isMark[m]) continue
        const l = nearestLink(rings[k]!, rings[m]!, reachOf(k, m), steep)
        if (l) tries.push({ ...l, to: m })
      }
      tries.sort((p, q) => p.d - q.d)
      const w = sprueWidth(boxes[k]!, width)
      for (const t of tries) {
        if (t.d > reachOf(k, t.to)) continue
        const s = slopedSprue(pieces[k]!, pieces[t.to]!, t.a, t.b, w)
        if (s) return s
      }
      // An umlaut dot over a counter, too far from either arm, joins its pair once that is held.
      for (const m of joined)
        if (isMark[m] && pairOf(k, m)) {
          const s = pairBar(pieces[k]!, pieces[m]!, w)
          if (s) return s
        }
      return null
    }
    try {
      while (left.size > 0) {
        let best = null as (Link & { piece: number; to: number; flush: boolean }) | null
        // Constrained links first (letters within their shared band, marks straight down), over
        // every loose part; the shortest link only when no loose part has a constrained one.
        for (const constrained of [true, false]) {
          for (const k of left) {
            for (const j of joined) {
              // Nothing ties to a mark: a bar from the next letter to an accent reads as part of
              // the letter, and the accent hangs from its own letter only.
              if (isMark[j]) continue
              const lo = Math.max(spans[k]![0], spans[j]![0]) + r
              const hi = Math.min(spans[k]![1], spans[j]![1]) - r
              if (constrained && !isMark[k] && lo > hi) continue
              let link: Link | null
              if (isMark[k]) {
                // A mark links only down, whatever `constrained` says: inside its own column
                // when that reaches, else steeply to the side.
                link = nearestLink(rings[k]!, rings[j]!, best?.d ?? Infinity, inColumn(k))
                if (!link || link.d > reachOf(k, j))
                  link =
                    nearestLink(
                      rings[k]!,
                      rings[j]!,
                      Math.min(best?.d ?? Infinity, reachOf(k, j)),
                      steep,
                    ) ?? link
              } else {
                const accept = constrained
                  ? (a: [number, number], b: [number, number]) =>
                      a[1] >= lo &&
                      a[1] <= hi &&
                      b[1] >= lo &&
                      b[1] <= hi &&
                      flush(rings[k]!, a, b, r) &&
                      flush(rings[j]!, b, a, r)
                  : undefined
                link = nearestLink(rings[k]!, rings[j]!, best?.d ?? Infinity, accept)
              }
              if (link && (!best || link.d < best.d))
                best = { piece: k, to: j, flush: constrained, ...link }
            }
          }
          if (best) break
        }
        if (!best) break
        const k = best.piece
        left.delete(k)
        if (isMark[k] && isTittle(k, best.to, best.b)) {
          joined.add(k)
          // a lies on the dot, b on its stem: move the dot along a→b past b.
          const shift = (best.d + MARK_OVERLAP * width) / Math.max(best.d, 1e-9)
          const dx = (best.b[0] - best.a[0]) * shift
          const dy = (best.b[1] - best.a[1]) * shift
          const moved = pieces[k]!.translate([dx, dy])
          made.push(moved)
          parts.push(moved)
          rings[k] = rings[k]!.map((ring) => ring.map(([x, y]) => [x + dx, y + dy] as const))
        } else if (isMark[k]) {
          const s = hang(k, best.to, best)
          if (!s) {
            // Not yet: tried again once another letter has joined.
            waiting.add(k)
            continue
          }
          joined.add(k)
          made.push(s)
          parts.push(pieces[k]!, s)
        } else {
          joined.add(k)
          const t = best.flush ? tie(best.a, best.b, r) : capsule(best.a, best.b, r, segments)
          made.push(t)
          parts.push(pieces[k]!, t)
          for (const m of waiting) left.add(m)
          waiting.clear()
        }
      }
      // Parts never joined (none reachable) stay as they are, where the font put them.
      const loose = [...left, ...waiting]
      for (const k of loose) parts.push(pieces[k]!)
      return {
        section: mf.CrossSection.union(parts),
        ties: joined.size - 1,
        loose: loose.map((k) => boxes[k]!),
      }
    } finally {
      for (const m of made) m.delete()
    }
  } finally {
    for (const p of pieces) p.delete()
  }
}

/** Whether (x, y) is inside rings filled even-odd. */
function insideRings(rings: readonly Ring[], x: number, y: number): boolean {
  let inside = false
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!
      const [xj, yj] = ring[j]!
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
  return inside
}

/**
 * Whether a tie of half-width r from `end` (on the part `rings`) toward `other` meets that part
 * across its whole width: both corners of its end, r inside the part, are metal. A tie
 * whose corner hangs past the edge it meets (the top of an L's foot, a rounded shoulder) stands
 * proud of the letter and leaves a step.
 */
function flush(
  rings: readonly Ring[],
  end: [number, number],
  other: [number, number],
  r: number,
): boolean {
  const len = Math.hypot(other[0] - end[0], other[1] - end[1]) || 1
  const ux = (other[0] - end[0]) / len
  const uy = (other[1] - end[1]) / len
  // Into the part (against the tie's direction) as far as the tie reaches into it.
  const ix = end[0] - ux * r
  const iy = end[1] - uy * r
  return (
    insideRings(rings, ix - uy * r, iy + ux * r) && insideRings(rings, ix + uy * r, iy - ux * r)
  )
}

/** Metal intervals [bottom, top] where rings (even-odd) cross the vertical line at x, upward. */
function column(rings: readonly Ring[], x: number): [number, number][] {
  const ys: number[] = []
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!
      const [xj, yj] = ring[j]!
      if (xi > x !== xj > x) ys.push(yi + ((x - xi) * (yj - yi)) / (xj - xi))
    }
  ys.sort((p, q) => p - q)
  const out: [number, number][] = []
  for (let k = 0; k + 1 < ys.length; k += 2) out.push([ys[k]!, ys[k + 1]!])
  return out
}

/** Step across an accent's column when looking for a sprue, mm. */
const SPRUE_STEP = 0.05
/** A sprue reaches the sprue's width into the accent and the letter, at most this far, mm. */
const SPRUE_GRIP = 0.05

/** A sprue's width: SPRUE_SHARE of its accent's, at most the tie width, at least the casting minimum. */
function sprueWidth(box: Box, width: number): number {
  return Math.min(width, Math.max(MIN_STROKE, SPRUE_SHARE * (box.max[0]! - box.min[0]!)))
}

/** How deep a sloped sprue reaches into the accent and the letter it joins, at most, mm. */
const SPRUE_SEAT = 0.15

/** The point of `section` nearest to p (a vertex or a point on an edge), or null when empty. */
function nearestPoint(section: CrossSection, p: [number, number]): [number, number] | null {
  const link = nearestLink([[p]], section.toPolygons() as Ring[], Number.POSITIVE_INFINITY)
  return link ? link.b : null
}

/**
 * A narrow sprue `w` wide from the accent `mark` down to its letter, along the link a→b between
 * them. Each end is seated inside metal, up to SPRUE_SEAT deep (or a quarter of the width, if
 * the stroke is too thin for that), not at the nearest point: a round dot meets a straight bar
 * at a point only, and a sprue cut there leaves the dot loose with a stub standing under it.
 * Null when it does not overlap both across a real width.
 */
function slopedSprue(
  mark: CrossSection,
  letter: CrossSection,
  a: [number, number],
  b: [number, number],
  w: number,
): CrossSection | null {
  const { manifold: mf } = runtime()
  const top = seat(mark, b, w / 2)
  const foot = top && seat(letter, top, w / 2)
  if (!top || !foot) return null
  // A seat may only move along the stroke it starts on, not jump to another part of the letter.
  const length = Math.hypot(top[0] - foot[0], top[1] - foot[1])
  if (length > Math.hypot(a[0] - b[0], a[1] - b[1]) + 2 * SPRUE_SEAT + w) return null
  const bar = squareBar(foot, top, w / 2)
  // Above the accent's lowest point, only what lies inside it or under it is kept, so the
  // sprue never shows beside the accent's corner.
  const below = shadow(mark)
  const kept = mf.CrossSection.intersection(bar, below)
  // It must overlap each part across a good share of its width: a touch is no joint.
  const grip = 0.25 * w * Math.min(SPRUE_SEAT, w / 4)
  const inMark = mf.CrossSection.intersection(kept, mark)
  const inLetter = mf.CrossSection.intersection(kept, letter)
  const whole = mf.CrossSection.union([kept, mark])
  try {
    const ok = inMark.area() >= grip && inLetter.area() >= grip && whole.decompose().length === 1
    if (!ok) {
      kept.delete()
      return null
    }
    return kept
  } finally {
    for (const c of [bar, below, inMark, inLetter, whole]) c.delete()
  }
}

/** The point of `part` nearest to p, SPRUE_SEAT inside its edge (less, in a thin stroke). */
function seat(part: CrossSection, p: [number, number], r: number): [number, number] | null {
  for (const depth of [Math.min(SPRUE_SEAT, r), r / 2]) {
    const core = part.offset(-depth, 'Round', 2, 16)
    try {
      if (!core.isEmpty()) return nearestPoint(core, p)
    } finally {
      core.delete()
    }
  }
  return null
}

/** A bar of half-width r from p to q, its ends cut square exactly at p and q. */
function squareBar(p: [number, number], q: [number, number], r: number): CrossSection {
  const { manifold: mf } = runtime()
  const length = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
  const ux = (q[0] - p[0]) / length
  const uy = (q[1] - p[1]) / length
  return mf.CrossSection.hull([
    [
      [
        [p[0] - uy * r, p[1] + ux * r],
        [p[0] + uy * r, p[1] - ux * r],
        [q[0] + uy * r, q[1] - ux * r],
        [q[0] - uy * r, q[1] + ux * r],
      ],
    ],
  ])
}

/**
 * A narrow bar `w` wide joining one dot of an umlaut to the other, already held, each end seated
 * inside its dot. Null when the dots do not overlap it across a real width.
 */
function pairBar(dot: CrossSection, held: CrossSection, w: number): CrossSection | null {
  const { manifold: mf } = runtime()
  const link = nearestLink(dot.toPolygons() as Ring[], held.toPolygons() as Ring[], Infinity)
  if (!link) return null
  const p = seat(dot, link.b, w / 2)
  const q = p && seat(held, p, w / 2)
  if (!p || !q) return null
  const bar = squareBar(p, q, w / 2)
  const grip = 0.25 * w * Math.min(SPRUE_SEAT, w / 4)
  const a = mf.CrossSection.intersection(bar, dot)
  const b = mf.CrossSection.intersection(bar, held)
  try {
    if (a.area() >= grip && b.area() >= grip) return bar
    bar.delete()
    return null
  } finally {
    a.delete()
    b.delete()
  }
}

/**
 * Everything under the accent's lowest point, and under its underside within its own width:
 * where a sprue may stand without showing beside it. Includes the accent itself.
 */
function shadow(mark: CrossSection): CrossSection {
  const { manifold: mf } = runtime()
  const rings = mark.toPolygons() as Ring[]
  const { min, max } = mark.bounds()
  const far = 1e3
  const n = Math.max(8, Math.ceil((max[0] - min[0]) / SPRUE_STEP / 2))
  const profile: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const x = min[0] + ((max[0] - min[0]) * (i + 0.5)) / (n + 1)
    // The underside of the accent at x, or its lowest point where a gap splits it (two acutes).
    profile.push([x, column(rings, x)[0]?.[0] ?? min[1]])
  }
  // Anticlockwise: along the bottom, then back right to left along the underside.
  const under = new mf.CrossSection([
    [[min[0], min[1] - far], [max[0], min[1] - far], ...profile.reverse()],
  ])
  const low = mf.CrossSection.square([2 * far, far]).translate([min[0] - far, min[1] - far])
  try {
    return mf.CrossSection.union([under, low, mark])
  } finally {
    under.delete()
    low.delete()
  }
}

/**
 * A narrow vertical sprue from an accent (rings, bounds) straight down to the letter under it,
 * inside the accent's own column: SPRUE_SHARE of its width, at most the tie width and at least
 * the casting minimum, no longer than `reach`. Each end is cut square across metal: the accent
 * over its whole width at the top, the letter at the bottom, so it never pokes out beside
 * either. Null when no metal lies within reach straight under the accent.
 */
function sprue(
  mark: readonly Ring[],
  letter: readonly Ring[],
  box: { min: readonly number[]; max: readonly number[] },
  width: number,
  reach: number,
): CrossSection | null {
  const w = sprueWidth(box, width)
  const r = w / 2
  let best: { x: number; bottom: number; top: number } | null = null
  for (let x = box.min[0]! + r; x <= box.max[0]! - r + 1e-9; x += SPRUE_STEP) {
    let top = Number.NEGATIVE_INFINITY
    let bottom = Number.POSITIVE_INFINITY
    let ok = true
    for (const xs of [x - r, x, x + r]) {
      // The accent's lowest metal over this line, and the letter's first metal under that.
      const above = column(mark, xs)[0]
      const under = above && column(letter, xs).filter(([, t]) => t <= above[0])
      const below = under?.at(-1)
      if (!above || !below || above[1] - above[0] < SPRUE_GRIP) {
        ok = false
        break
      }
      top = Math.max(top, above[0])
      bottom = Math.min(bottom, below[1])
    }
    if (ok && top - bottom <= reach && (!best || top - bottom < best.top - best.bottom))
      best = { x, bottom, top }
  }
  if (!best) return null
  const { manifold: mf } = runtime()
  const height = best.top - best.bottom + 2 * SPRUE_GRIP
  return mf.CrossSection.square([w, height]).translate([best.x - r, best.bottom - SPRUE_GRIP])
}

/**
 * The outline standing on a bar under its full width: `height` mm deep, overlapping the
 * bottom of the outline by half of that. The caller owns the result.
 */
export function underline(outline: CrossSection, height: number): CrossSection {
  const { manifold: mf } = runtime()
  const { min, max } = outline.bounds()
  const bar = mf.CrossSection.square([max[0] - min[0], height]).translate([
    min[0],
    min[1] - height / 2,
  ])
  try {
    return mf.CrossSection.union([outline, bar])
  } finally {
    bar.delete()
  }
}

/**
 * A bar of half-width r between two points, reaching r past each into the parts it joins (both
 * ends were checked to meet metal across the bar's width, see {@link flush}).
 */
function tie(a: [number, number], b: [number, number], r: number): CrossSection {
  const { manifold: mf } = runtime()
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  const ux = (b[0] - a[0]) / len
  const uy = (b[1] - a[1]) / len
  const points: [number, number][] = []
  for (const [x, y, s] of [
    [a[0], a[1], -1],
    [b[0], b[1], 1],
  ] as const)
    for (const side of [1, -1])
      points.push([x + s * ux * r - side * uy * r, y + s * uy * r + side * ux * r])
  return mf.CrossSection.hull([[points]])
}

/** A capsule of radius r between two points, reaching r past each so it overlaps both parts. */
function capsule(
  a: [number, number],
  b: [number, number],
  r: number,
  segments: number,
): CrossSection {
  const { manifold: mf } = runtime()
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  const ux = (b[0] - a[0]) / len
  const uy = (b[1] - a[1]) / len
  const ends: [number, number][] = [
    [a[0] - ux * r, a[1] - uy * r],
    [b[0] + ux * r, b[1] + uy * r],
  ]
  const points: [number, number][] = []
  const n = Math.max(8, Math.ceil(segments / 4))
  for (const [x, y] of ends)
    for (let i = 0; i < n; i++) {
      const t = (2 * Math.PI * i) / n
      points.push([x + r * Math.cos(t), y + r * Math.sin(t)])
    }
  return mf.CrossSection.hull([[points]])
}

/** Step along edges for constrained links, mm. */
const LINK_STEP = 0.2

/** The ring's vertices with points added along every edge, at most `step` apart. */
function densified(ring: Ring, step: number): Ring {
  const out: (readonly [number, number])[] = []
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!
    const q = ring[(i + 1) % ring.length]!
    const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / step))
    for (let k = 0; k < n; k++)
      out.push([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n])
  }
  return out
}

/**
 * The shortest segment from a vertex of `from` to an edge of `to` or back, shorter than `limit`
 * (and one `accept` takes, when given).
 */
function nearestLink(
  from: readonly Ring[],
  to: readonly Ring[],
  limit: number,
  accept?: (a: [number, number], b: [number, number]) => boolean,
): Link | null {
  let best: Link | null = null
  let bound = limit
  const scan = (points: readonly Ring[], edges: readonly Ring[], swap: boolean) => {
    // A constrained link may have to start part way along an edge (two upright strokes facing
    // each other meet only at their corners otherwise): walk the edges in short steps.
    for (const ring of accept ? points.map((r) => densified(r, LINK_STEP)) : points)
      for (const p of ring)
        for (const loop of edges)
          for (let i = 0; i < loop.length; i++) {
            const q0 = loop[i]!
            const q1 = loop[(i + 1) % loop.length]!
            // Cheap reject: both ends of the edge farther than the best along one axis.
            if (
              (q0[0] - p[0] > bound && q1[0] - p[0] > bound) ||
              (p[0] - q0[0] > bound && p[0] - q1[0] > bound) ||
              (q0[1] - p[1] > bound && q1[1] - p[1] > bound) ||
              (p[1] - q0[1] > bound && p[1] - q1[1] > bound)
            )
              continue
            const dx = q1[0] - q0[0]
            const dy = q1[1] - q0[1]
            const len2 = dx * dx + dy * dy
            const t =
              len2 > 0
                ? Math.max(0, Math.min(1, ((p[0] - q0[0]) * dx + (p[1] - q0[1]) * dy) / len2))
                : 0
            const q: [number, number] = [q0[0] + t * dx, q0[1] + t * dy]
            const d = Math.hypot(p[0] - q[0], p[1] - q[1])
            if (d < bound) {
              const link: Link = swap ? { a: q, b: [p[0], p[1]], d } : { a: [p[0], p[1]], b: q, d }
              if (accept && !accept(link.a, link.b)) continue
              bound = d
              best = link
            }
          }
  }
  scan(from, to, false)
  scan(to, from, true)
  return best
}
