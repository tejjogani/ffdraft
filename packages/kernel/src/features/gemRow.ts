/**
 * Stones along a band: pavé shoulders, channel, shared-claw, bar and flush rows, half and full
 * eternity. The count follows from stone size, gap and the arc to cover.
 */
import { type NodeOf, gemDims } from '@pave/schema'
import { type Addition, type BuildContext, type Cut, type Solid, type Stone, defineFeature } from '../core'
import { seatCutter, seatHole } from '../gems/cutter'
import { roundedRectLoop, translateLoop } from '../geometry/loop'
import { pinSolid } from '../geometry/pin'
import { ringPoint, ringRadial, ringSectionFrame, ringTangent } from '../geometry/ring'
import { placeLoop, sweepSolid } from '../geometry/sweep'
import { DEG, type Frame, type Vec3, addScaled, cross, lerp, normalize, transformFrame } from '../geometry/vec'
import { RULES } from '../rules'
import { culetDepth } from './gem'
import { type ShankData, shankData } from './ringShank'

type RowNode = NodeOf<'gemRow'>

/** A stone's place in the row: angle around the band, offset along the finger, size. */
interface Slot {
  theta: number
  a: number
  width: number
}

/** How far the girdle sits below (+) or above (−) the band's surface, as a fraction of the crown. */
const SINK: Record<RowNode['setting'], number> = {
  pave: 0.3,
  channel: 0.55,
  flush: 0.9,
  sharedProng: -0.6,
  bar: 0.1,
}

/**
 * Stone size at the ends of the row. The schema fills in 1.5 mm when no value was given (an
 * optional field with a default), so that exact value is read as "not graduated".
 */
const endWidth = (node: RowNode): number =>
  node.graduateTo === undefined || node.graduateTo === 1.5 ? node.stoneWidth : node.graduateTo

/**
 * Angles of the stones of one row, working outward from the row's centre so the row is always
 * symmetric. `radius` is where the girdles sit; sizes graduate linearly toward the ends.
 */
function rowAngles(node: RowNode, radius: number): { theta: number; width: number }[] {
  const end = (node.coverage / 2) * DEG
  const skip = (node.skipCenter / 2) * DEG
  const last = endWidth(node)
  const widthAt = (t: number) => lerp(node.stoneWidth, last, end > skip ? (Math.abs(t) - skip) / (end - skip) : 0)
  const centre = node.center * DEG

  if (node.coverage >= 360 && node.skipCenter === 0) {
    // Full eternity: stretch the gap so the row closes exactly.
    const count = Math.max(1, Math.floor((2 * Math.PI * radius) / (node.stoneWidth + node.gap)))
    return Array.from({ length: count }, (_, i) => ({ theta: centre + (i * 2 * Math.PI) / count, width: node.stoneWidth }))
  }
  const out: { theta: number; width: number }[] = []
  // Offsets from the centre for one side; mirrored for the other.
  const side: { t: number; width: number }[] = []
  let width = widthAt(skip)
  let t = skip === 0 ? 0 : skip + width / 2 / radius
  while (t + width / 2 / radius <= end + 1e-9) {
    side.push({ t, width })
    // Next centre: half of this stone, the gap, half of the next (whose size depends on where it lands).
    let next = t + (width + node.gap) / radius
    for (let i = 0; i < 3; i++) next = t + (width / 2 + node.gap + widthAt(next) / 2) / radius
    t = next
    width = widthAt(t)
  }
  for (const s of side) {
    out.push({ theta: centre + s.t, width: s.width })
    if (s.t !== 0) out.push({ theta: centre - s.t, width: s.width })
  }
  return out.sort((p, q) => p.theta - q.theta)
}

/** Frame of a stone seated on the band's outer surface at (θ, a), girdle `sink` mm below it. */
function seatFrame(shank: ShankData, theta: number, a: number, sink: number): Frame {
  const { radius, slope } = shank.outer(theta, a)
  const radial = ringRadial(theta)
  // Surface normal of r = f(a): tilt the radial direction against the slope.
  const z = normalize([radial[0], -slope, radial[2]])
  const x = ringTangent(theta)
  return { origin: addScaled(ringPoint(theta, a, radius), z, -sink), x, y: cross(z, x), z }
}

/** A strip of metal along the band between two angles (a channel wall). */
function wallAlong(shank: ShankData, from: number, to: number, a: number, width: number, height: number, closed: boolean): Solid {
  const steps = Math.max(2, Math.ceil(Math.abs(to - from) / (4 * DEG)))
  const count = closed ? steps : steps + 1
  const sections = Array.from({ length: count }, (_, i) => {
    const theta = from + ((to - from) * i) / steps
    // Open walls ramp down to the band at both ends.
    const ramp = closed ? 1 : Math.min(1, Math.min(i, steps - i) / 1.5 + 0.15)
    const h = height * ramp
    const base = shank.outer(theta, a).radius - 0.2
    return placeLoop(
      ringSectionFrame(theta),
      translateLoop(roundedRectLoop(width, h + 0.2, Math.min(0.1, width * 0.25)), a, base + (h + 0.2) / 2),
    )
  })
  return sweepSolid({ closed, sections })
}

function checks(node: RowNode, shank: ShankData, slots: readonly Slot[], depth: (w: number) => number, sink: (w: number) => number, ctx: BuildContext): void {
  let widest: { over: number; slot: Slot; band: number } | null = null
  let lowest: { clearance: number; slot: Slot } | null = null
  for (const slot of slots) {
    const band = shank.width(slot.theta)
    const needed = 2 * Math.abs(slot.a) + slot.width + 2 * RULES.stoneBorder
    if (needed > band + 1e-6 && (!widest || needed - band > widest.over)) widest = { over: needed - band, slot, band }
    const culet = shank.outer(slot.theta, slot.a).radius - sink(slot.width) - depth(slot.width)
    const clearance = culet - shank.innerRadius
    if (clearance < RULES.culetClearance && (!lowest || clearance < lowest.clearance)) lowest = { clearance, slot }
  }
  if (widest)
    ctx.report({
      level: 'warning',
      code: 'stone.wide',
      message: `The stones are too wide for the band: they need ${(widest.band + widest.over).toFixed(1)} mm (with ${RULES.stoneBorder} mm of metal either side) and it is ${widest.band.toFixed(1)} mm there.`,
      value: widest.band,
      limit: widest.band + widest.over,
      at: [...ringPoint(widest.slot.theta, 0, shank.outer(widest.slot.theta).radius)],
    })
  if (lowest)
    ctx.report({
      level: lowest.clearance <= 0 ? 'error' : 'warning',
      code: 'culet.low',
      message:
        lowest.clearance <= 0
          ? 'The stones are deeper than the band is thick: their culets reach the finger.'
          : `Only ${lowest.clearance.toFixed(2)} mm of metal under the stones; thicken the band or use smaller stones.`,
      value: lowest.clearance,
      limit: RULES.culetClearance,
      at: [...ringPoint(lowest.slot.theta, lowest.slot.a, shank.innerRadius)],
    })
}

export const gemRow = defineFeature('gemRow', (node, ctx) => {
  const host = ctx.input(node.host)
  const shank = shankData(host)
  const dimsOf = (width: number) => gemDims(node.cut, width)
  const depth = (width: number) => culetDepth(node.cut, dimsOf(width))
  const crown = (width: number) => dimsOf(width).depth - depth(width)
  const sink = (width: number) => SINK[node.setting] * crown(width)
  // Stones are spaced where their girdles are: near the surface at the top of the band.
  const radius = shank.outer(node.center * DEG).radius - sink(node.stoneWidth)
  const angles = rowAngles(node, radius)
  if (angles.length === 0) throw new Error('no stone of this size fits in the arc')

  const widest = Math.max(node.stoneWidth, endWidth(node))
  const rowPitch = dimsOf(widest).length + node.gap
  const slots: Slot[] = []
  for (let row = 0; row < node.rows; row++) {
    const a = (row - (node.rows - 1) / 2) * rowPitch
    // Neighbouring rows are staggered by half a stone, like a honeycomb.
    const stagger = row % 2 === 1 && angles.length > 1 ? (angles[1]!.theta - angles[0]!.theta) / 2 : 0
    for (const { theta, width } of angles) slots.push({ theta: theta + stagger, a, width })
  }
  checks(node, shank, slots, depth, sink, ctx)

  const place = (frame: Frame): Frame => transformFrame(host.matrix, frame)
  const stones: Stone[] = slots.map((slot) => ({
    cut: node.cut,
    stone: node.stone,
    dims: dimsOf(slot.width),
    frame: place(seatFrame(shank, slot.theta, slot.a, sink(slot.width))),
    role: 'accent',
    setting: node.setting,
  }))

  const additions: Addition[] = []
  const add = (solid: Solid, afterCuts = false) =>
    additions.push({ solid: solid.transformed(host.matrix), target: node.host, afterCuts })
  const cuts: Cut[] = []
  const full = node.coverage >= 360 && node.skipCenter === 0
  const span = (list: readonly Slot[]) => {
    const first = list[0]!
    const last = list[list.length - 1]!
    const pad = (s: Slot) => (s.width / 2 + 0.3) / radius
    return [first.theta - pad(first), last.theta + pad(last)] as const
  }
  // Runs of consecutive stones (a row with a gap for the head is two runs).
  const runs: Slot[][] = []
  for (let row = 0; row < node.rows; row++) {
    const inRow = slots.slice(row * angles.length, (row + 1) * angles.length)
    let run: Slot[] = []
    inRow.forEach((slot, i) => {
      const prev = inRow[i - 1]
      if (prev && (slot.theta - prev.theta) * radius > (slot.width + prev.width) / 2 + node.gap + 0.5) {
        runs.push(run)
        run = []
      }
      run.push(slot)
    })
    runs.push(run)
  }
  /** Mid-gap points between neighbouring stones of each run: where beads, claws and bars go. */
  const between = (visit: (theta: number, a: number, width: number) => void, ends: boolean) => {
    for (const run of runs) {
      const list = full ? [...run, { ...run[0]!, theta: run[0]!.theta + 2 * Math.PI }] : run
      for (let i = 0; i + 1 < list.length; i++)
        visit((list[i]!.theta + list[i + 1]!.theta) / 2, list[i]!.a, Math.min(list[i]!.width, list[i + 1]!.width))
      if (ends && !full) {
        const [from, to] = span(run)
        visit(from + 0.1 / radius, run[0]!.a, run[0]!.width)
        visit(to - 0.1 / radius, run[0]!.a, run[run.length - 1]!.width)
      }
    }
  }
  const surfaceAt = (theta: number, a: number): { point: Vec3; normal: Vec3 } => {
    const frame = seatFrame(shank, theta, a, 0)
    return { point: frame.origin, normal: frame.z }
  }

  if (node.setting === 'channel') {
    // A wall either side of the stones, lapping 0.1 mm over their girdles.
    const wall = Math.max(RULES.channelWall, 0.5)
    const height = sink(widest) + 0.25 * crown(widest)
    const offset = (node.rows * rowPitch - node.gap) / 2 - 0.1 + wall / 2
    const byRun = full ? [[0, 2 * Math.PI] as const] : runs.filter((r) => r[0]!.a === slots[0]!.a).map(span)
    for (const [from, to] of byRun)
      for (const side of [-1, 1]) add(wallAlong(shank, from, to, side * offset, wall, height, full))
  } else if (node.setting === 'sharedProng') {
    // Two small claws in every gap, each holding both neighbours just above the girdle.
    between((theta, a, width) => {
      const d = RULES.accentProng(width)
      for (const side of [-1, 1]) {
        const { point, normal } = surfaceAt(theta, a + side * (width / 2 - 0.05))
        add(pinSolid(addScaled(point, normal, -0.3), normal, d / 2, 0.3 - sink(width) + 0.3 * crown(width)))
      }
    }, true)
  } else if (node.setting === 'bar') {
    // A bar across the band in every gap, lapping over both girdles.
    between((theta, a, width) => {
      const bar = node.gap + 0.3
      const length = dimsOf(width).length + 0.2
      const height = 0.2 - sink(width) + 0.35 * crown(width)
      const { point, normal } = surfaceAt(theta, a)
      const tangent = ringTangent(theta)
      const frame = (y: number): Frame => ({ origin: addScaled(point, [0, 1, 0], y), x: tangent, y: normal, z: [0, 1, 0] })
      const loop = translateLoop(roundedRectLoop(bar, height + 0.2, 0.08), 0, height / 2 - 0.1)
      add(sweepSolid({ closed: false, sections: [placeLoop(frame(-length / 2), loop), placeLoop(frame(length / 2), loop)] }))
    }, true)
  }

  if (ctx.detail === 'production') {
    stones.forEach((stone, i) => {
      const slot = slots[i]!
      // Open the seat to above the band, and drill through to the finger so the culet has light.
      const open = Math.max(0.3, sink(slot.width)) + 0.4
      const scale = node.setting === 'flush' ? 0.94 : RULES.seatScale
      const through = shank.outer(slot.theta, slot.a).radius - shank.innerRadius
      cuts.push({ solid: seatCutter(stone, { open, scale }), targets: 'all' })
      cuts.push({ solid: seatHole(stone, slot.width * RULES.seatHole, through), targets: 'all' })
    })
    if (node.setting === 'pave') {
      // Beads: one either side of the row in every gap, catching both girdles.
      between((theta, a, width) => {
        const bead = RULES.beadDiameter(width)
        const lateral = Math.sqrt(Math.max(0.01, (width / 2 + bead / 2 - 0.05) ** 2 - ((width + node.gap) / 2) ** 2))
        for (const side of [-1, 1]) {
          const { point, normal } = surfaceAt(theta, a + side * lateral)
          add(pinSolid(addScaled(point, normal, -0.1), normal, bead / 2, 0.1 + bead * 0.2), true)
        }
      }, false)
    }
  }
  return { stones, cuts, additions }
})
