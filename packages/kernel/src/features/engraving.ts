/**
 * Text cut into (or raised from) a body: wrapped around the inside or outside of a band, or
 * laid on the flat front or back of a piece. Engraving is a cut at production detail; embossing
 * adds metal to the host.
 */
import type { NodeOf } from '@pave/schema'
import type { Manifold } from 'manifold-3d'
import {
  type BuildContext,
  defineFeature,
  type NodeResult,
  runtime,
  solidFromManifold,
} from '../core'
import { ringPoint } from '../geometry/ring'
import { DEG, transformPoint, type Vec3 } from '../geometry/vec'
import { RULES } from '../rules'
import { unionBounds } from '../solid/meshing'
import { type TextOutline, textOutline } from '../text'
import { shankData } from './ringShank'

type EngravingNode = NodeOf<'engraving'>

/** Extra reach of a cutter above the surface, and of raised text below it, so booleans are clean. */
const MARGIN = 0.3
const ROOT = 0.05

/**
 * The text as a slab in its own space: x along the baseline and y up, both centred on the
 * block; z from `from` to `to`, positive toward the reader.
 */
function textSlab(outline: TextOutline, size: number, from: number, to: number): Manifold {
  const { manifold: mf } = runtime()
  const lines = Math.max(...outline.glyphs.map((g) => g.line)) + 1
  const middle = (size - (lines - 1) * outline.lineHeight) / 2
  const glyphs = outline.glyphs.map(
    (g) => new mf.CrossSection(g.contours as [number, number][][], 'EvenOdd'),
  )
  const all = mf.CrossSection.union(glyphs)
  const slab = all.extrude(to - from)
  // Fine enough to follow a band's curvature once wrapped.
  const refined = slab.refineToLength(0.4)
  const placed = refined.translate([-outline.width / 2, -middle, from])
  for (const temporary of [...glyphs, all, slab, refined]) temporary.delete()
  return placed
}

/** Maps slab coordinates onto the host: around a band, or onto a flat face. */
function placement(node: EngravingNode, host: NodeResult): (p: Vec3) => Vec3 {
  if (node.where === 'insideBand' || node.where === 'outsideBand') {
    const shank = shankData(host)
    const centre = node.angle * DEG
    const inside = node.where === 'insideBand'
    // Read from where the surface faces: outside text runs with θ, inside text against it.
    const reference = inside ? shank.innerRadius : shank.outer(centre).radius
    return ([x, y, z]) => {
      const theta = centre + ((inside ? -1 : 1) * x) / reference
      const r = inside ? shank.innerRadius - z : shank.outer(theta, y).radius + z
      return transformPoint(host.matrix, ringPoint(theta, y, r))
    }
  }
  if (host.bodies.length === 0) throw new Error('the body to engrave has no solid')
  const bounds = unionBounds(host.bodies.map((b) => b.solid.bounds()))
  const cx = (bounds.min[0] + bounds.max[0]) / 2
  const cz = (bounds.min[2] + bounds.max[2]) / 2
  // Flat pieces face −Y: the front is read looking along +Y, the back looking along −Y.
  return node.where === 'front'
    ? ([x, y, z]) => [cx + x, bounds.min[1] - z, cz + y]
    : ([x, y, z]) => [cx - x, bounds.max[1] + z, cz + y]
}

function check(node: EngravingNode, ctx: BuildContext): void {
  if (node.mode === 'engrave' && node.depth > RULES.engravingDepth.max)
    ctx.report({
      level: 'warning',
      code: 'engraving.deep',
      message: `Engraving ${node.depth.toFixed(2)} mm deep will not cast cleanly; keep it to ${RULES.engravingDepth.max} mm.`,
      value: node.depth,
      limit: RULES.engravingDepth.max,
      fix: {
        label: `Engrave ${RULES.engravingDepth.max} mm deep`,
        ops: [{ t: 'update', id: node.id, patch: { depth: RULES.engravingDepth.max } }],
      },
    })
}

/** Share of a band's round that wrapped text may take, leaving a gap between its ends. */
const MAX_WRAP = 0.97

/**
 * Text longer than the round it wraps laps over itself (and the overlap cuts through the band).
 * Says so with a size that fits; returns false when the text cannot be wrapped.
 */
function fitsAround(
  node: EngravingNode,
  host: NodeResult,
  width: number,
  ctx: BuildContext,
): boolean {
  if (node.where !== 'insideBand' && node.where !== 'outsideBand') return true
  const shank = shankData(host)
  const radius =
    node.where === 'insideBand' ? shank.innerRadius : shank.outer(node.angle * DEG).radius
  const room = MAX_WRAP * 2 * Math.PI * radius
  if (width <= room) return true
  const size = Math.floor(((node.size * room) / width) * 10) / 10
  ctx.report({
    level: 'error',
    code: 'engraving.tooLong',
    message: `The text is ${width.toFixed(1)} mm long, more than the ${room.toFixed(1)} mm around the ${node.where === 'insideBand' ? 'inside' : 'outside'} of the band, so it would lap over itself; shorten it or use letters ${size} mm tall.`,
    value: width,
    limit: room,
    ...(size > 0 && {
      fix: {
        label: `Letters ${size} mm tall`,
        ops: [{ t: 'update', id: node.id, patch: { size } }],
      },
    }),
  })
  return false
}

export const engraving = defineFeature('engraving', async (node, ctx) => {
  const host = ctx.input(node.host)
  const place = placement(node, host)
  check(node, ctx)
  const emboss = node.mode === 'emboss'
  if (node.text.trim() === '') return {}
  // Laid out at every detail, so a text too long for its band is reported while designing.
  const outline = await textOutline(node.text, node.font, node.size, ctx.quality.chord)
  if (outline.glyphs.length === 0 || !fitsAround(node, host, outline.width, ctx)) return {}
  if (!emboss && ctx.detail !== 'production') return {}
  const slab = ctx.track(
    emboss
      ? textSlab(outline, node.size, -ROOT, node.depth)
      : textSlab(outline, node.size, -node.depth, MARGIN),
  )
  const wrapped = slab.warp((vertex) => {
    const p = place([vertex[0], vertex[1], vertex[2]])
    vertex[0] = p[0]
    vertex[1] = p[1]
    vertex[2] = p[2]
  })
  const solid = solidFromManifold(wrapped)
  return emboss
    ? { additions: [{ solid, target: node.host }] }
    : { cuts: [{ solid, targets: [node.host] }] }
})
