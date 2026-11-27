/** A single stone: nominal or measured dimensions, placed on a band, on a surface, or freely. */
import {
  flatBacked,
  GEM_CUTS,
  type GemCut,
  type GemDims,
  measuredUsable,
  type NodeOf,
  originalGemFit,
  stoneDims as schemaStoneDims,
} from '@pave/schema'
import { type BuildContext, defineFeature, type NodeResult, type Stone } from '../core'
import { hashString } from '../evaluate/hash'
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
  frameMatrix,
  fromFrame,
  multiply,
  normalize,
  scale,
  spinFrame,
  sub,
  toFrame,
  transformFrame,
  WORLD,
} from '../geometry/vec'
import { RULES } from '../rules'
import { keepsNativeSurface, sourceOf, sourceToGirdle } from './imported-source'
import { type ShankData, shankData } from './ringShank'

type GemNode = NodeOf<'gem'>

/**
 * The stone's real size: the measured stone when one has been sourced, else the cut's nominal.
 * One definition, in @pave/schema, which the mount rules size heads and side stones from too.
 */
export const stoneDims = schemaStoneDims

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
  /** How the stone is placed: on a band, sunk into a surface, or free in space. */
  placement: GemNode['placement']['type']
  /** The alloy of the band under a ring-top stone (a head of another alloy needs its own base). */
  hostMaterial?: string
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
      // Off the open gap of a split shank (a solid band has none to keep off).
      if (gap > 0 && Math.abs(a) < gap + margin) a = (a < 0 ? -1 : 1) * Math.min(half, gap + margin)
      const moved = toFrame(local, [c.r * Math.sin(c.theta), a, c.r * Math.cos(c.theta)])
      return [moved[0], moved[1]]
    },
  }
}

function ringTopFrame(
  node: GemNode,
  dims: GemDims,
  ctx: BuildContext,
): { frame: Frame; host: StoneHost; material: string | undefined } {
  const placement = node.placement as Extract<GemNode['placement'], { type: 'ringTop' }>
  const host = ctx.input(placement.shank)
  const shank = shankData(host)
  const theta = (placement.angle ?? 0) * DEG
  const culet = culetDepth(node.cut, dims)
  // A flat back (a cabochon) has no culet to keep off the finger: it rests on the band's
  // surface instead of hanging at the clearance above the finger, inside the metal.
  const girdle = Math.max(
    shank.innerRadius + placement.elevation + culet,
    flatBacked(node.cut) ? shank.outer(theta).radius + culet : -Infinity,
  )
  const local = spinFrame(ringSurfaceFrame(theta, 0, girdle), placement.spin * DEG)
  const frame = transformFrame(host.matrix, local)

  // What actually lies between the stone's lowest point and the finger (a cabochon resting on
  // the band has more than its elevation asks for).
  const clearance = girdle - culet - shank.innerRadius
  const bandWidth = shank.width(theta)
  if (dims.length > bandWidth * 4 && clearance < 0.3)
    ctx.report({
      level: 'info',
      code: 'stone.overhang',
      message: `The stone is ${dims.length.toFixed(1)} mm long on a ${bandWidth.toFixed(1)} mm band and sits almost on the finger.`,
      at: [...frame.origin],
    })
  if (clearance < RULES.culetClearance)
    ctx.report({
      level: clearance <= 0 ? 'error' : 'warning',
      code: 'culet.low',
      message:
        clearance <= 0
          ? 'The culet touches the finger.'
          : `Only ${clearance.toFixed(2)} mm between the culet and the finger; leave at least ${RULES.culetClearance} mm.`,
      value: clearance,
      limit: RULES.culetClearance,
      at: [...addScaled(frame.origin, frame.z, -culet)],
      fix: {
        label: `Raise the stone to ${RULES.culetClearance} mm above the finger`,
        ops: [
          { t: 'update', id: node.id, patch: { placement: { elevation: RULES.culetClearance } } },
        ],
      },
    })
  return { frame, host: ringHost(shank, local), material: host.bodies[0]?.material }
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
  const source = sourceOf(node, ctx)
  const fit = node.placement.type === 'free' ? originalGemFit(node) : undefined
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
  if (fit && source?.bodies[0]) {
    const scale = 1 / dims.width
    const local = multiply(
      frameMatrix(WORLD, [scale, scale, scale]),
      sourceToGirdle(fit.transform ?? node.transform),
    )
    const mesh = source.bodies[0].solid.transformed(local).tessellate(ctx.quality).mesh
    stone.imported = {
      mesh,
      width: dims.width,
      key: `import-${source.hash}-${hashString(local.join(','))}`,
      ...(keepsNativeSurface(source) && {
        native: { nodeId: source.id, matrix: multiply(local, source.matrix) },
      }),
    }
  }
  const measured = node.sourcing?.measured
  if (measured && !measuredUsable(measured))
    ctx.report({
      level: 'warning',
      code: 'stone.measured',
      message: `The measured size of the sourced stone (${measured.length} × ${measured.width} × ${measured.depth} mm) is not usable; the nominal ${cut.label.toLowerCase()} size is used.`,
    })
  if (
    node.lw !== undefined &&
    Math.abs(node.lw - gemRatio(node.cut, node.lw)) > 1e-6 &&
    !measuredUsable(measured) &&
    !fit
  )
    ctx.report({
      level: 'info',
      code: 'stone.ratio',
      message: `${cut.label} stones are cut between ${cut.lw.min} and ${cut.lw.max} length : width; using ${gemRatio(node.cut, node.lw)}.`,
    })
  return {
    stones: [stone],
    frames: { stone: frame },
    data: {
      kind: 'gem',
      host: onRing?.host ?? null,
      placement: node.placement.type,
      ...(onRing?.material ? { hostMaterial: onRing.material } : {}),
    } satisfies GemData,
    // A stone sunk into a surface needs the opening above its girdle cleared; a stone in a head
    // only needs its own shape removed, which leaves claws and bezel lips over the crown.
    cuts:
      ctx.detail === 'production' && !stone.imported
        ? [
            {
              solid: seatCutter(
                stone,
                node.placement.type === 'surface' ? { open: dims.depth } : {},
              ),
              targets: 'all',
              ...(node.importSourceId && { importSeatGem: node.id }),
            },
          ]
        : [],
  }
})
