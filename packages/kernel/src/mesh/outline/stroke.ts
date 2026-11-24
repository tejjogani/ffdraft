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
/** A mark is set down onto its letter until it overlaps it by this share of the tie width. */
const MARK_OVERLAP = 0.3
/**
 * …moving down onto metal under it: within its own width, give or take this share of it (an
 * italic stem slants under its dot). The nearest metal is sometimes the side of the next
 * letter's ascender, which would take the dot instead.
 */
const MARK_REACH = 0.25

type Ring = readonly (readonly [number, number])[]
type Link = { a: [number, number]; b: [number, number]; d: number }

/**
 * Joins the loose parts of an outline into one piece, the way a jeweler would solder a name,
 * nearest part first:
 *  - Letters get a tie `width` wide, side to side where both stand at full height: kept within
 *    the band both letters share (half a tie in from its top and bottom), a tie never sticks
 *    out over the cap line or under the baseline. The shortest link when no such one exists.
 *  - A mark (the dot of an i, an accent) is set down onto its letter, closing the gap: a tie
 *    across the gap reads as more stem and the i as an l, and one sideways to the next letter
 *    crosses an l or a t and reads as a bar.
 * Returns the joined outline and how many parts were joined, or null when it is already one
 * piece. The caller owns the result.
 */
export function joinIslands(
  outline: CrossSection,
  width: number,
  segments: number,
): { section: CrossSection; ties: number } | null {
  const { manifold: mf } = runtime()
  const pieces = outline.decompose()
  try {
    if (pieces.length <= 1) return null
    pieces.sort((a, b) => b.area() - a.area())
    const largest = pieces[0]!.area()
    const rings = pieces.map((p) => p.toPolygons() as Ring[])
    const boxes = pieces.map((p) => p.bounds())
    const spans = boxes.map(({ min, max }) => [min[1], max[1]] as const)
    const r = width / 2
    const joined = new Set([0])
    const left = new Set(rings.keys())
    left.delete(0)
    const parts: CrossSection[] = [pieces[0]!]
    const made: CrossSection[] = []
    try {
      while (left.size > 0) {
        let best = null as (Link & { piece: number }) | null
        // Constrained links first (letters within their shared band, marks straight down), over
        // every loose part; the shortest link only when no loose part has a constrained one.
        for (const constrained of [true, false]) {
          for (const k of left) {
            const mark = pieces[k]!.area() < MARK_SHARE * largest
            for (const j of joined) {
              const lo = Math.max(spans[k]![0], spans[j]![0]) + r
              const hi = Math.min(spans[k]![1], spans[j]![1]) - r
              if (constrained && !mark && lo > hi) continue
              const accept = !constrained
                ? undefined
                : mark
                  ? (a: [number, number], b: [number, number]) => {
                      const { min, max } = boxes[k]!
                      const slack = MARK_REACH * (max[0] - min[0])
                      return b[1] < a[1] && b[0] >= min[0] - slack && b[0] <= max[0] + slack
                    }
                  : (a: [number, number], b: [number, number]) =>
                      a[1] >= lo && a[1] <= hi && b[1] >= lo && b[1] <= hi
              const link = nearestLink(rings[k]!, rings[j]!, best?.d ?? Infinity, accept)
              if (link && (!best || link.d < best.d)) best = { piece: k, ...link }
            }
          }
          if (best) break
        }
        if (!best) break
        const k = best.piece
        left.delete(k)
        joined.add(k)
        if (pieces[k]!.area() < MARK_SHARE * largest) {
          // a lies on the mark, b on its letter: move the mark along a→b past b.
          const shift = (best.d + MARK_OVERLAP * width) / Math.max(best.d, 1e-9)
          const dx = (best.b[0] - best.a[0]) * shift
          const dy = (best.b[1] - best.a[1]) * shift
          const moved = pieces[k]!.translate([dx, dy])
          made.push(moved)
          parts.push(moved)
          rings[k] = rings[k]!.map((ring) => ring.map(([x, y]) => [x + dx, y + dy] as const))
        } else {
          const t = tie(best.a, best.b, r, segments)
          made.push(t)
          parts.push(pieces[k]!, t)
        }
      }
      // Parts never joined (none reachable) stay as they are.
      for (const k of left) parts.push(pieces[k]!)
      return { section: mf.CrossSection.union(parts), ties: joined.size - 1 }
    } finally {
      for (const m of made) m.delete()
    }
  } finally {
    for (const p of pieces) p.delete()
  }
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

/** A capsule of radius r between two points, reaching r past each so it overlaps both parts. */
function tie(a: [number, number], b: [number, number], r: number, segments: number): CrossSection {
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
