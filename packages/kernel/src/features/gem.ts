/** A single stone: nominal or measured dimensions, placed on a band, on a surface, or freely. */
import { GEM_CUTS, type GemCut, type GemDims, type NodeOf, gemDims } from '@pave/schema'
import { type BuildContext, type Stone, defineFeature } from '../core'
import { seatCutter } from '../gems/cutter'
import { gemRatio, gemUnit } from '../gems/index'
import { ringSurfaceFrame } from '../geometry/ring'
import {
  DEG,
  type Frame,
  WORLD,
  cross,
  frameFromZ,
  normalize,
  spinFrame,
  sub,
  transformFrame,
  addScaled,
  dot,
  scale,
} from '../geometry/vec'
import { RULES } from '../rules'
import { shankData } from './ringShank'

type GemNode = NodeOf<'gem'>

/** The stone's real size: the measured stone when one has been sourced, else the cut's nominal. */
export function stoneDims(node: Pick<GemNode, 'cut' | 'width' | 'lw' | 'sourcing'>): GemDims {
  const measured = node.sourcing?.measured
  if (measured) {
    // Length ≥ width by convention, whichever way round the lab reported them.
    return {
      length: Math.max(measured.length, measured.width),
      width: Math.min(measured.length, measured.width),
      depth: measured.depth,
    }
  }
  return gemDims(node.cut, node.width, gemRatio(node.cut, node.lw))
}

/** Distance from the girdle plane down to the culet for a stone of these dimensions. */
export function culetDepth(cut: GemNode['cut'], dims: GemDims): number {
  const unit = gemUnit(cut, dims.length / dims.width)
  return (-unit.bottom / unit.depth) * dims.depth
}

function ringTopFrame(node: GemNode, dims: GemDims, ctx: BuildContext): Frame {
  const placement = node.placement as Extract<GemNode['placement'], { type: 'ringTop' }>
  const host = ctx.input(placement.shank)
  const shank = shankData(host)
  const theta = placement.angle * DEG
  const girdle = shank.innerRadius + placement.elevation + culetDepth(node.cut, dims)
  const frame = transformFrame(host.matrix, spinFrame(ringSurfaceFrame(theta, 0, girdle), placement.spin * DEG))

  const bandWidth = shank.width(theta)
  if (dims.length > bandWidth * 4 && placement.elevation < 0.3)
    ctx.report({
      level: 'info',
      code: 'stone.overhang',
      message: `The stone is ${dims.length.toFixed(1)} mm long on a ${bandWidth.toFixed(1)} mm band and sits almost on the finger.`,
      at: [...frame.origin],
    })
  if (placement.elevation < RULES.culetClearance)
    ctx.report({
      level: placement.elevation <= 0 ? 'error' : 'warning',
      code: 'culet.low',
      message:
        placement.elevation <= 0
          ? 'The culet touches the finger.'
          : `Only ${placement.elevation.toFixed(2)} mm between the culet and the finger; leave at least ${RULES.culetClearance} mm.`,
      value: placement.elevation,
      limit: RULES.culetClearance,
      at: [...addScaled(frame.origin, frame.z, -culetDepth(node.cut, dims))],
    })
  return frame
}

function surfaceFrame(node: GemNode, ctx: BuildContext): Frame {
  const placement = node.placement as Extract<GemNode['placement'], { type: 'surface' }>
  ctx.input(placement.host)
  const normal = normalize(placement.normal)
  const origin = addScaled(placement.point, normal, -placement.inset)
  // Long stones stand upright on a face that looks sideways, and point along Y when it looks up.
  const up: [number, number, number] = Math.abs(normal[2]) > 0.95 ? [0, 1, 0] : [0, 0, 1]
  const y = normalize(sub(up, scale(normal, dot(up, normal))))
  return spinFrame({ origin, x: cross(y, normal), y, z: normal }, placement.spin * DEG)
}

export const gem = defineFeature('gem', (node, ctx) => {
  const dims = stoneDims(node)
  const cut: GemCut = GEM_CUTS[node.cut]
  const frame =
    node.placement.type === 'ringTop'
      ? ringTopFrame(node, dims, ctx)
      : node.placement.type === 'surface'
        ? surfaceFrame(node, ctx)
        : frameFromZ(WORLD.origin, WORLD.z, WORLD.x)
  const stone: Stone = {
    cut: node.cut,
    stone: node.stone,
    dims,
    frame,
    role: 'center',
    setting: node.placement.type === 'surface' ? 'flush' : 'loose',
  }
  if (node.lw !== undefined && node.lw !== 1 && Math.abs(node.lw - gemRatio(node.cut, node.lw)) > 1e-6 && !node.sourcing?.measured)
    ctx.report({
      level: 'info',
      code: 'stone.ratio',
      message: `${cut.label} stones are cut between ${cut.lw.min} and ${cut.lw.max} length : width; using ${gemRatio(node.cut, node.lw)}.`,
    })
  return {
    stones: [stone],
    frames: { stone: frame },
    // A stone sunk into a surface needs the opening above its girdle cleared; a stone in a head
    // only needs its own shape removed, which leaves claws and bezel lips over the crown.
    cuts:
      ctx.detail === 'production'
        ? [{ solid: seatCutter(stone, node.placement.type === 'surface' ? { open: dims.depth } : {}), targets: 'all' }]
        : [],
  }
})
