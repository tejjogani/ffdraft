/** Box, cylinder, sphere, torus and cone primitives, centred on the origin, exact B-rep. */
import {
  makeBaseBox,
  makeEllipsoid,
  makeSphere,
  type Shape3D,
  type Sketch,
  sketchCircle,
  sketchEllipse,
} from 'replicad'
import { type BuildContext, defineFeature, metalOf, runtime, solidFromBrep } from '../core'
import { wrapShape } from '../solid/occt'

/** An ellipse (or circle) with the given X and Y diameters on the plane z = `z`. */
function ellipseSketch(dx: number, dy: number, z: number): Sketch {
  const plane = { plane: 'XY' as const, origin: z }
  return Math.abs(dx - dy) < 1e-9
    ? sketchCircle(dx / 2, plane)
    : sketchEllipse(dx / 2, dy / 2, plane)
}

function torus(diameter: number, tube: number): Shape3D {
  const { oc } = runtime()
  const minor = Math.min(tube, diameter / 2 - 1e-3) / 2
  const maker = new oc.BRepPrimAPI_MakeTorus(diameter / 2 - minor, minor)
  try {
    return wrapShape<Shape3D>(maker.Shape())
  } finally {
    maker.delete()
  }
}

/** Rounds every edge; the radius is capped so the fillet always fits the smallest dimension. */
function withFillet(shape: Shape3D, radius: number, limit: number, ctx: BuildContext): Shape3D {
  const r = Math.min(radius, limit * 0.49)
  if (r < 1e-3) return shape
  try {
    const rounded = shape.fillet(r)
    shape.delete()
    return rounded
  } catch {
    ctx.report({
      level: 'warning',
      code: 'fillet.failed',
      message: `An edge radius of ${radius} mm does not fit this shape; it was left sharp.`,
    })
    return shape
  }
}

export const primitive = defineFeature('primitive', (node, ctx) => {
  const [x, y, z] = node.size.map((v) => Math.max(v, 0.01)) as [number, number, number]
  let shape: Shape3D
  switch (node.shape) {
    case 'box':
      shape = withFillet(
        makeBaseBox(x, y, z).translateZ(-z / 2),
        node.fillet,
        Math.min(x, y, z),
        ctx,
      )
      break
    case 'cylinder':
      shape = withFillet(
        ellipseSketch(x, y, -z / 2).extrude(z),
        node.fillet,
        Math.min(x, y, z),
        ctx,
      )
      break
    case 'cone':
      shape = ellipseSketch(x, y, -z / 2).loftWith([], { endPoint: [0, 0, z / 2], ruled: true })
      break
    case 'sphere':
      shape =
        Math.abs(x - y) < 1e-9 && Math.abs(x - z) < 1e-9
          ? makeSphere(x / 2)
          : makeEllipsoid(x / 2, y / 2, z / 2)
      break
    case 'torus':
      shape = torus(x, node.tube)
      break
  }
  return { bodies: [{ solid: solidFromBrep(shape), ...metalOf(node) }] }
})
