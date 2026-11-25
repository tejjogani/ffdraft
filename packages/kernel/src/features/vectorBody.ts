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
import { edgeProfile, flatProfile, membraneDome, profiledSlab } from '../mesh/outline/profile'
import { SHAPES } from '../mesh/outline/shapes'
import {
  joinIslands,
  MIN_STROKE,
  TIE_WIDTH,
  thickenStrokes,
  underline,
} from '../mesh/outline/stroke'
import { type Contour, parseSvgPath } from '../mesh/outline/svgPath'
import type { PaveField } from '../mesh/pave/region'
import { canCompose, type FontId, loadFont, textOutline } from '../text'

type VectorBodyNode = NodeOf<'vectorBody'>

/** Segments per full circle for round offsets (≈ 0.01 mm chord on a 1 mm radius). */
const SEGMENTS = 64
/** Flattening tolerance relative to the outline's height before scaling. */
const RELATIVE_TOLERANCE = 2e-4
/** Corner radius of the named shapes relative to their height: crisp, but castable and polishable. */
const SHAPE_CORNER = 0.015
/**
 * The scaled outline is thinned to this deviation (mm), far below casting resolution: artwork
 * traced at thousands of points per millimetre would otherwise cost minutes in every offset.
 */
const OUTLINE_TOLERANCE = 0.005
/** The bar a name stands on (join: underline): this share of the height, and at least this deep, mm. */
const UNDERLINE_SHARE = 0.08
const UNDERLINE_MIN = 0.8
/** Depth of the bar a name of this height stands on, mm (the bail weighs it before offering it). */
export const underlineDepth = (height: number) => Math.max(UNDERLINE_MIN, UNDERLINE_SHARE * height)
/** Widest outline accepted (mm): a belt buckle or a large plaque, not an SVG drawn at the wrong scale. */
const MAX_WIDTH = 250
/** A domed field stays flatter than this radius, so ~2 mm melee still fit it (R/3 rule). */
const FIELD_MIN_RADIUS = 6
/**
 * Depth of the field below the rim: deep enough that melee crowns (≈0.15 d above the girdle)
 * sit below the rim's top, never more than a third of the body.
 */
const recessFor = (border: number, thickness: number) =>
  Math.min(Math.max(0.8 * border, 0.3), 0.6, thickness / 3)
/**
 * Cells the membrane dome is solved on at most. Its relaxation costs cells × width, so a 150 mm
 * plaque at the usual spacing took seconds per slider step; the dome is smooth (curvature
 * bounded by FIELD_MIN_RADIUS) and interpolated, so a coarser grid reads the same.
 */
const DOME_CELLS = 40_000
const domeSpacing = (field: CrossSection, resolution: number): number => {
  const { min, max } = field.bounds()
  return Math.max(resolution / 2, Math.sqrt(((max[0] - min[0]) * (max[1] - min[1])) / DOME_CELLS))
}
/** The rim's edge treatment takes at most this share of the border; the rest is at full height. */
const RIM_EDGE = 0.75

/** The source's filled area, y up, in source units (the caller owns it). */
async function sourceSection(
  source: VectorBodyNode['source'],
  height: number,
  ctx: BuildContext,
): Promise<CrossSection> {
  const { manifold: mf } = runtime()
  switch (source.type) {
    case 'shape':
      return new mf.CrossSection(
        parseSvgPath(SHAPES[source.shape], RELATIVE_TOLERANCE * 2),
        'NonZero',
      )
    case 'svg': {
      // Flatten once coarsely to learn the artwork's size, then at the tolerance its scale needs.
      const rough = artwork(source.d, 1)
      const ys = rough.flat().map((p) => p[1])
      const extent = Math.max(...ys) - Math.min(...ys) || 1
      const tolerance = Math.max(extent * RELATIVE_TOLERANCE, (0.002 * extent) / height)
      // SVG's y axis points down; the fill rule is SVG's default.
      const contours = artwork(source.d, tolerance).map((c) =>
        c.map(([x, y]): [number, number] => [x, -y]),
      )
      return new mf.CrossSection(contours, 'NonZero')
    }
    case 'text': {
      const text = await drawableText(source.text, source.font, ctx)
      const layout = await textOutline(text, source.font, height, height * RELATIVE_TOLERANCE * 5)
      // Each glyph fills even-odd on its own; overlapping glyphs (script joins) are unioned.
      const glyphs = layout.glyphs.map(
        (g) =>
          new mf.CrossSection(
            g.contours.map((c) => c.map(([x, y]): [number, number] => [x, y])),
            'EvenOdd',
          ),
      )
      try {
        return mf.CrossSection.union(glyphs)
      } finally {
        for (const g of glyphs) g.delete()
      }
    }
  }
}

/** The path's closed contours, with errors a designer can act on. */
function artwork(d: string, tolerance: number): Contour[] {
  let contours: Contour[]
  try {
    contours = parseSvgPath(d, tolerance)
  } catch (error) {
    throw new Error(`The SVG path cannot be read: ${(error as Error).message}`)
  }
  if (contours.length === 0)
    throw new Error('The SVG path has no closed area; draw a filled shape, not just a line')
  return contours
}

/** Letters with no canonical decomposition, and the base letter they are set with. */
const BASE_LETTER: Record<string, string> = { Ł: 'L', ł: 'l', Đ: 'D', đ: 'd', Ħ: 'H', ħ: 'h' }

/**
 * The text as the font can draw it. A character the font lacks would come out as its "missing
 * glyph" box — engraved into gold — so an accented letter is set as its base letter (Ż as Z)
 * and anything else is left out; either is an error, since the name has changed. Throws
 * when nothing is left.
 */
async function drawableText(text: string, font: FontId, ctx: BuildContext): Promise<string> {
  const face = await loadFont(font)
  const has = (c: string) => c === '\n' || face.charToGlyphIndex(c) !== 0
  const replaced = new Map<string, string>()
  const missing = new Set<string>()
  const composed = new Set<string>()
  const kept: string[] = []
  for (const c of Array.from(text)) {
    if (has(c)) {
      kept.push(c)
      continue
    }
    // Drawn from its base letter and the font's own marks (text.ts layoutText).
    if (canCompose(face, c)) {
      composed.add(c)
      kept.push(c)
      continue
    }
    const base = BASE_LETTER[c] ?? c.normalize('NFD').replace(/\p{M}/gu, '')
    if (base !== c && base !== '' && Array.from(base).every(has)) {
      replaced.set(c, base)
      kept.push(base)
    } else if (c.trim() !== '') missing.add(c)
  }
  const quote = (c: string) => `“${c}”`
  const list = [...missing].map(quote).join(' ')
  if (kept.join('').trim() === '')
    throw new Error(
      missing.size > 0
        ? `The ${font} font has no letters for ${list}; choose another font or other characters`
        : 'The text is empty',
    )
  if (composed.size > 0)
    ctx.report({
      level: 'info',
      code: 'text.composed',
      message: `The ${font} font has no ${[...composed].map(quote).join(' ')}, so ${composed.size > 1 ? 'they were' : 'it was'} composed from the base letter and the font's own accents; check the accents read as intended.`,
    })
  // An error, not a warning: a letter set as its base spells another name, which no customer
  // accepts. No bundled font has it and it cannot be composed, so there is no font to offer.
  if (replaced.size > 0)
    ctx.report({
      level: 'error',
      code: 'text.accentDropped',
      message: `The ${font} font has no ${[...replaced.keys()].map(quote).join(' ')}, so ${[...replaced].map(([c, b]) => `${quote(c)} was set as ${quote(b)}`).join(', ')}, and the name is no longer spelled as written; no bundled font has ${replaced.size > 1 ? 'these letters' : 'this letter'}, so use an outline (SVG) of the lettering for it.`,
    })
  if (missing.size > 0)
    ctx.report({
      level: 'error',
      code: 'text.missingGlyph',
      message: `The ${font} font has no letters for ${list}, so ${missing.size > 1 ? 'they were' : 'it was'} left out and the text no longer reads as written; choose other characters or another font.`,
    })
  return kept.join('')
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
  const own = <T extends CrossSection | Manifold>(x: T): T => ctx.track(x)
  let outline = own(await sourceSection(node.source, node.height, ctx))
  if (outline.isEmpty()) throw new Error('The outline encloses no area')
  const box = outline.bounds()
  const scale = node.height / (box.max[1] - box.min[1])
  const width = (box.max[0] - box.min[0]) * scale
  if (width > MAX_WIDTH)
    throw new Error(
      `At ${node.height} mm tall this outline is ${Math.round(width)} mm wide (at most ${MAX_WIDTH} mm); lower the height or check the artwork's proportions`,
    )
  outline = own(
    own(
      own(
        outline.translate([-(box.min[0] + box.max[0]) / 2, -(box.min[1] + box.max[1]) / 2]),
      ).scale(scale),
    ).simplify(OUTLINE_TOLERANCE),
  )
  if (node.source.type === 'shape') {
    // Soften corners (convex, then concave) by a radius proportional to the shape.
    const r = node.height * SHAPE_CORNER
    outline = own(
      own(own(outline.offset(-r, 'Round', 2, SEGMENTS)).offset(2 * r, 'Round', 2, SEGMENTS)).offset(
        -r,
        'Round',
        2,
        SEGMENTS,
      ),
    )
    // Softening shortens points (a star's tips, a heart's point): scale back to the height asked.
    const soft = outline.bounds()
    const back = node.height / (soft.max[1] - soft.min[1])
    if (Math.abs(back - 1) > 1e-6)
      outline = own(
        own(
          outline.translate([-(soft.min[0] + soft.max[0]) / 2, -(soft.min[1] + soft.max[1]) / 2]),
        ).scale(back),
      )
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
  if (node.source.type === 'text' && node.join !== 'off') {
    // Lettering must cast as one piece: on a bar under it, if the designer asked for one, and
    // then dots, accents and letters that still stand apart are tied on. Joining changes how
    // the name reads, so it is reported, with the way to turn it off.
    if (node.join === 'underline')
      outline = own(underline(outline, underlineDepth(node.height)))
    // Only an i or a j has a dot to set down onto its stem; every other mark is an accent.
    const tittles = /[ij]/.test(node.source.text)
    const joined = joinIslands(outline, TIE_WIDTH, SEGMENTS, tittles)
    if (joined) {
      outline = own(joined.section)
      ctx.report({
        level: 'info',
        code: 'outline.joined',
        message: `${joined.ties} loose part${joined.ties > 1 ? 's' : ''} of the lettering (dots, accents, letters that do not touch) ${joined.ties > 1 ? 'were' : 'was'} tied to the rest with ${TIE_WIDTH} mm links so it casts as one piece; set Join letters to off to leave ${joined.ties > 1 ? 'them' : 'it'} loose, or to underline to stand the letters on a bar.`,
        value: joined.ties,
      })
    }
  }
  reportPieces(outline, node, ctx)
  const bevel = fittedBevel(node, ctx)

  // Fine enough for the profile to read smoothly, coarse enough to stay interactive.
  const resolution = Math.min(Math.max(node.height / 90, 0.12), 0.6)
  const distance = new OutlineDistance(outline.toPolygons())
  const field = node.border > 0 ? borderField(outline, node, ctx) : null
  const slab = own(
    field
      ? borderedSlab(outline, distance, field, { ...node, bevelSize: bevel }, resolution)
      : profiledSlab({
          outline,
          distance,
          profile: edgeProfile(node.bevel, bevel, node.thickness, innerReach(outline, distance)),
          segments: SEGMENTS,
          resolution,
        }),
  )

  // Outline (u, v) and thickness z  →  x = u, z = v, front toward −Y with the back on y = 0.
  const body = slab.rotate([90, 0, 0])
  const data: { paveField?: PaveField } = {}
  if (field)
    data.paveField = {
      outline: field.toPolygons().map((c) => c.map(([u, v]) => [u, v])),
      rim: node.border,
    }
  return { bodies: [{ solid: solidFromManifold(body), ...metalOf(node) }], data }
})

/** Metal kept under the deepest point of an edge treatment, mm. */
const MIN_BASE = 0.3

/**
 * The bevel or pillow size the thickness allows (a dome may not reach through the back), with
 * a note when it is less than asked.
 */
function fittedBevel(node: VectorBodyNode, ctx: BuildContext): number {
  if (node.bevel === 'flat') return node.bevelSize
  // A pillow keeps MIN_BASE under its edge (inside a border, under the recessed field it
  // domes); a chamfer or round edge may take 90 % of the thickness, as edgeProfile allows.
  const room =
    node.bevel !== 'pillow'
      ? node.thickness * 0.9
      : (node.border > 0
          ? node.thickness - recessFor(node.border, node.thickness)
          : node.thickness) - MIN_BASE
  const fitted = Math.max(0, Math.min(node.bevelSize, room))
  if (fitted < node.bevelSize - 0.01)
    ctx.report({
      level: 'info',
      code: 'outline.bevelReduced',
      message: `A ${node.bevelSize} mm ${node.bevel} does not fit a ${node.thickness} mm plate${node.border > 0 ? ' with a recessed field' : ''}, so it was made ${fitted.toFixed(2)} mm.`,
      value: fitted,
      limit: node.bevelSize,
    })
  return fitted
}

/** The field inside a raised border, or null (with a warning) when the border fills the outline. */
function borderField(
  outline: CrossSection,
  node: VectorBodyNode,
  ctx: BuildContext,
): CrossSection | null {
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
  const rimProfile = edgeProfile(
    edge,
    Math.min(node.bevelSize, node.border * RIM_EDGE),
    node.thickness,
    node.border,
  )
  const floor = node.thickness - recessFor(node.border, node.thickness)
  const fieldDistance = new OutlineDistance(field.toPolygons())
  const fieldProfile =
    node.bevel === 'pillow'
      ? membraneDome(
          fieldDistance,
          field.bounds(),
          node.bevelSize,
          floor,
          FIELD_MIN_RADIUS,
          domeSpacing(field, resolution),
        )
      : flatProfile(floor)
  const rim = profiledSlab({
    outline,
    distance,
    profile: rimProfile,
    to: node.border,
    within: (s) => mf.CrossSection.difference(s, field),
    segments: SEGMENTS,
    resolution,
  })
  // The field slab reaches under the rim, as far as the rim stands at full height, so the two
  // overlap in volume: unioned while only touching along the field's wall, they leave sliver
  // shells and handles that tear apart under any later tolerance-based step.
  const under = field.offset(node.border * (1 - RIM_EDGE), 'Round', 2, SEGMENTS)
  const inner = profiledSlab({
    outline: under,
    distance: fieldDistance,
    profile: fieldProfile,
    segments: SEGMENTS,
    resolution,
  })
  try {
    return mf.Manifold.union(rim, inner)
  } finally {
    under.delete()
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
