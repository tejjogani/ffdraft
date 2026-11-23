/**
 * A coin, medallion or signet face: a base plate in one of five outlines, a raised rim, and a
 * relief inside it from an image (luminance → height, smoothed) or, without one, an engine-
 * turned guilloché pattern. The relief is clipped to the field with clean vertical walls.
 * Stands in the XZ plane, face toward −Y, back on y = 0 (a signet face sits on the band).
 */
import type { NodeOf } from '@pave/schema'
import type { CrossSection, Manifold } from 'manifold-3d'
import { guilloche } from '../builtin/guilloche'
import { type BuildContext, defineFeature, metalOf, runtime, solidFromManifold } from '../core'
import { type HeightGrid, heightfieldSolid } from '../mesh/heightfield'
import { blur, decodeImage, luminanceHeights } from '../mesh/image/raster'
import { OutlineDistance } from '../mesh/outline/distance'
import { edgeProfile, profiledSlab } from '../mesh/outline/profile'
import { SHAPES } from '../mesh/outline/shapes'
import { parseSvgPath } from '../mesh/outline/svgPath'

type ReliefNode = NodeOf<'relief'>

const SEGMENTS = 128
/** Height-field samples across the field's larger side: ~0.1 mm on an 18 mm coin. */
const SAMPLES_ACROSS = 180
/** Smoothing of the height map, in grid cells: removes pixel stair-steps and JPEG noise. */
const SMOOTHING = 0.8
/** The relief overlaps the base by this much so the union is a single solid (mm). */
const OVERLAP = 0.05
/** Rounded outer edge of the rim, as a share of the rim width (capped at 0.3 mm). */
const RIM_ROUND = 0.4

function outlineSection(node: ReliefNode): CrossSection {
  const { manifold: mf } = runtime()
  const w = node.width
  const h = node.height
  switch (node.outline) {
    case 'round':
      // A coin is a circle: the smaller of width and height is its diameter.
      return mf.CrossSection.circle(Math.min(w, h) / 2, SEGMENTS)
    case 'oval':
      return mf.CrossSection.circle(0.5, SEGMENTS).scale([w, h])
    case 'cushion': {
      // Superellipse |x|⁴ + |y|⁴ = 1: square shoulders, soft corners (the classic signet cushion).
      const points: [number, number][] = Array.from({ length: SEGMENTS }, (_, i) => {
        const t = (i / SEGMENTS) * 2 * Math.PI
        const c = Math.cos(t)
        const s = Math.sin(t)
        return [(Math.sign(c) * Math.abs(c) ** 0.5 * w) / 2, (Math.sign(s) * Math.abs(s) ** 0.5 * h) / 2]
      })
      return new mf.CrossSection([points])
    }
    case 'rect': {
      const r = 0.08 * Math.min(w, h)
      const square = mf.CrossSection.square([w - 2 * r, h - 2 * r], true)
      try {
        return square.offset(r, 'Round', 2, SEGMENTS)
      } finally {
        square.delete()
      }
    }
    case 'shield': {
      const shape = new mf.CrossSection(parseSvgPath(SHAPES.shield, 1e-3), 'NonZero')
      try {
        // The shield path spans x ∈ [−0.8, 0.8], y ∈ [−1, 1].
        return shape.scale([w / 1.6, h / 2])
      } finally {
        shape.delete()
      }
    }
  }
}

/** Heights 0–1 on a grid over the field's bounds, from the image or the built-in pattern. */
async function heightGrid(node: ReliefNode, field: CrossSection, ctx: BuildContext): Promise<Omit<HeightGrid, 'z'> & { h: Float32Array }> {
  const { min, max } = field.bounds()
  const spacing = Math.max(max[0] - min[0], max[1] - min[1]) / SAMPLES_ACROSS
  const nx = Math.ceil((max[0] - min[0]) / spacing) + 1
  const ny = Math.ceil((max[1] - min[1]) / spacing) + 1
  const h = new Float32Array(nx * ny)
  if (!node.assetId) {
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const u = ((i / (nx - 1)) * 2 - 1)
        const v = ((j / (ny - 1)) * 2 - 1)
        const g = guilloche(u, v)
        h[j * nx + i] = node.invert ? 1 - g : g
      }
    return { x0: min[0], y0: min[1], spacing, nx, ny, h }
  }
  if (!ctx.assets) throw new Error('No asset store is connected, so the height map cannot be loaded')
  const image = decodeImage(await ctx.assets(node.assetId))
  const heights = luminanceHeights(image, node.invert)
  // "Cover" fit: the image fills the field, cropped to its aspect ratio; image rows run down.
  const aspect = (max[0] - min[0]) / (max[1] - min[1])
  const cropW = Math.min(image.width, image.height * aspect)
  const cropH = cropW / aspect
  const left = (image.width - cropW) / 2
  const topRow = (image.height - cropH) / 2
  // Box-average the image down to the grid, then smooth by a fraction of a cell.
  const sums = new Float32Array(nx * ny)
  const counts = new Float32Array(nx * ny)
  for (let py = Math.floor(topRow); py < Math.ceil(topRow + cropH); py++)
    for (let px = Math.floor(left); px < Math.ceil(left + cropW); px++) {
      const i = Math.round(((px + 0.5 - left) / cropW) * (nx - 1))
      const j = Math.round((1 - (py + 0.5 - topRow) / cropH) * (ny - 1))
      if (i < 0 || j < 0 || i >= nx || j >= ny || px < 0 || py < 0 || px >= image.width || py >= image.height) continue
      sums[j * nx + i]! += heights[py * image.width + px]!
      counts[j * nx + i]!++
    }
  for (let k = 0; k < h.length; k++) h[k] = counts[k]! > 0 ? sums[k]! / counts[k]! : 0
  fillGaps(h, counts, nx, ny)
  return { x0: min[0], y0: min[1], spacing, nx, ny, h: blur(h, nx, ny, SMOOTHING) }
}

/** Grid nodes no pixel fell into (images smaller than the grid) take their left/lower neighbour. */
function fillGaps(h: Float32Array, counts: Float32Array, nx: number, ny: number): void {
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      if (counts[k]! > 0) continue
      h[k] = i > 0 ? h[k - 1]! : j > 0 ? h[k - nx]! : 0
    }
}

export const relief = defineFeature('relief', async (node, ctx) => {
  const { manifold: mf } = runtime()
  const own = <T extends CrossSection | Manifold>(x: T): T => ctx.track(x)
  const outline = own(outlineSection(node))
  let field = outline
  if (node.rim > 0) {
    field = own(outline.offset(-node.rim, 'Round', 2, SEGMENTS))
    if (field.isEmpty()) throw new Error(`A ${node.rim} mm rim leaves no room for the relief; make it narrower`)
  }

  const base = own(outline.extrude(node.baseThickness))
  const grid = await heightGrid(node, field, ctx)
  const z = new Float32Array(grid.h.length)
  for (let k = 0; k < z.length; k++) z[k] = node.baseThickness + node.depth * grid.h[k]!
  const slab = own(heightfieldSolid({ ...grid, z }, node.baseThickness - OVERLAP))
  const prism = own(own(field.extrude(node.depth + 2 * OVERLAP)).translate([0, 0, node.baseThickness - OVERLAP]))
  const parts: Manifold[] = [base, own(slab.intersect(prism))]
  if (node.rim > 0) {
    // The rim stands flush with the highest relief to protect it, its outer edge rounded.
    const rimTop = node.baseThickness + node.depth
    const inner = field
    parts.push(
      own(
        profiledSlab({
          outline,
          distance: new OutlineDistance(outline.toPolygons()),
          profile: edgeProfile('round', Math.min(0.3, node.rim * RIM_ROUND), rimTop, node.rim),
          to: node.rim,
          within: (s) => mf.CrossSection.difference(s, inner),
          segments: SEGMENTS,
          resolution: Math.max(0.1, Math.min(node.width, node.height) / 120),
        }),
      ),
    )
  }
  const body = own(mf.Manifold.union(parts))
  // Outline plane (x, y) and relief height z → x, z and depth toward −Y, back on y = 0.
  return { bodies: [{ solid: solidFromManifold(body.rotate([90, 0, 0])), ...metalOf(node) }] }
})
