/**
 * The tennis link: a stone in a four-prong box, hinged to its neighbours underneath.
 *
 * Link-local space: girdle plane z = 0, table toward +z, chain along x. The box is a rounded
 * tube one wall thick whose top edge carries the pavilion (the stone's girdle overhangs it by
 * half a wall), closed below by a plate with a light hole of ≈ 0.66 × stone Ø
 * (docs/research/01-cad.md §2). Four prongs rise from the box corners and lean in over the
 * girdle. The hinge is a pair of interlocking rings under the plate — horizontal at the back on
 * two posts, vertical at the front — so links swing both ways like a cable chain without ever
 * touching. Every ring and post lands on plate metal, clear of the light hole.
 */
import { GEM_CUTS, type GemCutId, type GemDims, gemDims, snapToMelee } from '@pave/schema'
import type { Manifold } from 'manifold-3d'
import { type Deletable, QUALITY, type Quality, runtime } from '../../core'
import { circleLoop } from '../../geometry/loop'
import { frameFromZ, frameMatrix, type Vec3 } from '../../geometry/vec'
import { weldWithin } from '../../mesh/weld'
import { manifoldFromTriangles, trianglesFromManifold } from '../../solid/solid'
import { sampleCurve, segmentsFor, sweepAlong } from './centreline'
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
}

/** The link is too narrow for its hinge: the rings and posts would land in the light hole. */
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

  // Hinge: a horizontal ring hangs on two posts under the back wall, and the next link's
  // vertical front ring, on a post under its front edge, threads it. Two rings of radius R and
  // wire `ring` stay threaded and clear while their centres are `ring` to `2R − ring` apart; the
  // centres sit at the middle of that range where the box gap allows, so the hinge swings both
  // ways, and R grows only as far as the gap between the boxes needs.
  const ring = Math.max(0.3, 0.35 * prong)
  const back = lx / 2 - wall / 2 - ring / 2
  const frontmost = lx / 2 - ring / 2
  const span = pitch - back - frontmost
  const R = Math.max(1.8 * ring, (span + ring + CLEARANCE) / 2 + CLEARANCE)
  const centres = Math.max(span, R)
  const front = -(pitch - centres - back)
  const lightHole = (LIGHT_HOLE * stoneWidth) / 2
  // Inside the plate's rounded outline and outside its light hole, by half a ring wire.
  const onPlate = (x: number, y: number) => {
    const inset = ring / 2 - 1e-9
    const qx = Math.abs(x) - (lx / 2 - corner)
    const qy = Math.abs(y) - (ly / 2 - corner)
    const inside =
      qx > 0 && qy > 0
        ? Math.hypot(qx, qy) <= corner - inset
        : Math.abs(x) <= lx / 2 - inset && Math.abs(y) <= ly / 2 - inset
    return inside && Math.hypot(x, y) - ring / 2 >= lightHole
  }
  if (!onPlate(front, 0) || !onPlate(back, R)) throw new NoRoomForHinge(stoneWidth)
  // The rings hang one ring wire below the plate, so the front ring's arc passes under the
  // previous link's plate without touching it.
  const ringZ = bottom - R - ring - CLEARANCE
  const lowest = ringZ - R - ring / 2

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
      const loop = (normal: 'y' | 'z', x: number) => {
        const line = sampleCurve(
          (t) => {
            const c = Math.cos(2 * Math.PI * t) * R
            const s = Math.sin(2 * Math.PI * t) * R
            return normal === 'z' ? [x + c, s, ringZ] : [x + c, 0, ringZ + s]
          },
          () => (normal === 'z' ? [0, 0, 1] : [0, 1, 0]),
          16,
          true,
        )
        const swept = sweepAlong(line, circleLoop(ring / 2))
        try {
          return own(manifoldFromTriangles(swept.triangles(quality)))
        } finally {
          swept.dispose()
        }
      }
      parts.push(loop('y', front), loop('z', back))
      const post = (x: number, y: number, from: number) =>
        own(cylinderBetween(mf, [x, y, from], [x, y, bottom + wall / 2], ring / 2, seg(ring / 2)))
      // Posts start a quarter wire inside their ring, not on its centre line, for the same
      // reason: a post cap centred in the ring's tube touches its surface exactly.
      const into = ring / 4
      parts.push(
        post(front, 0, ringZ + R - into),
        post(back, R, ringZ - into),
        post(back, -R, ringZ - into),
      )
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

  // Neighbouring boxes rotate about the hinge; their inner corners close by width·θ/2.
  const minBend = (pitch * 2 * halfY) / (2 * (gap - CLEARANCE))
  return {
    template: { mesh },
    dims,
    length: lx,
    pitch,
    minBend,
    half: { y: halfY, z: (crown - lowest) / 2 },
    middle: (crown + lowest) / 2,
    prong,
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
