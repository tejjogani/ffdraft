/** A single stone: nominal or measured dimensions, placed on a band, on a surface, or freely. */
import { GEM_CUTS, type GemCut, type GemDims, gemDims, type NodeOf } from '@pave/schema'
import { type BuildContext, defineFeature, type NodeResult, type Stone } from '../core'
import { seatCutter } from '../gems/cutter'
import { gemRatio, gemUnit } from '../gems/index'
import { ringSurfaceFrame } from '../geometry/ring'
import {
  addScaled,
  clamp,
  cross,
  DEG,
  dot,
  type Frame,
  frameFromZ,
  fromFrame,
  normalize,
  scale,
  spinFrame,
  sub,
  toFrame,
  transformFrame,
  WORLD,
} from '../geometry/vec'
import { RULES } from '../rules'
import { type ShankData, shankData } from './ringShank'

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

/**
 * What lies under a stone, measured in the stone's own frame (x, y across the girdle plane,
 * depths along −z). A setting uses it to run its claws or cup down into the host.
 */
export interface StoneHost {
  /** Depth below the girdle plane of the host's outer surface under (x, y); null: no metal there. */
  surfaceBelow(x: number, y: number): number | null
  /** Depth below the girdle plane at which the wearer's finger starts under (x, y). */
  floorBelow(x: number, y: number): number
  /** The point nearest (x, y) that has host metal under it, `margin` mm in from its edge. */
  over(x: number, y: number, margin: number): [number, number]
}

/** What a gem publishes for the features that hold or surround it. */
export interface GemData {
  kind: 'gem'
  host: StoneHost | null
}

export function gemData(result: NodeResult): GemData {
  const data = result.data as GemData | undefined
  if (data?.kind !== 'gem') throw new Error(`“${result.id}” is not a stone`)
  return data
}

/** The band under a stone, seen from the stone's frame (both in the band's own space). */
function ringHost(shank: ShankData, local: Frame): StoneHost {
  const ringCoordinates = (x: number, y: number, depth: number) => {
    const p = fromFrame(local, [x, y, -depth])
    return { theta: Math.atan2(p[0], p[2]), a: p[1], r: Math.hypot(p[0], p[2]) }
  }
  const hasMetal = (theta: number, a: number): boolean =>
    Math.abs(a) < shank.width(theta) / 2 && Math.abs(a) >= shank.gap(theta) / 2
  return {
    surfaceBelow(x, y) {
      // Height above the band's surface falls monotonically with depth: bisect for zero.
      const height = (depth: number) => {
        const c = ringCoordinates(x, y, depth)
        return hasMetal(c.theta, c.a) ? c.r - shank.outer(c.theta, c.a).radius : null
      }
      let lo = -20
      let hi = Math.hypot(local.origin[0], local.origin[2]) - shank.innerRadius
      if (height(hi) === null || (height(hi) ?? 1) > 0) return null
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2
        const h = height(mid)
        if (h === null || h > 0) lo = mid
        else hi = mid
      }
      return hi
    },
    floorBelow(x, y) {
      // Bisect for the depth where the radius equals the finger's.
      let lo = -20
      let hi = Math.hypot(local.origin[0], local.origin[2])
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2
        if (ringCoordinates(x, y, mid).r > shank.innerRadius) lo = mid
        else hi = mid
      }
      return hi
    },
    over(x, y, margin) {
      // Only the position along the finger can leave the band; pull that back inside.
      const c = ringCoordinates(x, y, 0)
      const half = Math.max(0, shank.width(c.theta) / 2 - margin)
      const gap = shank.gap(c.theta) / 2
      let a = clamp(c.a, -half, half)
      if (Math.abs(a) < gap + margin) a = (a < 0 ? -1 : 1) * Math.min(half, gap + margin)
      const moved = toFrame(local, [c.r * Math.sin(c.theta), a, c.r * Math.cos(c.theta)])
      return [moved[0], moved[1]]
    },
  }
}

function ringTopFrame(
  node: GemNode,
  dims: GemDims,
  ctx: BuildContext,
): { frame: Frame; host: StoneHost } {
  const placement = node.placement as Extract<GemNode['placement'], { type: 'ringTop' }>
  const host = ctx.input(placement.shank)
  const shank = shankData(host)
  const theta = placement.angle * DEG
  const girdle = shank.innerRadius + placement.elevation + culetDepth(node.cut, dims)
  const local = spinFrame(ringSurfaceFrame(theta, 0, girdle), placement.spin * DEG)
  const frame = transformFrame(host.matrix, local)

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
      fix: {
        label: `Raise the stone to ${RULES.culetClearance} mm above the finger`,
        ops: [
          { t: 'update', id: node.id, patch: { placement: { elevation: RULES.culetClearance } } },
        ],
      },
    })
  return { frame, host: ringHost(shank, local) }
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
  const onRing = node.placement.type === 'ringTop' ? ringTopFrame(node, dims, ctx) : null
  const frame =
    onRing?.frame ??
    (node.placement.type === 'surface'
      ? surfaceFrame(node, ctx)
      : frameFromZ(WORLD.origin, WORLD.z, WORLD.x))
  const stone: Stone = {
    cut: node.cut,
    stone: node.stone,
    dims,
    frame,
    role: 'center',
    setting: node.placement.type === 'surface' ? 'flush' : 'loose',
  }
  if (
    node.lw !== undefined &&
    node.lw !== 1 &&
    Math.abs(node.lw - gemRatio(node.cut, node.lw)) > 1e-6 &&
    !node.sourcing?.measured
  )
    ctx.report({
      level: 'info',
      code: 'stone.ratio',
      message: `${cut.label} stones are cut between ${cut.lw.min} and ${cut.lw.max} length : width; using ${gemRatio(node.cut, node.lw)}.`,
    })
  return {
    stones: [stone],
    frames: { stone: frame },
    data: { kind: 'gem', host: onRing?.host ?? null } satisfies GemData,
    // A stone sunk into a surface needs the opening above its girdle cleared; a stone in a head
    // only needs its own shape removed, which leaves claws and bezel lips over the crown.
    cuts:
      ctx.detail === 'production'
        ? [
            {
              solid: seatCutter(
                stone,
                node.placement.type === 'surface' ? { open: dims.depth } : {},
              ),
              targets: 'all',
            },
          ]
        : [],
  }
})
