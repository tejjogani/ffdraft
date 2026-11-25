/**
 * The clasp that opens a necklace or bracelet so it can be put on: a lobster clasp with the jump
 * ring it catches, or for a tennis line a box clasp with its tongue. It takes the place of the
 * links at the back of the drape (opposite the low point, where a clasp sits on the neck).
 *
 * Clasp-local space: x runs along the chord from the end of the last link on one side (A, at
 * x = 0) to the start of the first link on the other (B), y across the chain in its plane, z
 * toward the chain's face. Like the links, the clasp's two pieces never touch each other, and
 * each is held by the chain: the lobster's eye and its ring are each cast onto an end link that
 * threads the chain as every link does (as a jeweler closes a clasp onto its end rings), and a
 * tennis line's box clasp hinges onto its end links as they hinge onto each other. Stood loose
 * beside their links, the pieces were held by nothing.
 */
import type { Manifold } from 'manifold-3d'
import { type Deletable, QUALITY, type Quality, runtime } from '../../core'
import { circleLoop, roundedRectLoop } from '../../geometry/loop'
import { placeLoop, sweepSolid } from '../../geometry/sweep'
import {
  type Mat4,
  multiply,
  transformDirection,
  transformPoint,
  translation,
  type Vec3,
} from '../../geometry/vec'
import { manifoldFromTriangles } from '../../solid/solid'
import { lobsterEyeWire, lobsterMesh } from '../finding/shapes'
import { sampleCurve, sweepAlong } from './centreline'
import type { TennisLink } from './tennis'

export type ClaspStyle = 'lobster' | 'box'

/** Air between the clasp's two pieces, mm. */
const CLASP_CLEARANCE = 0.1

/** A clasp of a given span: its pieces, built in clasp-local space. */
export interface Clasp {
  style: ClaspStyle
  /** The clasp's length along the chain, mm (the lobster, or the box). */
  length: number
  /** Distance from A's last link to B's first, along the chord. */
  span: number
  /** The clasp's metal, in clasp-local space; `own` takes each temporary. */
  parts(own: <T extends Deletable>(m: T) => T, quality: Quality): Manifold[]
}

/**
 * How far each end of the clasp reaches into its link, mm: negative, it stops the clearance
 * short, so its shells stay apart from the links' as the links' do from each other.
 */
const END_REACH = -CLASP_CLEARANCE

/** A wire ring of centreline radius r round the y axis, centred at x = cx, as a Manifold. */
function ringAboutY(cx: number, r: number, wire: number, quality: Quality): Manifold {
  const line = sampleCurve(
    (t) => [cx + r * Math.cos(2 * Math.PI * t), 0, r * Math.sin(2 * Math.PI * t)],
    () => [0, 1, 0],
    32,
    true,
  )
  const solid = sweepAlong(line, circleLoop(wire / 2))
  try {
    return manifoldFromTriangles(solid.triangles(quality))
  } finally {
    solid.dispose()
  }
}

/**
 * Lobster local (claw in XZ, length along Z from its eye) to clasp-local (length along x); the
 * same turn takes an extrusion along Z to one along x.
 */
const LOBSTER_AXES: Mat4 = [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1]

/** Stock lobster clasp length for a chain of this link width, mm: 10 on fine chain, 25 at most. */
const lobsterLength = (linkWidth: number) => Math.min(25, Math.max(10, 2 * linkWidth + 6))

/**
 * A lobster clasp and its ring spanning `span` (at least `lobsterMin(...)`): the lobster's eye
 * is at A; the ring's near side passes through the claw where it is widest, and its far side is
 * at B. The ring grows to take up the span, so the clasp meets both ends whatever whole number
 * of links it replaces. Each end reaches `reach` into what it meets (negative: stops short),
 * and `ends` gives the metal each piece is cast onto there (the end links, clasp-local).
 */
export function lobsterClasp(
  linkWidth: number,
  wire: number,
  span: number,
  reach = END_REACH,
  ends?: (own: <T extends Deletable>(m: T) => T, quality: Quality) => [Manifold[], Manifold[]],
): Clasp {
  const L = lobsterLength(linkWidth)
  const eye = lobsterEyeWire(L, wire)
  // The ring's near side crosses the claw's plane at 0.75 of its length (inside the claw), its
  // far side past the claw's top; it reaches B.
  const near = 0.75 * L - reach
  const r = (span + reach - eye / 2 - near) / 2
  return {
    style: 'lobster',
    length: L,
    span,
    parts: (own, quality) => {
      const lobster = own(lobsterPlaced(L, eye, quality, reach))
      const ring = own(ringAboutY(near + r, r, eye, quality))
      if (!ends) return [lobster, ring]
      const [a, b] = ends(own, quality)
      const { manifold: mf } = runtime()
      return [own(mf.Manifold.union([lobster, ...a])), own(mf.Manifold.union([ring, ...b]))]
    },
  }
}

/**
 * How far a lobster's eye and its ring reach into the end links they are cast onto: half the
 * thinner of the eye's wire and the chain's, so the joint is solid metal and not a kiss.
 */
export const lobsterFuse = (linkWidth: number, wire: number) =>
  0.5 * Math.min(wire, lobsterEyeWire(lobsterLength(linkWidth), wire))

/** The lobster in clasp-local space, its eye reaching `reach` behind x = 0. */
function lobsterPlaced(L: number, eye: number, quality: Quality, reach = END_REACH): Manifold {
  const claw = manifoldFromTriangles(lobsterMesh(L, eye, quality))
  try {
    return claw.transform(multiply(translation([-reach, 0, 0]), LOBSTER_AXES) as never)
  } finally {
    claw.delete()
  }
}

const shortest = new Map<string, number>()

/**
 * The shortest span a lobster clasp takes: the smallest ring whose far side passes over the
 * claw's top and that touches the claw nowhere, found on the meshes (the claw is not a simple
 * shape to clear by formula).
 */
export function lobsterMin(linkWidth: number, wire: number, reach = END_REACH): number {
  const L = lobsterLength(linkWidth)
  const eye = lobsterEyeWire(L, wire)
  const key = `${L}:${eye}:${reach}`
  const known = shortest.get(key)
  if (known !== undefined) return known
  const near = 0.75 * L - reach
  const lobster = lobsterPlaced(L, eye, QUALITY.draft, reach)
  let span = Infinity
  try {
    // From a ring whose far side just passes the claw's top, outward until nothing touches.
    for (let r = (0.25 * L + eye + CLASP_CLEARANCE) / 2; r < L; r += 0.02 * L) {
      const ring = ringAboutY(near + r, r, eye, QUALITY.draft)
      const shared = ring.intersect(lobster)
      const touches = shared.volume() > 1e-6
      for (const m of [ring, shared]) m.delete()
      if (touches) continue
      // A little more, so the ring clears the claw by the clearance and not by a hair.
      const rr = r + CLASP_CLEARANCE
      span = near + 2 * rr + eye / 2 - reach
      break
    }
  } finally {
    lobster.delete()
  }
  shortest.set(key, span)
  return span
}

/**
 * Shortest box a box clasp has, mm: its tongue needs that much length to spring and catch. At
 * 1.4 line widths alone a 2 mm tennis line got a 3 mm box, shorter than any stock clasp.
 */
const BOX_LEAST = 5

/** Spacing of the sections a hinged box clasp is swept through along the line, mm. */
const SWEEP_STEP = 0.5

/** Metal of a hinged box clasp's end piece beyond where its hinge meets it, mm. */
const END_LAP = 0.15

/**
 * Length of a hinged box clasp's end piece (the plate the tongue stands from): enough plate for
 * the hinge it carries to the next link, and a wall at least.
 */
const endPiece = (link: TennisLink, wall: number) => Math.max(wall, link.box.attach + END_LAP)

/** The box clasp's walls: as a box clasp's, and no thinner than the link's plate. */
const boxWall = (link: TennisLink, width: number) => Math.max(0.4, 0.1 * width, link.box.wall)

/**
 * Least distance between the centres of the first and last links a hinged box clasp replaces:
 * room for a box BOX_LEAST long and its end piece where those links' boxes stood.
 */
export function hingedBoxMin(link: TennisLink, width: number): number {
  const wall = boxWall(link, width)
  return Math.max(BOX_LEAST, 1.4 * width) + CLASP_CLEARANCE + endPiece(link, wall) - link.box.lx
}

/**
 * A box clasp for a tennis line, hinged onto its end links as a link is onto its neighbour: it
 * stands where the links it replaces stood, the box from the back edge of the first to the front
 * edge of the last, following the line's curve. Under the box's closed end are the staples (or
 * ring) the first link would have carried, so the link before it hinges into the box; the end
 * piece carries the last link's tongue (or ring) into the link after it. The tongue that locks
 * the clasp runs from the end piece into the box. Built loose, an end link's tongue stood out
 * into the gap with nothing to pass through, and each piece only stood beside its link.
 *
 * `frameAt(s)` is the link frame at arc length s (a link is placed by it, after `centred`);
 * `first` and `last` are the arc lengths of the first and last links replaced; `width` and
 * `height` size the box across and up from the plate's underside. Parts are in chain space.
 */
export function hingedBoxClasp(
  link: TennisLink,
  frameAt: (s: number) => Mat4,
  centred: Mat4,
  first: number,
  last: number,
  width: number,
  height: number,
): Clasp {
  const { lx, bottom } = link.box
  const wall = boxWall(link, width)
  const c = CLASP_CLEARANCE
  const s0 = first - lx / 2
  const s1 = last + lx / 2
  const end = endPiece(link, wall)
  const mouth = s1 - end - c
  const W = width
  const H = height
  const zc = bottom + H / 2
  return {
    style: 'box',
    length: mouth - s0,
    span: s1 - s0,
    parts: (own, quality) => {
      const r = Math.min(wall, 0.3 * Math.min(W, H))
      /** A rounded w × h section (across × up, centred `up` above zc) swept from a to b. */
      const along = (w: number, h: number, round: number, a: number, b: number, up = 0) => {
        const count = Math.max(2, Math.ceil((b - a) / SWEEP_STEP) + 1)
        const loop = roundedRectLoop(w, h, round)
        const sections = Array.from({ length: count }, (_, i) => {
          const m = multiply(frameAt(a + ((b - a) * i) / (count - 1)), centred)
          return placeLoop(
            {
              origin: transformPoint(m, [0, 0, zc + up]),
              x: transformDirection(m, [0, 1, 0]),
              y: transformDirection(m, [0, 0, 1]),
              z: transformDirection(m, [1, 0, 0]),
            },
            loop,
          )
        })
        const solid = sweepSolid({ closed: false, sections })
        try {
          return own(manifoldFromTriangles(solid.triangles(quality)))
        } finally {
          solid.dispose()
        }
      }
      const outer = along(W, H, r, s0, mouth)
      const cavity = along(
        W - 2 * wall,
        H - 2 * wall,
        Math.max(0.05, r - wall),
        s0 + wall,
        mouth + 1,
      )
      const box = own(outer.subtract(cavity))
      // The tongue fills the cavity's width with clearance, half its depth, from just inside the
      // cap into the end piece.
      const inner = H - 2 * wall
      const tongue = along(
        W - 2 * wall - 2 * c,
        0.5 * inner,
        Math.min(0.1, 0.1 * inner),
        s0 + wall + c,
        mouth + c + Math.min(wall, end) / 2,
      )
      const plate = along(W, H, r, mouth + c, s1)
      /** One side of a link's hinge, placed as the link centred at arc length s would carry it. */
      const hinge = (side: 'ahead' | 'behind', s: number) => {
        const m = multiply(frameAt(s), centred)
        return link.hingeParts(side, own, quality).map((p) => own(p.transform(m as never)))
      }
      const { manifold: mf } = runtime()
      return [
        own(mf.Manifold.union([box, ...hinge('behind', first)])),
        own(mf.Manifold.union([tongue, plate, ...hinge('ahead', last)])),
      ]
    },
  }
}

/** Unit vector from a to b. */
export const toward = (a: Vec3, b: Vec3): Vec3 => {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const l = Math.hypot(...d) || 1
  return [d[0] / l, d[1] / l, d[2] / l]
}
