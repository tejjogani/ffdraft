/**
 * The tennis link: a stone in a four-prong box, hinged to its neighbours underneath.
 *
 * Link-local space: girdle plane z = 0, table toward +z, chain along x. The box is a rounded
 * square tube one wall thick whose top edge carries the pavilion (the stone's girdle overhangs
 * it by half a wall), closed below by a plate with a light hole of ≈ 0.66 × stone Ø
 * (docs/research/01-cad.md §2). Four prongs rise from the box corners and lean in over the
 * girdle. The hinge is a pair of interlocking rings under the plate — horizontal at the back on
 * two posts, vertical at the front — so links swing both ways like a cable chain without ever
 * touching. Every ring and post lands on plate metal, clear of the light hole.
 */
import { GEM_CUTS, type GemCutId, type GemDims, gemDims, snapToMelee } from '@pave/schema'
import type { Manifold } from 'manifold-3d'
import { type Deletable, type Quality, runtime } from '../../core'
import { circleLoop } from '../../geometry/loop'
import { frameFromZ, frameMatrix, type Vec3 } from '../../geometry/vec'
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
}

/** Space between neighbouring boxes; pitch ≈ stone + 0.3–0.6 mm (06-freeform.md §6). */
const BOX_GAP = 0.3
const CLEARANCE = 0.03
/** Prongs overlap the girdle by 15 % of their diameter (Stuller, 01-cad.md §2). */
const PRONG_OVERLAP = 0.15
/** Light hole under the stone, as a fraction of its width (JewelCraft, 01-cad.md §2). */
const LIGHT_HOLE = 0.66

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
  const prong = Math.max(0.45, wire)
  const wall = Math.max(0.4, 0.5 * prong)
  const nominal = width - wall
  const stoneWidth = nominal <= 4 ? snapToMelee(nominal) : Math.round(nominal * 20) / 20
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
  const corner = 1.5 * wall
  const crown = proportions.crownPct * stoneWidth + girdle

  const pitch = lx + BOX_GAP
  // Hinge rings: room inside for the other ring's wire plus play to swing.
  const ring = Math.max(0.3, 0.35 * prong)
  const inner = 2.6 * ring
  const holeRadius = (LIGHT_HOLE * stoneWidth) / 2
  // The front ring hangs from the plate midway between the light hole and the wall; the back
  // ring of the previous link sits one taut cable pitch behind it (contact.ts).
  const front = -(holeRadius + lx / 2) / 2
  const back = front + pitch - (inner - CLEARANCE)
  // From the table down to the bottom of the hinge rings.
  const lowest = bottom - inner - 1.5 * ring

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
      const hole = rounded(lx - 2 * wall, ly - 2 * wall, Math.max(corner - wall, 0.05))
      const walls = own(
        own(own(outer.subtract(hole)).extrude(top - plateTop)).translate(0, 0, plateTop),
      )
      const lightHole = own(
        own(
          mf.Manifold.cylinder(
            wall * 3,
            (LIGHT_HOLE * stoneWidth) / 2,
            undefined,
            seg(stoneWidth / 3),
            true,
          ),
        ).translate(0, 0, bottom + wall / 2),
      )
      const plate = own(own(own(outer.extrude(wall)).translate(0, 0, bottom)).subtract(lightHole))
      const parts: Manifold[] = [walls, plate]
      for (const [sx, sy] of [
        [1, 1],
        [-1, 1],
        [-1, -1],
        [1, -1],
      ] as const) {
        const angle = Math.atan2(sy * ly, sx * lx)
        const dir: Vec3 = [Math.cos(angle), Math.sin(angle), 0]
        const base: Vec3 = [sx * (lx / 2 - corner * 0.6), sy * (ly / 2 - corner * 0.6), top - wall]
        const reach = girdleReach(cut, dims, angle) + prong / 2 - PRONG_OVERLAP * prong
        const tip: Vec3 = [dir[0] * reach, dir[1] * reach, girdle + 0.3 * prong]
        parts.push(own(cylinderBetween(mf, base, tip, prong / 2, seg(prong / 2))))
        parts.push(own(own(mf.Manifold.sphere(prong * 0.5, seg(prong / 2))).translate(tip)))
      }
      // Hinge: a vertical ring at the front, a horizontal ring on two posts at the back.
      const R = (inner + ring) / 2
      const ringZ = bottom - R
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
        const wire = sweepAlong(line, circleLoop(ring / 2))
        try {
          return own(manifoldFromTriangles(wire.triangles(quality)))
        } finally {
          wire.dispose()
        }
      }
      parts.push(loop('y', front), loop('z', back))
      for (const side of [-1, 1])
        parts.push(
          own(
            cylinderBetween(
              mf,
              [back, side * R, ringZ],
              [back, side * R, bottom + wall / 2],
              ring / 2,
              seg(ring / 2),
            ),
          ),
        )
      return trianglesFromManifold(own(mf.Manifold.union(parts)))
    } finally {
      for (const m of temps) m.delete()
    }
  }

  // Neighbouring boxes rotate about the hinge; their inner corners close by width·θ/2.
  const minBend = (pitch * ly) / (2 * (BOX_GAP - CLEARANCE))
  return {
    template: { mesh },
    dims,
    length: lx,
    pitch,
    minBend,
    half: { y: ly / 2, z: (crown - lowest) / 2 },
    middle: (crown + lowest) / 2,
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
