/**
 * Box (Venetian) chain: each link is a short square tube of flat strip — four walls the width
 * of the chain — and the next link, turned a quarter about the chain axis, threads it with one
 * wall through its hole. From every side the chain reads as a row of closed, flat-walled boxes.
 *
 * The links are flat-walled, not round wire, so they are mesh-only, and their pitch is found by
 * intersecting the link meshes themselves rather than by the round-wire contact solver.
 */
import type { Manifold } from 'manifold-3d'
import {
  type Deletable,
  type IndexedTriangles,
  type Mat4,
  QUALITY,
  type Quality,
  runtime,
} from '../../core'
import { IDENTITY, multiply } from '../../geometry/vec'
import { manifoldFromTriangles, trianglesFromManifold } from '../../solid/solid'
import { segmentsFor } from './centreline'
import { alongArc, atTightestBend, GAP_RATIO, InterlockError, tautPitch } from './contact'
import type { Template } from './instances'
import type { LinkSet } from './links'

/** Strip no thicker than this fraction of the box, so its hole stays open. */
const MAX_STRIP = 1 / 5.5
/**
 * How far a link may turn against its neighbour on a bend. Box chain is stiff, but ~6° per link
 * lets it drape round a neck (about 8 link widths of bend radius).
 */
const BOX_TURN = 0.1
/** Overlap below this is meshing noise between walls that only touch (mm³). */
const TOUCH_MM3 = 1e-6

const turned: Mat4 = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]

/** A square tube of side `side`, wall `strip` and length `depth` along z, outer corners rounded. */
function tubeMesh(side: number, strip: number, depth: number, quality: Quality): IndexedTriangles {
  const { manifold: mf } = runtime()
  const owned: Deletable[] = []
  const own = <T extends Deletable>(x: T): T => {
    owned.push(x)
    return x
  }
  try {
    const r = 0.9 * strip
    const outer = own(
      own(mf.CrossSection.square([side - 2 * r, side - 2 * r], true)).offset(
        r,
        'Round',
        2,
        segmentsFor(r, quality.chord, 4, 24),
      ),
    )
    // The inner corners stay sharp: the neighbour's wall runs right into them.
    const inner = own(mf.CrossSection.square([side - 2 * strip, side - 2 * strip], true))
    const ring = own(own(outer.subtract(inner)).extrude(depth))
    return trianglesFromManifold(own(ring.translate(0, 0, -depth / 2)))
  } finally {
    for (const x of owned.reverse()) x.delete()
  }
}

export function boxChain(width: number, wire: number): LinkSet {
  const strip = Math.min(wire, width * MAX_STRIP)
  const gap = GAP_RATIO * strip
  // Shallow enough that a wall of it passes through the neighbour's hole with air either side,
  // even with the neighbour turned by BOX_TURN on a bend (and a gap more, so the fattened test
  // links below pass too).
  // The neighbour turns about its own centre, so the wall it passes through this link's hole
  // swings sideways by half the box's width times the sine of the turn, not by its own
  // thickness; and straight, the whole depth must still pass the fattened hole.
  const hole = width - 2 * strip - gap
  const depth = Math.min(
    (hole - (width + gap) * Math.sin(BOX_TURN)) / Math.cos(BOX_TURN) - 2 * gap,
    hole - 2 * gap,
  )
  const mesh = (quality: Quality) => tubeMesh(width, strip, depth, quality)
  // Clearance is tested on links fattened by the gap all round: if those do not overlap, the
  // real links are at least a gap apart and never touch.
  const link = manifoldFromTriangles(tubeMesh(width + gap, strip + gap, depth + gap, QUALITY.draft))
  const orients = [IDENTITY, turned]
  const clears = (pitch: number, bend: number) => {
    const placed: Manifold[] = []
    try {
      for (const radius of [Infinity, bend, -bend]) {
        const at = (k: number) =>
          link.transform(multiply(alongArc(k * pitch, radius), orients[k % 2]!) as never)
        const [first, next, after] = [0, 1, 2].map(at) as [Manifold, Manifold, Manifold]
        placed.push(first, next, after)
        for (const other of [next, after]) {
          const overlap = first.intersect(other)
          const volume = overlap.volume()
          overlap.delete()
          if (volume > TOUCH_MM3) return false
        }
      }
      return true
    } finally {
      for (const m of placed) m.delete()
    }
  }
  try {
    // Pulled taut, a wall of each link rests against the far wall of the next one's hole.
    // The scan is bounded to a few dozen steps whatever the strip (a fine strip would otherwise
    // step a hundred times through mesh intersections), then refined by bisection.
    let solved: { solved: number; minBend: number }
    try {
      solved = atTightestBend(width, (bend) =>
        tautPitch((p) => clears(p, bend), width - 2 * strip - gap, Math.max(strip / 8, width / 32)),
      )
    } catch (error) {
      if (!(error instanceof InterlockError)) throw error
      // Thinner strip never helps a box link (its hole only grows), so say what does.
      throw new Error(
        `A ${width} mm box chain cannot be threaded with ${strip.toFixed(2)} mm strip; use a strip under ${(width * MAX_STRIP).toFixed(2)} mm or wider links`,
      )
    }
    const { solved: pitch, minBend } = solved
    const template: Template = { mesh }
    return {
      templates: [template],
      period: orients.map((orient) => ({ template: 0, orient })),
      pitches: [pitch, pitch],
      half: { y: width / 2, z: width / 2 },
      wire: strip,
      linkLength: width,
      minBend,
    }
  } finally {
    link.delete()
  }
}
