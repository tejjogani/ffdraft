/**
 * The head that holds one stone: claws, a basket (claws joined by gallery rails), a full or
 * half bezel, or a flush seat.
 *
 * Everything is measured from the stone's true outline, so claws land on the points of a pear
 * or the corners of a princess and a bezel hugs any cut. When the stone sits on a band the
 * head's metal runs down into the band; a free-standing head gets a base ring instead.
 */
import type { NodeOf } from '@pave/schema'
import { type Body, type BuildContext, type Cut, defineFeature, metalOf, type Solid } from '../core'
import { seatCutter } from '../gems/cutter'
import { prongDirections, type StoneShape, stoneShape } from '../gems/shape'
import {
  arcSegment,
  circleLoop,
  type Loop,
  lineSegment,
  roundedRectLoop,
  scaleLoop,
} from '../geometry/loop'
import { pathFrames } from '../geometry/path'
import { placeLoop, poleSection, sweepSolid } from '../geometry/sweep'
import {
  addScaled,
  clamp,
  DEG,
  lerp,
  lerp3,
  normalize,
  scale,
  sub,
  type Vec2,
  type Vec3,
} from '../geometry/vec'
import { RULES } from '../rules'
import { gemData, type StoneHost } from './gem'

type SettingNode = NodeOf<'setting'>

/** How far a claw's root is buried in the band, mm. */
const ROOT_SINK = 0.5
/** Metal kept between the lowest point of a head and the finger, mm. */
const FINGER_CLEARANCE = 0.25

interface Head {
  shape: StoneShape
  host: StoneHost | null
  taper: number
}

/** The straight run from the girdle down to where a piece of the head ends. */
interface Leg {
  /** At girdle height, `standoff` outside the girdle. */
  top: Vec3
  /** Where it ends: inside the band, or on the base ring of a free-standing head. */
  base: Vec3
}

function legAt(head: Head, phi: number, standoff: number, margin: number): Leg {
  const { shape, host } = head
  const g = shape.point(phi)
  const n = shape.normal(phi)
  const top: Vec3 = [g[0] + n[0] * standoff, g[1] + n[1] * standoff, 0]
  let bx = shape.centre[0] + (top[0] - shape.centre[0]) * (1 - head.taper)
  let by = shape.centre[1] + (top[1] - shape.centre[1]) * (1 - head.taper)
  let depth = -shape.culet + 0.35
  if (host) {
    ;[bx, by] = host.over(bx, by, margin)
    const surface = host.surfaceBelow(bx, by)
    const floor = host.floorBelow(bx, by) - FINGER_CLEARANCE
    depth = Math.max(
      surface === null ? floor : Math.min(surface + ROOT_SINK, floor),
      -shape.girdleBottom + 0.3,
    )
  }
  return { top, base: [bx, by, -depth] }
}

const world = (shape: StoneShape, points: readonly Vec3[]): Vec3[] =>
  points.map((p) => shape.toWorld(p))

// ── Claws ────────────────────────────────────────────────────────────────────────────────────

interface ProngStyle {
  /** Section at full size: x is radial (away from the stone), y along the girdle. */
  loop: Loop
  /** Half the section's radial thickness: how far the claw's axis stands off the girdle. */
  radius: number
  /** How deep the claw bites over the girdle edge. */
  overlap: number
  /** Stations up the crown: fraction of the crown height and section scale. */
  crown: readonly (readonly [number, number])[]
  /** How the claw ends above its last station. */
  end: 'dome' | 'point' | 'flat'
}

function prongStyle(node: SettingNode, onPoint: boolean): ProngStyle {
  const d = node.prongDiameter
  const overlap = RULES.prongOverlap(d)
  if (onPoint)
    // A V-claw: wide enough to wrap the point, biting deeper so the tip is fully covered.
    return {
      loop: roundedRectLoop(d * 0.9, d * 1.7, d * 0.3),
      radius: d * 0.45,
      overlap: Math.max(overlap, d * 0.3),
      crown: [
        [0.25, 1],
        [0.45, 0.92],
      ],
      end: 'flat',
    }
  switch (node.prongTip) {
    case 'claw':
      return {
        loop: circleLoop(d / 2),
        radius: d / 2,
        overlap,
        crown: [
          [0.3, 0.9],
          [0.6, 0.65],
          [0.82, 0.42],
        ],
        end: 'point',
      }
    case 'tab':
      return {
        loop: roundedRectLoop(d * 0.65, d * 1.5, d * 0.2),
        radius: d * 0.325,
        overlap,
        crown: [
          [0.25, 1],
          [0.5, 0.95],
        ],
        end: 'flat',
      }
    case 'double':
      return {
        loop: circleLoop(d * 0.31),
        radius: d * 0.31,
        overlap,
        crown: [
          [0.25, 1],
          [0.5, 1],
        ],
        end: 'dome',
      }
    default:
      return {
        loop: circleLoop(d / 2),
        radius: d / 2,
        overlap,
        crown: [
          [0.25, 1],
          [0.5, 1],
        ],
        end: 'dome',
      }
  }
}

/** One claw: up the leg, past the girdle, then leaning in over the crown. */
function prong(head: Head, phi: number, style: ProngStyle, sideways: number): Solid {
  const { shape } = head
  const n = shape.normal(phi)
  const tangent: Vec2 = [-n[1], n[0]]
  const leg = legAt(head, phi, style.radius - style.overlap, style.radius + 0.1)
  const shift = (p: Vec3): Vec3 => [
    p[0] + tangent[0] * sideways,
    p[1] + tangent[1] * sideways,
    p[2],
  ]

  // Axis points and section scales, from the root upward. Roots are a little stouter.
  const axis: Vec3[] = []
  const sizes: number[] = []
  for (const t of [1, 0.55, 0.2]) {
    axis.push(shift(lerp3(leg.top, leg.base, t)))
    sizes.push(1 + 0.2 * t)
  }
  axis.push(shift(leg.top))
  sizes.push(1)
  const crownHeight = shape.table - shape.girdleTop
  for (const [f, size] of style.crown) {
    const z = shape.girdleTop + f * crownHeight
    const s = shape.silhouette(phi, z)
    const off = style.radius * size - style.overlap
    axis.push(shift([s[0] + n[0] * off, s[1] + n[1] * off, z]))
    sizes.push(size)
  }

  const points = world(shape, axis)
  const outward = sub(shape.toWorld([n[0], n[1], 0]), shape.toWorld([0, 0, 0]))
  const frames = pathFrames(points, { closed: false, side: outward })
  const sections = frames.map((frame, i) => placeLoop(frame, scaleLoop(style.loop, sizes[i]!)))

  const last = frames[frames.length - 1]!
  const lastSize = sizes[sizes.length - 1]!
  if (style.end === 'dome') {
    // A hemisphere: rings shrinking along a quarter circle, closed by a pole.
    for (const a of [30, 60]) {
      const origin = addScaled(last.origin, last.z, style.radius * lastSize * Math.sin(a * DEG))
      sections.push(
        placeLoop({ ...last, origin }, scaleLoop(style.loop, lastSize * Math.cos(a * DEG))),
      )
    }
    sections.push(
      poleSection(addScaled(last.origin, last.z, style.radius * lastSize), style.loop.length),
    )
  } else if (style.end === 'point') {
    // The tip comes to rest on the crown, just short of the table.
    const z = shape.girdleTop + 0.95 * crownHeight
    const s = shape.silhouette(phi, z)
    sections.push(poleSection(shape.toWorld(shift([s[0], s[1], z + 0.02])), style.loop.length))
  }
  return sweepSolid({ closed: false, sections })
}

function prongs(node: SettingNode, head: Head): Solid[] {
  const directions = prongDirections(head.shape, node.prongCount, node.prongSpin * DEG)
  return directions.flatMap(({ phi, point }) => {
    const style = prongStyle(node, point)
    const pair = !point && node.prongTip === 'double'
    return (pair ? [-0.4, 0.4] : [0]).map((k) => prong(head, phi, style, k * node.prongDiameter))
  })
}

// ── Rails ────────────────────────────────────────────────────────────────────────────────────

/**
 * A wire ring that follows the stone's outline at `depth` below the girdle plane, passing
 * through the axes of claws with the given standoff.
 */
function rail(head: Head, depth: number, standoff: number, wire: number): Solid {
  const { shape } = head
  const poly = shape.polygon(6)
  const path = poly.phis.map((phi) => {
    const leg = legAt(head, phi, standoff, wire / 2 + 0.1)
    const t = clamp((depth - -leg.top[2]) / Math.max(1e-6, -leg.base[2] - -leg.top[2]), 0, 1)
    const p = lerp3(leg.top, leg.base, t)
    return [p[0], p[1], -depth] as Vec3
  })
  const up = normalize(sub(shape.toWorld([0, 0, 1]), shape.toWorld([0, 0, 0])))
  const frames = pathFrames(world(shape, path), { closed: true, up, kinks: poly.corners })
  return sweepSolid({
    closed: true,
    kinks: poly.corners,
    sections: frames.map((frame) => placeLoop(frame, circleLoop(wire / 2))),
  })
}

/** Depth of the lowest claw root: where a free-standing head's base ring goes. */
const baseDepth = (head: Head, standoff: number): number =>
  Math.max(...head.shape.polygon(2).phis.map((phi) => -legAt(head, phi, standoff, 0.3).base[2]))

// ── Bezels ───────────────────────────────────────────────────────────────────────────────────

/**
 * Bezel wall in (u, v): u outward from the girdle, v up the stone's axis. The lip leans over the
 * girdle edge; below the girdle a bearing ledge steps in for the stone to sit on.
 */
function bezelLoop(
  wall: number,
  top: number,
  ledgeTop: number,
  bottom: number,
  ledge: number,
): Loop {
  const lip = 0.12
  // The cup narrows toward its base (about 8°), as a bezel turned from tapered tube does.
  const inset = Math.min(0.14 * (top - bottom), ledge + wall - 0.3)
  const r = Math.min(0.3 * wall, 0.15)
  const r2 = Math.min(0.06, (wall + lip) * 0.2)
  const q = Math.PI / 2
  return [
    lineSegment([-ledge - inset, bottom], [wall - inset, bottom]),
    lineSegment([wall - inset, bottom], [wall, top - r]),
    arcSegment([wall - r, top - r], r, 0, q),
    lineSegment([wall - r, top], [-lip + r2, top]),
    arcSegment([-lip + r2, top - r2], r2, q, 2 * q),
    lineSegment([-lip, top - r2], [-lip, ledgeTop]),
    // The bearing: a 45° seat for the pavilion just under the girdle.
    lineSegment([-lip, ledgeTop], [-ledge, ledgeTop - (ledge - lip)]),
    lineSegment([-ledge, ledgeTop - (ledge - lip)], [-ledge - inset, bottom]),
  ]
}

function bezelDepth(head: Head): number {
  const { shape, host } = head
  if (!host) return -shape.culet + 0.3
  // Stop short of the finger at the lowest point under the stone.
  const floor = Math.min(...shape.polygon(4).points.map(([x, y]) => host.floorBelow(x, y)))
  return Math.max(floor - FINGER_CLEARANCE, -shape.girdleBottom + 0.6)
}

function bezel(
  node: SettingNode,
  head: Head,
  arcs: readonly (readonly [number, number])[] | null,
): Solid[] {
  const { shape } = head
  const crownHeight = shape.table - shape.girdleTop
  const top = shape.girdleTop + clamp(0.3 * crownHeight, 0.2, 0.6)
  const depth = bezelDepth(head)
  const ledge = Math.min(0.4, 0.12 * shape.stone.dims.width + 0.12)
  const loop = bezelLoop(node.wall, top, shape.girdleBottom - 0.05, -depth, ledge)
  const up = normalize(sub(shape.toWorld([0, 0, 1]), shape.toWorld([0, 0, 0])))
  const wallAlong = (phis: readonly number[], kinks: readonly number[], closed: boolean): Solid => {
    const path = world(
      shape,
      phis.map((phi) => [...shape.point(phi), 0] as unknown as Vec3),
    )
    const frames = pathFrames(path, { closed, up, kinks })
    return sweepSolid({ closed, kinks, sections: frames.map((frame) => placeLoop(frame, loop)) })
  }
  if (!arcs) {
    const poly = shape.polygon(8)
    return [wallAlong(poly.phis, poly.corners, true)]
  }
  const corners = shape.unit.outline.corners
  const solids = arcs.map(([from, to]) => {
    const steps = 14
    const phis = Array.from({ length: steps + 1 }, (_, i) => from + ((to - from) * i) / steps)
    // Corners inside the arc become exact, creased stations.
    for (const c of corners)
      for (const turn of [-2 * Math.PI, 0, 2 * Math.PI])
        if (c + turn > from + 0.05 && c + turn < to - 0.05) phis.push(c + turn)
    phis.sort((a, b) => a - b)
    const kinks = phis.flatMap((phi, i) =>
      corners.some((c) => Math.abs(Math.sin((phi - c) / 2)) < 1e-9) && i > 0 && i < phis.length - 1
        ? [i]
        : [],
    )
    return wallAlong(phis, kinks, false)
  })
  // Two free-standing arcs need something to hold them together.
  if (!head.host) solids.push(rail(head, depth - node.wall / 2, node.wall / 2, node.wall))
  return solids
}

// ── Feature ──────────────────────────────────────────────────────────────────────────────────

function checkProngs(node: SettingNode, shape: StoneShape, ctx: BuildContext): void {
  const d = node.prongDiameter
  if (d >= RULES.prongDiameter.warn) return
  const better =
    Math.ceil(
      Math.max(RULES.prongDiameter.warn, RULES.prongForStone(shape.stone.dims.width)) * 20,
    ) / 20
  ctx.report({
    level: d < RULES.prongDiameter.error ? 'error' : 'warning',
    code: 'prong.small',
    message: `${d.toFixed(2)} mm claws are too fine to cast and hold reliably; use at least ${RULES.prongDiameter.warn} mm.`,
    value: d,
    limit: RULES.prongDiameter.warn,
    at: [...shape.toWorld([0, 0, shape.girdleTop])],
    fix: {
      label: `Use ${better} mm claws`,
      ops: [{ t: 'update', id: node.id, patch: { prongDiameter: better } }],
    },
  })
}

export const setting = defineFeature('setting', (node, ctx) => {
  const gem = ctx.input(node.gem)
  const stone = gem.stones[0]
  if (!stone) throw new Error('the stone it holds was not built')
  const shape = stoneShape(stone)
  const head: Head = { shape, host: gemData(gem).host, taper: node.taper }
  const solids: Solid[] = []
  const cuts: Cut[] = []

  if (node.style === 'prong' || node.style === 'basket') {
    checkProngs(node, shape, ctx)
    solids.push(...prongs(node, head))
    const standoff = node.prongDiameter / 2 - RULES.prongOverlap(node.prongDiameter)
    const wire = clamp(node.prongDiameter * 0.8, 0.5, 1.2)
    const bottom = baseDepth(head, standoff)
    const girdle = -shape.girdleBottom
    if (node.style === 'basket')
      for (const f of node.rails === 2 ? [0.3, 0.7] : node.rails === 1 ? [0.5] : [])
        solids.push(rail(head, lerp(girdle, bottom, f), standoff, wire))
    // Without a band to stand in, the claws are gathered by a base ring under the culet.
    if (!head.host) solids.push(rail(head, bottom, standoff, wire))
  } else if (node.style === 'bezel' || node.style === 'halfBezel') {
    if (node.wall < RULES.bezelWall.error)
      ctx.report({
        level: 'error',
        code: 'bezel.thin',
        message: `A ${node.wall.toFixed(2)} mm bezel wall will not cast or survive setting; use at least ${RULES.bezelWall.error} mm.`,
        value: node.wall,
        limit: RULES.bezelWall.error,
        fix: {
          label: `Use a ${RULES.bezelWall.error} mm wall`,
          ops: [{ t: 'update', id: node.id, patch: { wall: RULES.bezelWall.error } }],
        },
      })
    // A half bezel grips the two ends of the stone that lie along the band.
    const half = 55 * DEG
    solids.push(
      ...bezel(
        node,
        head,
        node.style === 'bezel'
          ? null
          : [
              [-half, half],
              [Math.PI - half, Math.PI + half],
            ],
      ),
    )
  } else if (ctx.detail === 'production') {
    // Flush: no metal of its own. Open the host above the girdle, a little narrower than the
    // stone so a rim is left to burnish over its edge.
    cuts.push({ solid: seatCutter(stone, { open: stone.dims.depth, scale: 0.94 }), targets: 'all' })
  }

  const bodies: Body[] = solids.map((solid) => ({ solid, ...metalOf(node) }))
  const back = shape.toWorld([shape.centre[0], shape.centre[1], shape.culet])
  const down = scale(stone.frame.z, -1)
  return {
    bodies,
    cuts,
    // Where a post, a bail or a peg would attach: under the culet, pointing away from the stone.
    frames: { back: { origin: back, x: stone.frame.x, y: scale(stone.frame.y, -1), z: down } },
  }
})
