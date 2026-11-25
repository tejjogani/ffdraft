/**
 * The clasp that opens a necklace or bracelet so it can be put on: a lobster clasp with the jump
 * ring it catches, or for a tennis line a box clasp with its tongue. It takes the place of the
 * links at the back of the drape (opposite the low point, where a clasp sits on the neck).
 *
 * Clasp-local space: x runs along the chord from the end of the last link on one side (A, at
 * x = 0) to the start of the first link on the other (B), y across the chain in its plane, z
 * toward the chain's face. Like the links, the clasp is separate pieces that never touch: the
 * lobster (or box) against A's last link, the ring (or tongue) against B's first, caught in it,
 * each stopping the clearance short of its link. A chain is bought or cast apart and assembled
 * (the kernel never fuses its shells), and a jeweler solders the clasp's ends on then.
 */
import type { Manifold } from 'manifold-3d'
import { type Deletable, QUALITY, type Quality, runtime } from '../../core'
import { circleLoop } from '../../geometry/loop'
import { type Mat4, multiply, translation, type Vec3 } from '../../geometry/vec'
import { manifoldFromTriangles } from '../../solid/solid'
import { lobsterEyeWire, lobsterMesh } from '../finding/shapes'
import { sampleCurve, segmentsFor, sweepAlong } from './centreline'

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
 * is against A; the ring's near side passes through the claw where it is widest, and its far
 * side is against B. The ring grows to take up the span, so the clasp meets both ends
 * whatever whole number of links it replaces.
 */
export function lobsterClasp(linkWidth: number, wire: number, span: number): Clasp {
  const L = lobsterLength(linkWidth)
  const eye = lobsterEyeWire(L, wire)
  const reach = END_REACH
  // The ring's near side crosses the claw's plane at 0.75 of its length (inside the claw), its
  // far side past the claw's top; it reaches B.
  const near = 0.75 * L - reach
  const r = (span + reach - eye / 2 - near) / 2
  return {
    style: 'lobster',
    length: L,
    span,
    parts: (own, quality) => [
      own(lobsterPlaced(L, eye, quality)),
      own(ringAboutY(near + r, r, eye, quality)),
    ],
  }
}

/** The lobster in clasp-local space, its eye reaching SOLDER behind x = 0. */
function lobsterPlaced(L: number, eye: number, quality: Quality): Manifold {
  const claw = manifoldFromTriangles(lobsterMesh(L, eye, quality))
  try {
    return claw.transform(multiply(translation([-END_REACH, 0, 0]), LOBSTER_AXES) as never)
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
export function lobsterMin(linkWidth: number, wire: number): number {
  const L = lobsterLength(linkWidth)
  const eye = lobsterEyeWire(L, wire)
  const key = `${L}:${eye}`
  const known = shortest.get(key)
  if (known !== undefined) return known
  const reach = END_REACH
  const near = 0.75 * L - reach
  const lobster = lobsterPlaced(L, eye, QUALITY.draft)
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
 * A box clasp for a tennis line `width` wide and `height` deep, spanning `span` (at least
 * `boxMin(width)`): a box closed at A and open toward B, and on B a plate carrying a tongue that
 * fills the box with clearance all round. The box grows to take up the span.
 */
export function boxClasp(width: number, height: number, span: number): Clasp {
  const wall = Math.max(0.4, 0.1 * width)
  const reach = END_REACH
  const c = CLASP_CLEARANCE
  // The plate on B is a wall thick; the box takes the rest of the span.
  const box = span + 2 * reach - c - wall
  const W = width
  const H = height
  return {
    style: 'box',
    length: box,
    span,
    parts: (own, quality) => {
      const { manifold: mf } = runtime()
      const seg = (r: number) => segmentsFor(r, quality.chord, 8, 32)
      const r = Math.min(wall, 0.3 * Math.min(W, H))
      /** A rounded rectangle w × h across (y × z), extruded from x0 to x1. */
      const block = (w: number, h: number, round: number, x0: number, x1: number) => {
        const section = own(
          own(mf.CrossSection.square([w - 2 * round, h - 2 * round], true)).offset(
            round,
            'Round',
            2,
            seg(round),
          ),
        )
        // Extruded along z, then turned so it runs along x (w across y, h along z).
        const solid = own(section.extrude(x1 - x0))
        return own(own(solid.transform(LOBSTER_AXES as never)).translate([x0, 0, 0]))
      }
      const start = -reach
      const mouth = start + box
      const outer = block(W, H, r, start, mouth)
      const cavity = block(
        W - 2 * wall,
        H - 2 * wall,
        Math.max(0.05, r - wall),
        start + wall,
        mouth + 1,
      )
      const shell = own(outer.subtract(cavity))
      // The tongue fills the cavity's width with clearance, half its depth, from just inside
      // the cap to the plate past the mouth.
      const tongue = block(
        W - 2 * wall - 2 * c,
        0.5 * (H - 2 * wall),
        Math.min(0.1, 0.1 * (H - 2 * wall)),
        start + wall + c,
        mouth + c + wall / 2,
      )
      const plate = block(W, H, r, mouth + c, mouth + c + wall)
      return [shell, tongue, plate]
    },
  }
}

/**
 * Shortest box a box clasp has, mm: its tongue needs that much length to spring and catch. At
 * 1.4 line widths alone a 2 mm tennis line got a 3 mm box, shorter than any stock clasp.
 */
const BOX_LEAST = 5

/** The shortest span a box clasp takes: a box 1.4 line widths long, and BOX_LEAST at least. */
export function boxMin(width: number): number {
  const wall = Math.max(0.4, 0.1 * width)
  return Math.max(BOX_LEAST, 1.4 * width) - 2 * END_REACH + CLASP_CLEARANCE + wall
}

/** Unit vector from a to b. */
export const toward = (a: Vec3, b: Vec3): Vec3 => {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const l = Math.hypot(...d) || 1
  return [d[0] / l, d[1] / l, d[2] / l]
}
