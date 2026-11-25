/**
 * The tennis link: a stone in a four-prong box, hinged to its neighbours underneath.
 *
 * Link-local space: girdle plane z = 0, table toward +z, chain along x. The box is a rounded
 * tube one wall thick whose top edge carries the pavilion (the stone's girdle overhangs it by
 * half a wall), closed below by a plate with a light hole of ≈ 0.66 × stone Ø
 * (docs/research/01-cad.md §2). Four prongs rise from the box corners and lean in over the
 * girdle. The hinge lies flat under the plates, as a tennis line is made: each link carries a
 * flat tongue — a closed wire loop on two posts under its front edge — reaching under the next
 * link, where it passes through two staples (wire arches under that link's back edge). The line
 * bends down round a wrist and sideways as the tongue slides and turns in its staples, never
 * touching, and stands only about two hinge wires below the boxes: a pair of rings hung their
 * own diameter below and showed on the wrist. Links too narrow to carry staples beside their
 * light hole keep the rings (ringHinge). Every post and staple leg lands on plate metal, clear
 * of the light hole.
 */
import { GEM_CUTS, type GemCutId, type GemDims, gemDims, snapToMelee } from '@pave/schema'
import type { Manifold } from 'manifold-3d'
import { type Deletable, QUALITY, type Quality, runtime } from '../../core'
import { circleLoop } from '../../geometry/loop'
import { frameFromZ, frameMatrix, type Vec3 } from '../../geometry/vec'
import { weldWithin } from '../../mesh/weld'
import { manifoldFromTriangles, trianglesFromManifold } from '../../solid/solid'
import { type Centreline, sampleCurve, segmentsFor, sweepAlong } from './centreline'
import type { WireLoop } from './contact'
import type { Template } from './instances'

export interface TennisLink {
  template: Template
  dims: GemDims
  /** Outer box length along the chain. */
  length: number
  pitch: number
  /** Tightest radius the chain can bend to sideways before neighbouring boxes touch. */
  minBend: number
  half: { y: number; z: number }
  /** Height of the link's middle above the girdle plane: the chain's centre line runs there. */
  middle: number
  /** Prong wire actually used (thinner than asked when the stone is too small to carry it). */
  prong: number
  /**
   * The hinge's wires as closed centrelines in link-local space, for checks that it stays
   * threaded and clear: `ahead` (under the front edge) is threaded by the next link's `behind`.
   * Flat: the tongue, and each staple closed through the plate it stands from. `pivot` is the
   * height a link turns about against its neighbour round a wrist (the plates' underside).
   */
  hinge: { ahead: WireLoop[]; behind: WireLoop[]; flat: boolean; pivot: number }
}

/** The link is too narrow for any hinge: its posts would land in the light hole. */
export class NoRoomForHinge extends Error {
  constructor(stoneWidth: number) {
    super(
      `A ${stoneWidth} mm stone leaves no room for the tennis link's hinge under it: use wider links.`,
    )
    this.name = 'NoRoomForHinge'
  }
}

/** Space between neighbouring boxes; pitch ≈ stone + 0.3–0.6 mm (06-freeform.md §6). */
const BOX_GAP = 0.3
/**
 * On bigger links the gap grows with the box: the bend a pair allows grows with the square of
 * the link over the gap, so a fixed gap leaves a 6 mm line unable to drape round a neck. At
 * 8 % of the width the tightest bend stays near 7–10 link widths.
 */
const GAP_PER_WIDTH = 0.08
const CLEARANCE = 0.03
/** Prongs overlap the girdle by 15 % of their diameter (Stuller, 01-cad.md §2). */
const PRONG_OVERLAP = 0.15
/** Light hole under the stone, as a fraction of its width (JewelCraft, 01-cad.md §2). */
const LIGHT_HOLE = 0.66
/** Thinnest box wall and prong a caster holds (02-production.md §3: claws ≥ 0.5, walls ≥ 0.4). */
const MIN_WALL = 0.4
const MIN_PRONG = 0.45
/**
 * Upper limits relative to the stone: a prong past ~0.4 × the stone hides it (accent prongs run
 * 0.3–0.4 × stone, JewelCraft presets in rules.ts), and the wall may take at most a fifth of the
 * link's width so the stone stays the link.
 */
const MAX_PRONG = 0.4
const MAX_WALL = 0.2
/** Edges shorter than this are collapsed after the link's union, mm. */
const SLIVER = 1e-3
/** Vertices closer than this are merged after simplifying, mm: well above float32 steps at 250 mm. */
const WELD = 1e-4
/** A prong wire ends this share of its radius short of its tip ball's centre. */
const TIP_INSET = 0.4
/** Air round the tongue inside each staple, beyond the clearance, so the hinge moves freely, mm. */
const HINGE_PLAY = 0.1
/**
 * Tightest radius a bracelet bends to round a wrist, mm (a small wrist is about 45 × 55 mm
 * across). Each link turns against its neighbour by pitch / this, about the plates' underside
 * where their back edges meet.
 */
const WRIST_RADIUS = 22
/**
 * Most air either side of the tongue's wire in a staple, as a share of the wire: past it the
 * staple stands wider than a jeweler makes one, and the hinge limits the sideways bend instead.
 */
const PLAY_MAX = 1

/** Distance from the stone's centre to its girdle in the direction `angle` (from +x). */
function girdleReach(cut: GemCutId, dims: GemDims, angle: number): number {
  const a = dims.length / 2
  const b = dims.width / 2
  const c = Math.abs(Math.cos(angle))
  const s = Math.abs(Math.sin(angle))
  const outline = GEM_CUTS[cut].outline
  if (outline === 'square' || outline === 'rect' || outline === 'cushion') {
    // Rectangle, with the corner cut back along the diagonal.
    const box = Math.min(c > 1e-9 ? a / c : Infinity, s > 1e-9 ? b / s : Infinity)
    const corner = GEM_CUTS[cut].cornerCut * dims.width
    return Math.min(box, (a + b - corner) / (c + s))
  }
  return 1 / Math.hypot(c / a, s / b)
}

export function tennisLink(width: number, wire: number, cut: GemCutId): TennisLink {
  const wall = Math.min(Math.max(MIN_WALL, 0.5 * wire), MAX_WALL * width)
  const nominal = width - wall
  const stoneWidth = nominal <= 4 ? snapToMelee(nominal) : Math.round(nominal * 20) / 20
  const prong = Math.min(Math.max(MIN_PRONG, wire), MAX_PRONG * stoneWidth)
  const dims = gemDims(cut, stoneWidth)
  const proportions = GEM_CUTS[cut]
  const girdle = (proportions.girdlePct * stoneWidth) / 2
  const pavilion = proportions.pavilionPct * stoneWidth + girdle
  const lx = dims.length + wall
  const ly = dims.width + wall
  // The box top sits where the pavilion has narrowed to the box opening.
  const opening = (Math.min(lx, ly) - 2 * wall) / 2 - CLEARANCE
  const top = -(girdle + (pavilion - girdle) * (1 - opening / (stoneWidth / 2)))
  const plateTop = -pavilion - CLEARANCE
  const bottom = plateTop - wall
  // Corner radii stay below half the side, or the rounded outline collapses to nothing.
  const corner = Math.min(1.5 * wall, 0.45 * Math.min(lx, ly))
  const innerCorner = Math.min(Math.max(corner - wall, 0.05), 0.45 * (Math.min(lx, ly) - 2 * wall))
  const crown = proportions.crownPct * stoneWidth + girdle

  // Prongs: from the box corners, leaning in to bite the girdle.
  const prongs = (
    [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ] as const
  ).map(([sx, sy]) => {
    const angle = Math.atan2(sy * ly, sx * lx)
    const reach = girdleReach(cut, dims, angle) + prong / 2 - PRONG_OVERLAP * prong
    const base: Vec3 = [sx * (lx / 2 - corner * 0.6), sy * (ly / 2 - corner * 0.6), top - wall]
    const tip: Vec3 = [Math.cos(angle) * reach, Math.sin(angle) * reach, girdle + 0.3 * prong]
    return { base, tip }
  })
  // Prong tips must stay inside the link's own pitch cell, or they meet the neighbour's.
  const overhangX = Math.max(...prongs.map((p) => Math.abs(p.tip[0]))) + prong / 2 - lx / 2
  const gap = Math.max(BOX_GAP, GAP_PER_WIDTH * width, 2 * (overhangX + CLEARANCE))
  const pitch = lx + gap
  const halfY = Math.max(ly / 2, ...prongs.map((p) => Math.abs(p.tip[1]) + prong / 2))

  const ring = Math.max(0.3, 0.35 * prong)
  const lightHole = (LIGHT_HOLE * stoneWidth) / 2
  // Neighbouring boxes rotate about the hinge; their inner corners close by width·θ/2.
  const minBend = (pitch * 2 * halfY) / (2 * (gap - CLEARANCE))
  const box: Box = { lx, ly, corner, wall, bottom, crown, pitch, ring, lightHole, minBend }
  // The flat hinge where the plate has room for its staples; on the narrowest links, whose
  // light hole leaves only a rim of plate, the rings below.
  const flat = flatHinge(box)
  const hinge = flat ?? ringHinge(box)
  if (!hinge) throw new NoRoomForHinge(stoneWidth)
  const lowest = hinge.lowest

  const mesh = (quality: Quality) => {
    const { manifold: mf } = runtime()
    const temps: Deletable[] = []
    const own = <T extends Deletable>(m: T): T => {
      temps.push(m)
      return m
    }
    const seg = (r: number) => segmentsFor(r, quality.chord, 10, 40)
    const rounded = (x: number, y: number, r: number) =>
      own(own(mf.CrossSection.square([x - 2 * r, y - 2 * r], true)).offset(r, 'Round', 2, seg(r)))
    try {
      const outer = rounded(lx, ly, corner)
      const hole = rounded(lx - 2 * wall, ly - 2 * wall, innerCorner)
      // Walls and plate are one cup: the outline extruded full height with the box's hole
      // cut down to the plate. Two solids sharing the outline would fuse along coincident
      // faces into zero-area facets.
      const block = own(own(outer.extrude(top - bottom)).translate(0, 0, bottom))
      const cavity = own(own(hole.extrude(top - bottom)).translate(0, 0, bottom + wall))
      const lightHoleCutter = own(
        own(
          mf.Manifold.cylinder(wall * 3, lightHole, undefined, seg(stoneWidth / 3), true),
        ).translate(0, 0, bottom + wall / 2),
      )
      const cup = own(own(block.subtract(cavity)).subtract(lightHoleCutter))
      const parts: Manifold[] = [cup]
      for (const { base, tip } of prongs) {
        // The wire stops inside the tip ball: ending exactly at its centre would lay the wire's
        // rim on the ball's surface, and the union of coincident surfaces leaves zero-area
        // facets and non-manifold edges that STL readers see (the mesh is fine by index only).
        const run = Math.hypot(tip[0] - base[0], tip[1] - base[1], tip[2] - base[2])
        const short = 1 - (TIP_INSET * prong) / 2 / run
        const end: Vec3 = [0, 1, 2].map((k) => base[k]! + (tip[k]! - base[k]!) * short) as never
        parts.push(own(cylinderBetween(mf, base, end, prong / 2, seg(prong / 2))))
        parts.push(own(own(mf.Manifold.sphere(prong * 0.5, seg(prong / 2))).translate(tip)))
      }
      parts.push(...hinge.parts(own, quality))
      // Collapse the slivers where wires cross the box's faces at a glancing angle: below a
      // micron they round to zero-area facets once written as float32 (STL, 3MF). Simplifying
      // leaves a few edges a little longer than that, which still collapse once the link is
      // placed 200 mm out along a chain (float32 steps there are ~2e-5 mm), so those are welded
      // shut too; if welding ever opened the mesh, the simplified one is kept.
      const simplified = trianglesFromManifold(own(own(mf.Manifold.union(parts)).simplify(SLIVER)))
      const welded = weldWithin(simplified, WELD)
      try {
        own(manifoldFromTriangles(welded))
        return welded
      } catch {
        return simplified
      }
    } finally {
      for (const m of temps) m.delete()
    }
  }

  assertOneShell(mesh)

  return {
    template: { mesh },
    dims,
    length: lx,
    pitch,
    minBend: Math.max(minBend, flat?.minBend ?? 0),
    half: { y: halfY, z: (crown - lowest) / 2 },
    middle: (crown + lowest) / 2,
    prong,
    hinge: { ahead: hinge.ahead, behind: hinge.behind, flat: hinge.flat, pivot: hinge.pivot },
  }
}

/** What a hinge needs to know of its link's box (link-local, mm). */
interface Box {
  lx: number
  ly: number
  corner: number
  wall: number
  /** Underside of the plate. */
  bottom: number
  /** Top of the stone. */
  crown: number
  pitch: number
  /** Hinge wire. */
  ring: number
  lightHole: number
  /** Tightest sideways bend of the line, mm. */
  minBend: number
}

interface Hinge {
  lowest: number
  /** Height the link turns about against its neighbour round a wrist. */
  pivot: number
  /** The hinge's metal; `own` takes each temporary for deletion when the link is built. */
  parts(own: <T extends Deletable>(m: T) => T, quality: Quality): Manifold[]
  ahead: WireLoop[]
  behind: WireLoop[]
  flat: boolean
}

/** Inside the plate's rounded outline and outside its light hole, by half a hinge wire. */
function onPlate(b: Box, x: number, y: number): boolean {
  const inset = b.ring / 2 - 1e-9
  const qx = Math.abs(x) - (b.lx / 2 - b.corner)
  const qy = Math.abs(y) - (b.ly / 2 - b.corner)
  const inside =
    qx > 0 && qy > 0
      ? Math.hypot(qx, qy) <= b.corner - inset
      : Math.abs(x) <= b.lx / 2 - inset && Math.abs(y) <= b.ly / 2 - inset
  return inside && Math.hypot(x, y) - b.ring / 2 >= b.lightHole
}

/** The wire swept round a centreline, as a Manifold. */
function sweptWire(line: Centreline, radius: number, quality: Quality): Manifold {
  const solid = sweepAlong(line, circleLoop(radius))
  try {
    return manifoldFromTriangles(solid.triangles(quality))
  } finally {
    solid.dispose()
  }
}

/** `count` points of a curve as a closed polyline (an open curve is closed by its chord). */
function polyline(point: (t: number) => Vec3, count: number, open: boolean): Float64Array {
  const out = new Float64Array(count * 3)
  for (let i = 0; i < count; i++) out.set(point(open ? i / (count - 1) : i / count), i * 3)
  return out
}

/**
 * The flat hinge: a tongue on two posts under the front edge, through two staples under the next
 * link's back edge, laid out at the widest stance the plate carries. Its play is sized for the
 * line's bends. Round a wrist each link turns by pitch / WRIST_RADIUS about the plates'
 * underside: the next link's plate drops onto the tongue by that turn times the tongue's reach
 * past the turn, so the tongue hangs that much lower. Sideways (on the drape, down to the boxes'
 * tightest bend) each staple shifts across the tongue's wire by the turn times its reach, so its
 * legs stand that much wider, up to PLAY_MAX; past that the hinge sets the tightest bend.
 * Both depend on where the staples land, so the layout is settled in a few passes.
 * Null when the plate has no room for it.
 */
function flatHinge(b: Box): (Hinge & { minBend: number }) | null {
  const { ring, pitch } = b
  const wristTurn = pitch / WRIST_RADIUS
  let sideTurn = pitch / b.minBend
  const plateMid = b.bottom + b.wall / 2
  /** The x nearest the plate's edge on the side `sign` where every y in `ys` lands on plate. */
  const edgeX = (sign: 1 | -1, ys: number[]): number | null => {
    for (let x = b.lx / 2; x > 0; x -= 0.01)
      if (ys.every((y) => onPlate(b, sign * x, y))) return sign * x
    return null
  }
  let drop = CLEARANCE
  let play = HINGE_PLAY
  for (let pass = 0; pass < 8; pass++) {
    const tongueZ = b.bottom - drop - ring / 2
    // Staple legs stand this far either side of the tongue's side wire (centre to centre).
    const straddle = ring + play
    let layout: { half: number; post: number; staple: number; slide: number } | null = null
    for (let half = b.ly / 2; half >= straddle + ring && !layout; half -= 0.01) {
      // The tongue slides along its staples on a wrist (turning about the plates' underside)
      // and sideways (turning about the line's centre): as far as the larger, plus its play.
      const slide = HINGE_PLAY + Math.max(wristTurn * (b.bottom - tongueZ), sideTurn * half)
      const post = edgeX(1, [half, -half])
      const staple = edgeX(-1, [
        half - straddle,
        half + straddle,
        -half + straddle,
        -half - straddle,
      ])
      if (post === null || staple === null) continue
      // The staples' back legs stay inside the tongue's loop as it slides.
      if (pitch + staple - post < ring + slide) continue
      layout = { half, post, staple, slide }
    }
    if (!layout) return null
    const { half, post, staple, slide } = layout
    // The tongue reaches past the next link's staples by its slide.
    const front = pitch + staple + ring + slide
    const reach = pitch / 2 + staple
    const needDrop = CLEARANCE + wristTurn * (front - pitch / 2)
    let needPlay = HINGE_PLAY + sideTurn * reach
    if (needPlay > PLAY_MAX * ring) {
      // The hinge, not the boxes, sets how tight the line bends sideways.
      needPlay = PLAY_MAX * ring
      sideTurn = (needPlay - HINGE_PLAY) / reach
    }
    if (needDrop > drop + 1e-6 || needPlay > play + 1e-6) {
      drop = Math.max(drop, needDrop)
      play = Math.max(play, needPlay)
      continue
    }
    const corner = 0.4 * Math.min(half, (front - post) / 2)
    const tongue = roundedRect(post, front, half, corner, tongueZ)
    /** A staple round the tongue's side wire at y = side: legs up into the plate, a round foot. */
    const staplePoint =
      (side: number) =>
      (t: number): Vec3 => {
        // Down the first leg, round the foot (a half circle about the tongue's wire), up the other.
        const leg = plateMid - tongueZ
        const arc = Math.PI * straddle
        const s = t * (2 * leg + arc)
        if (s <= leg) return [staple, side - straddle, plateMid - s]
        if (s >= leg + arc) return [staple, side + straddle, tongueZ + (s - leg - arc)]
        const a = Math.PI + ((s - leg) / arc) * Math.PI
        return [staple, side + straddle * Math.cos(a), tongueZ + straddle * Math.sin(a)]
      }
    const sides = [half, -half]
    return {
      lowest: tongueZ - straddle - ring / 2,
      minBend: pitch / sideTurn,
      flat: true,
      pivot: b.bottom,
      parts: (own, quality) => {
        const { manifold: mf } = runtime()
        return [
          own(
            sweptWire(
              sampleCurve(tongue, () => [0, 0, 1], 48, true),
              ring / 2,
              quality,
            ),
          ),
          ...sides.map((side) =>
            own(
              sweptWire(
                sampleCurve(staplePoint(side), () => [1, 0, 0], 24, false),
                ring / 2,
                quality,
              ),
            ),
          ),
          // The posts start a quarter wire inside the tongue, not on its centre line: a post cap
          // centred in the wire's tube touches its surface exactly and leaves zero-area facets.
          ...sides.map((side) =>
            own(
              cylinderBetween(
                mf,
                [post, side, tongueZ - ring / 4],
                [post, side, plateMid],
                ring / 2,
                segmentsFor(ring / 2, quality.chord, 10, 40),
              ),
            ),
          ),
        ]
      },
      ahead: [{ points: polyline(tongue, 64, false), radius: ring / 2 }],
      behind: sides.map((side) => ({
        points: polyline(staplePoint(side), 33, true),
        radius: ring / 2,
      })),
    }
  }
  return null
}

/**
 * The ring hinge, for links too narrow for staples: a horizontal ring hangs on two posts under
 * the back wall, and the next link's vertical front ring, on a post under its front edge,
 * threads it. Two rings of radius R and wire `ring` stay threaded and clear while their centres
 * are `ring` to `2R − ring` apart; the centres sit at the middle of that range where the box gap
 * allows, so the hinge swings both ways, and R grows only as far as the gap between the boxes
 * needs. The rings hang one ring wire below the plate, so the front ring's arc passes under the
 * previous link's plate without touching it. Null when its posts would land in the light hole.
 */
function ringHinge(b: Box): Hinge | null {
  const { ring, pitch } = b
  const back = b.lx / 2 - b.wall / 2 - ring / 2
  const frontmost = b.lx / 2 - ring / 2
  const span = pitch - back - frontmost
  const R = Math.max(1.8 * ring, (span + ring + CLEARANCE) / 2 + CLEARANCE)
  const centres = Math.max(span, R)
  const front = -(pitch - centres - back)
  if (!onPlate(b, front, 0) || !onPlate(b, back, R)) return null
  const ringZ = b.bottom - R - ring - CLEARANCE
  const point =
    (normal: 'y' | 'z', x: number) =>
    (t: number): Vec3 => {
      const c = Math.cos(2 * Math.PI * t) * R
      const s = Math.sin(2 * Math.PI * t) * R
      return normal === 'z' ? [x + c, s, ringZ] : [x + c, 0, ringZ + s]
    }
  return {
    lowest: ringZ - R - ring / 2,
    flat: false,
    pivot: b.bottom,
    parts: (own, quality) => {
      const { manifold: mf } = runtime()
      const seg = segmentsFor(ring / 2, quality.chord, 10, 40)
      const loop = (normal: 'y' | 'z', x: number) =>
        own(
          sweptWire(
            sampleCurve(point(normal, x), () => (normal === 'z' ? [0, 0, 1] : [0, 1, 0]), 16, true),
            ring / 2,
            quality,
          ),
        )
      const post = (x: number, y: number, from: number) =>
        own(cylinderBetween(mf, [x, y, from], [x, y, b.bottom + b.wall / 2], ring / 2, seg))
      // Posts start a quarter wire inside their ring, not on its centre line, for the same
      // reason as the tongue's.
      const into = ring / 4
      return [
        loop('y', front),
        loop('z', back),
        post(front, 0, ringZ + R - into),
        post(back, R, ringZ - into),
        post(back, -R, ringZ - into),
      ]
    },
    ahead: [{ points: polyline(point('z', back), 48, false), radius: ring / 2 }],
    behind: [{ points: polyline(point('y', front), 48, false), radius: ring / 2 }],
  }
}

/** A link that falls apart into loose pieces is a bug in the proportions above, not a design. */
function assertOneShell(mesh: (quality: Quality) => ReturnType<typeof trianglesFromManifold>) {
  const link = manifoldFromTriangles(mesh(QUALITY.draft))
  const pieces = link.decompose()
  try {
    if (pieces.length !== 1)
      throw new Error(
        `The tennis link came out in ${pieces.length} pieces; try another link width or wire.`,
      )
  } finally {
    for (const m of [link, ...pieces]) m.delete()
  }
}

/** A cylinder of radius r from a to b. */
function cylinderBetween(
  mf: ReturnType<typeof runtime>['manifold'],
  a: Vec3,
  b: Vec3,
  r: number,
  segments: number,
): Manifold {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const length = Math.hypot(...d)
  const frame = frameFromZ(a, d)
  const unit = mf.Manifold.cylinder(length, r, r, segments)
  try {
    return unit.transform(frameMatrix(frame) as never)
  } finally {
    unit.delete()
  }
}

/**
 * A point round a rounded rectangle in the plane z = `z`, from x0 to x1 and ±half in y, with
 * corners of radius r, for t in [0, 1) evenly by length.
 */
function roundedRect(x0: number, x1: number, half: number, r: number, z: number) {
  const sx = x1 - x0 - 2 * r
  const sy = 2 * half - 2 * r
  const quarter = (Math.PI / 2) * r
  // Straight runs and quarter arcs, anticlockwise from the middle of the back (x0) side.
  const runs: { length: number; at: (u: number) => [number, number] }[] = []
  const arc = (cx: number, cy: number, from: number) => ({
    length: quarter,
    at: (u: number): [number, number] => [
      cx + r * Math.cos(from + (u * Math.PI) / 2),
      cy + r * Math.sin(from + (u * Math.PI) / 2),
    ],
  })
  const line = (ax: number, ay: number, bx: number, by: number) => ({
    length: Math.hypot(bx - ax, by - ay),
    at: (u: number): [number, number] => [ax + (bx - ax) * u, ay + (by - ay) * u],
  })
  runs.push(
    line(x0, 0, x0, -half + r),
    arc(x0 + r, -half + r, Math.PI),
    line(x0 + r, -half, x1 - r, -half),
    arc(x1 - r, -half + r, 1.5 * Math.PI),
    line(x1, -half + r, x1, half - r),
    arc(x1 - r, half - r, 0),
    line(x1 - r, half, x0 + r, half),
    arc(x0 + r, half - r, 0.5 * Math.PI),
    line(x0, half - r, x0, 0),
  )
  const total = 2 * sx + 2 * sy + 4 * quarter
  return (t: number): Vec3 => {
    let s = (((t % 1) + 1) % 1) * total
    for (const run of runs) {
      if (s <= run.length || run === runs[runs.length - 1]) {
        const [x, y] = run.at(run.length > 0 ? Math.min(1, s / run.length) : 0)
        return [x, y, z]
      }
      s -= run.length
    }
    return [x0, 0, z]
  }
}
