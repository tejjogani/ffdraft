/**
 * Finding geometry in finding-local space (z = the axis a finding attaches along, mm).
 *
 * The post and jump ring are lathe forms with exact B-reps. The butterfly back and lobster
 * clasp are formed sheet and wire whose small parts overlap, so they are fused on meshes.
 */
import type { Manifold } from 'manifold-3d'
import { draw, drawCircle, type Shape3D } from 'replicad'
import { type Deletable, type Quality, runtime, type Vec3 } from '../../core'
import { ellipseLoop } from '../../geometry/loop'
import type { IndexedTriangles } from '../../solid/meshing'
import { manifoldFromTriangles, trianglesFromManifold } from '../../solid/solid'
import { type Centreline, sampleCurve, segmentsFor, sweepAlong } from '../chain/centreline'

/** How far a post or ring is sunk into its host so the two fuse into one casting. */
export const EMBED = 0.3

/**
 * Friction notch: a V groove about 2 mm from the tip of a 10–11 mm post, where the butterfly's
 * scrolls click in (stock posts, 01-cad.md §2 "Earring post").
 */
export const NOTCH_FROM_TIP = 2
const NOTCH_WIDTH = 0.4
const NOTCH_DEPTH_RATIO = 0.15

/** A round post along +z from −EMBED to `length`, domed tip, notched near the end. */
export function postShape(length: number, wire: number): Shape3D {
  const r = wire / 2
  const notch = Math.max(length - NOTCH_FROM_TIP, length / 2)
  const depth = NOTCH_DEPTH_RATIO * wire
  const profile = draw([0, -EMBED])
    .hLineTo(r)
    .vLineTo(notch - NOTCH_WIDTH / 2)
    .lineTo([r - depth, notch])
    .lineTo([r, notch + NOTCH_WIDTH / 2])
    .vLineTo(length - r)
    .threePointsArcTo([0, length], [r * Math.SQRT1_2, length - r + r * Math.SQRT1_2])
    .close()
  return profile.sketchOnPlane('XZ').revolve() as Shape3D
}

/** A ring of outer diameter `outer` around the z axis, in the XY plane. */
export function ringShape(outer: number, wire: number): Shape3D {
  const r = Math.min(wire, outer / 3) / 2
  return drawCircle(r)
    .translate(outer / 2 - r, 0)
    .sketchOnPlane('XZ')
    .revolve() as Shape3D
}

/** Collects Manifold temporaries and deletes them together. */
function manifoldScope<T>(fn: (own: <D extends Deletable>(d: D) => D) => T): T {
  const owned: Deletable[] = []
  try {
    return fn((d) => {
      owned.push(d)
      return d
    })
  } finally {
    for (const d of owned.reverse()) d.delete()
  }
}

/** Wire of elliptical section (half-sizes across and along `up` at t) swept along a line. */
function sweptWire(
  line: Centreline,
  half: (t: number) => [number, number],
  quality: Quality,
): Manifold {
  const solid = sweepAlong(line, (t) => ellipseLoop(...half(t)))
  try {
    return manifoldFromTriangles(solid.triangles(quality))
  } finally {
    solid.dispose()
  }
}

/**
 * Butterfly (scroll) back, `span` wide, sliding on a post of diameter `post` along z: a two-lobed
 * plate with a hole, and two scrolls curled up from its edges whose lips meet at the post.
 */
export function butterflyMesh(span: number, post: number, quality: Quality): IndexedTriangles {
  const { manifold: mf } = runtime()
  return manifoldScope((own) => {
    const sheet = Math.max(0.3, span * 0.06)
    const seg = (r: number) => segmentsFor(r, quality.chord, 12, 48)
    const lobe = span * 0.3
    const lobes = [-1, 1].map((s) =>
      own(own(mf.CrossSection.circle(lobe, seg(lobe))).translate(s * (span / 2 - lobe), 0)),
    )
    const outline = own(
      mf.CrossSection.union([...lobes, own(mf.CrossSection.circle(span * 0.2, seg(span * 0.2)))]),
    )
    const plate = own(outline.extrude(sheet))
    const hole = own(mf.Manifold.cylinder(sheet * 4, post * 0.55, undefined, seg(post), true))
    const parts: Manifold[] = [own(plate.subtract(hole))]
    // Each scroll: a C-curl of sheet, its axis along y, rising from the plate beside the hole.
    const curl = post / 2 + sheet
    const length = span * 0.45
    for (const side of [-1, 1]) {
      const centre = side * (post / 2 + curl)
      const line = sampleCurve(
        (t) => {
          // From the plate, out and over the top, ending with its lip against the post.
          const a = -Math.PI / 2 + side * 1.35 * Math.PI * t
          return [centre + curl * Math.cos(a), 0, sheet + curl + curl * Math.sin(a)]
        },
        () => [0, 1, 0],
        24,
        false,
      )
      parts.push(own(sweptWire(line, () => [sheet / 2, length / 2], quality)))
    }
    return trianglesFromManifold(own(mf.Manifold.union(parts)))
  })
}

/**
 * Lobster clasp `length` long, standing on z = 0 (eye at the bottom, hook at the top), in the XZ
 * plane: a claw-shaped body open on one side, a spring gate closing it with its thumb lever,
 * and an eye for the jump ring. Proportions are those of stock 10–12 mm clasps.
 */
export function lobsterMesh(length: number, wire: number, quality: Quality): IndexedTriangles {
  const { manifold: mf } = runtime()
  const L = length
  // The claw outline: an egg, fuller at the hook end.
  // Centre and half-height leave room for the eye below and the wire's thickness above: the
  // whole clasp is `length` tall.
  const centre = 0.6 * L
  const egg = (t: number): Vec3 => [
    0.27 * L * Math.sin(t) * (1 + 0.22 * Math.cos(t)),
    0,
    centre + 0.34 * L * Math.cos(t),
  ]
  const facing = (): Vec3 => [0, 1, 0]
  // Body from the hook tip (upper left), over the top and down the back to the hinge (lower left).
  const hookTip = -1.15
  const hinge = Math.PI + 0.55
  const between = (a: number, b: number, inset = 0) =>
    sampleCurve(
      (t) => {
        const p = egg(a + (b - a) * t)
        return [p[0] * (1 - inset), 0, centre + (p[2] - centre) * (1 - inset)]
      },
      facing,
      32,
      false,
    )
  return manifoldScope((own) => {
    const body = own(
      sweptWire(
        between(hookTip, hinge),
        (t) => {
          // Heavy along the back, tapering into the hook.
          const taper = Math.min(1, t / 0.18)
          return [0.075 * L * (0.45 + 0.55 * taper), 0.12 * L * (0.5 + 0.5 * taper)]
        },
        quality,
      ),
    )
    // The gate runs from inside the hinge to just short of the hook tip.
    const gate = own(
      sweptWire(
        between(hinge - 0.15, hookTip + 2 * Math.PI - 0.1, 0.04),
        () => [0.035 * L, 0.07 * L],
        quality,
      ),
    )
    const lever = egg(Math.PI + 0.85)
    const thumb = own(
      own(mf.Manifold.sphere(0.065 * L, segmentsFor(0.065 * L, quality.chord, 12, 32))).translate([
        lever[0] - 0.06 * L,
        0,
        lever[2],
      ]),
    )
    const ring = Math.max(wire, 0.06 * L)
    const eyeRadius = 0.065 * L + ring / 2
    const eye = own(
      sweptWire(
        sampleCurve(
          (t) => [
            eyeRadius * Math.sin(2 * Math.PI * t),
            0,
            ring / 2 + eyeRadius * (1 - Math.cos(2 * Math.PI * t)),
          ],
          facing,
          24,
          true,
        ),
        () => [ring / 2, ring / 2],
        quality,
      ),
    )
    // A neck from the top of the eye up into the bottom of the claw.
    const neckBase = 2 * eyeRadius
    const neck = own(
      own(
        mf.Manifold.cylinder(
          egg(Math.PI)[2] - neckBase,
          ring * 0.7,
          ring * 0.9,
          segmentsFor(ring, quality.chord, 12, 32),
        ),
      ).translate([0, 0, neckBase]),
    )
    return trianglesFromManifold(own(mf.Manifold.union([body, gate, thumb, eye, neck])))
  })
}
