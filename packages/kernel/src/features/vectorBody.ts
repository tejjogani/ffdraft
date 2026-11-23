/**
 * Outline bodies: text, SVG path artwork or a named shape, scaled to an overall height and
 * extruded with a profiled front — flat, chamfered, rounded or pillowed (name plates, charms,
 * puffy hip-hop letters). Stands in the XZ plane facing −Y, back on y = 0, `thickness` deep.
 *
 * A raised border turns the face into a polished rim around a recessed field; the field is
 * published as `data.paveField` so a pavé node on this body ices the field and leaves the rim.
 */
import type { NodeOf } from '@pave/schema'
import type { CrossSection, Manifold } from 'manifold-3d'
import { type BuildContext, defineFeature, metalOf, runtime, solidFromManifold } from '../core'
import { OutlineDistance } from '../mesh/outline/distance'
import { edgeProfile, profiledSlab } from '../mesh/outline/profile'
import { SHAPES } from '../mesh/outline/shapes'
import { MIN_STROKE, thickenStrokes } from '../mesh/outline/stroke'
import { parseSvgPath } from '../mesh/outline/svgPath'
import type { PaveField } from '../mesh/pave/region'
import { textOutline } from '../text'

type VectorBodyNode = NodeOf<'vectorBody'>

/** Segments per full circle for round offsets (≈ 0.01 mm chord on a 1 mm radius). */
const SEGMENTS = 64
/** Flattening tolerance relative to the outline's height before scaling. */
const RELATIVE_TOLERANCE = 2e-4
/** Corner radius of the named shapes relative to their height: crisp, but castable and polishable. */
const SHAPE_CORNER = 0.015
/**
 * Depth of the field below the rim: deep enough that melee crowns (≈0.15 d above the girdle)
 * sit below the rim's top, never more than a third of the body.
 */
const recessFor = (border: number, thickness: number) => Math.min(Math.max(0.8 * border, 0.3), 0.6, thickness / 3)

/** The source's filled area, y up, in source units (the caller owns it). */
async function sourceSection(source: VectorBodyNode['source'], height: number): Promise<CrossSection> {
  const { manifold: mf } = runtime()
  switch (source.type) {
    case 'shape':
      return new mf.CrossSection(parseSvgPath(SHAPES[source.shape], RELATIVE_TOLERANCE * 2), 'NonZero')
    case 'svg': {
      // Flatten once coarsely to learn the artwork's size, then at the tolerance its scale needs.
      const rough = parseSvgPath(source.d, 1)
      const ys = rough.flat().map((p) => p[1])
      const extent = Math.max(...ys) - Math.min(...ys) || 1
      const tolerance = Math.max(extent * RELATIVE_TOLERANCE, (0.002 * extent) / height)
      // SVG's y axis points down; the fill rule is SVG's default.
      const contours = parseSvgPath(source.d, tolerance).map((c) => c.map(([x, y]): [number, number] => [x, -y]))
      return new mf.CrossSection(contours, 'NonZero')
    }
    case 'text': {
      if (source.text.trim() === '') throw new Error('The text is empty')
      const layout = await textOutline(source.text, source.font, height, height * RELATIVE_TOLERANCE * 5)
      // Each glyph fills even-odd on its own; overlapping glyphs (script joins) are unioned.
      const glyphs = layout.glyphs.map((g) => new mf.CrossSection(g.contours.map((c) => c.map(([x, y]): [number, number] => [x, y])), 'EvenOdd'))
      try {
        return mf.CrossSection.union(glyphs)
      } finally {
        for (const g of glyphs) g.delete()
      }
    }
  }
}

/** Largest distance from the outline to any point inside it (the pillow's reach). */
function innerReach(outline: CrossSection, distance: OutlineDistance): number {
  const { min, max } = outline.bounds()
  const n = 96
  let best = 0
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const x = min[0] + ((max[0] - min[0]) * i) / n
      const y = min[1] + ((max[1] - min[1]) * j) / n
      if (distance.inside(x, y)) best = Math.max(best, distance.distance(x, y))
    }
  return best
}

export const vectorBody = defineFeature('vectorBody', async (node, ctx) => {
  const { manifold: mf } = runtime()
  const own = <T extends CrossSection | Manifold>(x: T): T => ctx.track(x)
  let outline = own(await sourceSection(node.source, node.height))
  if (outline.isEmpty()) throw new Error('The outline encloses no area')
  const box = outline.bounds()
  const scale = node.height / (box.max[1] - box.min[1])
  outline = own(own(outline.translate([-(box.min[0] + box.max[0]) / 2, -(box.min[1] + box.max[1]) / 2])).scale(scale))
  if (node.source.type === 'shape') {
    // Soften corners (convex, then concave) by a radius proportional to the shape.
    const r = node.height * SHAPE_CORNER
    outline = own(own(own(outline.offset(-r, 'Round', 2, SEGMENTS)).offset(2 * r, 'Round', 2, SEGMENTS)).offset(-r, 'Round', 2, SEGMENTS))
  }
  const thickened = thickenStrokes(outline, MIN_STROKE, SEGMENTS)
  if (thickened) {
    outline = own(thickened)
    ctx.report({
      level: 'info',
      code: 'outline.thickened',
      message: `Strokes thinner than ${MIN_STROKE} mm were thickened so they survive casting.`,
      limit: MIN_STROKE,
    })
  }
  reportPieces(outline, node, ctx)

  // Fine enough for the profile to read smoothly, coarse enough to stay interactive.
  const resolution = Math.min(Math.max(node.height / 90, 0.12), 0.6)
  const distance = new OutlineDistance(outline.toPolygons())
  const field = node.border > 0 ? borderField(outline, node, ctx) : null
  const slab = own(
    field
      ? borderedSlab(outline, distance, field, node, resolution)
      : profiledSlab({
          outline,
          distance,
          profile: edgeProfile(node.bevel, node.bevelSize, node.thickness, innerReach(outline, distance)),
          segments: SEGMENTS,
          resolution,
        }),
  )

  // Outline (u, v) and thickness z  →  x = u, z = v, front toward −Y with the back on y = 0.
  const body = slab.rotate([90, 0, 0])
  const data: { paveField?: PaveField } = {}
  if (field) data.paveField = { outline: field.toPolygons().map((c) => c.map(([u, v]) => [u, v])) }
  return { bodies: [{ solid: solidFromManifold(body), ...metalOf(node) }], data }
})

/** The field inside a raised border, or null (with a warning) when the border fills the outline. */
function borderField(outline: CrossSection, node: VectorBodyNode, ctx: BuildContext): CrossSection | null {
  const field = ctx.track(outline.offset(-node.border, 'Round', 2, SEGMENTS))
  if (!field.isEmpty()) return field
  ctx.report({
    level: 'warning',
    code: 'outline.borderTooWide',
    message: `A ${node.border} mm border leaves no field inside this outline, so it was left out.`,
    value: node.border,
  })
  return null
}

/**
 * A polished rim with the edge treatment on its outside and a crisp inner wall, around a field
 * recessed below the rim's top. A pillowed body keeps its dome in the field, measured from the
 * field's own edge, so the stones of a pavé field follow the puff.
 */
function borderedSlab(
  outline: CrossSection,
  distance: OutlineDistance,
  field: CrossSection,
  node: VectorBodyNode,
  resolution: number,
): Manifold {
  const { manifold: mf } = runtime()
  const edge = node.bevel === 'pillow' ? 'round' : node.bevel
  const rimProfile = edgeProfile(edge, Math.min(node.bevelSize, node.border * 0.75), node.thickness, node.border)
  const floor = node.thickness - recessFor(node.border, node.thickness)
  const fieldDistance = new OutlineDistance(field.toPolygons())
  const fieldProfile =
    node.bevel === 'pillow'
      ? edgeProfile('pillow', node.bevelSize, floor, innerReach(field, fieldDistance))
      : edgeProfile('flat', 0, floor, 0)
  const rim = profiledSlab({
    outline,
    distance,
    profile: rimProfile,
    to: node.border,
    within: (s) => mf.CrossSection.difference(s, field),
    segments: SEGMENTS,
    resolution,
  })
  const inner = profiledSlab({ outline: field, distance: fieldDistance, profile: fieldProfile, segments: SEGMENTS, resolution })
  try {
    return mf.Manifold.union(rim, inner)
  } finally {
    rim.delete()
    inner.delete()
  }
}

/** Text whose glyphs do not touch casts as several loose pieces: say so. */
function reportPieces(outline: CrossSection, node: VectorBodyNode, ctx: BuildContext): void {
  const pieces = outline.decompose()
  const count = pieces.length
  for (const p of pieces) p.delete()
  if (count > 1)
    ctx.report({
      level: 'warning',
      code: 'outline.disconnected',
      message:
        node.source.type === 'text'
          ? `The letters form ${count} separate pieces; choose a joined (script) font, tighten the spacing, or add a bar so it casts as one.`
          : `The outline has ${count} separate pieces; join them so the body casts as one part.`,
    })
}
