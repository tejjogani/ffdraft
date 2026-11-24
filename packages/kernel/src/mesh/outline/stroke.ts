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

/**
 * Joins the loose parts of an outline into one piece: each part, nearest first, gets a tie
 * `width` wide along the shortest line to what is already joined — the dot of an i drops onto
 * its stem, a script capital reaches the next letter. Returns the joined outline and how many
 * ties were added, or null when it is already one piece. The caller owns the result.
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
    const rings = pieces.map((p) => p.toPolygons())
    const joined: [number, number][][] = [...rings[0]!]
    const left = new Set(rings.keys())
    left.delete(0)
    const ties: CrossSection[] = []
    try {
      while (left.size > 0) {
        // The loose part nearest to the joined body goes next, along its shortest link.
        let best: { piece: number; a: [number, number]; b: [number, number]; d: number } | null =
          null
        for (const k of left) {
          const link = nearestLink(rings[k]!, joined, best?.d ?? Infinity)
          if (link && (!best || link.d < best.d)) best = { piece: k, ...link }
        }
        if (!best) break
        left.delete(best.piece)
        joined.push(...rings[best.piece]!)
        ties.push(tie(best.a, best.b, width / 2, segments))
      }
      return { section: mf.CrossSection.union([outline, ...ties]), ties: ties.length }
    } finally {
      for (const t of ties) t.delete()
    }
  } finally {
    for (const p of pieces) p.delete()
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

/** The shortest segment from a vertex of `from` to an edge of `to` or back, shorter than `limit`. */
function nearestLink(
  from: readonly (readonly [number, number])[][],
  to: readonly (readonly [number, number])[][],
  limit: number,
): { a: [number, number]; b: [number, number]; d: number } | null {
  let best: { a: [number, number]; b: [number, number]; d: number } | null = null
  let bound = limit
  const scan = (
    points: readonly (readonly [number, number])[][],
    edges: readonly (readonly [number, number])[][],
    swap: boolean,
  ) => {
    for (const ring of points)
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
              bound = d
              best = swap ? { a: q, b: [p[0], p[1]], d } : { a: [p[0], p[1]], b: q, d }
            }
          }
  }
  scan(from, to, false)
  scan(to, from, true)
  return best
}
