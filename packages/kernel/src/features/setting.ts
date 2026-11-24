/**
 * The head that holds one stone: claws, a basket (claws joined by gallery rails), a full or
 * half bezel, or a flush seat.
 *
 * Everything is measured from the stone's true outline, so claws land on the points of a pear
 * or the corners of a princess and a bezel hugs any cut. When the stone sits on a band the
 * head's metal runs down into the band; a free-standing head gets a base ring instead.
 */
import {
  GEM_CUTS,
  type NodeOf,
  prongCountFor,
  prongDiameterFor,
  prongHeavyFor,
  prongLightFor,
  prongSpinFor,
} from '@pave/schema'
import { type Body, type BuildContext, type Cut, defineFeature, metalOf, type Solid } from '../core'
import { seatCutter } from '../gems/cutter'
import { clawLayoutIssues, prongDirections, type StoneShape, stoneShape } from '../gems/shape'
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
/**
 * Steepest a claw's leg may lean from the stone's axis. Past this a leg reaching for a narrow
 * band from the end of a long stone becomes a diagonal strut through the pavilion; the head
 * stands on a base rail of its own instead.
 */
const MAX_LEAN = 25 * DEG
/**
 * A leg may reach sideways for band metal (the classic solitaire's claws lean in onto a narrow
 * band) up to this lean; beyond it the leg ends on the head's base rail instead.
 */
const MAX_REACH_LEAN = 40 * DEG

interface Head {
  shape: StoneShape
  host: StoneHost | null
  taper: number
  /**
   * On a band: the depth of the head's base rail, where legs end that have no band metal under
   * them (the ends of a stone longer than the band is wide). Null when every leg can root in the
   * band, and for a free-standing head (whose legs end on its own base ring).
   */
  railDepth: number | null
  /** Legs may reach sideways for band metal (false for the base rail itself, which stays on its outline). */
  reach?: boolean
}

/** The claw parameters, from the node (the resolved design fills them) or the stone's rules. */
interface Claws {
  count: number
  diameter: number
  spin: number
}

function clawsOf(node: SettingNode, shape: StoneShape): Claws {
  const { cut, dims } = shape.stone
  const count = node.prongCount ?? prongCountFor(cut, dims)
  return {
    count,
    diameter: node.prongDiameter ?? prongDiameterFor(dims.width, count, false),
    spin: node.prongSpin ?? prongSpinFor(count),
  }
}

/** The straight run from the girdle down to where a piece of the head ends. */
interface Leg {
  /** At girdle height, `standoff` outside the girdle. */
  top: Vec3
  /** Where it ends: inside the band, or on the base ring of a free-standing head. */
  base: Vec3
  /** It ends on the head's base rail (no band metal within reach). */
  onRail?: boolean
}

/** Depth below the girdle plane at which a leg ending at (x, y) on a band roots, or null off the band. */
function rootDepth(head: Head, x: number, y: number, margin: number): number | null {
  const { shape, host } = head
  if (!host) return null
  const surface = host.surfaceBelow(x, y)
  // Within `margin` of the band's edge a leg would stand half off it.
  const [ox, oy] = host.over(x, y, margin)
  if (surface === null || Math.hypot(ox - x, oy - y) > 1e-6) return null
  const floor = host.floorBelow(x, y) - FINGER_CLEARANCE
  return Math.max(Math.min(surface + ROOT_SINK, floor), -shape.girdleBottom + 0.3)
}

function legAt(head: Head, phi: number, standoff: number, margin: number): Leg {
  const { shape, host } = head
  const g = shape.point(phi)
  const n = shape.normal(phi)
  const top: Vec3 = [g[0] + n[0] * standoff, g[1] + n[1] * standoff, 0]
  const [cx, cy] = shape.centre
  const reach = Math.hypot(top[0] - cx, top[1] - cy)
  const baseAt = (t: number): Vec2 => [cx + (top[0] - cx) * (1 - t), cy + (top[1] - cy) * (1 - t)]
  if (!host) {
    const [bx, by] = baseAt(head.taper)
    return { top, base: [bx, by, shape.culet - 0.35] }
  }
  const depthAt = ([x, y]: Vec2): number | null => rootDepth(head, x, y, margin) ?? head.railDepth
  let t = head.taper
  const own = rootDepth(head, ...baseAt(t), margin)
  if (own === null && head.reach !== false) {
    // No band metal under the leg: reach sideways for the nearest band metal while that keeps
    // the leg upright enough (or when there is no rail to end on).
    const [bx, by] = host.over(...baseAt(t), margin)
    const depth = rootDepth(head, bx, by, 0) ?? -shape.culet + 0.35
    const lean = Math.atan2(Math.hypot(bx - top[0], by - top[1]), depth)
    if (head.railDepth === null || lean <= MAX_REACH_LEAN) return { top, base: [bx, by, -depth] }
  }
  let depth = depthAt(baseAt(t))!
  // Lean no more than MAX_LEAN, and keep the leg's base outside the pavilion at its depth.
  for (let i = 0; i < 2 && depth !== null; i++) {
    const s = shape.silhouette(phi, -depth)
    const inside = Math.hypot(s[0] - cx, s[1] - cy) + margin
    t = clamp(Math.min(head.taper, (Math.tan(MAX_LEAN) * depth) / reach, 1 - inside / reach), 0, 1)
    depth = depthAt(baseAt(t)) ?? depth
  }
  const [bx, by] = baseAt(t)
  return { top, base: [bx, by, -depth], onRail: rootDepth(head, bx, by, margin) === null }
}

/**
 * Depth of a ring head's base rail: deep enough to sink `ROOT_SINK` into the band wherever its
 * tapered outline crosses band metal (so it stands on the band), above the finger. Null when
 * the outline never crosses the band.
 */
function railDepthOf(head: Head, standoff: number, wire: number): number | null {
  const { shape, host } = head
  if (!host) return null
  let deepest: number | null = null
  for (const phi of shape.polygon(6).phis) {
    const g = shape.point(phi)
    const n = shape.normal(phi)
    const [cx, cy] = shape.centre
    const x = cx + (g[0] + n[0] * standoff - cx) * (1 - head.taper)
    const y = cy + (g[1] + n[1] * standoff - cy) * (1 - head.taper)
    const d = rootDepth(head, x, y, wire / 2 + 0.1)
    if (d !== null)
      deepest = Math.max(
        deepest ?? 0,
        Math.min(d, host.floorBelow(x, y) - FINGER_CLEARANCE - wire / 2),
      )
  }
  return deepest
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

function prongStyle(node: SettingNode, d: number, onPoint: boolean): ProngStyle {
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

/** Half the width of a claw along the girdle, by tip: what a halo must leave room for. */
function clawHalfWidth(node: SettingNode, d: number, onPoint: boolean): number {
  if (onPoint) return d * 0.85
  if (node.prongTip === 'tab') return d * 0.75
  if (node.prongTip === 'double') return d * 0.71
  return d / 2
}

/** One claw as placed: its direction in the stone's frame and how much room it takes. */
export interface ClawPlace {
  phi: number
  point: boolean
  /** Half its width along the girdle, mm. */
  halfWidth: number
  /** How far its outside stands beyond the girdle, mm. */
  reach: number
}

function clawPlaces(node: SettingNode, shape: StoneShape, claws: Claws): ClawPlace[] {
  return prongDirections(shape, claws.count, claws.spin * DEG).map(({ phi, point }) => {
    const style = prongStyle(node, claws.diameter, point)
    return {
      phi,
      point,
      halfWidth: clawHalfWidth(node, claws.diameter, point),
      reach: 2 * style.radius - style.overlap,
    }
  })
}

function prongs(
  node: SettingNode,
  head: Head,
  claws: Claws,
  places: readonly ClawPlace[],
): Solid[] {
  return places.flatMap(({ phi, point }) => {
    const style = prongStyle(node, claws.diameter, point)
    const pair = !point && node.prongTip === 'double'
    return (pair ? [-0.4, 0.4] : [0]).map((k) => prong(head, phi, style, k * claws.diameter))
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
  /** Depth of a rail that joins arcs hanging off a narrow band to it; the arcs end on it. */
  railDepth: number | null = null,
): Solid[] {
  const { shape } = head
  const crownHeight = shape.table - shape.girdleTop
  const top = shape.girdleTop + clamp(0.3 * crownHeight, 0.2, 0.6)
  const depth = railDepth === null ? bezelDepth(head) : railDepth + node.wall / 2
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
  // Two free-standing arcs need something to hold them together; arcs off a narrow band are
  // held by a rail through the middle of the cup wall at its foot (the cup narrows toward its
  // base, so the rail follows it in), sunk into the band where it crosses it.
  if (!head.host) solids.push(rail(head, depth - node.wall / 2, node.wall / 2, node.wall))
  else if (railDepth !== null) {
    const inset = Math.min(0.14 * (top + depth), ledge + node.wall - 0.3)
    const along = (top + railDepth) / (top + depth)
    const standoff = node.wall / 2 - inset * (1 - along)
    solids.push(rail({ ...head, taper: 0, railDepth }, railDepth, standoff, node.wall))
  }
  return solids
}

// ── Feature ──────────────────────────────────────────────────────────────────────────────────

function checkProngs(
  node: SettingNode,
  shape: StoneShape,
  claws: Claws,
  places: readonly ClawPlace[],
  ctx: BuildContext,
): void {
  const d = claws.diameter
  const width = shape.stone.dims.width
  const at: [number, number, number] = [...shape.toWorld([0, 0, shape.girdleTop])]
  const rule = prongDiameterFor(width, claws.count, false)
  if (d < RULES.prongDiameter.warn) {
    const better = Math.ceil(Math.max(RULES.prongDiameter.warn, rule) * 20) / 20
    ctx.report({
      level: d < RULES.prongDiameter.error ? 'error' : 'warning',
      code: 'prong.small',
      message: `${d.toFixed(2)} mm claws are too fine to cast and hold reliably; use at least ${RULES.prongDiameter.warn} mm.`,
      value: d,
      limit: RULES.prongDiameter.warn,
      at,
      fix: {
        label: `Use ${better} mm claws`,
        ops: [{ t: 'update', id: node.id, patch: { prongDiameter: better } }],
      },
    })
  } else {
    // Against the stone: claws kept from a smaller or larger stone look wrong and wear wrong.
    // The floor is taken as for a head inside a halo (the halo guards the girdle), since a head
    // cannot see a halo around its stone; the canon lints the exact case.
    const light = prongLightFor(width, claws.count, true)
    const heavy = prongHeavyFor(width)
    if (d < light - 1e-6 || d > heavy + 1e-6)
      ctx.report({
        level: 'warning',
        code: d < light ? 'prong.light' : 'prong.heavy',
        message:
          d < light
            ? `${d.toFixed(2)} mm claws are light for a ${width.toFixed(2)} mm stone; it takes at least ${light.toFixed(2)} mm.`
            : `${d.toFixed(2)} mm claws are heavy for a ${width.toFixed(2)} mm stone; above ${heavy.toFixed(2)} mm they hide it.`,
        value: d,
        limit: d < light ? light : heavy,
        at,
        // Removing the pin lets the wire follow the stone again.
        fix: {
          label: `Size the claws to the stone (${rule} mm)`,
          ops: [{ t: 'update', id: node.id, patch: { prongDiameter: null } }],
        },
      })
  }
  const issues = clawLayoutIssues(shape, places)
  if (issues.length) {
    const cut = GEM_CUTS[shape.stone.cut]
    const usual = prongCountFor(shape.stone.cut, shape.stone.dims)
    ctx.report({
      level: 'warning',
      code: 'prong.count',
      message: `${claws.count} claws on a ${cut.label.toLowerCase()}: ${issues.join('; ')}. ${usual} is the usual count for this shape.`,
      value: claws.count,
      limit: usual,
      at,
      ...(usual !== claws.count
        ? {
            fix: {
              label: `Use ${usual} claws`,
              ops: [{ t: 'update', id: node.id, patch: { prongCount: null } }],
            },
          }
        : {}),
    })
  }
  // Every claw on a point is a V-claw, whatever the tip asked for.
  if (places.length > 0 && places.every((p) => p.point) && node.prongTip !== 'round')
    ctx.report({
      level: 'info',
      code: 'prong.tipIgnored',
      message: `Every claw of this ${cut(shape)} sits on a point and takes a V-claw, so the ${node.prongTip} tip is not used.`,
    })
  // A rotation pinned on a shape whose claws go on its points or corners changes nothing.
  if (
    node.prongSpin !== undefined &&
    shape.unit.outline.prongs.length > 0 &&
    Math.abs(node.prongSpin - prongSpinFor(claws.count)) > 0.5
  )
    ctx.report({
      level: 'info',
      code: 'prong.spinIgnored',
      message: `A ${cut(shape)} puts its claws on its points and corners, so the claw rotation is not used.`,
    })
}

const cut = (shape: StoneShape) => GEM_CUTS[shape.stone.cut].label.toLowerCase()

/** What a head publishes for a halo around the same stone: where its metal reaches past the girdle. */
export interface HeadData {
  kind: 'head'
  style: SettingNode['style']
  /** Claw directions in the stone's frame (empty for bezels and flush). */
  claws: ClawPlace[]
  /** How far a bezel wall stands beyond the girdle, mm (0 for claws). */
  wall: number
}

/**
 * Centres (directions in the stone's frame) of the two half-bezel arcs. `sides`: across the
 * stone (along the band on a ring). `ends`: the two ends of its length. `auto`: on the points
 * of a pointed stone (a pear's tip and the end opposite it), on the ends of a long one, across
 * a round or square one, so the parts that chip are the parts held.
 */
function halfBezelArcs(node: SettingNode, shape: StoneShape): [number, number] {
  const across: [number, number] = [0, Math.PI]
  const ends: [number, number] = [Math.PI / 2, (3 * Math.PI) / 2]
  if (node.arcs === 'sides') return across
  if (node.arcs === 'ends') return ends
  const points = shape.unit.outline.prongs.filter((p) => p.point).map((p) => p.phi)
  if (points.length === 1) return [points[0]!, points[0]! + Math.PI]
  if (points.length === 2) return [points[0]!, points[1]!]
  if (points.length === 0 && shape.stone.dims.length > shape.stone.dims.width * 1.05) return ends
  return across
}

export const setting = defineFeature('setting', (node, ctx) => {
  const gem = ctx.input(node.gem)
  const stone = gem.stones[0]
  if (!stone) throw new Error('the stone it holds was not built')
  const shape = stoneShape(stone)
  const placed = gemData(gem)
  const head: Head = { shape, host: placed.host, taper: node.taper, railDepth: null }
  const solids: Solid[] = []
  const cuts: Cut[] = []
  // A head of another alloy than its band is cast on its own and soldered on: it needs metal of
  // its own joining it into one piece.
  const ownCasting = placed.hostMaterial !== undefined && placed.hostMaterial !== node.material
  let places: ClawPlace[] = []
  let wallReach = 0

  if (node.style === 'prong' || node.style === 'basket') {
    const claws = clawsOf(node, shape)
    places = clawPlaces(node, shape, claws)
    checkProngs(node, shape, claws, places, ctx)
    const standoff = claws.diameter / 2 - RULES.prongOverlap(claws.diameter)
    const wire = clamp(claws.diameter * 0.8, 0.5, 1.2)
    head.railDepth = railDepthOf(head, standoff, wire)
    solids.push(...prongs(node, head, claws, places))
    const bottom = baseDepth(head, standoff)
    const girdle = -shape.girdleBottom
    if (node.style === 'basket')
      for (const f of node.rails === 2 ? [0.3, 0.7] : node.rails === 1 ? [0.5] : [])
        solids.push(rail(head, lerp(girdle, bottom, f), standoff, wire))
    // Without a band to stand in, the claws are gathered by a base ring under the culet. On a
    // band, legs that have no band metal under them end on a base rail that stands on the band
    // (a gallery), and a head of its own alloy gets one so it casts in one piece.
    const offBand =
      head.host !== null &&
      head.railDepth !== null &&
      places.some(({ phi }) => legAt(head, phi, standoff, claws.diameter / 2 + 0.1).onRail)
    if (!head.host) solids.push(rail(head, bottom, standoff, wire))
    else if (head.railDepth !== null && (offBand || ownCasting))
      solids.push(rail({ ...head, reach: false }, head.railDepth, standoff, wire))
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
    wallReach = node.wall
    const half = 55 * DEG
    const arcs =
      node.style === 'bezel'
        ? null
        : halfBezelArcs(node, shape).map((c) => [c - half, c + half] as const)
    // Arcs off a narrow band would hang beside it: they end on a rail along the girdle outline
    // that stands on the band (as does a half bezel cast in its own alloy).
    let railDepth: number | null = null
    if (arcs && head.host) {
      const hanging = arcs.some(([from, to]) => {
        const g = shape.point((from + to) / 2)
        return head.host!.surfaceBelow(g[0], g[1]) === null
      })
      if (hanging || ownCasting) railDepth = railDepthOf({ ...head, taper: 0 }, 0, node.wall)
    }
    solids.push(...bezel(node, head, arcs, railDepth))
  } else {
    // Flush: no metal of its own; the stone must already be sunk in a body.
    const sunk =
      placed.placement === 'surface' ||
      (head.host !== null &&
        (head.host.surfaceBelow(shape.centre[0], shape.centre[1]) ?? Infinity) <= -shape.girdleTop)
    if (!sunk)
      ctx.report({
        level: 'error',
        code: 'setting.noHost',
        message:
          'A flush setting sinks the stone into metal, but this stone stands clear of any body: nothing would hold it. Use a bezel, or set it into a surface.',
        at: [...shape.toWorld([0, 0, 0])],
        fix: {
          label: 'Use a bezel',
          ops: [{ t: 'update', id: node.id, patch: { style: 'bezel' } }],
        },
      })
    if (ctx.detail === 'production')
      // Open the host above the girdle, a little narrower than the stone so a rim is left to
      // burnish over its edge.
      cuts.push({
        solid: seatCutter(stone, { open: stone.dims.depth, scale: 0.94 }),
        targets: 'all',
      })
  }

  const bodies: Body[] = solids.map((solid) => ({ solid, ...metalOf(node) }))
  const back = shape.toWorld([shape.centre[0], shape.centre[1], shape.culet])
  const down = scale(stone.frame.z, -1)
  return {
    bodies,
    cuts,
    // Where a post, a bail or a peg would attach: under the culet, pointing away from the stone.
    frames: { back: { origin: back, x: stone.frame.x, y: scale(stone.frame.y, -1), z: down } },
    data: { kind: 'head', style: node.style, claws: places, wall: wallReach } satisfies HeadData,
  }
})
